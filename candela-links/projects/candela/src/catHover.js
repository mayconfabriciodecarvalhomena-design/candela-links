import * as THREE from "three";
import { CONFIG } from "./config.js";
import { onUpdate } from "./scene.js";

// -----------------------------------------------------------------------
// CAT HOVER LABEL: pequeño nombre ("Chloe" por defecto — ver
// CONFIG.cat.hoverLabel) que aparece con un fundido suave al pasar el
// cursor sobre el gato, y lo sigue en pantalla.
//
// Sistema completamente independiente del raycasting de
// matchesController.js (que solo conoce la cerilla, con su propio
// THREE.Raycaster y su propio hit-test simplificado por radio): este
// módulo usa su PROPIO Raycaster y su PROPIO listener de
// "pointermove"/"pointerleave" sobre el mismo <canvas>
// (`renderer.domElement`), sin tocar matchesController.js/matches.js en
// absoluto. Varios listeners de puntero independientes sobre el mismo
// elemento no entran en conflicto entre sí — cada uno procesa el evento
// por su cuenta —, exactamente el mismo patrón que ya usa
// particlesBackground.js con su propio listener aparte sobre `window`.
//
// A propósito NO se toca `domElement.style.cursor` aquí: eso ya lo
// gestiona matchesController.js para la cerilla, y tocarlo también
// desde aquí podría pisar ese estado si ambos hovers llegaran a
// coincidir. La aparición/desaparición del nombre ya es feedback
// suficiente para esta interacción.
//
// Detección: `raycaster.intersectObject(cat.model, true)` — recursivo,
// contra la geometría real ya cargada, así que detecta el gato completo
// sin importar si estuviera formado por varios sub-meshes (hoy es una
// malla estática de una sola pieza, pero el raycast recursivo cubre
// igualmente cualquier jerarquía interna sin necesitar ningún caso
// especial).
// -----------------------------------------------------------------------

export function createCatHoverLabel(camera, renderer, cat) {
  const cfg = CONFIG.cat.hoverLabel;
  const domElement = renderer.domElement;

  const el = document.createElement("div");
  el.className = "cat-hover-label";
  el.textContent = cfg.text;
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerInsideCanvas = false;
  let hovering = false;

  function updatePointerFromEvent(event) {
    const rect = domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function setHovering(next) {
    if (hovering === next) return;
    hovering = next;
    // El fundido en sí (opacity + transition) vive en styles.css, vía
    // esta única clase — igual que ".narrative-text.is-visible".
    el.classList.toggle("is-visible", hovering);
  }

  function refreshHoverState() {
    if (!pointerInsideCanvas || !cat.model) {
      setHovering(false);
      return;
    }
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(cat.model, true);
    setHovering(hits.length > 0);
  }

  function handlePointerMove(event) {
    updatePointerFromEvent(event);
    pointerInsideCanvas = true;
    refreshHoverState();
  }

  function handlePointerLeave() {
    pointerInsideCanvas = false;
    setHovering(false);
  }

  domElement.addEventListener("pointermove", handlePointerMove);
  domElement.addEventListener("pointerleave", handlePointerLeave);

  // ---- Seguimiento en pantalla ----
  // Cada frame se recalcula un punto justo encima del gato a partir de
  // su bounding box REAL en world space (Box3().setFromObject), no de
  // una posición fija guardada una sola vez: así seguiría siguiendo al
  // gato si su transform cambiase alguna vez con alguna animación
  // futura, aunque hoy el gato no se mueve de su sitio. No se toca
  // `cat.group`/`cat.model` para nada más que leerlos.
  const box = new THREE.Box3();
  const worldTop = new THREE.Vector3();
  const projected = new THREE.Vector3();

  onUpdate(() => {
    if (!cat.model) return;

    box.setFromObject(cat.model);
    worldTop.set(
      (box.min.x + box.max.x) / 2,
      box.max.y + cfg.verticalOffset,
      (box.min.z + box.max.z) / 2
    );

    projected.copy(worldTop).project(camera);

    // Punto detrás de la cámara: caso límite defensivo (con la cámara
    // fija actual no debería darse), se oculta con el mismo mecanismo
    // de fundido en vez de forzar un estilo aparte.
    if (projected.z > 1) {
      setHovering(false);
      return;
    }

    const rect = domElement.getBoundingClientRect();
    const x = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  });

  function dispose() {
    domElement.removeEventListener("pointermove", handlePointerMove);
    domElement.removeEventListener("pointerleave", handlePointerLeave);
    el.remove();
  }

  return { dispose };
}
