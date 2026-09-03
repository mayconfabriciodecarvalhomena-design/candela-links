import * as THREE from "three";
import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// MATCH VISUAL — reescrito desde cero (ver PROJECT_STATE.md: la versión
// anterior tenía un palo de aspecto plano, una cabeza de esferas
// superpuestas poco convincente, y una llama (planos cruzados con
// silueta RECORTADA que nunca giraban a cámara) que se veía geométrica.
//
// Cambios: palo con curva orgánica + veta de madera; cabeza como UN
// sólido de revolución; llama como THREE.Sprite real (billboard nativo,
// siempre mira a cámara) con textura pintada por círculos suaves
// superpuestos, sin ningún trazo/clip recortado — cero bordes duros.
// Caja/secuencia/arrastre/chispas/humo: mismo comportamiento que ya
// funcionaba, solo con menos código.
//
// Investigado antes de escribir esto: la técnica estándar para una
// llama pequeña en Three.js es un billboard con textura de borde suave
// (no shaders volumétricos). Se descartaron librerías externas de fuego
// (p.ej. mattatz/THREE.Fire): sin build ESM estable para import maps sin
// bundler, y pensadas para fuego grande — dependencia innecesaria aquí.
//
// API pública igual que antes (la usa matchesController.js, sin tocar).
// -----------------------------------------------------------------------

const STATE = { RESTING: "resting", SEQUENCE: "sequence", FREE: "free" };
const UP = new THREE.Vector3(0, 1, 0);

