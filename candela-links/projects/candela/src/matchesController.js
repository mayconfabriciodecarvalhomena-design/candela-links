import * as THREE from "three";
import { onUpdate } from "./scene.js";
import { CONFIG } from "./config.js";
import { createMatches } from "./matches.js";

// -----------------------------------------------------------------------
// MATCHES CONTROLLER: única pieza que conoce tanto la mecánica
// (`matches.js`) como la representación 3D (`matchVisual.js`). Orquesta
// el gesto completo:
//
//   click sobre la cerilla en reposo
//     → matches.attemptStrike()
//     → matchVisual.startStrikeSequence({ onFlameVisible, onIgnited })
//         (caja+cerilla se levantan juntas, varias pasadas de raspado
//          con chispas direccionales, la llamita crece y se estabiliza,
//          la caja vuelve a su sitio y la cerilla pasa a la mano)
//     → onFlameVisible: matches.confirmIgnited() (ahora sí hay llama real)
//   click sobre la cerilla ya encendida y libre
//     → matchVisual.startAutoIgnition()
//         (animación suave: la raíz se mueve hasta que la llama
//          coincide con candleWickPosition, easeInOut ~0.8s)
//   cada frame, si la cerilla está encendida y libre: se comprueba la
//   distancia entre la posición de su LLAMA y candleWickPosition; al
//   entrar en contacto se emite "matchReadyToLightCandle" y la cerilla
//   se apaga (matches.extinguish("used-on-candle")).
//
// Esto sigue SIN llamar a `flame.ignite()` en ningún sitio.
// -----------------------------------------------------------------------

export function createMatchesController(scene, camera, renderer, matchVisual, options = {}) {
  const matches = createMatches(options.mechanics);
  const interactionCfg = CONFIG.matches.interaction;

  const readyListeners = new Set();
  function emitReadyToLightCandle(payload) {
    readyListeners.forEach((cb) => cb(payload));
  }

  // ---- Conexión: eventos de estado simples de matches.js -> visual ----
  // ("strike-sequence-start" y "strike" no disparan la visual aquí: el
  // encendido lo dispara el propio click, ver handlePointerDown, porque
  // necesitamos pasar las callbacks de la secuencia en ese momento.)
  matches.on("extinguish", () => matchVisual.extinguish());
  matches.on("strike-failed", () => matchVisual.playFailShake());
  matches.on("depleted", () => matchVisual.playDepleted());
  matches.on("reset", () => matchVisual.resetPose());

  onUpdate((delta) => matchVisual.update(delta));

  // ---- Contacto con la mecha: se usa la posición de la LLAMA de la
  // cerilla (getFlameWorldPosition), no la del palo completo. Se
  // comprueba cada frame mientras la cerilla está encendida y libre —
  // que ahora puede ser un tiempo indefinido, no hay prisa por tiempo.
  // Edge-triggered para no emitir el evento en bucle. ----
  const wickPosition = new THREE.Vector3(...interactionCfg.candleWickPosition);
  const flameWorldPos = new THREE.Vector3();
  let contactFired = false;

  onUpdate(() => {
    if (!matchVisual.isFree() || !matchVisual.isLit()) {
      contactFired = false;
      return;
    }
    matchVisual.getFlameWorldPosition(flameWorldPos);
    const distance = flameWorldPos.distanceTo(wickPosition);

    if (distance <= interactionCfg.candleContactRadius) {
      if (!contactFired) {
        contactFired = true;
        emitReadyToLightCandle({ matchesRemaining: matches.matchesRemaining() });
        // Único punto en el que la cerilla se apaga tras encenderse:
        // justo después (y solo después) de confirmarse el contacto con
        // la mecha. No hay ningún apagado por tiempo en ningún sitio.
        matches.extinguish("used-on-candle");
      }
    } else {
      contactFired = false;
    }
  });

  // ---- Interacción de puntero: click para auto-ignición ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const domElement = renderer.domElement;

  function updatePointer(event) {
    const rect = domElement.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  function isPointerOverObject(object3D) {
    raycaster.setFromCamera(pointer, camera);
    const worldPos = new THREE.Vector3();
    object3D.getWorldPosition(worldPos);
    const closestPoint = new THREE.Vector3();
    raycaster.ray.closestPointToPoint(worldPos, closestPoint);
    return closestPoint.distanceTo(worldPos) <= interactionCfg.hitRadius;
  }

  function handlePointerDown(event) {
    updatePointer(event);

    if (matches.canStrike() && isPointerOverObject(matchVisual.object)) {
      const result = matches.attemptStrike();
      if (result.success) {
        matchVisual.startStrikeSequence({
          onFlameVisible: () => matches.confirmIgnited(),
        });
      }
      return;
    }

    if (matchVisual.isFree() && matchVisual.isLit() && !matchVisual.isAutoIgniting()) {
      matchVisual.startAutoIgnition();
    }
  }

  function handlePointerMove(event) {
    updatePointer(event);
    const hovering =
      (matches.canStrike() && isPointerOverObject(matchVisual.object)) ||
      (matchVisual.isFree() && matchVisual.isLit() && !matchVisual.isAutoIgniting());
    domElement.style.cursor = hovering ? interactionCfg.cursor : "default";
  }

  domElement.addEventListener("pointerdown", handlePointerDown);
  domElement.addEventListener("pointermove", handlePointerMove);

  function dispose() {
    domElement.removeEventListener("pointerdown", handlePointerDown);
    domElement.removeEventListener("pointermove", handlePointerMove);
  }

  return {
    matches,
    matchVisual,

    // Señal para encender la vela. Se dispara cuando la llama de la
    // cerilla (ya encendida y libre) toca candleWickPosition — bien por
    // auto-ignición o por contacto directo.
    onReadyToLightCandle: (callback) => {
      readyListeners.add(callback);
      return () => readyListeners.delete(callback);
    },

    dispose,
  };
}