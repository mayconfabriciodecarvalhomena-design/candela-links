import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// CANDLE: carga el modelo 3D real de la vela (assets/models/candle.glb).
//
// La llama (partículas + luz) NO vive aquí: vive en flame.js, que se
// coloca de forma independiente usando CONFIG.flame.position. Este
// archivo solo se encarga de la vela física.
//
// -----------------------------------------------------------------------
// AÑADIDO (petición de anclaje real llama↔mecha): `scene.js` llama a
// `createCandle(scene)` sin guardar el valor que devuelve, y luego
// llama a `createFlame(scene)` sin pasarle ninguna referencia a la
// vela — por diseño, `flame.js` nunca ha tenido forma de conocer dónde
// está realmente la mecha del modelo cargado. Como `scene.js` está
// fuera del ámbito de estos cambios (no se toca), la única vía posible
// para que la llama conozca la posición REAL de la mecha (en vez de una
// posición hardcodeada e independiente) es que ESTE archivo la mida y
// la exponga, y que `flame.js` la importe directamente.
//
// Por eso se añade, al final del archivo: `findWickTipLocal()` (mide la
// punta real de la mecha sobre la geometría ya cargada) y
// `onWickReady()` (para que flame.js se suscriba a esa posición). Es lo
// único que se añade — el resto de este archivo, y todo lo que ya hacía
// (cargar el modelo, escalarlo, apoyarlo en el suelo, sombras), sigue
// exactamente igual.
// -----------------------------------------------------------------------

// Posición real de la punta de la mecha, en coordenadas de mundo. null
// hasta que el modelo termina de cargar (GLTFLoader es asíncrono).
let wickTipWorld = null;
const wickReadyCallbacks = [];

// Se suscribe a la posición real de la punta de la mecha. Si ya está
// disponible, invoca el callback de inmediato; si el modelo todavía se
// está cargando, lo invoca en cuanto esté listo. El callback recibe un
// THREE.Vector3 en coordenadas de mundo (ya independiente, no hace
// falta transformarlo más).
export function onWickReady(callback) {
  if (wickTipWorld) {
    callback(wickTipWorld.clone());
  } else {
    wickReadyCallbacks.push(callback);
  }
}

export function createCandle(scene) {
  const group = new THREE.Group();
  group.position.set(...CONFIG.candle.position);
  group.rotation.y = CONFIG.candle.rotationY;
  scene.add(group);

  // Objeto que devolvemos ya mismo, aunque el modelo tarde en cargar.
  // `model` se rellena cuando termina la carga (ver más abajo).
  const candle = { group, model: null };

  const loader = new GLTFLoader();

  loader.load(
    CONFIG.candle.modelPath,
    (gltf) => {
      const model = gltf.scene;

      // El modelo puede venir en cualquier unidad/tamaño según el archivo
      // original, así que lo medimos y lo escalamos para que tenga la
      // altura que pedimos en config.js (targetHeight).
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);

      const scaleFactor = CONFIG.candle.targetHeight / size.y;
      model.scale.setScalar(scaleFactor);

      // Con el nuevo tamaño, volvemos a medir para saber cuánto hay que
      // subir el modelo y que su base quede justo sobre el suelo (y = 0).
      const scaledBox = new THREE.Box3().setFromObject(model);
      model.position.y -= scaledBox.min.y;

      // Activamos sombras en todas las mallas del modelo.
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Punta real de la mecha: se mide AQUÍ, sobre la geometría ya
      // escalada y colocada, y ANTES de añadir "model" a "group" — así
      // que el resultado está en el mismo espacio local que "group"
      // (coincide con CONFIG.candle.position/rotationY, ya asignados a
      // "group" al principio de esta función). Después solo hace falta
      // pasarlo por la transformación de "group" para tener la posición
      // de mundo.
      const wickLocal = findWickTipLocal(model);

      group.add(model);
      candle.model = model;

      if (wickLocal) {
        group.updateMatrixWorld(true);
        const wickWorld = wickLocal.clone();
        group.localToWorld(wickWorld);
        wickTipWorld = wickWorld;
        wickReadyCallbacks.forEach((callback) => callback(wickWorld.clone()));
        wickReadyCallbacks.length = 0;
      } else {
        // No debería pasar con candle.glb tal y como está hoy, pero si
        // algún día se sustituye por un modelo sin geometría legible
        // (o vacío), la llama sigue funcionando: se queda en su
        // posición de respaldo (CONFIG.flame.position), simplemente sin
        // el anclaje automático.
        console.warn(
          "[candela] No se pudo medir la punta real de la mecha en candle.glb; " +
            "la llama usará su posición de respaldo (CONFIG.flame.position)."
        );
      }
    },
    undefined,
    (error) => {
      console.error("No se pudo cargar assets/models/candle.glb:", error);
    }
  );

  return candle;
}

// -----------------------------------------------------------------------
// Mide la punta real de la mecha sobre la geometría YA CARGADA (no una
// suposición): recorre todos los vértices del modelo y busca el punto
// más alto. Pero la punta de una mecha no es un único vértice — es un
// pequeño anillo de vértices formando su borde superior — así que se
// promedian los vértices que están muy cerca del punto más alto, para
// encontrar el CENTRO real (x, z) de ese anillo. Usar el centro de toda
// la caja envolvente en su lugar sería menos preciso: esa caja incluye
// también la cera, que es más ancha y no está necesariamente centrada
// exactamente igual que la mecha (en candle.glb, comprobado
// directamente sobre el archivo, hay un desfase de varios milímetros
// entre ambos centros — pequeño, pero suficiente para que la llama
// pareciera ligeramente descentrada respecto a la mecha real).
//
// Devuelve un THREE.Vector3 en el espacio local de "model" (antes de
// añadirlo a "group"), o null si el modelo no tiene geometría legible.
// -----------------------------------------------------------------------
function findWickTipLocal(model) {
  model.updateWorldMatrix(true, true);

  let maxY = -Infinity;
  let minY = Infinity;
  const points = [];
  const vertex = new THREE.Vector3();

  model.traverse((child) => {
    if (!child.isMesh) return;
    const posAttr = child.geometry && child.geometry.attributes && child.geometry.attributes.position;
    if (!posAttr) return;
    for (let i = 0; i < posAttr.count; i++) {
      vertex.fromBufferAttribute(posAttr, i);
      vertex.applyMatrix4(child.matrixWorld);
      points.push(vertex.clone());
      if (vertex.y > maxY) maxY = vertex.y;
      if (vertex.y < minY) minY = vertex.y;
    }
  });

  if (!points.length) return null;

  // Margen relativo a la altura total del modelo (no un número fijo),
  // para que siga funcionando igual de bien sin importar la escala a la
  // que se mida (aquí se mide ya escalado, pero así queda a prueba de
  // futuros cambios de tamaño del modelo).
  const epsilon = Math.max((maxY - minY) * 0.0015, 0.00005);
  const top = points.filter((p) => p.y > maxY - epsilon);

  const tip = new THREE.Vector3();
  top.forEach((p) => tip.add(p));
  tip.divideScalar(top.length);
  tip.y = maxY;
  return tip;
}