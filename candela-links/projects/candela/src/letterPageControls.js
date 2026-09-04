import * as THREE from "three";
import { onUpdate } from "./scene.js";

// -----------------------------------------------------------------------
// LETTER PAGE CONTROLS: dos flechas discretas ("‹" / "›") para pasar de
// página en la carta del final (nextPage()/previousPage(), ya
// existentes en candelaFinale.js — este módulo NO crea ningún sistema
// de páginas paralelo, solo las controla).
//
// Mismo patrón que catHover.js (overlay HTML posicionado por
// proyección 3D→2D, con su PROPIO listener de "click" sobre sus
// propios elementos — nunca toca renderer.domElement ni su raycaster):
// las flechas son dos <div> con position:fixed, positionados cada
// frame junto al borde izquierdo/derecho de la carta REAL (proyectando
// su bounding box actual, igual que catHover.js hace con `cat.model`),
// y con pointer-events:none salvo cuando están visibles — así nunca
// pueden interferir con la cerilla (matchesController.js), el gato
// (catHover.js) o la Hello Kitty (helloKittyInspection.js): esos
// sistemas escuchan eventos sobre el <canvas>; estas flechas son
// elementos DOM aparte, por encima en el z-index, que solo capturan el
// click cuando el propio navegador determina que el puntero está sobre
// su área visible — nunca antes de que exista intersección real.
//
// Solo se muestran una vez la carta está "legible" (candelaFinale.
// isLetterReadable(): FINAL_HOLD o DONE — la carta ya llegó a su
// posición final y dejó de moverse) y solo la que tenga sentido según
// la página actual (getCurrentPage()/getPageCount()): en la primera
// hoja no aparece "anterior"; en la última, no aparece "siguiente" —
// navegación ACOTADA, sin bucle (ver letterMesh.js: la pila tiene un
// principio y un final reales, `nextPage()`/`previousPage()` ya se
// bloquean solos en esos límites, esto solo refleja lo mismo en la UI).
// Mientras haya una transición en curso (isTurning()) ambas quedan
// deshabilitadas (atenuadas, sin recibir clicks) para que nunca se
// puedan lanzar dos transiciones a la vez.
// -----------------------------------------------------------------------
export function createLetterPageControls(camera, renderer, candelaFinale) {
  const domElement = renderer.domElement;

  function createArrowElement(direction, glyph) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "letter-page-arrow";
    el.dataset.direction = direction;
    el.setAttribute("aria-label", direction === "prev" ? "Página anterior" : "Página siguiente");
    el.textContent = glyph;
    document.body.appendChild(el);
    return el;
  }

  const prevEl = createArrowElement("prev", "\u2039"); // ‹
  const nextEl = createArrowElement("next", "\u203A"); // ›

  function handlePrevClick() {
    if (!candelaFinale.isLetterReadable()) return;
    if (candelaFinale.isTurning()) return;
    if (candelaFinale.getCurrentPage() <= 0) return;
    candelaFinale.previousPage();
  }

  function handleNextClick() {
    if (!candelaFinale.isLetterReadable()) return;
    if (candelaFinale.isTurning()) return;
    if (candelaFinale.getCurrentPage() >= candelaFinale.getPageCount() - 1) return;
    candelaFinale.nextPage();
  }

  prevEl.addEventListener("click", handlePrevClick);
  nextEl.addEventListener("click", handleNextClick);

  // ---- Posicionamiento en pantalla (mismo patrón que catHover.js:
  // Box3().setFromObject() sobre el objeto 3D real, cada frame, nunca
  // una posición fija guardada una sola vez) ----
  const box = new THREE.Box3();
  const anchorLeft = new THREE.Vector3();
  const anchorRight = new THREE.Vector3();
  const projected = new THREE.Vector3();

  // Separación extra respecto al borde real de la carta (unidades de
  // mundo) para que las flechas queden claramente FUERA de la hoja,
  // nunca superpuestas al texto ni pegadas al canto.
  const EDGE_MARGIN = 0.045;

  function positionArrow(el, worldX, worldY, worldZ) {
    projected.set(worldX, worldY, worldZ).project(camera);
    if (projected.z > 1) {
      // Punto detrás de la cámara: caso límite defensivo, igual
      // criterio que catHover.js.
      el.classList.remove("is-visible");
      return;
    }
    const rect = domElement.getBoundingClientRect();
    const x = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  onUpdate(() => {
    const letterGroup = candelaFinale.letterGroup;
    const readable = candelaFinale.isLetterReadable();
    const turning = candelaFinale.isTurning();

    if (!readable || !letterGroup || !letterGroup.visible) {
      prevEl.classList.remove("is-visible");
      nextEl.classList.remove("is-visible");
      return;
    }

    box.setFromObject(letterGroup);
    const centerY = (box.min.y + box.max.y) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    anchorLeft.set(box.min.x - EDGE_MARGIN, centerY, centerZ);
    anchorRight.set(box.max.x + EDGE_MARGIN, centerY, centerZ);

    // Navegación acotada, sin bucle (ver cabecera del archivo): cada
    // flecha se muestra solo si de verdad hay una hoja anterior/
    // siguiente hacia la que ir.
    const currentPage = candelaFinale.getCurrentPage();
    const pageCount = candelaFinale.getPageCount();
    const hasPrev = currentPage > 0;
    const hasNext = currentPage < pageCount - 1;

    prevEl.classList.toggle("is-visible", hasPrev);
    prevEl.classList.toggle("is-disabled", turning);
    if (hasPrev) positionArrow(prevEl, anchorLeft.x, anchorLeft.y, anchorLeft.z);

    nextEl.classList.toggle("is-visible", hasNext);
    nextEl.classList.toggle("is-disabled", turning);
    if (hasNext) positionArrow(nextEl, anchorRight.x, anchorRight.y, anchorRight.z);
  });

  function dispose() {
    prevEl.removeEventListener("click", handlePrevClick);
    nextEl.removeEventListener("click", handleNextClick);
    prevEl.remove();
    nextEl.remove();
  }

  return { dispose };
}
