import * as THREE from "three";
import { CONFIG, DEBUG } from "./config.js";
import { createRoom } from "./room.js";
import { createCandle } from "./candle.js";
import { createFlame } from "./flame.js";
import { createSmoke } from "./smoke.js";
import { createBackgroundParticles } from "./particlesBackground.js";
import { createMatchVisual } from "./matchvisual.js";
import { createCat } from "./cat.js";
import { createHelloKitty } from "./helloKitty.js";
import { createFlameWords } from "./flameWords.js";
import { createPictureFrame } from "./pictureFrame.js";
import { addDebugLighting } from "./debug.js";
import { getResponsiveLayout } from "./responsiveLayout.js";

let scene, camera, renderer, clock;

// Funciones que otros módulos podrán registrar para que se ejecuten en
// cada frame, sin tener que tocar este archivo cada vez (útil cuando
// añadamos la llama, el gato, las partículas, etc).
const updateCallbacks = [];

// -----------------------------------------------------------------------
// CÁMARA RESPONSIVE (ver el encargo de esta iteración — "sistema
// responsive dinámico basado en el viewport real", "no solo alejar la
// cámara", "solución de composición 3D").
//
// CONFIG.camera (fov/position/lookAt, en config.js) sigue siendo la
// composición de escritorio, SIN TOCAR: en aspect ratio >=
// CONFIG.responsive.referenceAspect (16:9 — la inmensa mayoría de
// móviles en horizontal ya caen aquí de forma natural) el resultado es
// EXACTAMENTE el mismo fov/position/lookAt de siempre.
//
// Por debajo de ese aspect ratio (`t` > 0, ver getResponsiveLayout() en
// responsiveLayout.js — continuo, derivado del aspect real, nunca de un
// "es un móvil") se combinan TRES ajustes graduales, con
// CONFIG.responsive.portrait como extremo (t=1):
//
//   1. RECENTRAR el encuadre (lookAt) y la posición de la cámara hacia
//      el punto medio entre la vela y el gato — los dos elementos de
//      mayor prioridad narrativa (ver el encargo, sección 4: "1. vela,
//      2. carta/sobre, 3. gato...") — en vez de simplemente ensanchar
//      el FOV alrededor del lookAt de escritorio (que incluye también
//      el espejo/la puerta, de menor prioridad). Esto es lo que evita
//      "solo hacer zoom out": no es una misma foto más alejada, es una
//      composición distinta, más cerrada sobre lo importante.
//   2. Ampliar el FOV vertical, con un tope MODERADO (portrait.maxFov)
//      para no caer en distorsión de ojo de pez ni encoger de más los
//      objetos reales.
//   3. Un retroceso de cámara PEQUEÑO (portrait.maxDollyBack), como
//      ajuste fino final tras los dos anteriores, no como mecanismo
//      principal.
//
// Ver CONFIG.responsive.portrait (config/responsive.config.js) para los
// valores concretos y su razonamiento.
// -----------------------------------------------------------------------
const basePosition = new THREE.Vector3();
const baseLookAt = new THREE.Vector3();
const portraitPosition = new THREE.Vector3();
const portraitLookAt = new THREE.Vector3();
const blendedPosition = new THREE.Vector3();
const blendedLookAt = new THREE.Vector3();
const backDirection = new THREE.Vector3();

function applyResponsiveCamera(width, height) {
  const layout = getResponsiveLayout(width, height);
  const rc = CONFIG.responsive.portrait;

  camera.aspect = layout.aspect;

  basePosition.set(...CONFIG.camera.position);
  baseLookAt.set(...CONFIG.camera.lookAt);
  portraitPosition.set(...rc.positionTarget);
  portraitLookAt.set(...rc.lookAtTarget);

  // t=0 → blended* queda EXACTAMENTE en basePosition/baseLookAt (lerp
  // con alpha 0 devuelve el propio valor de partida): composición de
  // escritorio intacta, byte a byte igual que antes de esta iteración.
  blendedPosition.copy(basePosition).lerp(portraitPosition, layout.t);
  blendedLookAt.copy(baseLookAt).lerp(portraitLookAt, layout.t);

  camera.fov = THREE.MathUtils.lerp(CONFIG.camera.fov, rc.maxFov, layout.t);

  backDirection.copy(blendedPosition).sub(blendedLookAt).normalize();
  camera.position.copy(blendedPosition).addScaledVector(backDirection, rc.maxDollyBack * layout.t);

  camera.lookAt(blendedLookAt);
  camera.updateProjectionMatrix();

  return layout;
}