export function createMatchVisual(scene, options = {}) {
  const cfg = { ...CONFIG.matches.visual, ...options };
  const animCfg = CONFIG.matches.animation;
  const seqCfg = CONFIG.matches.strikeSequence;
  const boxCfg = CONFIG.matches.box;
  const flameCfg = CONFIG.matches.matchFlame;
  const sparksCfg = CONFIG.matches.sparks;
  const smokeCfg = CONFIG.matches.smoke;

  const box = buildMatchbox(boxCfg);
  scene.add(box.group);
  const boxRestPos = box.group.position.clone();
  const boxRestRotY = box.group.rotation.y;
  const boxLiftedPos = boxRestPos.clone().add(new THREE.Vector3(...boxCfg.liftOffset));
  const boxLiftedRotY = boxRestRotY + boxCfg.liftRotationY;

  const stick = buildMatchStick(cfg);
  const assembly = stick.group; // crece en +Y local; base = pivote
  assembly.rotation.z = -Math.PI / 2;
  assembly.rotation.x = cfg.restTiltX;

  const root = new THREE.Group();
  root.position.set(...cfg.position);
  root.rotation.y = cfg.restRotationY;
  root.add(assembly);
  root.position.y += cfg.headRadius;
  scene.add(root);

  const restPose = { position: root.position.clone(), rotationY: root.rotation.y };
  const heldPose = {
    position: new THREE.Vector3(...cfg.heldPosition),
    rotationY: cfg.heldRotationY,
    tiltX: cfg.heldTiltX,
  };

  // Punto más alto de la cabeza (la punta afilada del perfil de
  // revolución, radio 0 ahí): sigue usándose para la luz, que sí debe
  // vivir arriba del todo.
  const headTopY = cfg.shaftLength - cfg.headOverlap + cfg.headHeight;

  // ---------------------------------------------------------------------
  // INVESTIGACIÓN DE ESTA PASADA (antes de tocar nada — resumen; números
  // exactos verificados aparte reconstruyendo a mano la composición de
  // transformaciones de three.js, sin depender de render):
  //
  // 1) `assembly` (=stick.group) es HIJO de `root`. `assembly.rotation`
  //    = Euler(tiltX, 0, -PI/2, orden 'XYZ' — el de three.js por
  //    defecto). El eje +Y local de `assembly` (el eje de revolución de
  //    la cabeza, y también el eje sobre el que se mide headTopY /
  //    este anclaje) se transforma así:
  //        v = RotXYZ(tiltX, 0, -PI/2) · (0,1,0) = (cos(tiltX), 0, sin(tiltX))
  //    La componente Y da EXACTAMENTE CERO, para cualquier tiltX. O sea:
  //    este eje NO tiene ninguna componente vertical — es un eje que
  //    vive en el plano horizontal (X-Z) de `root`, con tiltX
  //    controlando cuánto se inclina hacia PROFUNDIDAD (Z), no hacia
  //    arriba (Y). Confirmado numéricamente para los dos valores reales
  //    de tiltX del proyecto: reposo (0.06) da Z≈+0.013; sujeta en mano
  //    (heldTiltX=-0.3, signo opuesto y ~5x mayor) da Z≈-0.063.
  //
  // 2) Consecuencia importante: headTopY y este anclaje (antes
  //    headBulgeY) están medidos sobre ESE MISMO eje, así que cabeza y
  //    llama son SIEMPRE colineales entre sí — no hay (ni había) un bug
  //    que las desalinee una de otra. Verificado: para cualquier tiltX,
  //    el vector entre el punto "headTopY" y este punto de anclaje es
  //    paralelo al eje de la cerilla, en cualquier pose.
  //
  // 3) Entonces, ¿por qué "antes derecha, ahora izquierda"? La captura
  //    anterior corresponde a la cerilla en reposo/secuencia (tiltX=
  //    +0.06, cerca del suelo); la captura actual es la pose SUJETA EN
  //    MANO (heldTiltX=-0.3 — signo invertido y mucho mayor). Con la
  //    componente Z invertida entre ambas poses, el mismo desplazamiento
  //    a lo largo del eje de la cerilla se proyecta en un punto de
  //    pantalla bastante distinto — eso es lo que se percibe como
  //    "saltó de derecha a izquierda", no un fallo de posicionamiento
  //    relativo llama/cabeza.
  //
  // 4) Lo que SÍ sería una corrección real de fondo es que tiltX/
  //    heldTiltX (pensados, a juzgar por su nombre, para inclinar la
  //    cerilla verticalmente) en realidad —por el orden de composición
  //    de rotaciones (X se aplica ANTES del giro de -90° en Z que
  //    tumba el palo)— inclinan en profundidad, no en altura. Corregir
  //    eso implicaría cambiar cómo se inclina TODO el palo (reposo,
  //    raspado, temblor de fallo, agotada, sujeta en mano) — no es un
  //    cambio aislado de la llama, así que NO se toca aquí (fuera de
  //    alcance de esta tarea; lo señalo para que quede constancia).
  //
  // FIX aplicado (dentro de alcance, solo llama/anclaje): ya que la
  // llama SIEMPRE nace en algún punto de ESE eje (es el eje de
  // revolución real de la cabeza, no hay forma de que sea otro), lo que
  // sí se puede corregir con rigor es CUÁL punto de ese eje se usa. El
  // punto anterior (headBulgeHeightFrac=0.55) era el radio máximo del
  // perfil "a ojo" — ahora se usa el CENTROIDE VOLUMÉTRICO real del
  // sólido de revolución (integral de área con el mismo perfil de
  // buildMatchStick, más abajo), que da 0.4946 de headHeight — más
  // profundo que el ecuador, y ya no una fracción elegida sino
  // calculada. Al estar más centrado en la masa del bulbo (en vez de en
  // su punto más ancho, que cae más cerca de la mitad superior), el
  // punto de anclaje es más estable frente a cambios de pose/tiltX que
  // el usado antes. Ver headFlameAnchorFrac en matches.config.js.
  // ---------------------------------------------------------------------
  const headAnchorY =
    cfg.shaftLength - cfg.headOverlap + cfg.headHeight * cfg.headFlameAnchorFrac;

  let headGrowth = 0;
  const litColor = new THREE.Color(cfg.headColorLit);
  const unlitColor = new THREE.Color(cfg.headColor);
  const mixedColor = new THREE.Color();
  const headMaterial = stick.headMaterial;

  const headLight = new THREE.PointLight(cfg.litLight.color, 0, cfg.litLight.distance);
  headLight.position.set(0, headTopY, 0);
  assembly.add(headLight);

  const flame = buildFlame(flameCfg);
  // Anclaje (REVISADO esta iteración — ver el bloque de investigación
  // junto a headAnchorY más arriba): headAnchorY ya es el centroide real
  // del volumen de la cabeza, así que headSink aquí es solo un pequeño
  // ajuste fino adicional hacia el cuerpo (mucho menor que antes, porque
  // el centroide ya hace la mayor parte del trabajo de "hundir" la base
  // en la cabeza). `flame.group` envuelve las capas de sprites + la luz
  // (un único punto de anclaje para todo lo que crece).
  flame.group.position.set(0, headAnchorY - flameCfg.headSink, 0);
  assembly.add(flame.group);

  let flameGrowth = 0; // 0 apagada, 1 estable — sin límite de tiempo
  let extinguishing = false;

  const sparks = buildEmbers(sparksCfg, THREE.AdditiveBlending);
  scene.add(sparks.points);
  let sparkTimer = 0;

  const smoke = buildEmbers(smokeCfg, THREE.NormalBlending);
  scene.add(smoke.points);
  let smokeTimer = 0;

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();

  let state = STATE.RESTING;
  let shakeElapsed = 0;
  let shakeActive = false;
  let depletedElapsed = 0;
  let depletedActive = false;
  let depletedFrom = 0;
  let seq = null;

  // ---- Secuencia de encendido: caja+cerilla suben juntas, varias
  // pasadas de raspado con pausas, encendido progresivo, estabilización,
  // y la caja vuelve sola mientras la cerilla pasa a la mano. ----
  function startStrikeSequence(callbacks = {}) {
    if (state !== STATE.RESTING) return;
    state = STATE.SEQUENCE;
    seq = {
      phase: "lift",
      t: 0,
      matchFrom: { position: root.position.clone(), rotationY: root.rotation.y },
      boxFrom: { position: box.group.position.clone(), rotationY: box.group.rotation.y },
      strokeIndex: 0,
      strokeDuration: seqCfg.scrapeStrokeDuration,
      strokeDistance: seqCfg.scrapeDistance,
      sparkTimer: 0,
      callbacks,
    };
  }

  function strikePoseFor(boxPos, boxRotY) {
    _v1.copy(box.strikingSurfaceCenter).applyAxisAngle(UP, boxRotY).add(boxPos);
    return { position: _v1.clone(), rotationY: boxRotY + Math.PI / 2 };
  }

  function updateSequence(delta) {
    seq.t += delta;

    if (seq.phase === "lift") {
      const t = Math.min(seq.t / seqCfg.liftDuration, 1);
      const e = t * t * (3 - 2 * t);
      box.group.position.lerpVectors(seq.boxFrom.position, boxLiftedPos, e);
      box.group.rotation.y = THREE.MathUtils.lerp(seq.boxFrom.rotationY, boxLiftedRotY, e);
      const target = strikePoseFor(boxLiftedPos, boxLiftedRotY);
      root.position.lerpVectors(seq.matchFrom.position, target.position, e);
      root.rotation.y = THREE.MathUtils.lerp(seq.matchFrom.rotationY, target.rotationY, e);
      if (t >= 1) {
        seq.phase = "scrape-stroke";
        seq.t = 0;
        prepareStroke(seq);
      }
      return;
    }

    // Temblor mínimo compartido caja+cerilla mientras se usan.
    box.group.position.copy(boxLiftedPos);
    box.group.position.y += Math.sin(seq.t * 40) * 0.0025;
    box.group.rotation.y = boxLiftedRotY;

    if (seq.phase === "scrape-stroke") {
      const t = Math.min(seq.t / seq.strokeDuration, 1);
      const wave = Math.sin(t * Math.PI);
      root.position.copy(strikePoseFor(boxLiftedPos, boxLiftedRotY).position);
      root.position.x -= wave * seq.strokeDistance;
      root.rotation.y = boxLiftedRotY + Math.PI / 2;
      assembly.rotation.z = -Math.PI / 2 + Math.sin(seq.t * 55) * seqCfg.scrapeJitter;

      seq.sparkTimer += delta;
      if (wave > 0.15 && seq.sparkTimer >= seqCfg.sparkEmitInterval) {
        seq.sparkTimer = 0;
        _v2.set(t > 0.5 ? 1 : -1, 0.35, 0);
        sparks.emit(root.position, _v2, sparksCfg.countPerEmit);
        seq.callbacks.onSparks?.();
      }
      if (t >= 1) {
        seq.strokeIndex += 1;
        assembly.rotation.z = -Math.PI / 2;
        seq.phase = seq.strokeIndex >= seqCfg.scrapeStrokes ? "ignite-delay" : "scrape-pause";
        seq.t = 0;
      }
      return;
    }

    if (seq.phase === "scrape-pause") {
      assembly.rotation.z = -Math.PI / 2 + Math.sin(seq.t * 18) * (seqCfg.scrapeJitter * 0.3);
      if (seq.t >= seqCfg.scrapePauseDuration) {
        seq.phase = "scrape-stroke";
        seq.t = 0;
        prepareStroke(seq);
      }
      return;
    }

    if (seq.phase === "ignite-delay") {
      if (seq.t >= seqCfg.igniteDelay) {
        seq.phase = "flame-grow";
        seq.t = 0;
      }
      return;
    }

    if (seq.phase === "flame-grow") {
      const t = Math.min(seq.t / seqCfg.flameGrowDuration, 1);
      headGrowth = flameGrowth = t;
      if (t >= 1) {
        seq.phase = "flame-stabilize";
        seq.t = 0;
        seq.callbacks.onFlameVisible?.();
      }
      return;
    }

    if (seq.phase === "flame-stabilize") {
      if (seq.t >= seqCfg.flameStabilizeDuration) {
        seq.phase = "release";
        seq.t = 0;
        seq.matchFrom = { position: root.position.clone(), rotationY: root.rotation.y };
        seq.boxFrom = { position: box.group.position.clone(), rotationY: box.group.rotation.y };
      }
      return;
    }

    if (seq.phase === "release") {
      const t = Math.min(seq.t / seqCfg.releaseDuration, 1);
      const e = t * t * (3 - 2 * t);
      box.group.position.lerpVectors(seq.boxFrom.position, boxRestPos, e);
      box.group.rotation.y = THREE.MathUtils.lerp(seq.boxFrom.rotationY, boxRestRotY, e);
      root.position.lerpVectors(seq.matchFrom.position, heldPose.position, e);
      root.rotation.y = THREE.MathUtils.lerp(seq.matchFrom.rotationY, heldPose.rotationY, e);
      assembly.rotation.x = THREE.MathUtils.lerp(cfg.restTiltX, heldPose.tiltX, e);
      if (t >= 1) {
        state = STATE.FREE;
        seq.callbacks.onIgnited?.();
        seq = null;
      }
    }
  }

  function prepareStroke(s) {
    const v = seqCfg.scrapeStrokeVariation;
    s.strokeDuration = seqCfg.scrapeStrokeDuration * (1 + (Math.random() * 2 - 1) * v);
    s.strokeDistance = seqCfg.scrapeDistance * (1 + (Math.random() * 2 - 1) * v * 0.6);
  }

  let autoIgnition = null;

  function startAutoIgnition(callbacks = {}) {
    if (state !== STATE.FREE || autoIgnition) return false;
    const interactionCfg = CONFIG.matches.interaction;
    const flamePos = getFlameWorldPosition(new THREE.Vector3());
    // Offset visual respecto a `candleWickPosition` para que la punta
    // de la cerilla parezca estar en contacto con la mecha cuando la
    // raíz de la cerilla llega a su destino.  Sin esto, la distancia
    // entre la raíz y la punta de la cerilla crea una separación
    // visible entre la llama de la cerilla y la mecha de la vela.
    const wickPos = new THREE.Vector3(...interactionCfg.candleWickPosition).add(
      new THREE.Vector3(...(interactionCfg.approachOffset || [0, 0, 0])),
    );
    const delta = wickPos.sub(flamePos);
    autoIgnition = {
      startPos: root.position.clone(),
      targetPos: root.position.clone().add(delta),
      elapsed: 0,
      duration: interactionCfg.autoIgnitionDuration,
      onComplete: callbacks.onComplete,
    };
    return true;
  }

  const isAutoIgniting = () => autoIgnition !== null;

  // Posición de la parte ENCENDIDA (no del palo): la que detecta el
  // contacto con la mecha.
  function getFlameWorldPosition(target = new THREE.Vector3()) {
    return flame.group.getWorldPosition(target);
  }

  function playFailShake() {
    if (state !== STATE.RESTING) return;
    shakeActive = true;
    shakeElapsed = 0;
  }
  function playDepleted() {
    depletedActive = true;
    depletedElapsed = 0;
    depletedFrom = assembly.rotation.x;
  }
  // Único apagado visual: cuando matches.js emite "extinguish" (uso
  // sobre la vela o manual). Si la cerilla no está en su posición de
  // reposo, además inicia una animación de regreso suave.
  let returnToRest = null;

  function extinguish() {
    autoIgnition = null;
    state = STATE.RESTING;
    extinguishing = true;

    const atRest =
      root.position.distanceTo(restPose.position) < 0.001 &&
      Math.abs(root.rotation.y - restPose.rotationY) < 0.001;
    if (!atRest) {
      returnToRest = {
        startPos: root.position.clone(),
        targetPos: restPose.position.clone(),
        startRotY: root.rotation.y,
        targetRotY: restPose.rotationY,
        startTiltX: assembly.rotation.x,
        targetTiltX: cfg.restTiltX,
        elapsed: 0,
        duration: animCfg.returnDuration,
      };
    }
  }

  function update(delta) {
    if (seq) updateSequence(delta);

    if (autoIgnition) {
      autoIgnition.elapsed += delta;
      const t = Math.min(autoIgnition.elapsed / autoIgnition.duration, 1);
      const e = t * t * (3 - 2 * t);
      root.position.lerpVectors(autoIgnition.startPos, autoIgnition.targetPos, e);
      if (t >= 1) {
        const cb = autoIgnition.onComplete;
        autoIgnition = null;
        cb?.();
      }
    }

    if (returnToRest) {
      returnToRest.elapsed += delta;
      const t = Math.min(returnToRest.elapsed / returnToRest.duration, 1);
      const e = t * t * (3 - 2 * t);
      root.position.lerpVectors(returnToRest.startPos, returnToRest.targetPos, e);
      root.rotation.y = THREE.MathUtils.lerp(returnToRest.startRotY, returnToRest.targetRotY, e);
      assembly.rotation.x = THREE.MathUtils.lerp(returnToRest.startTiltX, returnToRest.targetTiltX, e);
      if (t >= 1) returnToRest = null;
    }

    if (extinguishing) {
      const step = delta / animCfg.extinguishDuration;
      headGrowth = Math.max(0, headGrowth - step);
      flameGrowth = Math.max(0, flameGrowth - step);
      if (headGrowth <= 0 && flameGrowth <= 0) extinguishing = false;
    }

    headMaterial.color.copy(mixedColor.copy(unlitColor).lerp(litColor, headGrowth));
    headLight.intensity = cfg.litLight.intensity * headGrowth;
    flame.update(delta, flameGrowth);
    sparks.update(delta);
    smoke.update(delta);

    // Emisión ambiental de chispas/humo mientras la llama está estable.
    if (flameGrowth > 0.65) {
      flame.group.getWorldPosition(_v3);
      if (sparksCfg.enabled) {
        sparkTimer -= delta;
        if (sparkTimer <= 0) {
          sparkTimer = THREE.MathUtils.lerp(sparksCfg.ambientEmitInterval.min, sparksCfg.ambientEmitInterval.max, Math.random());
          sparks.emit(_v3, UP, 1);
        }
      }
      if (smokeCfg.enabled) {
        smokeTimer -= delta;
        if (smokeTimer <= 0) {
          smokeTimer = THREE.MathUtils.lerp(smokeCfg.spawnInterval.min, smokeCfg.spawnInterval.max, Math.random());
          smoke.emit(_v3, 1);
        }
      }
    }

    if (shakeActive) {
      shakeElapsed += delta;
      const s = animCfg.failShake;
      const t = shakeElapsed / s.duration;
      if (t >= 1) {
        shakeActive = false;
        assembly.rotation.z = -Math.PI / 2;
      } else {
        assembly.rotation.z = -Math.PI / 2 + Math.sin(shakeElapsed * s.frequency) * s.strength * (1 - t);
      }
    }
    if (depletedActive) {
      depletedElapsed += delta;
      const t = Math.min(depletedElapsed / animCfg.depletedDuration, 1);
      assembly.rotation.x = THREE.MathUtils.lerp(depletedFrom, cfg.restTiltX + animCfg.depletedTiltX, 1 - Math.pow(1 - t, 3));
      if (t >= 1) depletedActive = false;
    }
  }

  function resetPose() {
    seq = null;
    autoIgnition = null;
    returnToRest = null;
    extinguishing = false;
    state = STATE.RESTING;
    root.position.copy(restPose.position);
    root.rotation.y = restPose.rotationY;
    assembly.rotation.set(cfg.restTiltX, 0, -Math.PI / 2);
    box.group.position.copy(boxRestPos);
    box.group.rotation.y = boxRestRotY;
    headGrowth = flameGrowth = 0;
    headMaterial.color.copy(unlitColor);
    headLight.intensity = 0;
    shakeActive = depletedActive = false;
  }

  function dispose() {
    scene.remove(root, box.group, sparks.points, smoke.points);
    stick.dispose();
    box.dispose();
    sparks.dispose();
    smoke.dispose();
    flame.dispose();
  }

  return {
    object: root,
    boxObject: box.group,
    resetPose,
    dispose,
    update,
    startStrikeSequence,
    startAutoIgnition,
    isAutoIgniting,
    getFlameWorldPosition,
    extinguish,
    playFailShake,
    playDepleted,
    isSequenceActive: () => state === STATE.SEQUENCE,
    isFree: () => state === STATE.FREE,
    isLit: () => flameGrowth > 0.001,
  };
}

