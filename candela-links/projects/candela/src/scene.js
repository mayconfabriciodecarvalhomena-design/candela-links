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

// -----------------------------------------------------------------------
// PÉRDIDA DE CONTEXTO WEBGL (ver el encargo de esta iteración — FASE 3).
// `contextLost` es deliberadamente el ÚNICO estado nuevo que introduce
// este archivo: en cuanto el navegador dispara "webglcontextlost" (ver
// más abajo, dentro de `initScene()`), `animate()` deja de llamar a
// `renderer.render()` en cada frame — sin eso, seguiría intentando
// pintar contra un contexto muerto indefinidamente. No se intenta
// reconstruir nada aquí: "webglcontextrestored" solo se registra (ver
// más abajo) y notifica hacia arriba (`options.onContextRestored`,
// gestionado en main.js) — recrear de forma segura TODOS los sistemas
// que dependen de la escena (matches, inspección de objetos, puerta,
// finale, carta...) con la arquitectura actual sería complejo y
// arriesgado; según el propio encargo, es preferible dejar un estado de
// error/reintento claro (ver intro.js `setLoadError`/`onRetry`) que una
// reconstrucción parcial que pueda introducir bugs. Por eso este flag,
// una vez a `true`, no se vuelve a poner a `false` desde aquí — el único
// camino de vuelta es un reintento real desde main.js (recarga
// completa de página), que crea un contexto nuevo desde cero.
let contextLost = false;

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
// "es un móvil") se combinan DOS ajustes graduales, con
// CONFIG.responsive.portrait como extremo (t=1):
//
//   1. RETROCEDER la cámara (portrait.maxDollyBack) a lo largo de su
//      MISMA dirección de mirada de escritorio — condición NECESARIA:
//      comprobado numéricamente que, por debajo de un umbral de
//      retroceso (≈3 unidades), la puerta y el espejo se quedan en 0%
//      de visibilidad sin importar cuánto suba el FOV. Alejar la cámara
//      reduce el tamaño angular de toda la habitación proporcionalmente,
//      así que el hFov (aunque siga siendo estrecho en grados) cubre una
//      franja de mundo mucho más ancha.
//   2. Ampliar el FOV vertical, con un tope MODERADO (portrait.maxFov)
//      para no caer en distorsión de ojo de pez ni encoger de más los
//      objetos reales — `camera.fov` en three.js es el FOV VERTICAL, así
//      que en un aspect ratio estrecho el FOV HORIZONTAL real cae mucho
//      más de lo que este número sugiere (a fov=56/aspect 16:9 el hFov
//      real es ≈87°; ese mismo fov=56 a aspect 0.45 da un hFov real de
//      solo ≈23° — la causa geométrica original del recorte en portrait).
//      Superado el umbral de retroceso del punto 1, este es el ajuste
//      con más recorrido por grado — es la palanca principal para
//      ganar más puerta/espejo SIN aumentar más el retroceso (ver el
//      razonamiento numérico completo en CONFIG.responsive.portrait,
//      config/responsive.config.js).
//
// `lookAtTarget`/`positionTarget` (CONFIG.responsive.portrait) se dejan
// IGUALES a CONFIG.camera.lookAt/position a propósito — con esos dos
// valores iguales a la base, el lerp() de abajo no mueve nada, y la
// composición en portrait es la MISMA vista de escritorio (gato, vela,
// mesa, cuadro, y ahora también la mayor parte de puerta/espejo), solo
// vista desde más lejos y con algo más de FOV vertical — nunca una
// composición distinta o recentrada sobre un subconjunto de elementos.
//
// Ver CONFIG.responsive.portrait (config/responsive.config.js) para los
// valores concretos y su razonamiento.
// -----------------------------------------------------------------------
const basePosition = new THREE.Vector3();
const baseLookAt = new THREE.Vector3();
const portraitPosition = new THREE.Vector3();
const portraitLookAt = new THREE.Vector3();
const blendedPosition = new THREE.Vector3();
// blendedLookAtBase: el punto de mira "puro" que ya calculaba este
// archivo antes de esta iteración (solo depende de CONFIG.camera +
// CONFIG.responsive.portrait + `t`, NUNCA del paneo lateral de abajo).
// Es el pivote sobre el que gira el paneo — recalculado únicamente en
// applyResponsiveCamera (init/resize), igual que siempre.
const blendedLookAtBase = new THREE.Vector3();
// blendedLookAt: el punto de mira REAL ya aplicado a la cámara en este
// instante — blendedLookAtBase rotado por panYawOffset (ver
// applyCameraPan() más abajo). Es lo que devuelve getCameraBaseLookAt(),
// así que objectInspection.js sigue viendo, sin ningún cambio en ese
// archivo, "la vista real vigente ahora mismo" — antes esa vista nunca
// se apartaba de blendedLookAtBase; ahora también puede incluir paneo.
const blendedLookAt = new THREE.Vector3();
const backDirection = new THREE.Vector3();