// -----------------------------------------------------------------------
// getCameraBaseLookAt(): expone el ÚLTIMO lookAt "base" aplicado por
// applyResponsiveCamera (el CONFIG.camera.lookAt de escritorio, o su
// mezcla con CONFIG.responsive.portrait.lookAtTarget en pantallas
// estrechas) — nunca el lookAt de una inspección de objeto en curso
// (objectInspection.js, que mueve la cámara temporalmente y siempre
// vuelve exactamente a la vista de la que venía).
//
// NECESARIO desde esta iteración (antes de la adaptación responsive de
// cámara, el lookAt real de la cámara SIEMPRE coincidía con
// CONFIG.camera.lookAt, así que objectInspection.js podía asumirlo como
// una constante). Ahora, en portrait, el lookAt real puede ser distinto
// de CONFIG.camera.lookAt (ver arriba), así que objectInspection.js
// necesita poder leer el valor REAL vigente en cada momento — ver la
// nota junto a `currentLookAt` en objectInspection.js. Devuelve una
// copia (nunca la referencia interna) para que quien la reciba no pueda
// mutar el estado de este módulo por accidente.
// -----------------------------------------------------------------------
export function getCameraBaseLookAt() {
  return blendedLookAt.clone();
}

export function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.scene.backgroundColor);

  camera = new THREE.PerspectiveCamera(
    CONFIG.camera.fov,
    window.innerWidth / window.innerHeight,
    CONFIG.camera.near,
    CONFIG.camera.far
  );
  applyResponsiveCamera(window.innerWidth, window.innerHeight);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.renderer.toneMappingExposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  document.getElementById("app").appendChild(renderer.domElement);

  addAmbientLight();
  const room = createRoom(scene);
  // Elemento decorativo nuevo e independiente: cuadro colgado en la
  // pared del fondo (src/pictureFrame.js). Estático, como room.js — no
  // se registra en onUpdate() ni depende de ningún otro sistema, así
  // que basta con instanciarlo aquí, sin tocar nada más.
  const pictureFrame = createPictureFrame(scene);
  createCandle(scene);
  const flame = createFlame(scene);
  // Módulo independiente (src/smoke.js): se suscribe solo a la llama
  // (onFlameExtinguished) y a la mecha (onWickReady), así que basta con
  // instanciarlo aquí, igual que el resto de sistemas — no hace falta
  // ninguna lógica de humo en este archivo.
  const smoke = createSmoke(scene);
  const backgroundParticles = createBackgroundParticles(scene, camera);
  const matchVisual = createMatchVisual(scene);
  // El gato ya NO se sincroniza con la vela mediante llamadas puntuales
  // (reveal()/hide()) — lee su estado de luz en vivo cada frame. Para
  // eso necesita, en su construcción, una referencia a la función real
  // de flame.js (creada un par de líneas más arriba: el orden de estas
  // dos líneas SÍ importa ahora). No se le pasa el objeto `flame`
  // completo — solo el getter de solo lectura que ya expone flame.js —
  // así cat.js no gana acceso a ignite()/extinguish() ni a nada más de
  // la llama, solo a su progreso de luz.
  const cat = createCat(scene, { getLightProgress: flame.getLightProgress });
  const helloKitty = createHelloKitty(scene);
  // v0 EXPERIMENTAL, aditivo: no depende de flame.js ni lo modifica (ver
  // src/flameWords.js). Se ancla sola a la mecha real (onWickReady,
  // igual que smoke.js) y solo se activa a mano desde la consola
  // (candela.flameWords.show("...")) — no altera nada de lo que ya
  // ocurre en la escena mientras no se llame.
  const flameWords = createFlameWords(scene, camera);

  // Luz extra solo para desarrollo. Si DEBUG es false, esta línea no
  // añade nada y la escena queda con su iluminación oscura habitual.
  if (DEBUG) {
    addDebugLighting(scene);
  }

  clock = new THREE.Clock();

  // ITERACIÓN — ver el encargo: "recalcular mediante resize y, si es
  // necesario, orientationchange; evita crear listeners duplicados".
  // Ambos disparan exactamente el mismo onResize (window.innerWidth/
  // innerHeight en el momento de la llamada, no un valor cacheado en el
  // propio evento) — "resize" ya cubre casi todos los casos por sí solo
  // en navegadores actuales, "orientationchange" es un respaldo
  // adicional para el giro de dispositivo en algunos navegadores/
  // versiones donde "resize" puede llegar con un frame de retraso.
  // initScene() se llama UNA sola vez por carga de página (ver
  // main.js), así que estos addEventListener también se registran una
  // sola vez — sin riesgo de duplicados.
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  animate();

  return { scene, camera, renderer, room, pictureFrame, flame, smoke, backgroundParticles, matchVisual, cat, helloKitty, flameWords };
}