// -----------------------------------------------------------------------
// Palo (cilindro cónico con curva orgánica + veta de madera) y cabeza
// (LatheGeometry: un sólido de revolución bulboso). Crecen en +Y local.
// -----------------------------------------------------------------------
function buildMatchStick(cfg) {
  const group = new THREE.Group();

  const shaftGeo = new THREE.CylinderGeometry(cfg.shaftRadiusTop, cfg.shaftRadiusBottom, cfg.shaftLength, 8, 6);
  shaftGeo.translate(0, cfg.shaftLength / 2, 0);
  const pos = shaftGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / cfg.shaftLength;
    pos.setX(i, pos.getX(i) + Math.sin(t * Math.PI * 0.5) * cfg.shaftBend);
  }
  pos.needsUpdate = true;
  shaftGeo.computeVertexNormals();

  const woodTexture = buildWoodTexture(cfg.woodColor, cfg.woodColorDark);
  const woodMaterial = new THREE.MeshStandardMaterial({ map: woodTexture, roughness: 0.82 });
  const shaft = new THREE.Mesh(shaftGeo, woodMaterial);
  shaft.castShadow = shaft.receiveShadow = true;
  group.add(shaft);

  // Cabeza: base estrecha -> se ensancha -> punta redondeada, hundida
  // ligeramente en el palo (headOverlap) para no dejar hueco visible.
  const r = cfg.headRadius;
  const h = cfg.headHeight;
  const profile = [
    [cfg.shaftRadiusTop * 0.9, 0], [r * 0.55, h * 0.08], [r * 0.95, h * 0.32],
    [r, h * 0.55], [r * 0.82, h * 0.8], [r * 0.3, h * 0.97], [0, h],
  ].map(([radius, y]) => new THREE.Vector2(radius, y));

  const headGeo = new THREE.LatheGeometry(profile, 14);
  headGeo.translate(0, cfg.shaftLength - cfg.headOverlap, 0);
  const headMaterial = new THREE.MeshStandardMaterial({ color: cfg.headColor, roughness: 0.7, metalness: 0.05 });
  const head = new THREE.Mesh(headGeo, headMaterial);
  head.castShadow = true;
  group.add(head);

  function dispose() {
    shaftGeo.dispose();
    woodMaterial.dispose();
    woodTexture.dispose();
    headGeo.dispose();
    headMaterial.dispose();
  }

  return { group, headMaterial, dispose };
}

