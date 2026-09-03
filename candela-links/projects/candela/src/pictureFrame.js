import * as THREE from "three";
import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// PICTURE FRAME: cuadro decorativo colgado en la pared del fondo, encima
// y ligeramente a la derecha de la vela. Elemento nuevo, independiente y
// estático (no se anima, no se registra en onUpdate() — mismo criterio
// que room.js, del que se apoya conceptualmente pero vive en su propio
// módulo por ser un añadido posterior).
//
// Estructura, de atrás hacia delante (misma idea que un cuadro real
// colgado en la pared):
//   pared → [wallGap] → MARCO (4 listones con profundidad `frame.depth`,
//   formando un borde HUECO — no un bloque sólido — con una ventana del
//   mismo tamaño que la imagen) → [imageInset, hundido dentro del hueco
//   del marco] → IMAGEN (un plano con la textura de la foto, o su
//   marcador de posición si `imagePath` todavía no existe).
//
// La imagen se carga de forma asíncrona (THREE.TextureLoader, igual que
// candle.js/cat.js/helloKitty.js cargan sus .glb con GLTFLoader): el
// cuadro se construye y se ve correctamente desde el primer frame con un
// marcador de posición, y la textura real la sustituye en cuanto termina
// de cargar (o se queda con el marcador, sin romper nada, si el archivo
// no existe o falla la carga — mismo criterio de robustez que ya usa
// candle.js con `findWickTipLocal`/onError).
// -----------------------------------------------------------------------

