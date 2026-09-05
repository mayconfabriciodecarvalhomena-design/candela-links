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
  // ORIENTACIÓN DEL BOTÓN "ENVIAR" (ver "BOTÓN ENVIAR" del encargo de
  // esta iteración): la carta se ve en perspectiva desde una cámara que
  // NO mira de frente al plano de la hoja (ver config.js →
  // CONFIG.camera.position/lookAt) — por eso, aunque `letterGroup`
  // nunca tiene rotación propia en reposo (ver candelaFinale.js →
  // applyRestLayout()/computeLetterEmergePath(), "la orientación se
  // deja en su identidad por defecto"), la hoja SÍ se dibuja como un
  // cuadrilátero ligeramente inclinado en pantalla — puro efecto de
  // perspectiva. El botón, al ser un rectángulo HTML plano, se notaba
  // "pegado a la cámara" por no seguir esa misma inclinación.
  //
  // ITERACIÓN — ROTACIÓN 3D REAL EN VEZ DE UN SHEAR 2D APROXIMADO (ver
  // encargo: "el botón sigue sin integrarse... del revés/poco
  // contraste" en iteraciones previas). Los intentos anteriores
  // proyectaban dos ejes cercanos a un punto del plano (con un
  // pequeño desplazamiento de sondeo) y usaban esa diferencia como una
  // matriz 2D (`matrix(a,b,c,d,...)`) — una aproximación LOCAL de la
  // perspectiva que, medida numéricamente contra la cámara real de
  // config.js, resultaba en apenas 2-3° de inclinación aparente:
  // técnicamente correcta pero demasiado sutil para leerse como "la
  // hoja está inclinada", y además dependía de EN QUÉ PUNTO del plano
  // se evaluaba (el centro daba un resultado ligeramente distinto que
  // la esquina), lo cual no tiene sentido físico para un plano RÍGIDO:
  // un plano sin deformar tiene la MISMA orientación en todos sus
  // puntos, solo cambia su posición/escala proyectada.
  //
  // La orientación real de la hoja respecto a la cámara es, por
  // definición, la ROTACIÓN RELATIVA entre la cámara y `letterGroup`
  // (ambas como quaterniones de mundo) — totalmente independiente de
  // en qué punto del plano se evalúe, y del tamaño del botón. Medida
  // con los valores reales de config.js (cámara + `letterGroup`
  // identidad), esa rotación relativa es de ~16° en el eje vertical y
  // ~5° en el horizontal: un valor mucho más fiel a lo que se ve en
  // pantalla que el shear anterior.
  //
  // Cálculo (reutilizando EXACTAMENTE la cámara y el `letterGroup` que
  // ya usa el resto del archivo para proyectar, sin ningún sistema
  // paralelo):
  //   1. `camera.getWorldQuaternion()` y `letterGroup.getWorldQuaternion()`
  //      — orientación real de cámara y hoja en espacio de mundo.
  //   2. `relative = inverse(cámara) * hoja` — la orientación de la
  //      hoja TAL COMO LA VE la cámara (si la cámara mirase
  //      perfectamente de frente, `relative` sería la identidad).
  //   3. La convención de three.js es Y-arriba; la de un elemento CSS
  //      sin transformar es Y-abajo. Se corrige conjugando la matriz
  //      con `F = diag(1,-1,1)` (F·M·F) — mismo tipo de corrección de
  //      signo que ya hizo falta en la versión anterior (con un único
  //      eje en vez de una matriz 3×3 completa) para arreglar el botón
  //      "del revés".
  //   4. Los elementos de esa matriz (`THREE.Matrix4.elements` ya está
  //      en orden column-major, EXACTAMENTE lo que espera
  //      `matrix3d(...)` en CSS) se usan directamente como
  //      `transform: ... matrix3d(...)`.
  //
  // Como es una rotación pura (sin escalado ni traslación), el botón
  // conserva su tamaño real — la ligera reducción de anchura aparente
  // que produce el propio `matrix3d` al rotarlo es, precisamente, el
  // mismo escorzo que sufriría un objeto real pegado a esa hoja: es lo
  // que hace que "el tamaño aparente sea coherente con la escala de la
  // hoja" (ver encargo), no una escala manual.
  //
  // DINÁMICO por construcción: se recalcula cada frame a partir de la
  // cámara y `letterGroup` REALES (nunca un ángulo fijo "a ojo") — si
  // la cámara o la orientación de la hoja cambiaran en el futuro, el
  // botón las seguiría automáticamente sin tocar este código.
  // -----------------------------------------------------------------------
  const camWorldQuat = new THREE.Quaternion();
  const planeWorldQuat = new THREE.Quaternion();
  const relativeQuat = new THREE.Quaternion();
  const relativeMatrix = new THREE.Matrix4();
  // F = diag(1,-1,1,1): conjugación Y-arriba (three.js) -> Y-abajo
  // (CSS) — constante, se construye una sola vez.
  const CSS_Y_FLIP = new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const tmpMatrix = new THREE.Matrix4();

  function computeButtonMatrix3d(cameraObj, planeObj) {
    cameraObj.getWorldQuaternion(camWorldQuat).invert();
    planeObj.getWorldQuaternion(planeWorldQuat);
    relativeQuat.copy(planeWorldQuat).premultiply(camWorldQuat);
    relativeMatrix.makeRotationFromQuaternion(relativeQuat);
    // M' = F · M · F (ver cabecera de la función)
    tmpMatrix.copy(CSS_Y_FLIP).multiply(relativeMatrix).multiply(CSS_Y_FLIP);
    return tmpMatrix.elements;
  }

  // Fracciones que definen dónde está el botón dentro de la hoja, en
  // pantalla (ver onUpdate más abajo) — el botón vive cerca de la
  // esquina inferior-derecha.
  const SEND_BTN_SIDE_INSET = 0.09;
  const SEND_BTN_BOTTOM_INSET = 0.12 * 0.55;

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

    // Rotación 3D real cámara↔hoja (ver nota de la iteración arriba) —
    // uniforme en todo el plano, no depende de dónde esté el botón.
    const m = computeButtonMatrix3d(camera, letterGroup);
    sendBtn.style.transform = `translate(-100%, -100%) perspective(900px) matrix3d(${m.join(",")})`;

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