// -----------------------------------------------------------------------
// PANEO LATERAL DE CÁMARA (exploración táctil izquierda/derecha — ver
// src/cameraPan.js, que es quien decide EL VALOR de `panYawOffset` a
// partir del drag del usuario y de los límites geométricos reales de
// puerta/espejo; este archivo solo sabe "girar la cámara sobre sí misma
// tantos radianes", nunca calcula límites ni escucha eventos de puntero).
//
// Es una ROTACIÓN pura alrededor del eje Y que pasa por camera.position
// (nunca se traslada la cámara, nunca se toca su Y) — "sentado delante
// de la mesa, mirando un poco hacia la izquierda o la derecha", tal
// cual pide el encargo. Se aplica sobre blendedLookAtBase (el pivote sin
// panear) preservando su distancia exacta a la cámara, así que el punto
// resultante barre un arco horizontal a esa misma distancia — nunca
// atraviesa paredes ni cambia de "qué tan lejos mira" la cámara.
// -----------------------------------------------------------------------
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const panDirection = new THREE.Vector3();
let panYawOffset = 0;

function applyCameraPan() {
  panDirection.copy(blendedLookAtBase).sub(camera.position);
  const distance = panDirection.length();
  panDirection.normalize();
  if (panYawOffset !== 0) {
    panDirection.applyAxisAngle(Y_AXIS, panYawOffset);
  }
  blendedLookAt.copy(camera.position).addScaledVector(panDirection, distance);
  camera.lookAt(blendedLookAt);
}

// Llamado cada frame por cameraPan.js (con su valor ya amortiguado/
// clampeado) mientras el paneo no esté suspendido (ver isSuspended en
// createCameraPan(), main.js) — objectInspection.js y candelaFinale.js
// NUNCA llaman a esto, así que nunca compiten por la cámara con ellos:
// cameraPan.js simplemente deja de llamar a esta función mientras dure
// una inspección o el final, y panYawOffset se queda "congelado" en su
// último valor (ver la nota de cabecera de cameraPan.js).
export function setCameraPanYaw(offsetRadians) {
  panYawOffset = offsetRadians;
  applyCameraPan();
}

// Punto de mira "puro" (sin paneo) vigente ahora mismo — lo usa
// cameraPan.js como referencia para calcular, cada frame, tanto la
// dirección "de frente" (t=0 de su propio paneo) como los límites
// izquierdo/derecho reales (ángulo hasta la puerta/el espejo desde
// camera.position). Devuelve una copia, mismo criterio que
// getCameraBaseLookAt().
export function getCameraUnpannedLookAt() {
  return blendedLookAtBase.clone();
}

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
  blendedLookAtBase.copy(baseLookAt).lerp(portraitLookAt, layout.t);

  camera.fov = THREE.MathUtils.lerp(CONFIG.camera.fov, rc.maxFov, layout.t);

  backDirection.copy(blendedPosition).sub(blendedLookAtBase).normalize();
  camera.position.copy(blendedPosition).addScaledVector(backDirection, rc.maxDollyBack * layout.t);

  // ITERACIÓN — paneo lateral: antes esta función terminaba con
  // `camera.lookAt(blendedLookAt); camera.updateProjectionMatrix();`
  // usando directamente el punto de mira recién calculado. ahora ese
  // punto vive en blendedLookAtBase (sin panear) y es applyCameraPan()
  // quien, a partir de él y del panYawOffset VIGENTE (el que ya
  // hubiera antes de este resize — nunca se resetea aquí), calcula
  // blendedLookAt real y llama a camera.lookAt(). Con panYawOffset=0
  // (valor inicial, antes de que cameraPan.js toque nada) el resultado
  // es idéntico, ángulo a ángulo, al de siempre.
  applyCameraPan();
  camera.updateProjectionMatrix();

  return layout;
}

