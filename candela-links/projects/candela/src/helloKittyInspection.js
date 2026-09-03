import * as THREE from "three";
import { CONFIG } from "./config.js";
import { onUpdate } from "./scene.js";

// -----------------------------------------------------------------------
// HELLO KITTY INSPECTION: click/tap sobre la Hello Kitty de la mesa →
// la cámara se acerca con una transición suave y la deja centrada,
// cerca y bien visible — la sensación de "la he cogido para mirarla de
// cerca". Click/tap fuera de ella mientras se está inspeccionando →
// vuelve, con otra transición suave, exactamente a la vista que la
// cámara tenía justo antes (no a una posición fija inventada).
//
// Reutiliza el patrón ya existente en el proyecto para interacción por
// puntero: su propio THREE.Raycaster y su propio listener de
// "pointerdown" sobre el mismo <canvas> (renderer.domElement), sin
// tocar matchesController.js/catHover.js/matches.js en absoluto —
// varios listeners de puntero independientes sobre el mismo elemento
// ya conviven hoy sin conflicto en el proyecto (ver la nota de
// catHover.js). Por el mismo motivo, y por el mismo criterio que
// catHover.js, este módulo tampoco toca `domElement.style.cursor`
// (eso ya lo gestiona matchesController.js para la cerilla).
//
// La detección usa `raycaster.intersectObject(helloKitty.model, true)`
// — recursivo, así que detecta la Kitty completa sin importar cuántos
// meshes la formen internamente (mismo criterio que catHover.js con
// cat.model).
//
// La cámara de Candela es, hasta ahora, completamente estática: se
// coloca una única vez en scene.js (camera.position.set() +
// camera.lookAt()) y no existe ningún otro sistema que vuelva a
// tocarla (no hay OrbitControls ni nada equivalente). Este módulo es
// el primero que la mueve, y solo durante esta interacción concreta:
// toma el control de camera.position/lookAt exclusivamente mientras
// dura la inspección (entrando, dentro, o saliendo) y la devuelve
// intacta a la vista original al terminar.
// -----------------------------------------------------------------------

