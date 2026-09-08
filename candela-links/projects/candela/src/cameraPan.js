import * as THREE from "three";
import { CONFIG } from "./config.js";
import { onUpdate, setCameraPanYaw, getCameraUnpannedLookAt } from "./scene.js";

// -----------------------------------------------------------------------
// CAMERA PAN: exploración lateral de cámara por drag/swipe horizontal
// con el dedo — "sentado delante de la mesa, pudiendo mirar un poco
// hacia la izquierda (puerta) o la derecha (espejo/cuadro)". Nunca
// traslada la cámara ni la habitación: es una ROTACIÓN pura sobre el
// eje Y aplicada por scene.js (ver setCameraPanYaw()) — este archivo
// solo decide CUÁNTOS RADIANES, a partir del gesto del usuario y de
// límites calculados con la geometría real de la puerta/el espejo (ver
// CAMERA_PAN_CONFIG en config/cameraPan.config.js).
//
// SOLO TÁCTIL a propósito (event.pointerType === "touch"): es la razón
// por la que la composición de escritorio (sin pantalla táctil) queda
// intacta sin necesitar ninguna comprobación de aspect ratio/dispositivo
// — sin dedo sobre la pantalla, panYawOffset nunca se toca.
//
// SUSPENSIÓN — recibe `isSuspended()` (mismo patrón que `isCandleLit`
// en matchesController.js) para ceder el control TOTAL de la cámara a
// otros sistemas sin pelear por ella:
//   - objectInspection.js (Kitty/cuadro): mientras su estado no sea
//     "IDLE" (entrando, dentro, o saliendo de una inspección), este
//     módulo deja de llamar a setCameraPanYaw() por completo — nunca
//     escribe camera.position/lookAt durante ese tiempo, así que nunca
//     puede pisar la animación de inspección. panYawOffset se queda
//     "congelado" en su último valor (en scene.js) mientras tanto, así
//     que al volver a IDLE la vista retomada por objectInspection.js
//     (que usa getCameraBaseLookAt(), ya paneado — ver la nota en
//     scene.js) coincide exactamente con este mismo valor: no hay
//     salto ni recentrado al salir de una inspección.
//   - candelaFinale.js (final: llama creciendo, sobre, carta): mientras
//     su fase no sea "idle" (desde el primer aviso de que va a empezar
//     el final hasta "done", el reposo final con la carta legible —
//     isLetterReadable() ya cubierto dentro de ese rango), tampoco se
//     toca la cámara. Cubre explícitamente el caso "un swipe sobre la
//     carta no debe mover la cámara": durante toda esa fase este módulo
//     ni siquiera escucha el resultado del drag para aplicarlo a la
//     cámara (si acaso seguiría acumulando el gesto internamente, pero
//     nunca llega a setCameraPanYaw() — en la práctica el "arrastre en
//     la carta" tampoco existe hoy como gesto, ver letterPageControls.js,
//     que solo usa flechas de click; esta suspensión es la garantía
//     también de cara a cualquier gesto que se añada ahí en el futuro).
// -----------------------------------------------------------------------
export function createCameraPan(camera, renderer, options = {}) {
  const cfg = CONFIG.cameraPan;
  const isSuspended = typeof options.isSuspended === "function" ? options.isSuspended : () => false;
  const domElement = renderer.domElement;

  // Valor CRUDO acumulado por el drag (antes de clampear a los límites
  // reales de este frame) — se deja crecer/decrecer libremente durante
  // el arrastre y se clampea cada frame en onUpdate(), nunca en el
  // propio listener de puntero: así, si los límites cambian a media
  // sesión (p. ej. el usuario gira el móvil de portrait a landscape
  // mientras panea), el valor objetivo ya clampeado se ajusta solo, sin
  // que el arrastre en curso quede en un estado inconsistente.
  let yawTargetRaw = 0;
  // Valor REALMENTE aplicado a la cámara, amortiguado hacia el target
  // clampeado cada frame (ver dampingSpeed, cameraPan.config.js).
  let yawCurrent = 0;

  let dragging = false;
  let lastClientX = 0;

  // ---- Límites reales, recalculados cada frame (ver CAMERA_PAN_CONFIG:
  // "no inventar minX/maxX", usar las posiciones reales) ----
  const doorPos = CONFIG.room.door.position; // [x, z]
  const mirrorPos = CONFIG.room.mirror.position; // [x, z]

  // signedYawTo(cameraPos, forwardXZ, targetX, targetZ): ángulo (rad,
  // MISMO signo que camera.applyAxisAngle(Y_AXIS, ángulo) en scene.js —
  // comprobado numéricamente contra la rotación real de three.js, no
  // una convención matemática genérica) que habría que sumar a
  // panYawOffset para que la cámara mirase EXACTAMENTE hacia
  // (targetX, targetZ) desde cameraPos, partiendo de la dirección
  // horizontal `forwardXZ`. Solo horizontal (X/Z) a propósito — el
  // paneo nunca toca la Y, así que el límite tampoco debe calcularse
  // con inclinación vertical incluida (ver "solamente eje horizontal"
  // en el encargo).
  function signedYawTo(cameraPos, forwardXZ, targetX, targetZ) {
    const tx = targetX - cameraPos.x;
    const tz = targetZ - cameraPos.z;
    const cross = forwardXZ.x * tz - forwardXZ.z * tx;
    const dot = forwardXZ.x * tx + forwardXZ.z * tz;
    return -Math.atan2(cross, dot);
  }

  const forwardXZ = { x: 0, z: 0 };
  const maxYawRad = THREE.MathUtils.degToRad(cfg.limits.maxYawDegrees);

  // Devuelve { min, max } en radianes: min = límite hacia el espejo
  // (ángulo negativo), max = límite hacia la puerta (ángulo positivo) —
  // ver la nota de signo en scene.js/applyCameraPan(). Recalculado con
  // camera.position y el pivote SIN panear (getCameraUnpannedLookAt())
  // vigentes en este instante — válido en cualquier aspect ratio/t, se
  // recalcula solo cada frame, no se cachea entre resizes.
  function computeYawLimits() {
    const base = getCameraUnpannedLookAt();
    forwardXZ.x = base.x - camera.position.x;
    forwardXZ.z = base.z - camera.position.z;

    const yawToDoor = signedYawTo(camera.position, forwardXZ, doorPos[0], doorPos[1]);
    const yawToMirror = signedYawTo(camera.position, forwardXZ, mirrorPos[0], mirrorPos[1]);

    const max = THREE.MathUtils.clamp(yawToDoor * cfg.limits.centerMarginFactor, 0, maxYawRad);
    const min = THREE.MathUtils.clamp(yawToMirror * cfg.limits.centerMarginFactor, -maxYawRad, 0);

    return { min, max };
  }

  // ---- Interacción táctil: solo pointerType === "touch" (ver cabecera
  // del archivo). pointerdown/pointermove/pointerup — NUNCA
  // preventDefault/stopPropagation: los demás sistemas (matchesController,
  // catHover, objectInspection, doorInteraction) tienen sus propios
  // listeners independientes sobre el mismo <canvas> y deben seguir
  // recibiendo exactamente los mismos eventos que reciben hoy — un tap
  // corto (sin apenas movimiento) no mueve la cámara de forma
  // perceptible, así que su click/tap sigue funcionando con normalidad
  // (ver #app canvas { touch-action: none } en styles.css, que evita el
  // scroll/gesto nativo del navegador sin necesidad de preventDefault
  // aquí). ----
  function handlePointerDown(event) {
    if (event.pointerType !== "touch") return;
    if (isSuspended()) return;
    dragging = true;
    lastClientX = event.clientX;
  }

  function handlePointerMove(event) {
    if (event.pointerType !== "touch" || !dragging) return;
    if (isSuspended()) {
      // Se ha entrado en inspección/final a media sesión: se corta el
      // arrastre en curso (no se sigue acumulando yawTargetRaw a
      // ciegas mientras la cámara está bajo otro control) — al soltar
      // el dedo no queda ningún gesto "pendiente" de aplicar de golpe.
      dragging = false;
      return;
    }

    const deltaX = event.clientX - lastClientX;
    lastClientX = event.clientX;

    const width = domElement.clientWidth || window.innerWidth;
    const radiansPerPixel = THREE.MathUtils.degToRad(cfg.drag.degreesPerFullWidth) / width;

    // Swipe a la izquierda (deltaX < 0) → hacia la puerta (panYawOffset
    // positivo, ver la nota de signo en scene.js) — de ahí el signo
    // negativo aquí.
    yawTargetRaw -= deltaX * radiansPerPixel;
  }

  function handlePointerUp(event) {
    if (event.pointerType !== "touch") return;
    dragging = false;
  }

  domElement.addEventListener("pointerdown", handlePointerDown);
  domElement.addEventListener("pointermove", handlePointerMove);
  domElement.addEventListener("pointerup", handlePointerUp);
  domElement.addEventListener("pointercancel", handlePointerUp);
  // pointerleave: el dedo puede "salirse" del canvas sin generar
  // pointerup en algunos navegadores móviles (p. ej. al arrastrar hasta
  // el borde de la pantalla) — mismo tratamiento que soltar.
  domElement.addEventListener("pointerleave", handlePointerUp);

  // ---- Aplicación por frame: clamp + amortiguación + escritura en
  // scene.js (o ninguna escritura en absoluto, si isSuspended()) ----
  onUpdate((delta) => {
    if (isSuspended()) return;

    const { min, max } = computeYawLimits();
    yawTargetRaw = THREE.MathUtils.clamp(yawTargetRaw, min, max);

    const alpha = Math.min(1, cfg.dampingSpeed * delta);
    yawCurrent = THREE.MathUtils.lerp(yawCurrent, yawTargetRaw, alpha);

    setCameraPanYaw(yawCurrent);
  });

  function dispose() {
    domElement.removeEventListener("pointerdown", handlePointerDown);
    domElement.removeEventListener("pointermove", handlePointerMove);
    domElement.removeEventListener("pointerup", handlePointerUp);
    domElement.removeEventListener("pointercancel", handlePointerUp);
    domElement.removeEventListener("pointerleave", handlePointerUp);
  }

  return {
    // Solo para inspección/depuración manual desde consola (mismo
    // criterio que el resto de sistemas expuestos en window.candela):
    //   candela.cameraPan.yaw — radianes actualmente aplicados
    //   candela.cameraPan.yawDegrees — lo mismo, en grados
    get yaw() {
      return yawCurrent;
    },
    get yawDegrees() {
      return THREE.MathUtils.radToDeg(yawCurrent);
    },
    dispose,
  };
}