// -----------------------------------------------------------------------
// getCameraBaseLookAt(): expone el ÚLTIMO lookAt "normal" aplicado por
// este archivo (el CONFIG.camera.lookAt de escritorio, o su mezcla con
// CONFIG.responsive.portrait.lookAtTarget en pantallas estrechas —
// SIEMPRE ya con el paneo lateral en curso incluido, ver
// setCameraPanYaw()/applyCameraPan() arriba) — nunca el lookAt de una
// inspección de objeto en curso (objectInspection.js, que mueve la
// cámara temporalmente y siempre vuelve exactamente a la vista de la
// que venía, paneada o no).
//
// ITERACIÓN — paneo lateral: antes de esta iteración este valor NUNCA
// se apartaba del punto de mira responsive puro (no existía nada más
// que lo tocase). Ahora también puede incluir el paneo — a propósito:
// objectInspection.js captura este valor como "vista a la que volver
// al salir" (previousLookAt), y esa vista SIEMPRE debe ser la que el
// usuario tenía de verdad justo antes de entrar a inspeccionar,
// paneada o no — si devolviera el centro puro, salir de una inspección
// mientras la cámara estaba paneada haría que la vista "saltara" al
// centro en vez de retomar el paneo. Con este cambio, objectInspection.js
// no necesita ni una sola línea modificada: sigue leyendo "el lookAt
// real vigente" exactamente igual que antes, solo que ahora ese valor
// es más preciso.
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

export function initScene(options = {}) {
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

  // FASE 3 — pérdida/restauración de contexto WebGL (ver el comentario
  // de `contextLost` arriba). `event.preventDefault()` es OBLIGATORIO en
  // "webglcontextlost": sin él, el navegador considera la pérdida
  // definitiva y "webglcontextrestored" nunca llega a dispararse.
  renderer.domElement.addEventListener(
    "webglcontextlost",
    (event) => {
      event.preventDefault();
      contextLost = true;
      console.error("[Candela] Contexto WebGL perdido — se detiene el render loop.", {
        type: "webgl-context-lost",
      });
      if (typeof options.onContextLost === "function") {
        options.onContextLost();
      }
    },
    false
  );

  renderer.domElement.addEventListener(
    "webglcontextrestored",
    () => {
      // A propósito NO se pone `contextLost = false` aquí ni se intenta
      // reanudar el render loop — ver el comentario junto a la
      // declaración de `contextLost` arriba: esta escena concreta no
      // vuelve a renderizarse tras una pérdida de contexto, el camino de
      // recuperación es un reintento real (recarga de página) desde
      // main.js/intro.js.
      console.warn("[Candela] Contexto WebGL restaurado por el navegador — no se reconstruye la escena automáticamente.", {
        type: "webgl-context-restored",
      });
      if (typeof options.onContextRestored === "function") {
        options.onContextRestored();
      }
    },
    false
  );

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

  // FASE 3 — ver el comentario de `contextLost` arriba: mientras el
  // contexto esté perdido, ni siquiera se actualizan los sistemas
  // registrados en `updateCallbacks` (no solo se salta el render) — no
  // tiene sentido seguir avanzando lógica de una escena cuyo único
  // camino de recuperación es un reintento completo.
  if (contextLost) return;

  const delta = clock.getDelta();

  updateCallbacks.forEach((callback) => callback(delta));

  renderer.render(scene, camera);
}