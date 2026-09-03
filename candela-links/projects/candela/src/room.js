import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { CONFIG } from "./config.js";
import { TABLE_TOP_Y } from "./config/room.config.js";

// -----------------------------------------------------------------------
// ROOM: el "plano" de habitación de Candela — suelo, dos tramos de
// pared (fondo + lateral, formando una esquina real), la mesa de noche,
// el espejo y la puerta. Deliberadamente NO es la habitación completa:
// solo lo que la cámara actual necesita reconocer como arquitectura.
//
// Sistema estático: no se anima ni se actualiza por frame (a diferencia
// de flame.js/cat.js/matches.js), así que no se registra en onUpdate().
// Se limita a construir geometría una vez y devolver las referencias
// que puedan hacer falta (por ejemplo, la altura de la mesa, ya
// exportada por separado en room.config.js como TABLE_TOP_Y).
// -----------------------------------------------------------------------

export function createRoom(scene) {
  const cfg = CONFIG.room;

  const group = new THREE.Group();
  scene.add(group);

  addFloor(group, cfg.floor);
  addWalls(group, cfg.wall);
  const table = addTable(group, cfg.table);
  addMirror(group, cfg.mirror);
  addDoor(group, cfg.door);

  return { group, tableTopY: TABLE_TOP_Y, table };
}

// ---- SUELO ----
function addFloor(group, cfg) {
  const geometry = new THREE.PlaneGeometry(cfg.width, cfg.depth);
  // BUG REAL ENCONTRADO Y CORREGIDO (esto es lo que hacía que el suelo
  // se viera negro puro, no solo "un marrón muy oscuro"): el material
  // tenía A LA VEZ `color: cfg.color` Y un `map` cuyo relleno base ya
  // se pinta con ESE MISMO cfg.color (ver buildFloorTexture). En
  // three.js el color final es `material.color * texel(map)` — al
  // llevar el mismo tono oscuro en AMBOS factores, el resultado se
  // eleva al cuadrado (un marrón ya oscuro al cuadrado da un valor
  // casi nulo), y el tone mapping ACES lo termina de aplastar a negro.
  // Verificado aislando el caso: con `color` + `map` el píxel salía
  // (3,0,0); quitando `color` (dejando que el mapa sea la única fuente
  // de color, patrón estándar en three.js) el mismo suelo sale
  // (57,28,12) — un marrón oscuro cálido perfectamente visible.
  const material = new THREE.MeshStandardMaterial({
    roughness: cfg.roughness,
    map: buildFloorTexture(cfg.color, cfg.grainColor, cfg.width, cfg.depth),
  });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cfg.position[0], 0, cfg.position[1]);
  floor.receiveShadow = true;
  group.add(floor);
}

// Vetas de madera en tablones, pintadas en un canvas — mismo criterio
// (sin imágenes externas) que ya usa matchvisual.js para el palo de las
// cerillas, aplicado aquí a una escala mucho mayor (suelo, no un
// cilindro pequeño).
function buildFloorTexture(base, grain, worldWidth, worldDepth) {
  const w = 512, h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = colorToCss(base);
  ctx.fillRect(0, 0, w, h);

  // Líneas de junta entre tablones (horizontales, el suelo "corre" a lo
  // ancho de la habitación) + vetas onduladas sutiles dentro de cada
  // tablón, para que no se lea como un color plano.
  const plankHeight = h / 8;
  for (let p = 0; p < 8; p++) {
    const y = p * plankHeight;

    ctx.strokeStyle = colorToCss(grain, 0.5);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();

    for (let i = 0; i < 5; i++) {
      const gy = y + Math.random() * plankHeight;
      ctx.strokeStyle = colorToCss(grain, 0.08 + Math.random() * 0.1);
      ctx.lineWidth = 0.6 + Math.random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      for (let x = 0; x <= w; x += 32) {
        ctx.lineTo(x, gy + (Math.random() * 6 - 3));
      }
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  // Repetición proporcional al tamaño real del suelo, para que los
  // tablones tengan un tamaño creíble (no gigantes ni microscópicos).
  texture.repeat.set(worldWidth / 2, worldDepth / 2);
  return texture;
}

function colorToCss(hex, alpha = 1) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- PAREDES ----
function addWalls(group, cfg) {
  const material = new THREE.MeshStandardMaterial({
    color: cfg.color,
    roughness: 0.95,
  });

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.back.width, cfg.height, cfg.thickness),
    material
  );
  back.position.set(cfg.back.position[0], cfg.height / 2, cfg.back.position[1]);
  back.receiveShadow = true;
  group.add(back);

  const side = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.side.width, cfg.height, cfg.thickness),
    material
  );
  side.rotation.y = cfg.side.rotationY;
  side.position.set(cfg.side.position[0], cfg.height / 2, cfg.side.position[1]);
  side.receiveShadow = true;
  group.add(side);
}

