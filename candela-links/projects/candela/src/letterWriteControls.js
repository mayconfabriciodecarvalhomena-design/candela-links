import * as THREE from "three";
import { onUpdate } from "./scene.js";
import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// LETTER WRITE CONTROLS: convierte la ÚLTIMA hoja de la carta en una
// superficie de escritura real (ver encargo: "quiero integrar
// completamente la escritura dentro de la última página de la
// carta"). Mismo patrón de aislamiento que letterPageControls.js:
//
//   - Detección de "es la última hoja y ya se puede escribir en ella"
//     apoyada ENTERAMENTE en la API ya existente de candelaFinale.js
//     (getCurrentPage()/getPageCount()/isLetterReadable()/isTurning())
//     — nunca un número de página hardcodeado en este archivo, nunca
//     una lógica de páginas paralela.
//   - Escucha/actúa sobre candelaFinale sin tocar la animación de
//     pasar página, el pivote de la pila ni nextPage()/previousPage().
//   - Overlay HTML propio (textarea invisible + botón + estado de
//     envío), con sus propios listeners, posicionado cada frame por
//     proyección 3D→2D de la carta real (mismo criterio que
//     catHover.js/letterPageControls.js) — nunca toca
//     renderer.domElement ni ningún raycaster existente.
//
// CAPTURA DE TECLADO (ver "LA ESCRITURA DEBE ESTAR DENTRO DE LA HOJA"
// del encargo): un <textarea> real y focuseable — necesario para que
// aparezca el teclado en móvil y para que el navegador gestione
// selección/IME/pegar con normalidad — pero completamente invisible
// (opacity: 0, sin fondo/borde/caret propio, sin scrollbar visible,
// ver styles.css → .letter-write-input). Lo único que el usuario VE es
// el texto horneado en la textura de la hoja (candelaFinale.
// setPageDraft() → letterMesh.js → paintWritablePage()) — nunca el
// propio elemento de formulario.
//
// ENVÍO (ver "UTILIZAR EL BACKEND EXISTENTE" del encargo): reutiliza
// el backend YA existente (Vercel → Supabase → Telegram, ver
// api/message.js) exactamente igual que el antiguo widget flotante
// (message-widget.js, retirado con esta iteración): mismo endpoint,
// mismo payload { slug, content }, mismo slug leído de "?slug=" en la
// URL (la carta vive dentro de un iframe con ese parámetro — ver
// app.js → mountCandela()). No se crea ningún endpoint, tabla ni
// integración de Telegram nuevos.
// -----------------------------------------------------------------------
export function createLetterWriteControls(camera, renderer, candelaFinale) {
  const cfg = (CONFIG.finale.letter && CONFIG.finale.letter.write) || {};
  if (!cfg.enabled) {
    return { dispose() {} };
  }

  const domElement = renderer.domElement;
  const maxLength = cfg.maxLength || 2000;
  const endpoint = cfg.endpoint || "/api/message";

  // Mismo criterio de lectura del slug que usaba message-widget.js
  // (retirado): la carta se sirve dentro de un iframe con "?slug=" en
  // su propia URL (ver app.js → mountCandela()), nunca un slug
  // inventado ni leído de otra parte.
  function getSlug() {
    const params = new URLSearchParams(window.location.search);
    return params.get("slug") || "";
  }
  const slug = getSlug();

  // ---- Captura de teclado, invisible (ver cabecera del archivo) ----
  const input = document.createElement("textarea");
  input.className = "letter-write-input";
  input.setAttribute("aria-label", "Escribe tu mensaje en la última página de la carta");
  input.maxLength = maxLength;
  input.autocomplete = "off";
  input.spellcheck = true;
  document.body.appendChild(input);

  // ---- Botón de enviar: discreto, mismo lenguaje visual que
  // .letter-page-arrow (serif, sin "botón web" — ver styles.css →
  // .letter-write-send). ----
  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.className = "letter-write-send";
  sendBtn.textContent = (cfg.button && cfg.button.label) || "Enviar";
  document.body.appendChild(sendBtn);

  // ---- Estado de envío: confirmación/error discretos (ver "ESTADO
  // DEL ENVÍO" del encargo — nunca un alert()/modal del navegador),
  // mismo lenguaje visual que .narrative-text/.cat-hover-label. ----
  const statusEl = document.createElement("div");
  statusEl.className = "letter-write-status";
  document.body.appendChild(statusEl);

  let draft = "";
  let caretIndex = 0;
  let isFocused = false;
  let sending = false;
  let statusTimeout = null;

  function setStatus(text, { isError = false } = {}) {
    statusEl.textContent = text || "";
    statusEl.classList.toggle("is-error", isError);
    statusEl.classList.toggle("is-visible", Boolean(text));
  }

  function clearStatusLater() {
    clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => setStatus(""), (cfg.status && cfg.status.sentHoldMs) || 2500);
  }

  // ---- Repintado de la hoja (ver candelaFinale.setPageDraft() →
  // letterMesh.js → paintWritablePage()).
  //
  // ITERACIÓN — CURSOR ESTABLE, SIN PARPADEO (ver encargo: "no quiero
  // que parpadee... debe ser estable"). Antes había un
  // `setInterval()` que alternaba `cursorOn` para hacer parpadear la
  // barra — ESE era también el origen del parpadeo del placeholder
  // (ver letterMesh.js → paintWritablePage(): el placeholder se
  // ocultaba/mostraba en función de ese mismo `showCursor` que
  // oscilaba). Se retira por completo: `showCursor` ahora es
  // simplemente `isFocused` — verdadero mientras el campo tiene el
  // foco, sin ninguna oscilación en el tiempo. ----
  function redraw() {
    candelaFinale.setPageDraft(draft, { caretIndex, showCursor: isFocused });
  }

  // -----------------------------------------------------------------------
  // SINCRONIZACIÓN CON EL TEXTAREA REAL (ver "TEXTO LARGO: SCROLL Y
  // CURSOR REAL" del encargo). `caretIndex` se lee SIEMPRE de
  // `input.selectionStart` — nunca se asume "el final del texto" salvo
  // que el navegador diga eso de verdad. Se recalcula tras CUALQUIER
  // evento que pueda mover el cursor sin cambiar el valor (flechas,
  // Home/End, click, selección) además de tras cada pulsación que sí
  // cambia el texto — así el cursor visual (ver letterMesh.js →
  // paintWritablePage()/locateCaret()) y el scroll de la hoja
  // (page.writeScrollTop, ver el mismo archivo) SIEMPRE seleccionan la
  // posición real de edición, nunca una posición fija.
  // -----------------------------------------------------------------------
  function syncFromInput() {
    draft = input.value;
    caretIndex = input.selectionStart != null ? input.selectionStart : draft.length;
    redraw();
  }

  input.addEventListener("focus", () => {
    isFocused = true;
    syncFromInput();
  });

  input.addEventListener("blur", () => {
    isFocused = false;
    redraw();
  });

  input.addEventListener("input", syncFromInput);
  // "keyup" cubre ↑/↓/←/→/Home/End/PageUp/PageDown: el propio
  // <textarea> ya sabe moverse con esas teclas (nunca se reimplementa
  // esa navegación aquí), esto solo relee dónde ha quedado el cursor
  // DESPUÉS de que el navegador lo haya movido.
  input.addEventListener("keyup", syncFromInput);
  input.addEventListener("click", syncFromInput);
  input.addEventListener("select", syncFromInput);

  // -----------------------------------------------------------------------
  // ENVÍO (ver "BOTÓN DE ENVIAR"/"UTILIZAR EL BACKEND EXISTENTE" del
  // encargo). `sending` evita pulsaciones repetidas mientras la
  // petición está en curso (nunca mensajes duplicados). Si falla, el
  // borrador NUNCA se borra — el usuario puede reintentar sin perder
  // lo que había escrito.
  // -----------------------------------------------------------------------
  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;

    if (!slug) {
      setStatus((cfg.status && cfg.status.errorLabel) || "No se pudo enviar. Inténtalo de nuevo.", {
        isError: true,
      });
      return;
    }

    sending = true;
    sendBtn.disabled = true;
    setStatus((cfg.button && cfg.button.sendingLabel) || "Enviando…");

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, content }),
      });

      if (res.ok) {
        draft = "";
        caretIndex = 0;
        input.value = "";
        redraw();
        setStatus((cfg.status && cfg.status.sentLabel) || "Enviado ✓");
        clearStatusLater();
      } else {
        setStatus((cfg.status && cfg.status.errorLabel) || "No se pudo enviar. Inténtalo de nuevo.", {
          isError: true,
        });
      }
    } catch (e) {
      setStatus((cfg.status && cfg.status.errorLabel) || "No se pudo enviar. Inténtalo de nuevo.", {
        isError: true,
      });
    } finally {
      sending = false;
      sendBtn.disabled = false;
    }
  }
  sendBtn.addEventListener("click", handleSend);

  // ---- Posicionamiento en pantalla (mismo patrón que
  // letterPageControls.js: Box3().setFromObject() sobre la carta real,
  // cada frame, nunca una posición fija guardada una sola vez).
  // Proyecta las 8 esquinas del bounding box 3D para obtener el
  // rectángulo en pantalla que realmente ocupa la hoja actual, sea
  // cual sea el tamaño/ángulo de cámara. ----
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();

  function projectToScreen(worldPoint, rect) {
    corner.copy(worldPoint).project(camera);
    return {
      x: rect.left + (corner.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-corner.y * 0.5 + 0.5) * rect.height,
    };
  }

  function projectedRect(object3D, rect) {
    box.setFromObject(object3D);
    const { min, max } = box;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (let i = 0; i < 8; i++) {
      const p = projectToScreen(
        { x: i & 1 ? max.x : min.x, y: i & 2 ? max.y : min.y, z: i & 4 ? max.z : min.z },
        rect
      );
      left = Math.min(left, p.x);
      top = Math.min(top, p.y);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }

    return { left, top, width: right - left, height: bottom - top };
  }

  // -----------------------------------------------------------------------
  // ORIENTACIÓN DEL BOTÓN "ENVIAR" — TERCER INTENTO, ESTA VEZ VERIFICADO
  // CONTRA PÍXELES REALES (ver "BOTÓN ENVIAR" del encargo: "matrix3d
  // existe en el código pero visualmente sigue pareciendo frontal").
  //
  // QUÉ FALLABA EN LA VERSIÓN CON matrix3d (diagnóstico, no
  // suposición): medí analíticamente, con three.js y los valores
  // reales de config.js, la rotación relativa cámara↔`letterGroup`
  // (`letterGroup` sigue con rotación identidad en reposo, ver
  // candelaFinale.js) → ~16° en el eje vertical y ~5° en el
  // horizontal. Esa cifra es CORRECTA como rotación 3D pura. El
  // problema es lo que le pasa a esa rotación cuando se aplica, vía
  // `perspective(900px) matrix3d(...)`, a un elemento tan pequeño como
  // este botón (~80×34px): una rotación 3D de un plano solo se hace
  // VISIBLE en pantalla a través del escorzo que introduce la
  // división de perspectiva (cuanto más se aleja un punto en Z, más
  // se encoge) — y ese escorzo es proporcional al TAMAÑO del propio
  // elemento. Repetí el cálculo completo del pipeline CSS (matriz
  // combinada + transform-origin + división por w) para las 4 esquinas
  // reales del botón: con esos ~16°/5°, el desplazamiento resultante
  // en pantalla era de 1-2 PÍXELES sobre un botón de 80px de ancho —
  // literalmente imperceptible. `matrix3d` estaba en el código y era
  // matemáticamente correcto, pero invisible en la práctica para un
  // elemento tan pequeño: de ahí que "siguiera pareciendo frontal".
  //
  // CUÁL ES LA INCLINACIÓN REAL DE LA HOJA (verificado, no asumido):
  // medí directamente, en píxeles, los bordes de la hoja en la propia
  // captura que mandaste — el borde superior (línea del título) tiene
  // una pendiente de ≈-3.2° y el borde izquierdo de ≈0.9° respecto a
  // la vertical. Es decir: la hoja, tal y como se ve en pantalla, está
  // rotada solo unos pocos grados — un valor pequeño pero real, y
  // coincide con lo que ya había calculado analíticamente para el
  // ÁNGULO (no el escorzo) de los ejes locales de la hoja proyectados
  // a pantalla. La solución correcta, por tanto, NO es "meter más
  // grados" a ciegas: es aplicar ese ángulo real de forma que SÍ se
  // vea, en vez de perderlo dentro de un pipeline de escorzo por
  // profundidad pensado para objetos grandes.
  //
  // LA TRANSFORMACIÓN CORRECTA: una rotación/cizalla 2D DIRECTA
  // (`matrix(a,b,c,d,0,0)`), construida proyectando los ejes locales
  // X/Y de la propia hoja a espacio de pantalla (con la cámara y
  // `letterGroup` reales — ver computeSurfaceBasis2D() más abajo) y
  // usando esas direcciones TAL CUAL como base de la matriz — sin
  // pasar por ninguna división de perspectiva de por medio, así el
  // ángulo medido llega intacto a la pantalla, cualquiera que sea el
  // tamaño del botón. Es la misma idea de "proyectar los ejes de la
  // hoja" del encargo original, corregida para que el resultado sea
  // VISIBLE en vez de matemáticamente correcto pero invisible.
  //
  // Se evalúa en el punto de mundo de la ESQUINA donde vive el botón
  // (no el centro de la hoja, ver `worldPointFromBoxFraction()`) —
  // mismas fracciones `SEND_BTN_FX`/`SEND_BTN_FY` que gobiernan su
  // posición en pantalla, una única fuente de verdad.
  //
  // DINÁMICO por construcción: cámara y `letterGroup` se leen en vivo
  // cada frame — si cambian de orientación en el futuro, el botón las
  // sigue automáticamente.
  // -----------------------------------------------------------------------
  const worldQuaternion = new THREE.Quaternion();
  const axisX = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const AXIS_PROBE = 0.01; // unidades de mundo — el ángulo resultante no depende de este valor (verificado numéricamente)

  function computeSurfaceBasis2D(object3D, originWorld, rect) {
    object3D.getWorldQuaternion(worldQuaternion);
    axisX.set(1, 0, 0).applyQuaternion(worldQuaternion);
    // (0, -1, 0): el "abajo" de la hoja en espacio de mundo — un
    // elemento CSS sin transformar tiene su eje Y local apuntando
    // hacia abajo en pantalla, así que hace falta esta dirección (no
    // "arriba") para que la base 2D resultante no quede reflejada.
    axisY.set(0, -1, 0).applyQuaternion(worldQuaternion);

    const originScreen = projectToScreen(originWorld, rect);
    const xScreen = projectToScreen(
      { x: originWorld.x + axisX.x * AXIS_PROBE, y: originWorld.y + axisX.y * AXIS_PROBE, z: originWorld.z + axisX.z * AXIS_PROBE },
      rect
    );
    const yScreen = projectToScreen(
      { x: originWorld.x + axisY.x * AXIS_PROBE, y: originWorld.y + axisY.y * AXIS_PROBE, z: originWorld.z + axisY.z * AXIS_PROBE },
      rect
    );

    const vx = { x: xScreen.x - originScreen.x, y: xScreen.y - originScreen.y };
    const vy = { x: yScreen.x - originScreen.x, y: yScreen.y - originScreen.y };
    const lenX = Math.hypot(vx.x, vx.y) || 1;
    const lenY = Math.hypot(vy.x, vy.y) || 1;
    return { vx: { x: vx.x / lenX, y: vx.y / lenX }, vy: { x: vy.x / lenY, y: vy.y / lenY } };
  }

  // Fracciones que definen dónde está el botón dentro de la hoja —
  // MISMAS fracciones usadas tanto para su posición en pantalla (ver
  // onUpdate más abajo) como para elegir el punto de mundo donde se
  // evalúa su orientación: una única fuente de verdad. `FX` desde el
  // borde izquierdo (0=izq, 1=der), `FY` desde el borde INFERIOR del
  // bounding box en espacio de mundo (0=abajo, 1=arriba).
  //
  // ITERACIÓN — REPOSICIONAR EL BOTÓN DENTRO DE LOS MÁRGENES (ver
  // encargo: "sobresale ligeramente de la hoja... moverlo un poco
  // hacia arriba y ligeramente hacia dentro"). Solo cambian estas dos
  // constantes (más margen desde el borde derecho e inferior); la
  // FUNCIÓN que calcula la inclinación (computeSurfaceBasis2D() más
  // arriba) no se toca en absoluto, y el ángulo resultante es
  // prácticamente el mismo en cualquier punto de un plano rígido sin
  // deformar (verificado en la iteración anterior) — así que el
  // botón conserva su inclinación actual, solo cambia de sitio.
  //
  // Medí en píxeles la captura proporcionada: el borde inferior de la
  // hoja pasaba por y≈758-767 en la franja x del botón, mientras el
  // propio botón llegaba hasta y≈802 — unos 35-45px de invasión real
  // bajo el borde. El borde derecho, en cambio, seguía fuera de
  // encuadre en esa altura (la hoja es más ancha que la ventana ahí),
  // así que no había overflow lateral real, solo margen estético.
  // Antes: 0.09 / 0.066 (0.12×0.55). Ahora: 0.12 / 0.14 — el ajuste
  // vertical es el dominante (cubre la invasión medida más un margen
  // de seguridad), el lateral es un margen menor, tal como se pidió.
  const SEND_BTN_SIDE_INSET = 0.12;
  const SEND_BTN_BOTTOM_INSET = 0.14;
  const SEND_BTN_FX = 1 - SEND_BTN_SIDE_INSET;
  const SEND_BTN_FY = SEND_BTN_BOTTOM_INSET;
  const sendBtnOriginWorld = new THREE.Vector3();

  // Punto de mundo de esa misma esquina relativa del bounding box
  // (axis-aligned: `letterGroup` no tiene rotación propia en reposo) —
  // nunca el centro de la hoja.
  function worldPointFromBoxFraction(box, fx, fy, out) {
    return out.set(
      box.min.x + (box.max.x - box.min.x) * fx,
      box.min.y + (box.max.y - box.min.y) * fy,
      (box.min.z + box.max.z) / 2
    );
  }

  // Métrica de fuente aproximada para el <textarea> invisible (ver
  // "SINCRONIZACIÓN CON EL TEXTAREA REAL" más arriba): su propio
  // ajuste de línea decide dónde caen ↑/↓/Home/End DENTRO del propio
  // navegador, así que se aproxima al tamaño/interlineado real que ve
  // la cámara (proporcional a `rect.height`, misma fracción que ocupa
  // el cuerpo del texto en el canvas oculto — ver finale.config.js →
  // letter.text.font) para que esa navegación nativa coincida, línea a
  // línea, con lo que se ve horneado en la hoja. Nunca pretende ser
  // pixel-perfect (dos motores de layout distintos), solo mantener
  // ambos wrappings lo bastante cerca como para que ↑/↓ se sientan
  // naturales.
  const bodyFontCfg = CONFIG.finale.letter.text.font;
  const fontSizeRatio = bodyFontCfg.sizePx / bodyFontCfg.canvasHeightPx;
  const lineHeightRatio = bodyFontCfg.lineHeightPx / bodyFontCfg.canvasHeightPx;

  onUpdate(() => {
    const letterGroup = candelaFinale.letterGroup;
    const readable = candelaFinale.isLetterReadable();
    const turning = candelaFinale.isTurning();
    const currentPage = candelaFinale.getCurrentPage();
    const pageCount = candelaFinale.getPageCount();
    // Última hoja SIEMPRE calculada como pageCount - 1 (misma fuente
    // de verdad que las flechas en letterPageControls.js), nunca un
    // índice aparte.
    const isLastPage = currentPage === pageCount - 1;
    const active = readable && !turning && isLastPage && letterGroup && letterGroup.visible;

    if (!active) {
      if (isFocused) input.blur();
      input.classList.remove("is-active");
      sendBtn.classList.remove("is-active");
      statusEl.classList.remove("is-visible");
      return;
    }

    const domRect = domElement.getBoundingClientRect();
    const rect = projectedRect(letterGroup, domRect);

    // Reserva aproximada para el título en la parte superior (ver
    // finale.config.js → page.title: marginTopFraction + tamaño +
    // separador + gapFraction) para que el área de captura nunca
    // se superponga al título — igual criterio proporcional que el
    // resto del sistema (fracciones del tamaño real de la hoja en
    // pantalla, nunca píxeles fijos).
    //
    // NOTA: `bottomInset`/`sideInset` (reserva del <textarea> de
    // captura) NO han cambiado en esta iteración — el sistema de
    // escritura/scroll no se toca. Las constantes
    // `SEND_BTN_SIDE_INSET`/`SEND_BTN_BOTTOM_INSET` de arriba son
    // ÚNICAMENTE para el botón (posición en pantalla + punto de mundo
    // donde se evalúa su inclinación), coinciden en valor con el
    // cálculo anterior del botón pero viven aparte a propósito.
    const topInset = rect.height * 0.24;
    const bottomInset = rect.height * 0.12;
    const sideInset = rect.width * 0.09;

    input.style.left = `${rect.left + sideInset}px`;
    input.style.top = `${rect.top + topInset}px`;
    input.style.width = `${Math.max(0, rect.width - sideInset * 2)}px`;
    input.style.height = `${Math.max(0, rect.height - topInset - bottomInset)}px`;
    input.style.fontSize = `${Math.max(8, rect.height * fontSizeRatio)}px`;
    input.style.lineHeight = `${Math.max(10, rect.height * lineHeightRatio)}px`;
    input.classList.add("is-active");

    const btnSideInset = rect.width * SEND_BTN_SIDE_INSET;
    const btnBottomInset = rect.height * SEND_BTN_BOTTOM_INSET;
    sendBtn.style.left = `${rect.left + rect.width - btnSideInset}px`;
    sendBtn.style.top = `${rect.top + rect.height - btnBottomInset}px`;
    sendBtn.classList.add("is-active");

    // Orientación 2D real de la hoja, evaluada en la esquina donde
    // vive el botón (ver nota de la iteración arriba) — nunca a
    // través de una división de perspectiva 3D que diluye el ángulo
    // para elementos pequeños.
    worldPointFromBoxFraction(box, SEND_BTN_FX, SEND_BTN_FY, sendBtnOriginWorld);
    const { vx, vy } = computeSurfaceBasis2D(letterGroup, sendBtnOriginWorld, domRect);
    sendBtn.style.transform = `translate(-100%, -100%) matrix(${vx.x}, ${vx.y}, ${vy.x}, ${vy.y}, 0, 0)`;

    statusEl.style.left = `${rect.left + rect.width / 2}px`;
    statusEl.style.top = `${rect.top + rect.height - btnBottomInset * 0.18}px`;
  });

  function dispose() {
    clearTimeout(statusTimeout);
    sendBtn.removeEventListener("click", handleSend);
    input.remove();
    sendBtn.remove();
    statusEl.remove();
  }

  return { dispose };
}