// Permite que otros módulos (llama, gato, partículas...) se enganchen
// al render loop sin modificar este archivo.
export function onUpdate(callback) {
  updateCallbacks.push(callback);
}

// -----------------------------------------------------------------------
// fastForward(totalSeconds, step): avanza TODOS los sistemas ya
// registrados en `updateCallbacks` (llama, sobre, carta, candelaFinale,
// flameWords, gato...) con deltas sintéticos, en vez de esperar a los
// deltas reales de `animate()` — reutiliza el mismo array y el mismo
// mecanismo, no crea ninguna animación paralela ni ningún estado nuevo.
//
// Pensado para "Saltar animación" (ver src/skipIntro.js): permite que la
// propia máquina de estados de cada sistema llegue a su estado final
// real (el que ya calcula su propio código), solo que en una fracción de
// segundo en vez de en tiempo real.
//
// A propósito NO llama a `renderer.render()` en ningún momento: los
// fotogramas intermedios de este avance sintético nunca se pintan en
// pantalla — el usuario solo verá el resultado ya asentado en el
// siguiente `requestAnimationFrame` real de `animate()`, exactamente
// igual que si hubiera esperado a que la animación normal terminase.
//
// `step` por defecto (1/20 s) es deliberadamente pequeño: varias
// transiciones de fase dependen de que un sistema (p. ej. la apertura
// del sobre) procese su PROPIO update() en un "fotograma" posterior al
// que activó la transición (ver el comentario de orquestación en
// skipIntro.js) — un `step` demasiado grande podría saltarse ese orden
// relativo entre sistemas. `fastForward` no sabe nada de fases ni de
// candelaFinale: quien lo usa decide cuántos segundos totales avanzar y
// cuándo parar (ver skipIntro.js, que consulta candelaFinale.getPhase()
// entre tandas).
// -----------------------------------------------------------------------
export function fastForward(totalSeconds, step = 1 / 20) {
  let remaining = Math.max(0, totalSeconds);
  while (remaining > 0) {
    const dt = Math.min(step, remaining);
    updateCallbacks.forEach((callback) => callback(dt));
    remaining -= dt;
  }
}

function addAmbientLight() {
  const ambient = new THREE.AmbientLight(
    CONFIG.scene.ambientColor,
    CONFIG.scene.ambientIntensity
  );
  scene.add(ambient);

  const hemiCfg = CONFIG.scene.hemisphere;
  if (hemiCfg) {
    const hemi = new THREE.HemisphereLight(
      hemiCfg.skyColor,
      hemiCfg.groundColor,
      hemiCfg.intensity
    );
    scene.add(hemi);
  }
}

function onResize() {
  applyResponsiveCamera(window.innerWidth, window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  updateCallbacks.forEach((callback) => callback(delta));

  renderer.render(scene, camera);
}