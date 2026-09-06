import * as THREE from "three";
import { CONFIG } from "./config.js";
import { showNarrativeLine } from "./narrative.js";

// -----------------------------------------------------------------------
// DOOR INTERACTION: click/tap sobre la puerta de la habitación (hoja +
// marco + pomo, agrupados en room.js — ver createRoom()/addDoor()) →
// solo muestra un aviso de texto, reutilizando el mismo sistema de
// texto narrativo que ya usa el resto de la experiencia
// (showNarrativeLine, ver src/narrative.js — el mismo que usan las
// frases de candleSequence en main.js), en vez de crear un sistema de
// mensajes/toast nuevo.
//
// La puerta NO se abre: este módulo no le aplica ninguna posición,
// rotación ni animación — nunca toca su transform. Es, a propósito, la
// interacción más simple de la escena: ni tiene estado propio, ni
// máquina de estados, ni transición de cámara.
//
// Mismo patrón que el resto de interacciones de puntero del proyecto
// (matchesController.js/catHover.js/objectInspection.js): su propio
// THREE.Raycaster y sus propios listeners de "pointerdown"/"pointermove"
// sobre el mismo <canvas> (renderer.domElement), sin tocar ninguno de
// los otros — varios listeners de puntero independientes sobre el mismo
// elemento ya conviven hoy sin conflicto en el proyecto (ver la nota de
// catHover.js). El hover reutiliza el MISMO raycast/referencia `door`
// que ya usaba el click (mismo criterio exacto: si el click detecta esa
// zona, el hover detecta esa misma zona, ni más ni menos), y el mismo
// valor de cursor ya usado por matchesController.js/objectInspection.js
// (CONFIG.matches.interaction.cursor = "pointer"), sin inventar uno
// nuevo. Se registra DESPUÉS de matchesController.js en main.js (mismo
// orden que objectInspection.js), así que puede sobrescribir su
// "default" a "pointer" al pasar por la puerta, y al salir simplemente
// deja de tocar el cursor — el siguiente pointermove ya lo habrá puesto
// matchesController.js en "default" si no hay nada interactivo debajo.
// -----------------------------------------------------------------------

export function createDoorInteraction(camera, renderer, door) {
  const domElement = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function updatePointer(event) {
    const rect = domElement.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  }

  function isPointerOverDoor() {
    if (!door) return false;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(door, true).length > 0;
  }

  function handlePointerDown(event) {
    updatePointer(event);
    if (isPointerOverDoor()) {
      showNarrativeLine("Esta cerrada, pero alomejor en un futuro se abre");
    }
  }

  // Hover: mismo raycast/referencia `door` que el click (isPointerOverDoor),
  // así que detectan exactamente la misma zona (hoja+marco+pomo, dentro
  // del mismo doorGroup — ver room.js). Solo escribe el cursor al entrar
  // en esa zona; al salir no lo toca (ver nota de cabecera: el propio
  // matchesController.js ya lo repone a "default" en su pointermove).
  function handlePointerMove(event) {
    updatePointer(event);
    if (isPointerOverDoor()) {
      domElement.style.cursor = CONFIG.matches.interaction.cursor;
    }
  }

  domElement.addEventListener("pointerdown", handlePointerDown);
  domElement.addEventListener("pointermove", handlePointerMove);

  function dispose() {
    domElement.removeEventListener("pointerdown", handlePointerDown);
    domElement.removeEventListener("pointermove", handlePointerMove);
  }

  return { dispose };
}