// ---- MESA ----
// Tablero largo + dos pies (uno en cada extremo), con el centro bajo el
// tablero completamente abierto (espacio real para piernas) — ver nota
// en room.config.js sobre por qué ya no es un único bloque cerrado.
function addTable(group, cfg) {
  const legMaterial = new THREE.MeshStandardMaterial({
    color: cfg.leg.color,
    roughness: 0.75,
  });
  const topMaterial = new THREE.MeshStandardMaterial({
    color: cfg.top.color,
    roughness: cfg.top.roughness,
  });

  const legHeight = cfg.leg.size[1];
  const topHeight = cfg.top.size[1];
  const [topX, topZ] = cfg.top.position;
  const topWidth = cfg.top.size[0];
  const legWidth = cfg.leg.size[0];

  // Centro X de cada pie: pegado al borde exterior del tablero, con un
  // pequeño inset hacia dentro (mismo criterio que el "vuelo de borde"
  // que ya tenía el tablero respecto a la base antigua).
  const legOffsetX = topWidth / 2 - cfg.leg.inset - legWidth / 2;
  const legPositionsX = [topX - legOffsetX, topX + legOffsetX];

  const legs = legPositionsX.map((x) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(...cfg.leg.size), legMaterial);
    leg.position.set(x, legHeight / 2, topZ);
    leg.castShadow = true;
    leg.receiveShadow = true;
    group.add(leg);
    return leg;
  });

  const top = new THREE.Mesh(new THREE.BoxGeometry(...cfg.top.size), topMaterial);
  top.position.set(topX, legHeight + topHeight / 2, topZ);
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);

  return { legs, top };
}

// ---- ESPEJO ----
// Reflector real de Three.js (three/addons/objects/Reflector.js).
//
// HISTORIAL — hubo una versión anterior de este archivo que sustituyó el
// Reflector por un material sólido (color/metalness/roughness/emissive
// fijos) porque el Reflector "parecía" renderizar como un panel negro
// opaco. Diagnosticado a fondo: el Reflector en sí NUNCA fue la causa —
// el negro era el MARCO (frame, más abajo) ocultando el plano entero por
// un error de profundidad, más una segunda causa de z-fighting entre el
// plano y la pared del fondo tras un cambio de posición posterior. Con
// ambas causas corregidas (ver comentarios "BUG REAL" más abajo, sin
// tocar), el Reflector real vuelve a ser seguro de usar — reintroducido
// para que el espejo refleje la escena de verdad, no un color fijo.
// Espejo colgado en una pared: soporta cualquier pared recta gracias a
// `cfg.rotationY` (mismo campo/criterio que wall.side.rotationY): 0 =
// pared del fondo (cara visible hacia +Z, comportamiento original),
// Math.PI/2 = pared lateral izquierda (cara visible hacia +X). Con
// rotationY = 0 el comportamiento es idéntico al de antes (ver bug de
// profundidad más abajo); con cualquier otro ángulo, el marco y el
// cristal simplemente giran juntos alrededor de Y, y el "hueco hacia
// atrás" del marco se calcula a lo largo de la normal ya rotada en vez
// de asumir siempre el eje Z.
function addMirror(group, cfg) {
  const rotationY = cfg.rotationY ?? 0;
  const frameOuterWidth = cfg.width + cfg.frame.margin * 2;
  const frameOuterHeight = cfg.height + cfg.frame.margin * 2;

  // BUG REAL ENCONTRADO Y CORREGIDO — esto era el "elemento negro
  // extraño" (independientemente del Reflector que ya se sustituyó):
  // el marco se centraba en z = cfg.position[1] - 0.01, pero al ser una
  // caja con profundidad (frame.depth = 0.03), su cara FRONTAL quedaba
  // en z_centro + depth/2 = cfg.position[1] - 0.01 + 0.015 =
  // cfg.position[1] + 0.005 — es decir, MÁS CERCA de la cámara que el
  // propio plano del espejo (en z = cfg.position[1]). El marco tapaba
  // el espejo entero, no solo el borde. Verificado quitando el marco:
  // el rectángulo negro desaparecía igualmente. Corregido calculando el
  // centro del marco a partir de su profundidad real, para que su cara
  // frontal quede siempre por detrás del plano del espejo — ahora
  // generalizado a lo largo de la normal de la pared (sin(rotationY),
  // 0, cos(rotationY)), no siempre el eje Z.
  const frameGap = 0.005;
  const frameOffset = cfg.frame.depth / 2 + frameGap;
  const frameCenterX = cfg.position[0] - Math.sin(rotationY) * frameOffset;
  const frameCenterZ = cfg.position[1] - Math.cos(rotationY) * frameOffset;

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(frameOuterWidth, frameOuterHeight, cfg.frame.depth),
    new THREE.MeshStandardMaterial({ color: cfg.frame.color, roughness: 0.6 })
  );
  frame.rotation.y = rotationY;
  frame.position.set(frameCenterX, cfg.centerY, frameCenterZ);
  frame.castShadow = true;
  group.add(frame);

  // Reflector real: genera su propio render target y cámara virtual
  // (automático, vía onBeforeRender — no requiere tocar scene.js) que
  // refleja la escena de verdad respetando la posición/orientación de
  // este plano. clipBias evita artefactos de auto-intersección en el
  // borde del plano (valor estándar recomendado por Three.js).
  const mirror = new Reflector(new THREE.PlaneGeometry(cfg.width, cfg.height), {
    clipBias: 0.003,
    color: cfg.color,
    textureWidth: window.innerWidth * Math.min(window.devicePixelRatio, 2),
    textureHeight: window.innerHeight * Math.min(window.devicePixelRatio, 2),
  });
  mirror.rotation.y = rotationY;
  mirror.position.set(cfg.position[0], cfg.centerY, cfg.position[1]);
  group.add(mirror);
}