const STATE = {
  IDLE: "IDLE",
  TRANSITION_IN: "TRANSITION_IN",
  KITTY_INSPECTION: "KITTY_INSPECTION",
  TRANSITION_OUT: "TRANSITION_OUT",
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createHelloKittyInspection(scene, camera, renderer, helloKitty) {
  const cfg = CONFIG.helloKittyInspection;
  const domElement = renderer.domElement;

  // Cursor interactivo igual al de la cerilla (ver matchesController.js):
  // se reutiliza CONFIG.matches.interaction.cursor en vez de duplicar el
  // valor. Se escribe SOLO cuando el puntero está sobre la Kitty en
  // estado IDLE; en cualquier otro caso no se toca `domElement.style.cursor`,
  // para no interferir con el cursor de la cerilla (que pone "default" en
  // cada pointermove y debe conservar prioridad sobre su zona).

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let state = STATE.IDLE;

  // Target/lookAt actual de la cámara, seguido a mano: camera.lookAt()
  // no guarda en ningún sitio el punto al que apunta (solo orienta el
  // quaternion en el momento de llamarlo), así que lo recordamos
  // nosotros — hace falta para poder interpolarlo suavemente y para
  // saber exactamente a qué punto volver al salir.
  const currentLookAt = new THREE.Vector3(...CONFIG.camera.lookAt);

  // Vista real de la que se viene, capturada en el momento de entrar
  // (no una posición fija inventada): a esto es a lo que se vuelve al
  // salir.
  const previousPosition = new THREE.Vector3();
  const previousLookAt = new THREE.Vector3();

  // Estado de la interpolación en curso.
  const startPosition = new THREE.Vector3();
  const startLookAt = new THREE.Vector3();
  const endPosition = new THREE.Vector3();
  const endLookAt = new THREE.Vector3();
  let elapsed = 0;
  let duration = 0;

  // Escrituras reutilizadas cada vez que se calcula la posición de
  // inspección, para no crear objetos nuevos en cada click.
  const box = new THREE.Box3();
  const sphere = new THREE.Sphere();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  const faceDirection = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

  // ---- Cálculo de la posición/target de inspección ----
  // Usa la bounding box REAL de la Kitty ya cargada (no un valor
  // hardcodeado) y su orientación real (helloKitty.group.rotation.y —
  // ver la nota de orientación en helloKitty.config.js: con esa
  // rotación, la cara reconocible del modelo mira hacia +Z local del
  // grupo) para colocar la cámara delante de su cara. La distancia se
  // calcula con el FOV y el aspect ratio reales de la cámara en ese
  // momento, para que la Kitty quede centrada, entera y con un tamaño
  // cómodo para observarla, sin cortarse por ningún borde.
  function computeInspectionTarget(outPosition, outLookAt) {
    box.setFromObject(helloKitty.model);
    box.getCenter(center);
    box.getSize(size);
    box.getBoundingSphere(sphere);

    faceDirection
      .set(-1, 0, 0)
      .applyAxisAngle(yAxis, helloKitty.group.rotation.y)
      .normalize();

    const halfVFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const aspect = camera.aspect || window.innerWidth / window.innerHeight;

    // Distancia mínima para que el diámetro de la esfera que envuelve
    // a la Kitty quepa dentro de cfg.screenFraction del encuadre,
    // calculada en vertical y en horizontal (el aspect ratio real
    // puede hacer que el límite horizontal sea el más estricto, p. ej.
    // en pantallas estrechas) — se usa la distancia mayor de las dos
    // para garantizar que no se corte por ningún borde.
    const distV = sphere.radius / (cfg.screenFraction * Math.tan(halfVFov));
    const distH = sphere.radius / (cfg.screenFraction * Math.tan(halfVFov) * aspect);
    const distance = THREE.MathUtils.clamp(
      Math.max(distV, distH),
      cfg.minDistance,
      cfg.maxDistance
    );

    outPosition
      .copy(center)
      .addScaledVector(faceDirection, distance)
      .addScaledVector(yAxis, size.y * cfg.heightLift);

    outLookAt.copy(center);
  }

  function beginTransition(nextState, nextEndPosition, nextEndLookAt, nextDuration) {
    startPosition.copy(camera.position);
    startLookAt.copy(currentLookAt);
    endPosition.copy(nextEndPosition);
    endLookAt.copy(nextEndLookAt);
    elapsed = 0;
    duration = nextDuration;
    state = nextState;
  }

  const inspectionPosition = new THREE.Vector3();
  const inspectionLookAt = new THREE.Vector3();

  function enterInspection() {
    if (state !== STATE.IDLE || !helloKitty.model) return;

    previousPosition.copy(camera.position);
    previousLookAt.copy(currentLookAt);

    computeInspectionTarget(inspectionPosition, inspectionLookAt);

    beginTransition(STATE.TRANSITION_IN, inspectionPosition, inspectionLookAt, cfg.transitionInDuration);
  }

  function exitInspection() {
    if (state !== STATE.KITTY_INSPECTION) return;
    beginTransition(STATE.TRANSITION_OUT, previousPosition, previousLookAt, cfg.transitionOutDuration);
  }

  onUpdate((delta) => {
    if (state !== STATE.TRANSITION_IN && state !== STATE.TRANSITION_OUT) return;

    elapsed += delta;
    const t = duration > 0 ? THREE.MathUtils.clamp(elapsed / duration, 0, 1) : 1;
    const eased = easeInOutCubic(t);

    camera.position.lerpVectors(startPosition, endPosition, eased);
    currentLookAt.lerpVectors(startLookAt, endLookAt, eased);
    camera.lookAt(currentLookAt);

    if (t >= 1) {
      state = state === STATE.TRANSITION_IN ? STATE.KITTY_INSPECTION : STATE.IDLE;
    }
  });

  // ---- Interacción de puntero: click sobre la Kitty entra, click
  // fuera (mientras se inspecciona) sale. Ignorado mientras hay una
  // transición en curso, para no interrumpir un movimiento de cámara a
  // medias con un segundo click. ----
  function updatePointer(event) {
    const rect = domElement.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  function isPointerOverKitty() {
    if (!helloKitty.model) return false;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(helloKitty.model, true).length > 0;
  }

  function handlePointerDown(event) {
    updatePointer(event);

    if (state === STATE.IDLE) {
      if (isPointerOverKitty()) enterInspection();
      return;
    }

    if (state === STATE.KITTY_INSPECTION) {
      if (!isPointerOverKitty()) exitInspection();
    }
  }

  // Solo cursor interactivo (el de la cerilla) al pasar por encima de la
  // Kitty en estado IDLE. Fuera de la Kitty, o en cualquier otro estado
  // (transición/inspección), este módulo NO escribe el cursor: lo deja
  // exactamente como lo deje matchesController.js (que gestiona la
  // cerilla con prioridad y pone "default" cuando el puntero no está
  // sobre ella), evitando pisarlo o dejarlo atascado en "pointer".
  function handlePointerMove(event) {
    updatePointer(event);
    if (state === STATE.IDLE && isPointerOverKitty()) {
      domElement.style.cursor = CONFIG.matches.interaction.cursor;
    }
  }

  domElement.addEventListener("pointerdown", handlePointerDown);
  domElement.addEventListener("pointermove", handlePointerMove);

  function dispose() {
    domElement.removeEventListener("pointerdown", handlePointerDown);
    domElement.removeEventListener("pointermove", handlePointerMove);
  }

  return {
    // Solo para inspección/depuración manual desde consola (mismo
    // criterio que el resto de sistemas expuestos en window.candela):
    //   candela.helloKittyInspection.state
    //   candela.helloKittyInspection.enter() / .exit()
    get state() {
      return state;
    },
    enter: enterInspection,
    exit: exitInspection,
    dispose,
  };
}
