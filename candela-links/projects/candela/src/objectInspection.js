import * as THREE from "three";
import { CONFIG } from "./config.js";
import { onUpdate } from "./scene.js";

// -----------------------------------------------------------------------
// OBJECT INSPECTION: click/tap sobre un objeto interactivo registrado
// (hoy: la Hello Kitty de la mesa y el cuadro de la pared) → la cámara
// se acerca con una transición suave y lo deja centrado, cerca y bien
// visible. Click/tap fuera de él mientras se está inspeccionando →
// vuelve, con otra transición suave, exactamente a la vista que la
// cámara tenía justo antes (no a una posición fija inventada).
//
// ESTE ARCHIVO ERA `helloKittyInspection.js`, específico de la Kitty.
// Se ha generalizado para poder registrar VARIOS objetivos (ahora
// también `pictureFrame`) SIN duplicar nada de la animación de cámara:
// la máquina de estados, el easing, la interpolación y el algoritmo de
// encuadre (`computeInspectionTarget`, bounding-sphere + FOV real) son
// EXACTAMENTE los mismos que antes, carácter por carácter — lo único
// que cambia es que ahora reciben, por parámetro, DE QUÉ objeto se
// trata en cada momento (`getObject3D`/`computeFaceDirection`/`cfg`)
// en vez de tenerlo hardcodeado a `helloKitty`.
//
// El comportamiento de la Kitty es IDÉNTICO al de antes: se registra
// con exactamente los mismos valores (`helloKitty.model`,
// `helloKitty.group.rotation.y`, `CONFIG.helloKittyInspection`) que
// usaba el archivo original — ver main.js. El cuadro se registra con
// `CONFIG.helloKittyInspection` (la MISMA configuración, tal y como se
// pidió: mismo estilo/duración/suavidad), solo con su propia geometría
// real (pictureFrame.group) y su propia normal de cara (la misma
// fórmula que ya usa pictureFrame.js para "hacia dónde mira la pared").
//
// Todos los objetivos comparten UN ÚNICO estado (IDLE / TRANSITION_IN /
// INSPECTING / TRANSITION_OUT): la cámara es una sola, así que solo
// puede haber una inspección en marcha a la vez. Si se hace click en un
// objetivo distinto al que se está inspeccionando, se interpreta como
// "click fuera" (mismo criterio que ya tenía la Kitty) y se sale hacia
// la vista anterior — no salta directamente al otro objetivo.
//
// Reutiliza el patrón ya existente en el proyecto para interacción por
// puntero: su propio THREE.Raycaster y su propio listener de
// "pointerdown" sobre el mismo <canvas> (renderer.domElement), sin
// tocar matchesController.js/catHover.js/matches.js en absoluto —
// varios listeners de puntero independientes sobre el mismo elemento
// ya conviven hoy sin conflicto en el proyecto (ver la nota de
// catHover.js). Por el mismo motivo, y por el mismo criterio que
// catHover.js, este módulo tampoco toca `domElement.style.cursor` salvo
// para el propio cursor interactivo al pasar por encima de un objetivo
// en IDLE (eso ya lo gestiona matchesController.js para la cerilla).
//
// La cámara de Candela es, hasta ahora, completamente estática fuera de
// esta interacción: se coloca una única vez en scene.js
// (camera.position.set() + camera.lookAt()) y no existe ningún otro
// sistema que vuelva a tocarla (no hay OrbitControls ni nada
// equivalente). Este módulo es el único que la mueve, y solo durante
// esta interacción concreta: toma el control de camera.position/lookAt
// exclusivamente mientras dura la inspección (entrando, dentro, o
// saliendo) y la devuelve intacta a la vista original al terminar.
// -----------------------------------------------------------------------

