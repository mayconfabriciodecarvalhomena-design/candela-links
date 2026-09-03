import * as THREE from "three";
import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// DEBUG LIGHTING: una luz ambiental extra, únicamente para desarrollo.
// Sirve para ver bien el modelo de la vela (posición, escala, materiales,
// mecha) mientras la llama todavía no existe y la escena está muy oscura.
//
// Este módulo solo se usa si DEBUG === true en config.js. Si DEBUG es
// false, nunca se llama y la escena queda exactamente como estaba.
// -----------------------------------------------------------------------

export function addDebugLighting(scene) {
  const debugLight = new THREE.AmbientLight(
    CONFIG.debugLight.color,
    CONFIG.debugLight.intensity
  );

  scene.add(debugLight);

  return debugLight;
}