// Veta de madera: unas pocas líneas onduladas más oscuras, envueltas
// alrededor del cilindro. Sin imágenes externas.
function buildWoodTexture(base, dark) {
  const w = 32, h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = rgba(base, 1);
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * w;
    ctx.strokeStyle = rgba(dark, 0.25 + Math.random() * 0.2);
    ctx.lineWidth = 0.5 + Math.random() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (Math.random() * 4 - 2), h * 0.33, x + (Math.random() * 4 - 2), h * 0.66, x + (Math.random() * 4 - 2), h);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  return texture;
}

// -----------------------------------------------------------------------
// Llama: THREE.Sprite (billboard nativo, siempre mira a cámara) con una
// textura pintada superponiendo círculos suaves (globalCompositeOperation
// "lighter"). Sin ningún trazo/clip recortado -> sin bordes duros.
// -----------------------------------------------------------------------
function buildFlame(cfg) {
  // Dos capas superpuestas (texturas con semilla de ruido distinta),
  // cada una con su propio desfase temporal — misma idea que la vela al
  // superponer varios planos con patrones distintos para dar sensación
  // de volumen, en vez de leerse como "una imagen plana". Se usan
  // SPRITES (no planos 3D): un sprite SIEMPRE mira a cámara, lo que es
  // imprescindible aquí — la cerilla gira hasta ~110° durante el
  // raspado, y justo entonces es cuando la llama empieza a encenderse;
  // un plano rígido se vería de canto en ese momento. Ver
  // PROJECT_STATE.md para el razonamiento completo.
  const LAYER_COUNT = 2;
  const group = new THREE.Group();
  const layers = [];

  for (let i = 0; i < LAYER_COUNT; i++) {
    const texture = buildFlameTexture(cfg, i * 7.3 + 2.1);
    const material = new THREE.SpriteMaterial({
      map: texture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);
    // sprite.center en la base de la textura (no el centro, el valor
    // por defecto): ver PROJECT_STATE.md — es lo que corrigió la llama
    // "flotando" separada de la cabeza. Además, al pivotar la rotación
    // de balanceo sobre la base, la punta se mueve y la base se queda
    // fija — "base estable, la parte superior con más movimiento".
    sprite.center.set(0.5, 0.04);
    sprite.scale.set(0, 0, 1);
    group.add(sprite);
    layers.push({
      sprite, material, texture,
      time: i * 2.9, // desfase inicial: las capas no arrancan sincronizadas
      sway: 0, wJ: 1, hJ: 1, driftTimer: 0,
      target: { sway: 0, width: 1, height: 1 },
    });
  }

  const light = new THREE.PointLight(cfg.light.color, 0, cfg.light.distance);
  group.add(light);

  // Tres senos de frecuencias no relacionadas + saltos aleatorios
  // suavizados: parpadeo/deriva que no se lee como bucle sinusoidal.
  const wave = (t, f) => Math.sin(t * f) * 0.5 + Math.sin(t * f * 2.3 + 1.7) * 0.3 + Math.sin(t * f * 4.6 + 3.1) * 0.2;

  function update(delta, growth) {
    let flickerSum = 0;

    for (const layer of layers) {
      layer.time += delta;
      layer.driftTimer -= delta;
      if (layer.driftTimer <= 0) {
        layer.driftTimer = cfg.animation.driftSpeed * (0.6 + Math.random() * 0.8);
        layer.target.sway = (Math.random() * 2 - 1) * cfg.animation.sway;
        layer.target.width = 1 + (Math.random() * 2 - 1) * cfg.animation.driftAmount;
        layer.target.height = 1 + (Math.random() * 2 - 1) * cfg.animation.driftAmount;
      }
      const a = Math.min(delta * 3, 1);
      layer.sway += (layer.target.sway - layer.sway) * a;
      layer.wJ += (layer.target.width - layer.wJ) * a;
      layer.hJ += (layer.target.height - layer.hJ) * a;

      const flicker = 1 + wave(layer.time, cfg.animation.flickerSpeed) * cfg.animation.flickerAmount;
      flickerSum += flicker;

      layer.sprite.scale.set(cfg.width * layer.wJ * growth, cfg.height * layer.hJ * growth, 1);
      layer.material.rotation = layer.sway;
      // Se divide entre el nº de capas para que, sumadas por el
      // blending aditivo, no sobreexpongan respecto a una sola capa.
      layer.material.opacity = (growth / LAYER_COUNT) * Math.min(1, 0.82 + flicker * 0.18);
    }

    light.intensity = cfg.light.maxIntensity * growth * (flickerSum / LAYER_COUNT);
  }

  function dispose() {
    layers.forEach((layer) => {
      layer.texture.dispose();
      layer.material.dispose();
    });
  }

  return { group, light, update, dispose };
}

// -----------------------------------------------------------------------
// Textura de la llama — modelo de "campo de calor" trasladado del
// lenguaje visual de flameShader.js (llama de la vela), NO copiado:
// reescrito en JS/canvas porque un Sprite (necesario para el anclaje
// robusto durante los giros de la cerilla) no admite un ShaderMaterial
// con el pipeline de billboard nativo, así que el cálculo se hornea una
// vez por capa en vez de evaluarse por fotograma en GLSL.
//
// Principios trasladados (ver PROJECT_STATE.md para la comparación
// completa):
//   - FORMA: `riseFactor * fallFactor`, cada uno un smoothstep — la
//     pendiente es CERO exactamente en el vientre por construcción, así
//     que el punto más ancho queda redondeado, nunca como el vértice de
//     un rombo (verificado numéricamente antes de integrar esto).
//   - COLOR: no hay bandas geométricas (azul/naranja/amarillo como
//     franjas limpias). Se calcula un único campo escalar de "calor"
//     por píxel (tendencia según altura+radio, más ruido fractal) y ES
//     ESE CAMPO el que decide el color — el límite entre zonas sale del
//     ruido, no de una curva perfecta.
//   - ZONA AZUL: el calor se SUPRIME dentro de la zona azul ANTES de
//     calcular el color (no se mezcla azul ENCIMA de un resultado que ya
//     podría ser amarillo) — así el azul manda de verdad ahí, y se
//     funde con naranja/amarillo en su borde de forma natural.
//   - BORDE: ruido fractal (FBM, 3 octavas rotadas), no sumas de senos.
// -----------------------------------------------------------------------
function buildFlameTexture(cfg, seed) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const colors = cfg.colors;
  const core = new THREE.Color(colors.core);
  const yellow = new THREE.Color(colors.yellow);
  const orange = new THREE.Color(colors.orange);
  const edgeColor = new THREE.Color(colors.edge);
  const blue = new THREE.Color(colors.blue);

  const lerpColor = (a, b, t) => new THREE.Color().copy(a).lerp(b, THREE.MathUtils.clamp(t, 0, 1));
  const smooth = (a, b, x) => {
    const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // ---- Ruido de valor 2D + FBM (3 octavas rotadas) ----
  function hash(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
  function noise2D(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v * (1 - u) + (d - b) * u * v;
  }
  function fbm(x, y, s) {
    let qx = x + s * 13.7, qy = y + s * 7.3, sum = 0, amp = 0.5;
    for (let i = 0; i < 3; i++) {
      sum += amp * (noise2D(qx, qy) - 0.5);
      const nqx = qx * 0.8 + qy * 0.6, nqy = -qx * 0.6 + qy * 0.8;
      qx = nqx * 2.02; qy = nqy * 2.02; amp *= 0.5;
    }
    return sum;
  }

  const shape = cfg.shape;
  // t: 0 en la base (borde inferior del canvas), 1 en la punta (borde
  // superior) — igual convención que "v" en flameShader.js.
  function widthProfile(t) {
    const riseFactor = smooth(0, shape.bulgeHeight, t);
    const widthBeforeTaper = THREE.MathUtils.lerp(shape.baseWidthRel, shape.bodyWidthRel, riseFactor);
    const fallFactor = Math.pow(THREE.MathUtils.clamp(1 - smooth(shape.bulgeHeight, 1, t), 0, 1), shape.tipSharpness);
    return widthBeforeTaper * fallFactor;
  }

  const heat = cfg.heat;
  const blueHeight = colors.blueHeight, blueRadius = colors.blueRadius;
  function heatAt(t, r) {
    const heightTrend = smooth(heat.riseStart, heat.riseEnd, t) * (1 - smooth(heat.fallStart, heat.fallEnd, t));
    const radialTrend = 1 - r;
    const trend = THREE.MathUtils.clamp(heightTrend * (0.25 + 0.75 * radialTrend), 0, 1);
    const field = fbm(r * heat.fieldScale, t * heat.fieldScale, seed);
    return THREE.MathUtils.clamp(trend + field * heat.turbulence, 0, 1);
  }
  function blueZoneAt(t, r) {
    return THREE.MathUtils.clamp((1 - smooth(0, blueHeight, t)) * (1 - smooth(0, blueRadius, r)), 0, 1);
  }

  const maxHalfWidth = (size / 2) * 0.94; // pequeño margen a los lados del canvas

  for (let py = 0; py < size; py++) {
    const t = 1 - py / (size - 1); // 0 en la base (abajo), 1 en la punta (arriba)
    const widthFactor = widthProfile(t);
    if (widthFactor <= 0) continue;

    // Borde: ruido fractal (no senos) para un contorno irregular real.
    const edgeNoiseL = fbm(t * cfg.edge.scale, 0.3, seed + 91);
    const edgeNoiseR = fbm(t * cfg.edge.scale, 1.7, seed + 91);
    const halfWidthL = maxHalfWidth * widthFactor * (1 + edgeNoiseL * cfg.edge.strength);
    const halfWidthR = maxHalfWidth * widthFactor * (1 + edgeNoiseR * cfg.edge.strength);

    const left = Math.round(size / 2 - halfWidthL);
    const right = Math.round(size / 2 + halfWidthR);

    for (let px = Math.max(0, left); px <= Math.min(size - 1, right); px++) {
      const halfWidth = px < size / 2 ? halfWidthL : halfWidthR;
      const r = halfWidth > 0 ? THREE.MathUtils.clamp(Math.abs(px - size / 2) / halfWidth, 0, 1) : 1;

      const heatValue = heatAt(t, r);
      const blueZone = blueZoneAt(t, r);
      // Se suprime el calor DENTRO de la zona azul ANTES de decidir el
      // color — así el azul manda de verdad, no se pinta encima.
      const heatForRamp = heatValue * (1 - blueZone * colors.blueHeatSuppress);

      let pixelColor = lerpColor(edgeColor, orange, smooth(0.05, 0.42, heatForRamp));
      pixelColor = lerpColor(pixelColor, yellow, smooth(0.38, 0.72, heatForRamp));
      pixelColor = lerpColor(pixelColor, core, smooth(0.74, 0.98, heatForRamp));
      pixelColor = lerpColor(pixelColor, blue, blueZone * colors.blueStrength);

      // Borde suave (meseta sólida en el centro, caída en el exterior) +
      // envolvente exterior más transparente (separa núcleo/cuerpo/
      // exterior en vez de una opacidad uniforme).
      const edgeSoftness = 1 - smooth(0.65, 1, r);
      const outerFade = r > cfg.outer.start ? THREE.MathUtils.lerp(1, cfg.outer.alpha, smooth(cfg.outer.start, 1, r)) : 1;
      const tipFade = t > 0.9 ? THREE.MathUtils.lerp(1, 0.4, smooth(0.9, 1, t)) : 1;
      const alpha = edgeSoftness * outerFade * tipFade;

      const idx = (py * size + px) * 4;
      data[idx] = Math.round(pixelColor.r * 255);
      data[idx + 1] = Math.round(pixelColor.g * 255);
      data[idx + 2] = Math.round(pixelColor.b * 255);
      data[idx + 3] = Math.round(THREE.MathUtils.clamp(alpha, 0, 1) * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

function rgba(hex, alpha) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`;
}

function buildMatchbox(cfg) {
  const group = new THREE.Group();
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;

  const bodyGeo = new THREE.BoxGeometry(cfg.size.width, cfg.size.height, cfg.size.depth);
  bodyGeo.translate(0, cfg.size.height / 2, 0);
  const bodyMat = new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.75 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  const strip = cfg.strikingSurface;
  const stripGeo = new THREE.BoxGeometry(0.002, strip.height, strip.width);
  const stripMat = new THREE.MeshStandardMaterial({ color: strip.color, roughness: 1 });
  const stripMesh = new THREE.Mesh(stripGeo, stripMat);
  const stripCenter = new THREE.Vector3(cfg.size.width / 2 + strip.inset, cfg.size.height * 0.55, 0);
  stripMesh.position.copy(stripCenter);
  stripMesh.receiveShadow = true;
  group.add(stripMesh);

  function dispose() {
    bodyGeo.dispose();
    bodyMat.dispose();
    stripGeo.dispose();
    stripMat.dispose();
  }

  return { group, strikingSurfaceCenter: stripCenter, dispose };
}

// -----------------------------------------------------------------------
// Chispas y humo: un mismo pool de partículas simple (THREE.Points +
// PointsMaterial estándar, sin shader propio). Color por partícula vía
// `vertexColors` (soporte nativo); tamaño único por sistema (se pierde
// variación de tamaño individual a cambio de mucho menos código — no es
// lo que se pidió corregir en esta pasada).
// -----------------------------------------------------------------------
function buildEmbers(cfg, blending) {
  const isSmoke = blending === THREE.NormalBlending;
  const max = isSmoke ? Math.max(cfg.count * 2, 8) : Math.max(cfg.count * 4, 48);

  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const texture = buildSoftDotTexture();
  const size = (cfg.size.min + cfg.size.max) / 2;
  const material = new THREE.PointsMaterial({
    map: texture, size, vertexColors: true, transparent: true, opacity: isSmoke ? 0.5 : 1,
    depthWrite: false, blending, sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;

  const life = new Float32Array(max);
  const vel = new Float32Array(max * 3);
  const gravity = isSmoke ? 0 : cfg.gravity ?? 0;
  let cursor = 0;

  function emit(origin, direction, count) {
    const dir = _tmpV.copy(direction).normalize();
    for (let i = 0; i < count; i++) {
      const idx = cursor % max;
      cursor++;
      let vx, vy, vz, color, lifeVal;

      if (isSmoke) {
        const phase = Math.random() * Math.PI * 2;
        vx = Math.cos(phase) * cfg.sway;
        vy = cfg.speed * (0.7 + Math.random() * 0.6);
        vz = Math.sin(phase) * cfg.sway;
        color = _tmpColor.set(cfg.color);
        lifeVal = THREE.MathUtils.lerp(cfg.life.min, cfg.life.max, Math.random());
      } else {
        const spread = (Math.random() * 2 - 1) * cfg.spread;
        const cos = Math.cos(spread), sin = Math.sin(spread);
        const speed = THREE.MathUtils.lerp(cfg.speed.min, cfg.speed.max, Math.random());
        vx = (dir.x * cos - dir.y * sin) * speed;
        vy = (dir.x * sin + dir.y * cos) * speed;
        vz = (Math.random() - 0.5) * speed * 0.3;
        color = _tmpColor.set(cfg.colors[(Math.random() * cfg.colors.length) | 0]);
        lifeVal = THREE.MathUtils.lerp(cfg.life.min, cfg.life.max, Math.random());
      }

      positions[idx * 3] = origin.x;
      positions[idx * 3 + 1] = origin.y;
      positions[idx * 3 + 2] = origin.z;
      colors[idx * 3] = color.r;
      colors[idx * 3 + 1] = color.g;
      colors[idx * 3 + 2] = color.b;
      vel[idx * 3] = vx;
      vel[idx * 3 + 1] = vy;
      vel[idx * 3 + 2] = vz;
      life[idx] = lifeVal;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  function update(delta) {
    let any = false;
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) continue;
      any = true;
      life[i] -= delta;
      if (life[i] <= 0) {
        positions[i * 3 + 1] = -1000; // aparca fuera de vista
        continue;
      }
      vel[i * 3 + 1] -= gravity * delta;
      positions[i * 3] += vel[i * 3] * delta;
      positions[i * 3 + 1] += vel[i * 3 + 1] * delta;
      positions[i * 3 + 2] += vel[i * 3 + 2] * delta;
    }
    if (any) geometry.attributes.position.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }

  return { points, emit, update, dispose };
}

const _tmpV = new THREE.Vector3();
const _tmpColor = new THREE.Color();

function buildSoftDotTexture() {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}