// ---- PUERTA ----
function addDoor(group, cfg) {
  // La puerta vive en la pared del FONDO (misma pared que la mesa): su
  // cara visible mira hacia +Z, así que es una caja fina en Z, ancha en
  // X (antes era al revés, pensada para la pared lateral — ver nota
  // "REVISADO" en room.config.js).
  const thickness = 0.05;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.width, cfg.height, thickness),
    new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.7 })
  );
  door.position.set(cfg.position[0], cfg.height / 2, cfg.position[1]);
  door.castShadow = true;
  door.receiveShadow = true;
  group.add(door);

  // Marco: un segundo bloque blanco, más ancho que la hoja (cfg.frame.
  // margin por lado) y recedido hacia la pared respecto a su cara
  // frontal (cfg.frame.reveal), para que la hoja quede ligeramente por
  // delante — el relieve resultante se lee por sombra/geometría, no por
  // diferencia de color (mismo blanco, apenas un tono distinto).
  // Igual que la base de la mesa, se apoya en el suelo (y=0), no en el
  // centro de la hoja, así que su altura es height + margin (solo
  // arriba y a los lados, sin zócalo/umbral elevado en la base).
  //
  // El desnivel (reveal) se mide desde la CARA FRONTAL de la hoja, no
  // desde su centro — con el mismo criterio que ya costó un bug real en
  // el espejo (ver notas de esa sección): medir desde el centro de una
  // caja con grosor puede empujar la pieza "de detrás" más allá de la
  // cara trasera de la pared, escondiéndola. Aquí, doorFrontZ ya tiene
  // en cuenta el grosor de la hoja, así que el marco se queda siempre
  // dentro del grosor real de la pared.
  const doorFrontZ = cfg.position[1] + thickness / 2;
  const frameWidth = cfg.width + cfg.frame.margin * 2;
  const frameHeight = cfg.height + cfg.frame.margin;
  const frameCenterZ = doorFrontZ - cfg.frame.reveal - cfg.frame.depth / 2;

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(frameWidth, frameHeight, cfg.frame.depth),
    new THREE.MeshStandardMaterial({ color: cfg.frame.color, roughness: 0.75 })
  );
  frame.position.set(cfg.position[0], frameHeight / 2, frameCenterZ);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(cfg.knob.radius, 12, 10),
    new THREE.MeshStandardMaterial({
      color: cfg.knob.color,
      roughness: 0.35,
      metalness: 0.6,
    })
  );
  // Junto al borde de la puerta más cercano a la mesa. edgeSign indica
  // hacia qué lado está la mesa respecto a la puerta: -1 = mesa en X
  // más negativo (borde izquierdo del pomo — comportamiento original,
  // con la mesa a la izquierda de la puerta), +1 = mesa en X más
  // positivo (borde derecho — composición invertida horizontalmente,
  // con la mesa ahora a la derecha de la puerta). Así el pomo sigue
  // "mirando hacia la mesa" sin necesidad de tocar nada más que este
  // signo cuando se invierte la composición.
  const edgeSign = cfg.knob.edgeSign ?? -1;
  knob.position.set(
    cfg.position[0] + edgeSign * (cfg.width / 2 - cfg.knob.insetFromEdge),
    cfg.knob.height,
    cfg.position[1] + thickness / 2 + cfg.knob.radius * 0.6
  );
  group.add(knob);
}
