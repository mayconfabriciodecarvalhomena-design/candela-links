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

let scene, camera, renderer, clock;

// Funciones que otros módulos podrán registrar para que se ejecuten en
// cada frame, sin tener que tocar este archivo cada vez (útil cuando
// añadamos la llama, el gato, las partículas, etc).
const updateCallbacks = [];

export function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.scene.backgroundColor);

  camera = new THREE.PerspectiveCamera(
    CONFIG.camera.fov,
    window.innerWidth / window.innerHeight,
    CONFIG.camera.near,
    CONFIG.camera.far
  );
  camera.position.set(...CONFIG.camera.position);
  camera.lookAt(...CONFIG.camera.lookAt);

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

  window.addEventListener("resize", onResize);

  animate();

  return { scene, camera, renderer, room, pictureFrame, flame, smoke, backgroundParticles, matchVisual, cat, helloKitty, flameWords };
}

// Permite que otros módulos (llama, gato, partículas...) se enganchen
// al render loop sin modificar este archivo.
export function onUpdate(callback) {
  updateCallbacks.push(callback);
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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  updateCallbacks.forEach((callback) => callback(delta));

  renderer.render(scene, camera);
}