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
  // letterMesh.js → paintWritablePage()) + parpadeo del cursor
  // mientras el campo tiene el foco (ver "CRITERIO DE CALIDAD" del
  // encargo: que se sienta como estar escribiendo de verdad). ----
  let cursorOn = true;
  let cursorTimer = null;

  function redraw() {
    candelaFinale.setPageDraft(draft, { showCursor: isFocused && cursorOn });
  }

  function startCursorBlink() {
    stopCursorBlink();
    cursorOn = true;
    const blinkMs = (cfg.cursor && cfg.cursor.blinkMs) || 530;
    cursorTimer = setInterval(() => {
      cursorOn = !cursorOn;
      redraw();
    }, blinkMs);
  }

  function stopCursorBlink() {
    if (cursorTimer) clearInterval(cursorTimer);
    cursorTimer = null;
  }

  input.addEventListener("focus", () => {
    isFocused = true;
    startCursorBlink();
    redraw();
  });

  input.addEventListener("blur", () => {
    isFocused = false;
    stopCursorBlink();
    redraw();
  });

  input.addEventListener("input", () => {
    draft = input.value;
    redraw();
  });

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

  function projectedRect(object3D) {
    box.setFromObject(object3D);
    const { min, max } = box;
    const rect = domElement.getBoundingClientRect();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).project(camera);
      const sx = rect.left + (corner.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-corner.y * 0.5 + 0.5) * rect.height;
      left = Math.min(left, sx);
      top = Math.min(top, sy);
      right = Math.max(right, sx);
      bottom = Math.max(bottom, sy);
    }

    return { left, top, width: right - left, height: bottom - top };
  }

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

    const rect = projectedRect(letterGroup);

    // Reserva aproximada para el título en la parte superior (ver
    // finale.config.js → page.title: marginTopFraction + tamaño +
    // separador + gapFraction) para que el área de captura nunca
    // se superponga al título — igual criterio proporcional que el
    // resto del sistema (fracciones del tamaño real de la hoja en
    // pantalla, nunca píxeles fijos).
    const topInset = rect.height * 0.24;
    const bottomInset = rect.height * 0.12;
    const sideInset = rect.width * 0.09;

    input.style.left = `${rect.left + sideInset}px`;
    input.style.top = `${rect.top + topInset}px`;
    input.style.width = `${Math.max(0, rect.width - sideInset * 2)}px`;
    input.style.height = `${Math.max(0, rect.height - topInset - bottomInset)}px`;
    input.classList.add("is-active");

    sendBtn.style.left = `${rect.left + rect.width - sideInset}px`;
    sendBtn.style.top = `${rect.top + rect.height - bottomInset * 0.55}px`;
    sendBtn.classList.add("is-active");

    statusEl.style.left = `${rect.left + rect.width / 2}px`;
    statusEl.style.top = `${rect.top + rect.height - bottomInset * 0.1}px`;
  });

  function dispose() {
    stopCursorBlink();
    clearTimeout(statusTimeout);
    sendBtn.removeEventListener("click", handleSend);
    input.remove();
    sendBtn.remove();
    statusEl.remove();
  }

  return { dispose };
}
