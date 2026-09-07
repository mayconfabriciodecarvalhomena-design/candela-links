import * as THREE from "three";
import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// getResponsiveLayout(width, height, dpr): ÚNICA fuente de verdad de
// cómo el viewport real del usuario se traduce en composición (ver el
// encargo de esta iteración: "sistema responsive dinámico basado en el
// viewport real", "función centralizada", "no quiero if(mobile)").
//
// La usan tanto scene.js (cámara) como candelaFinale.js (tamaño/
// cercanía de la carta) para no duplicar la fórmula ni arriesgarse a
// que ambos sistemas diverjan con el tiempo — mismo criterio que ya usa
// el proyecto en otros sitios (p. ej. TABLE_TOP_Y en room.config.js,
// una única constante que consumen varios sistemas independientes).
//
// TODO lo que devuelve es un DERIVADO de width/height (aspect,
// orientation, minDimension y `t` — la variable continua que gobierna
// la composición, ver RESPONSIVE_CONFIG en config/responsive.config.js)
// — nunca una tabla de valores fijos por dispositivo. `dpr` se acepta y
// se devuelve por completitud (el encargo pide tenerlo en cuenta) pero
// no participa en ningún cálculo de composición: la geometría de
// cámara/FOV se define en unidades de mundo y grados, independientes de
// cuántos píxeles físicos tenga la pantalla — devicePixelRatio ya se usa
// donde SÍ corresponde (renderer.setPixelRatio, en scene.js, sin tocar
// en esta iteración), que es una cuestión de nitidez, no de encuadre.
//
// `deviceClass` es puramente INFORMATIVA (útil para depuración o para
// analítica futura, ver visits.js) — ningún cálculo de cámara/carta
// ramifica sobre ella; toda la composición depende únicamente de `t`,
// que a su vez depende solo del aspect ratio real, de forma continua.
// -----------------------------------------------------------------------
export function getResponsiveLayout(
  width = window.innerWidth,
  height = window.innerHeight,
  dpr = window.devicePixelRatio || 1
) {
  const rc = CONFIG.responsive;
  const aspect = width / height;
  const orientation = aspect >= 1 ? "landscape" : "portrait";
  const minDimension = Math.min(width, height);

  let deviceClass = "desktop";
  if (minDimension < 480) deviceClass = "mobile";
  else if (minDimension < 900) deviceClass = "tablet";

  // t: 0 en aspect >= referenceAspect (composición de escritorio
  // intacta, ver CONFIG.camera en config.js) → 1 en aspect <=
  // narrowAspect (adaptación portrait completa, ver RESPONSIVE_CONFIG.
  // portrait/letter), interpolado linealmente entre medias — la ÚNICA
  // variable de la que depende toda la adaptación de cámara/carta.
  const t = THREE.MathUtils.clamp(
    (rc.referenceAspect - aspect) / (rc.referenceAspect - rc.narrowAspect),
    0,
    1
  );

  return { width, height, dpr, aspect, orientation, minDimension, deviceClass, t };
}