const STATE = {
  IDLE: "IDLE",
  TRANSITION_IN: "TRANSITION_IN",
  INSPECTING: "INSPECTING",
  TRANSITION_OUT: "TRANSITION_OUT",
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// targets: array de
//   {
//     key: string,                              // identificador para consola/debug
//     getObject3D: () => THREE.Object3D | null,  // objetivo real de raycast/bounding box (puede no existir aún)
//     computeFaceDirection: (outVector3) => void, // rellena la normal "hacia la que mira" el objeto
//     cfg: { screenFraction, minDistance, maxDistance, heightLift, transitionInDuration, transitionOutDuration },
//   }
export function createObjectInspection(scene, camera, renderer, targets) {
  const domElement = renderer.domElement;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let state = STATE.IDLE;
  let activeTarget = null;

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
  // Usa la bounding box REAL del objetivo ya cargado/construido (no un
  // valor hardcodeado) y su orientación real (target.computeFaceDirection,
  // distinta para cada objetivo — ver la nota de cada uno en main.js)
  // para colocar la cámara delante de su cara. La distancia se calcula
  // con el FOV y el aspect ratio reales de la cámara en ese momento,
  // para que el objetivo quede centrado, entero y con un tamaño cómodo
  // para observarlo, sin cortarse por ningún borde. Idéntico al cálculo
  // original de la Kitty — solo que `object3D`/`cfg`/la normal ahora
  // vienen del `target` en vez de estar fijos.
  function computeInspectionTarget(target, outPosition, outLookAt) {
    const object3D = target.getObject3D();
    const cfg = target.cfg;

    box.setFromObject(object3D);
    box.getCenter(center);
    box.getSize(size);
    box.getBoundingSphere(sphere);

    target.computeFaceDirection(faceDirection);
    faceDirection.normalize();

    const halfVFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const aspect = camera.aspect || window.innerWidth / window.innerHeight;

    // Distancia mínima para que el diámetro de la esfera que envuelve
    // al objetivo quepa dentro de cfg.screenFraction del encuadre,
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

  function enterInspection(target) {
    if (state !== STATE.IDLE) return;
    const object3D = target.getObject3D();
    if (!object3D) return;

    previousPosition.copy(camera.position);
    previousLookAt.copy(currentLookAt);
    activeTarget = target;

    computeInspectionTarget(target, inspectionPosition, inspectionLookAt);

    beginTransition(STATE.TRANSITION_IN, inspectionPosition, inspectionLookAt, target.cfg.transitionInDuration);
  }

  function exitInspection() {
    if (state !== STATE.INSPECTING) return;
    beginTransition(STATE.TRANSITION_OUT, previousPosition, previousLookAt, activeTarget.cfg.transitionOutDuration);
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
      if (state === STATE.TRANSITION_IN) {
        state = STATE.INSPECTING;
      } else {
        state = STATE.IDLE;
        activeTarget = null;
      }
    }
  });

  // ---- Interacción de puntero: click sobre un objetivo entra, click
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

  // Devuelve el PRIMER target registrado que el puntero esté tocando
  // ahora mismo (o null). El orden de `targets` decide el desempate si,
  // en algún futuro, dos objetivos llegaran a solaparse en pantalla —
  // hoy Kitty y cuadro no se solapan en ningún punto de la escena.
  function hitTestTargets() {
    raycaster.setFromCamera(pointer, camera);
    for (const target of targets) {
      const object3D = target.getObject3D();
      if (!object3D) continue;
      if (raycaster.intersectObject(object3D, true).length > 0) return target;
    }
    return null;
  }

  function handlePointerDown(event) {
    updatePointer(event);

    if (state === STATE.IDLE) {
      const hit = hitTestTargets();
      if (hit) enterInspection(hit);
      return;
    }

    if (state === STATE.INSPECTING) {
      const hit = hitTestTargets();
      if (!hit || hit !== activeTarget) exitInspection();
    }
  }

  // Solo cursor interactivo (el de la cerilla) al pasar por encima de
  // CUALQUIER objetivo registrado en estado IDLE. Fuera de todos ellos,
  // o en cualquier otro estado (transición/inspección), este módulo NO
  // escribe el cursor: lo deja exactamente como lo deje
  // matchesController.js (que gestiona la cerilla con prioridad y pone
  // "default" cuando el puntero no está sobre ella), evitando pisarlo o
  // dejarlo atascado en "pointer".
  function handlePointerMove(event) {
    updatePointer(event);
    if (state === STATE.IDLE && hitTestTargets()) {
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
    //   candela.objectInspection.state
    //   candela.objectInspection.enter("kitty" | "pictureFrame")
    //   candela.objectInspection.exit()
    get state() {
      return state;
    },
    get activeTargetKey() {
      return activeTarget ? activeTarget.key : null;
    },
    enter(key) {
      const target = targets.find((t) => t.key === key);
      if (target) enterInspection(target);
    },
    exit: exitInspection,
    dispose,
  };
}