export function createPictureFrame(scene) {
  const cfg = CONFIG.pictureFrame;
  const rotationY = cfg.rotationY ?? 0;

  const group = new THREE.Group();
  scene.add(group);

  // Normal de la pared (misma fórmula que ya usa addMirror en room.js
  // para generalizar más allá de la pared del fondo): con rotationY=0
  // apunta hacia +Z (hacia la cámara/habitación).
  const normalX = Math.sin(rotationY);
  const normalZ = Math.cos(rotationY);

  // ---- MARCO: HUECO de verdad — 4 listones (arriba/abajo/izq/dcha)
  // que forman un borde rectangular con una VENTANA interior del mismo
  // tamaño exacto que la imagen (cfg.width x cfg.height), no un bloque
  // sólido.
  //
  // BUG REAL ENCONTRADO Y CORREGIDO (esto era el "cuadrado negro" del
  // reporte, no un problema de ruta/textura): el marco era un único
  // `BoxGeometry(frameOuterWidth, frameOuterHeight, depth)` — un bloque
  // MACIZO, sin ventana — colocado delante del plano de la imagen
  // (recedida solo `imageInset`, 1.2cm, detrás de su cara frontal). Al
  // ser opaco y cubrir exactamente la misma zona X/Y que la imagen, el
  // marco tapaba la foto por completo; lo único visible era la cara
  // frontal del marco, un marrón oscuro (0x4a3323) que se leía como
  // "cuadrado negro". No era un fallo de carga de textura ni de
  // orientación del material — la imagen SIEMPRE estuvo ahí detrás,
  // simplemente oculta. Sustituido por 4 listones fine que dejan la
  // ventana libre — mismo criterio "marco sencillo y realista" que ya
  // pedía la tarea original, ahora construido como un marco de verdad.
  //
  // Su cara TRASERA se apoya casi contra la pared (wallGap, solo para
  // evitar z-fighting) — pegado a la pared, no flotando.
  const frameOuterWidth = cfg.width + cfg.frame.margin * 2;
  const frameOuterHeight = cfg.height + cfg.frame.margin * 2;

  const frameBackOffset = cfg.wallGap + cfg.frame.depth / 2;
  const frameCenterX = cfg.position[0] + normalX * frameBackOffset;
  const frameCenterZ = cfg.position[1] + normalZ * frameBackOffset;

  // Vector "a lo largo de la pared" (perpendicular a la normal, en el
  // plano horizontal): junto con normalX/normalZ, es la base que hace
  // falta para desplazar los listones izquierdo/derecho en world-space
  // cuando rotationY no es 0 (mismo criterio de generalización que ya
  // usa el resto de este archivo). Con rotationY=0 (pared del fondo,
  // caso actual) esto es simplemente (1, 0) — puro eje X.
  const alongX = Math.cos(rotationY);
  const alongZ = -Math.sin(rotationY);

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: cfg.frame.color,
    roughness: cfg.frame.roughness,
  });

  function addBar(width, height, alongOffset) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, cfg.frame.depth),
      frameMaterial
    );
    bar.rotation.y = rotationY;
    bar.position.set(
      frameCenterX + alongX * alongOffset,
      cfg.centerY,
      frameCenterZ + alongZ * alongOffset
    );
    bar.castShadow = true;
    bar.receiveShadow = true;
    group.add(bar);
    return bar;
  }

  // Izquierda/derecha: cubren toda la altura exterior (incluyen las
  // esquinas). Arriba/abajo: solo el ancho de la ventana, para no
  // solapar con los listones laterales.
  const sideBarOffset = cfg.width / 2 + cfg.frame.margin / 2;
  addBar(cfg.frame.margin, frameOuterHeight, -sideBarOffset); // izquierda
  addBar(cfg.frame.margin, frameOuterHeight, sideBarOffset); // derecha
  const topBarY = cfg.centerY + cfg.height / 2 + cfg.frame.margin / 2;
  const bottomBarY = cfg.centerY - cfg.height / 2 - cfg.frame.margin / 2;
  [topBarY, bottomBarY].forEach((barY) => {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(cfg.width, cfg.frame.margin, cfg.frame.depth),
      frameMaterial
    );
    bar.rotation.y = rotationY;
    bar.position.set(frameCenterX, barY, frameCenterZ);
    bar.castShadow = true;
    bar.receiveShadow = true;
    group.add(bar);
  });

  // ---- IMAGEN: un plano recedido `imageInset` respecto a la cara
  // frontal del marco (frameCenterZ/X + frame.depth/2 a lo largo de la
  // normal), para que quede un pequeño hueco donde la luz de la escena
  // pinte una sombra sutil del borde del marco — el cuadro se lee con
  // volumen real, no como una imagen pegada encima de una caja.
  const frameFrontOffset = frameBackOffset + cfg.frame.depth / 2;
  const imageOffset = frameFrontOffset - cfg.imageInset;
  const imageCenterX = cfg.position[0] + normalX * imageOffset;
  const imageCenterZ = cfg.position[1] + normalZ * imageOffset;

  // Textura de marcador de posición: se usa de inmediato (la carga real
  // es asíncrona) y se mantiene si `imagePath` no existe o falla.
  const placeholderTexture = buildPlaceholderTexture(cfg.width, cfg.height, cfg.imagePath);
  const imageMaterial = new THREE.MeshStandardMaterial({
    map: placeholderTexture,
    roughness: 0.85,
  });

  const image = new THREE.Mesh(
    new THREE.PlaneGeometry(cfg.width, cfg.height),
    imageMaterial
  );
  image.rotation.y = rotationY;
  image.position.set(imageCenterX, cfg.centerY, imageCenterZ);
  image.receiveShadow = true;
  group.add(image);

  // ---- Carga real de la foto del usuario, si existe. `imagePath` (ver
  // pictureFrame.config.js) es la ruta que el usuario debe sustituir.
  const loader = new THREE.TextureLoader();
  loader.load(
    cfg.imagePath,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      // Encuadre "cover": recorta el sobrante en vez de deformar la
      // foto si su proporción no coincide con width/height del cuadro.
      applyCoverUV(texture, cfg.width / cfg.height);
      placeholderTexture.dispose();
      imageMaterial.map = texture;
      imageMaterial.needsUpdate = true;
    },
    undefined,
    () => {
      // Sin archivo todavía (o error de carga): se queda el marcador de
      // posición ya visible, la escena sigue funcionando con normalidad.
      console.info(
        `[candela] No se encontró "${cfg.imagePath}" — el cuadro muestra un ` +
          "marcador de posición. Coloca tu foto en esa ruta para sustituirlo."
      );
    }
  );

  return { group, image };
}

