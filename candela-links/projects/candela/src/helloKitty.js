import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// HELLO KITTY: pequeño detalle decorativo de mesa (assets/models/
// hello_kitty.glb). Mismo patrón exacto que candle.js: carga el GLB,
// lo escala de forma uniforme para alcanzar la altura deseada, lo apoya
// sobre la superficie de la mesa, y activa sombras — nada más.
//
// A propósito NO tiene ningún sistema de revelado por opacidad (a
// diferencia de cat.js): el modelo usa materiales PBR normales (ver la
// nota en helloKitty.config.js), así que reacciona de verdad a las
// luces ya existentes de la escena (AmbientLight/HemisphereLight de
// scene.js + la PointLight cálida de flame.js cuando la vela está
// encendida) — oscuro-pero-sólido con la vela apagada, progresivamente
// más iluminado cuando se enciende, sin ningún fundido/opacity artificial
// que mantener aquí. No se añade ninguna luz propia: la vela sigue
// siendo la única fuente de luz cálida de la escena.
// -----------------------------------------------------------------------

export function createHelloKitty(scene) {
  const cfg = CONFIG.helloKitty;

  const group = new THREE.Group();
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;
  scene.add(group);

  // Objeto que devolvemos ya mismo, aunque el modelo tarde en cargar.
  // `model` se rellena cuando termina la carga (mismo criterio que
  // candle.js/cat.js).
  const helloKitty = { group, model: null };

  const loader = new GLTFLoader();

  loader.load(
    cfg.modelPath,
    (gltf) => {
      const model = gltf.scene;

      // El modelo puede venir en cualquier unidad/tamaño según el
      // archivo original, así que lo medimos y lo escalamos para que
      // tenga la altura que pedimos en la configuración.
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);

      if (size.y > 0) {
        const scaleFactor = cfg.targetHeight / size.y;
        model.scale.setScalar(scaleFactor);
      }

      // Con el nuevo tamaño, volvemos a medir para saber cuánto hay que
      // subir el modelo y que su base quede justo apoyada en la
      // superficie (y = 0 en el espacio local de "group", que ya está
      // colocado en cfg.position).
      const scaledBox = new THREE.Box3().setFromObject(model);
      model.position.y -= scaledBox.min.y;

      // Activamos sombras en todas las mallas del modelo, igual que
      // candle.js/cat.js — sin añadir ninguna luz propia, la sombra la
      // proyecta/recibe con la PointLight ya existente de la llama.
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      group.add(model);
      helloKitty.model = model;
    },
    undefined,
    (error) => {
      console.error(`No se pudo cargar ${cfg.modelPath}:`, error);
    }
  );

  return helloKitty;
}