// Ajusta repeat/offset de la textura para un encuadre tipo
// "background-size: cover": mantiene la proporción original de la
// imagen, recorta el sobrante (centrado) en vez de estirarla.
function applyCoverUV(texture, frameAspect) {
  const img = texture.image;
  if (!img || !img.width || !img.height) return;

  const imageAspect = img.width / img.height;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

  if (imageAspect > frameAspect) {
    // Imagen más ancha que el hueco del cuadro: recorta a los lados.
    const repeatX = frameAspect / imageAspect;
    texture.repeat.set(repeatX, 1);
    texture.offset.set((1 - repeatX) / 2, 0);
  } else {
    // Imagen más alta que el hueco del cuadro: recorta arriba/abajo.
    const repeatY = imageAspect / frameAspect;
    texture.repeat.set(1, repeatY);
    texture.offset.set(0, (1 - repeatY) / 2);
  }
}

// ---- MARCADOR DE POSICIÓN ----
// Textura generada por canvas (sin imágenes externas — mismo criterio
// que ya usa room.js para la veta de madera del suelo y matchvisual.js
// para el palo de las cerillas), en los tonos cálidos de Candela: un
// fondo crema suave con un icono sencillo de "foto" y un texto corto que
// indica dónde colocar la imagen real. Nada de grises genéricos de
// placeholder de librería — tiene que sentirse parte de la escena
// mientras el usuario no ha puesto su foto todavía.
function buildPlaceholderTexture(worldWidth, worldHeight, imagePath) {
  const w = 512;
  const h = Math.round(w * (worldHeight / worldWidth));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  // Fondo: crema cálido con un ligero degradado hacia los bordes
  // (evita que se lea como un rectángulo perfectamente plano/digital).
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, "#f3e7da");
  gradient.addColorStop(1, "#e8d8c6");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // Viñeta suave en las esquinas, como una foto envejecida/cálida, no
  // un placeholder digital.
  const vignette = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.35,
    w / 2, h / 2, Math.max(w, h) * 0.75
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(90,60,40,0.16)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // Icono sencillo "imagen de paisaje": marco fino + sol + montañas,
  // en un tono marrón suave, centrado.
  const iconW = w * 0.42;
  const iconH = iconW * 0.68;
  const iconX = (w - iconW) / 2;
  const iconY = (h - iconH) / 2 - h * 0.04;
  const stroke = "#a9825f";

  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, w * 0.006);
  ctx.strokeRect(iconX, iconY, iconW, iconH);

  ctx.fillStyle = stroke;
  ctx.beginPath();
  ctx.arc(iconX + iconW * 0.24, iconY + iconH * 0.28, iconW * 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(iconX + iconW * 0.06, iconY + iconH * 0.85);
  ctx.lineTo(iconX + iconW * 0.38, iconY + iconH * 0.5);
  ctx.lineTo(iconX + iconW * 0.58, iconY + iconH * 0.68);
  ctx.lineTo(iconX + iconW * 0.78, iconY + iconH * 0.42);
  ctx.lineTo(iconX + iconW * 0.94, iconY + iconH * 0.85);
  ctx.closePath();
  ctx.fill();

  // Texto corto: dónde poner la foto real.
  ctx.fillStyle = "#8a6a52";
  ctx.textAlign = "center";
  ctx.font = `${Math.round(w * 0.042)}px Georgia, serif`;
  ctx.fillText("tu foto aquí", w / 2, iconY + iconH + h * 0.1);
  ctx.font = `${Math.round(w * 0.028)}px Georgia, serif`;
  ctx.fillStyle = "#a9825f";
  ctx.fillText(imagePath, w / 2, iconY + iconH + h * 0.16);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
