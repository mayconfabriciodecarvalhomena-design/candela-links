import * as THREE from "three";
import { CONFIG } from "./config.js";
import { onUpdate } from "./scene.js";
import { onWickReady } from "./candle.js";
import { EMBER_VERTEX_SHADER, EMBER_FRAGMENT_SHADER } from "./flameShader.js";
import { createEnvelopeMesh } from "./envelopeMesh.js";
import { createLetterMesh } from "./letterMesh.js";

// -----------------------------------------------------------------------
// CANDELA FINALE (primera parte + segunda parte): la transición desde
// que termina la última frase de FlameWords hasta que el mensaje final
// queda completamente visible. Ver el encargo completo para la
// intención narrativa — en resumen:
//
//   pause → flameSurge → partículas (birth → rise → converge) →
//   materialize → travel → settle → open →
//   [segunda parte] pause-after-open → letter-rise → final-hold → done
//
// La primera parte (hasta `open`) no se ha tocado en su lógica interna;
// la segunda parte (desde `pause-after-open`) es una extensión ADITIVA
// de la MISMA máquina de estados, en el mismo módulo — nunca una
// segunda máquina de estados independiente (ver el encargo de la
// segunda parte: "amplía la máquina de estados existente").
//
// Módulo ADITIVO e independiente, mismo criterio que flameWords.js:
//   - No importa nada de flameWords.js ni depende de su estado interno;
//     solo escucha su evento público "sequence-completed" (ver
//     flameWords.on(), añadido de forma aditiva).
//   - No modifica flame.js más allá de llamar a su API pública
//     (flame.setSurge(), añadida de forma aditiva y separada del
//     ignite()/extinguish() normal — ver flame.js).
//   - Reutiliza EMBER_VERTEX_SHADER/EMBER_FRAGMENT_SHADER tal cual
//     (mismo shader que usan las brasas reales de la llama y las
//     partículas de FlameWords), para que estas partículas sean,
//     técnicamente, la MISMA cosa que una brasa.
//   - Se ancla a la mecha real (onWickReady, igual que smoke.js/
//     flameWords.js), nunca a una coordenada inventada.
//
// Quien usa este módulo (main.js) solo necesita:
//   const finale = createCandelaFinale({ scene, camera, flame });
//   flameWords.on("sequence-completed", () => finale.start());
// -----------------------------------------------------------------------

const PHASE = {
  IDLE: "idle",
  PAUSE: "pause",
  FLAME_SURGE: "flame-surge",
  BIRTH: "birth",
  RISE: "rise",
  CONVERGE: "converge",
  MATERIALIZE: "materialize",
  TRAVEL: "travel",
  SETTLE: "settle",
  OPEN: "open",
  // ---- Segunda parte del final (ver comentario de cabecera) ----
  PAUSE_AFTER_OPEN: "pause-after-open",
  // ITERACIÓN — antes había una fase LETTER_UNFOLD separada, que
  // desplegaba la carta QUIETA una vez terminada la subida (ver
  // finale.config.js → cfg.letter.emerge): eso es precisamente lo que
  // se leía como "la hoja sale doblada" (llega ya con el pliegue
  // completo, luego se abre parada). Ahora LETTER_RISE anima a la vez
  // posición, escala Y pliegue con el mismo progreso — la hoja llega
  // ya plana. No queda ninguna fase LETTER_UNFOLD.
  //
  // ITERACIÓN — antes también había una fase MESSAGE_REVEAL posterior
  // y separada (con su propio delay/duración) que desvanecía el texto
  // DESPUÉS de que la hoja ya estuviera visible — "hoja vacía → espera
  // ~1s → segunda capa con el texto". Ahora `letter.setAppearance()`
  // (llamada dentro de LETTER_RISE, ver más abajo) desvanece
  // directamente la página actual (ya con su texto horneado) — la
  // hoja que sale YA tiene el contenido, no hay una segunda capa. No
  // queda ninguna fase MESSAGE_REVEAL.
  //
  // ITERACIÓN — SE ABANDONA POR COMPLETO EL DOBLADO (ver letterMesh.js:
  // cada hoja es una única malla completa, sin pivotes de pliegue ni
  // caras frontal/trasera distintas). Ya no queda ninguna fase ni
  // sub-fase relacionada con pliegue/despliegue (LETTER_UNFOLD,
  // MESSAGE_REVEAL, "emerging", "fold-pause", "unfolding" — todas
  // eliminadas en distintas iteraciones). LETTER_RISE es ahora una
  // única transición: la hoja avanza desde el sobre hasta su posición
  // final —ya completa, a su escala definitiva y con el texto ya
  // visible desde que tiene opacidad > 0— y ahí se queda quieta.
  LETTER_RISE: "letter-rise",
  FINAL_HOLD: "final-hold",
  DONE: "done",
};

export function createCandelaFinale({ scene, camera, flame }) {
  const cfg = CONFIG.finale;
  const capacity = cfg.particles.count;

  // ---- Geometría/material de partículas: mismo patrón que embers en
  // flame.js y que flameWords.js (buffer de tamaño fijo, reservado una
  // sola vez — ver sección 13 del encargo). ----
  const positions = new Float32Array(capacity * 3);
  const particleColors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("particleColor", new THREE.BufferAttribute(particleColors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: createSoftGlowTexture() },
      pixelHeight: { value: window.innerHeight },
    },
    vertexShader: EMBER_VERTEX_SHADER,
    fragmentShader: EMBER_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.visible = false;
  points.frustumCulled = false;
  scene.add(points);

  // ---- Objeto físico procedural (ver sección 8 del encargo) ----
  const envelopeMeshCfg = {
    width: cfg.envelope.width,
    height: cfg.envelope.height,
    flapHeight: cfg.envelope.flapHeight,
    depth: cfg.envelope.depth,
    color: cfg.envelope.color,
    edgeColor: cfg.envelope.edgeColor,
    roughness: cfg.envelope.roughness,
    emissiveIntensity: cfg.envelope.emissiveIntensity,
    fillLight: cfg.envelope.fillLight,
    open: cfg.open,
  };
  const envelope = createEnvelopeMesh(envelopeMeshCfg, onUpdate);
  scene.add(envelope.group);

  // ---- Carta (segunda parte del final, ver letterMesh.js): objeto
  // procedural independiente, creado una única vez aquí (nunca por
  // frame ni por fase — ver sección "REQUISITOS TÉCNICOS" del encargo
  // de la segunda parte). Su posición/escala las gobierna esta máquina
  // de estados (ver LETTER_RISE más abajo); su aparición (la página
  // actual, YA con su contenido, ver letterMesh.js — una única malla
  // completa, sin doblado) se controla a través de la API que expone
  // (setAppearance()), igual que ya se hace
  // con envelope.setAppearance()/open(). ----
  const letterMeshCfg = {
    width: cfg.letter.width,
    height: cfg.letter.height,
    color: cfg.letter.color,
    edgeColor: cfg.letter.edgeColor,
    roughness: cfg.letter.roughness,
    text: cfg.letter.text,
    // Sistema real de hojas (ver "OBJETIVO 2" del encargo de esta
    // iteración): el contenido (`pages`, un array de { title?, text })
    // y el comportamiento de pasar página (`page`, duración del giro +
    // estilo del título) viven enteros en finale.config.js — este
    // módulo nunca hardcodea cuántas hojas hay ni su contenido, solo
    // pasa la configuración tal cual a letterMesh.js.
    pages: cfg.letter.pages,
    page: cfg.letter.page,
  };
  const letter = createLetterMesh(letterMeshCfg, onUpdate);
  scene.add(letter.group);

  // ---- Anclajes reales: mismo criterio que flameWords.js (onWickReady
  // + offset propio), nunca coordenadas inventadas (ver sección 3/15
  // del encargo). ----
  const anchor = new THREE.Vector3(...CONFIG.candle.position).add(
    new THREE.Vector3(...cfg.envelope.anchorOffset)
  );
  const flameOrigin = new THREE.Vector3(...CONFIG.candle.position).add(
    new THREE.Vector3(...cfg.particles.origin.offset)
  );
  onWickReady((wickWorld) => {
    anchor.copy(wickWorld).add(new THREE.Vector3(...cfg.envelope.anchorOffset));
    flameOrigin.copy(wickWorld).add(new THREE.Vector3(...cfg.particles.origin.offset));
  });

  // ---- Paleta (idéntica a CONFIG.flame.colors a propósito, ver
  // comentario en finale.config.js) ----
  const palette = [
    new THREE.Color(cfg.particles.colors.core),
    new THREE.Color(cfg.particles.colors.yellow),
    new THREE.Color(cfg.particles.colors.orange),
    new THREE.Color(cfg.particles.colors.edge),
  ];
  function sampleFireColor() {
    const t = Math.pow(Math.random(), 1.15) * 3;
    const i = Math.min(2, Math.floor(t));
    const localT = t - i;
    return palette[i].clone().lerp(palette[i + 1], localT);
  }

  // ---- Estado por partícula ----
  const state = [];
  for (let i = 0; i < capacity; i++) {
    state.push({
      target: { x: 0, y: 0, z: 0 },
      spawnBase: { x: 0, y: 0, z: 0 },
      delay: Math.random(),
      seedA: Math.random() * Math.PI * 2,
      seedB: Math.random() * Math.PI * 2,
      curl: { x: 0, y: 0 },
      driftLateralBias: 1,
      size: cfg.particles.size.min + Math.random() * (cfg.particles.size.max - cfg.particles.size.min),
      color: sampleFireColor(),
    });
  }

  // -----------------------------------------------------------------------
  // ESTADO DE LA MÁQUINA (ver PHASE arriba)
  // -----------------------------------------------------------------------
  let phase = PHASE.IDLE;
  let phaseElapsed = 0;
  let elapsedTotal = 0;
  let activeCount = 0;

  // Sub-fase de OPEN (ver más abajo): independiente de `phase` porque
  // OPEN necesita esperar a envelope.isOpen()/isOpening(), que vive en
  // otro módulo con su propio reloj interno.
  let openSubPhase = "waiting-before"; // "waiting-before" | "opening" | "waiting-after"

  // ITERACIÓN — SE ABANDONA POR COMPLETO EL DOBLADO (ver letterMesh.js:
  // cada hoja es una única malla completa). Ya no existe ninguna
  // sub-fase de pliegue/pausa/apertura: LETTER_RISE es una única
  // transición (ver PHASE.LETTER_RISE más abajo), sin `emerging`,
  // `fold-pause` ni `unfolding`, y sin `letterRiseSubPhase`.

  // Surge de la llama: reloj INDEPENDIENTE de `phase` (ver comentario en
  // update() más abajo) — sigue avanzando durante BIRTH/RISE/CONVERGE
  // aunque `phase` ya no valga FLAME_SURGE, para que la llama se calme
  // MIENTRAS nacen las partículas, no antes ni de golpe.
  let surgeElapsed = 0;
  let surgeActive = false;

  // Cuenta atrás UNA VEZ que `surgeActive` pasa a false (llama ya de
  // vuelta a la normalidad del todo) — ver cfg.particles.postSurgePause
  // más abajo: es solo el "pequeño instante de transición" antes de que
  // nazcan las partículas, NUNCA un temporizador que se adelante al
  // final real de la llama.
  let postSurgeElapsed = 0;

  // Datos de viaje (TRAVEL), calculados una vez al entrar en esa fase a
  // partir de la cámara REAL en ese momento (ver sección 7 del encargo).
  let travelStart = new THREE.Vector3();
  let travelControl = new THREE.Vector3();
  let travelEnd = new THREE.Vector3();

  // Datos de la carta (segunda parte), calculados una vez al entrar en
  // LETTER_RISE a partir de la posición REAL del sobre ya asentado y de
  // los ejes/posición de la cámara en ese instante (mismo criterio que
  // computeTravelPath() — nunca una coordenada de mundo fija, ver
  // sección "IMPORTANTE: CONTINUIDAD" del encargo de la segunda parte).
  //
  // ITERACIÓN — TRAYECTORIA HACIA DELANTE (ver encargo: "la hoja SÍ
  // debe pasar por delante del sobre... avanzar hacia el centro, no
  // hacia arriba"): `letterEmergeStart` es el punto de salida (junto a
  // la apertura del sobre, igual criterio que antes); `letterEmergeEnd`
  // ya NO se calcula respecto al sobre sino respecto a la CÁMARA REAL
  // (mismo criterio que `travelEnd` arriba), para terminar siempre
  // delante de él; `letterEmergeControl` es el punto de control de una
  // curva Bézier cuadrática entre ambos (mismo criterio que
  // `travelControl` arriba) — nunca una línea recta "robótica".
  // `letterUp` se conserva para la respiración vertical de DONE más
  // abajo.
  let letterUp = new THREE.Vector3(0, 1, 0);
  let letterEmergeStart = new THREE.Vector3();
  let letterEmergeControl = new THREE.Vector3();
  let letterEmergeEnd = new THREE.Vector3();
  let letterRestPosition = new THREE.Vector3();
  // Fijado una vez al cargar el módulo (no en cada aparición): mismo
  // criterio que `travelLateralSign` arriba — la curva de salida de la
  // carta se desvía siempre hacia el mismo lado dentro de una misma
  // sesión.
  const letterLateralSign = Math.random() < 0.5 ? -1 : 1;

  // Reloj de la respiración final, independiente de `phaseElapsed`
  // (arranca en 0 al entrar en DONE y no se reinicia salvo con start()).
  let idleElapsed = 0;

  // -----------------------------------------------------------------------
  // EVENTOS: mismo patrón mínimo que candleSequence.js/flameWords.js.
  // "phase-complete" se emite una única vez, al llegar a DONE — ahora
  // al final de la SEGUNDA parte (mensaje completamente visible +
  // FINAL_HOLD), no ya al sobre abierto — pensado para que una fase
  // posterior pueda engancharse sin que este módulo necesite saber nada
  // de ella.
  // -----------------------------------------------------------------------
  const listeners = new Map();
  function on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(callback);
    return () => off(event, callback);
  }
  function off(event, callback) {
    listeners.get(event)?.delete(callback);
  }
  function emit(event, payload) {
    listeners.get(event)?.forEach((callback) => callback(payload));
  }

  // -----------------------------------------------------------------------
  // start(): dispara la secuencia. Pensado para llamarse UNA vez, cuando
  // flameWords emite "sequence-completed" — pero es seguro llamarlo
  // varias veces desde consola para pruebas: si ya está en marcha, no
  // hace nada; si ya terminó (DONE), lo reinicia desde PAUSE.
  // -----------------------------------------------------------------------
  function start() {
    if (phase !== PHASE.IDLE && phase !== PHASE.DONE) return;
    phase = PHASE.PAUSE;
    phaseElapsed = 0;
    surgeElapsed = 0;
    surgeActive = false;
    postSurgeElapsed = 0;
    activeCount = 0;
    idleElapsed = 0;
    points.visible = false;
    envelope.reset();
    letter.reset();
    flame.setSurge(0);
    flame.setSurgeDeform(null);
  }

  function isActive() {
    return phase !== PHASE.IDLE && phase !== PHASE.DONE;
  }

  function getPhase() {
    return phase;
  }

  // -----------------------------------------------------------------------
  // startParticles(): se llama UNA vez, al entrar en BIRTH. Calcula el
  // contorno procedural del sobre (ver sampleEnvelopeOutlinePoints() más
  // abajo) y coloca cada partícula activa en su punto de nacimiento
  // real (dentro del volumen de la llama, ver sampleFlameOriginPoint())
  // y su target (un punto del contorno, proyectado en el plano
  // right/up de la cámara sobre `anchor` — mismo criterio que show() en
  // flameWords.js).
  // -----------------------------------------------------------------------
  function startParticles() {
    camera.updateMatrixWorld(true);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    const outline = sampleEnvelopeOutlinePoints(cfg);
    activeCount = Math.min(capacity, outline.length);

    for (let i = 0; i < activeCount; i++) {
      const p = outline[i];
      state[i].target.x = anchor.x + right.x * p.x + up.x * p.y;
      state[i].target.y = anchor.y + right.y * p.x + up.y * p.y;
      state[i].target.z = anchor.z + right.z * p.x + up.z * p.y;

      const originPoint = sampleFlameOriginPoint(cfg.particles.origin);
      state[i].spawnBase.x = flameOrigin.x + originPoint.offsetX;
      state[i].spawnBase.y = flameOrigin.y + originPoint.offsetY;
      state[i].spawnBase.z = flameOrigin.z + originPoint.offsetZ;

      const [biasMin, biasMax] = cfg.particles.origin.lateralBiasRange;
      state[i].driftLateralBias = biasMin + Math.random() * (biasMax - biasMin);

      const curlAngle = Math.random() * Math.PI * 2;
      const curlMag = 0.35 + Math.random() * 0.65;
      state[i].curl.x = Math.cos(curlAngle) * curlMag;
      state[i].curl.y = Math.sin(curlAngle) * curlMag;

      state[i].delay = Math.random();
    }

    for (let i = activeCount; i < capacity; i++) {
      alphas[i] = 0;
      sizes[i] = 0;
    }
    geometry.attributes.alpha.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;

    points.visible = true;
  }

  // Congela cada partícula activa exactamente en su punto del contorno
  // (mismo criterio que freezeAtTargets() en flameWords.js) — se llama
  // una vez, al terminar CONVERGE, justo antes de empezar a hacer
  // aparecer el objeto físico.
  function freezeParticlesAtTargets() {
    for (let i = 0; i < activeCount; i++) {
      const s = state[i];
      positions[i * 3] = s.target.x;
      positions[i * 3 + 1] = s.target.y;
      positions[i * 3 + 2] = s.target.z;
      alphas[i] = 1;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.alpha.needsUpdate = true;
  }

  // Coloca el objeto físico exactamente donde estaba el contorno de
  // partículas (mismo `anchor`), listo para empezar a aparecer.
  function placeEnvelopeAtAnchor() {
    envelope.group.position.copy(anchor);
    envelope.group.quaternion.identity();
    envelope.group.scale.setScalar(1);
    envelope.setAppearance(0);
  }

  // -----------------------------------------------------------------------
  // computeTravelPath(): calcula spawn→control→destino para la fase
  // TRAVEL a partir de la cámara REAL (ver sección 7 del encargo: "el
  // destino debe calcularse respecto a la cámara actual, no hardcodees
  // una coordenada que solo funcione en esta cámara"). El punto de
  // control se desvía de la línea recta en altura y lateralmente (ejes
  // propios de la cámara, no del mundo) para que el trayecto sea una
  // curva, no un `start → target` mecánico.
  // -----------------------------------------------------------------------
  function computeTravelPath() {
    camera.updateMatrixWorld(true);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();

    travelStart.copy(anchor);

    travelEnd
      .copy(camera.position)
      .addScaledVector(forward, cfg.travel.distanceFromCamera)
      .addScaledVector(up, cfg.travel.verticalOffset);

    // Punto de control a mitad de camino, desplazado en altura y a un
    // lado (signo determinista por sesión, no aleatorio cada frame, para
    // que la curva sea coherente consigo misma durante todo el viaje).
    const lateralSign = travelLateralSign;
    travelControl
      .copy(travelStart)
      .add(travelEnd)
      .multiplyScalar(0.5)
      .addScaledVector(up, cfg.travel.arcHeight)
      .addScaledVector(right, cfg.travel.lateralOffset * lateralSign);
  }
  // Fijado una vez al cargar el módulo (no en cada viaje): con esto la
  // curva siempre se desvía hacia el mismo lado dentro de una misma
  // sesión, en vez de poder salir distinta cada vez que se prueba desde
  // consola.
  const travelLateralSign = Math.random() < 0.5 ? -1 : 1;

  // -----------------------------------------------------------------------
  // computeLetterEmergePath(): calcula, UNA vez al entrar en LETTER_RISE,
  // spawn→control→destino para la salida de la carta — mismo patrón que
  // computeTravelPath() del sobre (ver más arriba), aplicado ahora a la
  // carta en vez de al sobre.
  //
  // `letterEmergeStart` sigue calculándose respecto al sobre ya asentado
  // (envelope.group.position): la carta sigue saliendo físicamente por
  // su apertura, eso no ha cambiado. `letterEmergeEnd`, en cambio, se
  // calcula respecto a la CÁMARA REAL (igual que `travelEnd` del sobre)
  // para terminar SIEMPRE delante de él, sea cual sea su posición (ver
  // "OBJETIVO 3" del encargo: "la hoja SÍ debe pasar por delante del
  // sobre").
  //
  // La orientación de `letter.group` se deja en su identidad por
  // defecto, igual que `envelope.group` tras TRAVEL — ambos comparten
  // el mismo sistema de ejes de mundo.
  // -----------------------------------------------------------------------
  function computeLetterEmergePath() {
    camera.updateMatrixWorld(true);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();

    letterUp.copy(up);

    letterEmergeStart
      .copy(envelope.group.position)
      .addScaledVector(forward, -cfg.letter.emerge.startForwardOffset)
      .addScaledVector(up, cfg.letter.emerge.startHeight);

    letterEmergeEnd
      .copy(camera.position)
      .addScaledVector(forward, cfg.letter.emerge.finalDistanceFromCamera)
      .addScaledVector(up, cfg.letter.emerge.finalVerticalOffset);

    letterEmergeControl
      .copy(letterEmergeStart)
      .add(letterEmergeEnd)
      .multiplyScalar(0.5)
      .addScaledVector(up, cfg.letter.emerge.arcHeight)
      .addScaledVector(right, cfg.letter.emerge.lateralOffset * letterLateralSign);
  }

  // -----------------------------------------------------------------------
  // updateSurge(delta): avanza el reloj de flame.setSurge() (ver
  // sección 2 del encargo) de forma TOTALMENTE independiente de `phase`
  // — sigue llamándose cada frame desde que empieza FLAME_SURGE hasta
  // que ha terminado de bajar del todo, sin que importe si `phase` ya
  // ha avanzado a BIRTH/RISE/CONVERGE mientras tanto (ver
  // cfg.flameSurge.dipDuration en finale.config.js: la pulsación final
  // de contracción se solapa a propósito con el nacimiento de las
  // partículas, igual que antes).
  // -----------------------------------------------------------------------
  // pulseHump(u): forma de UNA pulsación aislada, u ∈ [0,1] → [0,1].
  // sin(π·u)² empieza en 0 con velocidad 0, sube a 1 en u=0.5 y vuelve a
  // 0 con velocidad 0 en u=1 — por eso varias pulsaciones seguidas
  // (pulseHump para u=0..1, luego otra vez para el siguiente tramo,
  // etc.) se encadenan SIN corte ni cambio brusco de velocidad en el
  // punto de unión: cada una termina exactamente donde y como empieza
  // la siguiente. Es lo que permite "más pulsaciones que antes" sin que
  // se note como la animación anterior reproducida mecánicamente varias
  // veces — es una única curva continua.
  function pulseHump(u) {
    const s = Math.sin(Math.PI * u);
    return s * s;
  }

  function updateSurge(delta) {
    if (!surgeActive) return;
    surgeElapsed += delta;
    const s = cfg.flameSurge;
    const pulsesDuration = s.pulseCount * s.pulseDuration;
    const totalDuration = pulsesDuration + s.dipDuration;
    const t = surgeElapsed;

    let value;
    if (t < pulsesDuration) {
      // Pulsaciones de CRECIMIENTO: `pulseCount` repeticiones seguidas
      // de la misma forma (normal → grande → normal), cada una de
      // duración pulseDuration — ver comentario de pulseHump() arriba
      // sobre por qué se encadenan sin corte.
      const localU = (t % s.pulseDuration) / s.pulseDuration;
      value = pulseHump(localU) * s.peak;
    } else if (t < totalDuration) {
      // Pulsación FINAL de contracción ("pequeña"): misma forma, pero
      // en negativo (ver setSurge() en flame.js, que ahora admite
      // valores por debajo de 0) — y termina en 0 exactamente en
      // u=1, así que ya deja la llama "de vuelta a normal" sin
      // necesitar un tramo de asentamiento aparte.
      const localU = (t - pulsesDuration) / s.dipDuration;
      value = -pulseHump(localU) * s.dipDepth;
    } else {
      value = 0;
      surgeActive = false;
    }
    flame.setSurge(value);

    if (surgeActive) {
      flame.setSurgeDeform(computeSurgeDeform(t, Math.min(1, Math.abs(value)), s.deform));
    } else {
      // Reset explícito a identidad justo al terminar — evita que quede
      // cualquier resto de inclinación/pulsación si el redondeo de
      // punto flotante dejase `value` en algo minúsculo pero no
      // exactamente 0 en el último frame.
      flame.setSurgeDeform(null);
    }
  }

  // -----------------------------------------------------------------------
  // computeSurgeDeform: mecanismo de balanceo/inclinación/pulsación
  // INDEPENDIENTE de `surge`, multiplicado por `intensity` (mismo
  // patrón de siempre — con `intensity`=0 esto es la identidad). ITERACIÓN
  // ("no quiero más meneo"): todas las amplitudes en
  // cfg.flameSurge.deform están a 0 (ver finale.config.js), así que esta
  // función devuelve la identidad en la práctica durante toda la
  // pulsación — el pulso de tamaño/intensidad real ahora vive
  // enteramente en `surge` (ver updateSurge()/pulseHump() más arriba),
  // que es la MISMA señal que ya gobierna la luz, así que ambos quedan
  // sincronizados por construcción. Se conserva la función (sin cambiar
  // su lógica) por si en el futuro se quisiera reintroducir algo de
  // balanceo ajustando solo los números de config — sin
  // Math.random() por frame, todo determinista.
  // -----------------------------------------------------------------------
  function computeSurgeDeform(t, intensity, d) {
    const lateral =
      Math.sin(t * d.lateralFrequency1) * d.lateralAmplitude1 +
      Math.sin(t * d.lateralFrequency2 + d.lateralPhase2) * d.lateralAmplitude2;
    const tilt = Math.sin(t * d.tiltFrequency + d.tiltPhase) * d.tiltAmplitude;
    const widthPulse = Math.sin(t * d.widthFrequency + d.widthPhase) * d.widthAmplitude;
    const heightPulse = Math.sin(t * d.heightFrequency + d.heightPhase) * d.heightAmplitude;

    return {
      // rotation.z: balanceo lateral (bending izq/derecha, pivote en la
      // base real de la llama — ver flame.js).
      tiltZ: lateral * intensity,
      // rotation.x: inclinación adicional hacia/desde cámara.
      tiltX: tilt * intensity,
      // Anchura (X/Z) y altura (Y) pulsan de forma INDEPENDIENTE entre
      // sí (frecuencias/fases distintas) — nunca crecen/encogen exactamente
      // a la vez.
      scaleX: 1 + widthPulse * intensity,
      scaleZ: 1 + widthPulse * intensity,
      scaleY: 1 + heightPulse * intensity,
    };
  }

  function update(delta) {
    material.uniforms.pixelHeight.value = window.innerHeight;

    if (phase === PHASE.IDLE) return;

    if (phase === PHASE.DONE) {
      // Estado final estable (ver sección 7 del encargo de la segunda
      // parte): nada más avanza — ni fases ni el resto de relojes —
      // salvo una respiración vertical de la carta muy sutil y
      // continua ("movimiento ambiental... respiración visual muy
      // ligera"), que nunca toca el sobre, la cámara ni la
      // iluminación.
      idleElapsed += delta;
      const bob = Math.sin(idleElapsed * cfg.idle.frequency * Math.PI * 2) * cfg.idle.amplitude;
      letter.group.position.copy(letterRestPosition).addScaledVector(letterUp, bob);
      return;
    }

    elapsedTotal += delta;
    phaseElapsed += delta;
    updateSurge(delta);

    if (phase === PHASE.PAUSE) {
      if (phaseElapsed >= cfg.pause.duration) {
        phase = PHASE.FLAME_SURGE;
        phaseElapsed = 0;
        surgeElapsed = 0;
        surgeActive = true;
        postSurgeElapsed = 0;
      }
      return;
    }

    if (phase === PHASE.FLAME_SURGE) {
      // FLAME_SURGE → BIRTH: espera a que `surgeActive` sea false, es
      // decir, a que la animación agresiva de la llama (todas sus
      // pulsaciones + la contracción final, ver updateSurge()) haya
      // terminado REALMENTE — ya no a un temporizador fijo
      // (cfg.particles.startDelay de antes, pensado para los 6.4s de la
      // curva única que había entonces y que se quedó desfasado al pasar
      // FLAME_SURGE a 12.8s con varias pulsaciones). `postSurgePause` es
      // solo un pequeño margen de transición DESPUÉS de ese final real,
      // nunca un adelanto.
      if (!surgeActive) {
        postSurgeElapsed += delta;
        if (postSurgeElapsed >= cfg.particles.postSurgePause) {
          startParticles();
          phase = PHASE.BIRTH;
          phaseElapsed = 0;
        }
      }
      return;
    }

    if (phase === PHASE.BIRTH || phase === PHASE.RISE || phase === PHASE.CONVERGE) {
      updateParticles(delta);

      if (phase === PHASE.BIRTH && phaseElapsed >= cfg.particles.birthDuration) {
        phase = PHASE.RISE;
        phaseElapsed = 0;
      } else if (phase === PHASE.RISE && phaseElapsed >= cfg.particles.riseDuration) {
        phase = PHASE.CONVERGE;
        phaseElapsed = 0;
      } else if (phase === PHASE.CONVERGE && phaseElapsed >= cfg.formation.convergeDuration) {
        freezeParticlesAtTargets();
        placeEnvelopeAtAnchor();
        phase = PHASE.MATERIALIZE;
        phaseElapsed = 0;
      }
      return;
    }

    if (phase === PHASE.MATERIALIZE) {
      const t = clamp01(phaseElapsed / cfg.materialize.duration);
      const eased = easeOutCubic(t);
      // Las partículas pierden protagonismo (alpha 1→0) MIENTRAS el
      // objeto físico gana presencia (opacidad 0→1) — a la vez, nunca
      // un pop instantáneo (ver sección 8 del encargo).
      for (let i = 0; i < activeCount; i++) {
        alphas[i] = 1 - eased;
      }
      geometry.attributes.alpha.needsUpdate = true;
      envelope.setAppearance(eased);

      if (t >= 1) {
        points.visible = false;
        computeTravelPath();
        phase = PHASE.TRAVEL;
        phaseElapsed = 0;
      }
      return;
    }

    if (phase === PHASE.TRAVEL) {
      const raw = clamp01(phaseElapsed / cfg.travel.duration);
      const eased = easeOutCubic(raw); // decelera al llegar, ver sección 9
      const oneMinusT = 1 - eased;
      // Bézier cuadrática: spawn → control → destino, nunca una línea
      // recta (ver sección 7 del encargo).
      envelope.group.position.set(
        oneMinusT * oneMinusT * travelStart.x + 2 * oneMinusT * eased * travelControl.x + eased * eased * travelEnd.x,
        oneMinusT * oneMinusT * travelStart.y + 2 * oneMinusT * eased * travelControl.y + eased * eased * travelEnd.y,
        oneMinusT * oneMinusT * travelStart.z + 2 * oneMinusT * eased * travelControl.z + eased * eased * travelEnd.z
      );
      // Ligero balanceo orgánico durante el viaje, que se apaga según se
      // acerca al destino (para que no llegue "temblando").
      const wobble = Math.sin(elapsedTotal * 3.1) * 0.05 * oneMinusT;
      envelope.group.rotation.z = wobble;
      envelope.group.rotation.y = Math.sin(elapsedTotal * 2.3) * 0.04 * oneMinusT;

      if (raw >= 1) {
        envelope.group.position.copy(travelEnd);
        envelope.group.rotation.set(0, 0, 0);
        phase = PHASE.SETTLE;
        phaseElapsed = 0;
      }
      return;
    }

    if (phase === PHASE.SETTLE) {
      // Pequeño asentamiento final (amortiguado, se apaga rápido) — se
      // nota que el objeto "acaba de llegar", no un frenado en seco.
      const t = clamp01(phaseElapsed / cfg.settle.duration);
      const settleWobble = Math.sin(t * Math.PI * 3) * 0.02 * (1 - t);
      envelope.group.scale.setScalar(1 + settleWobble);

      if (phaseElapsed >= cfg.settle.duration) {
        envelope.group.scale.setScalar(1);
        phase = PHASE.OPEN;
        phaseElapsed = 0;
        openSubPhase = "waiting-before";
      }
      return;
    }

    if (phase === PHASE.OPEN) {
      if (openSubPhase === "waiting-before") {
        if (phaseElapsed >= cfg.open.pauseBefore) {
          envelope.open();
          openSubPhase = "opening";
          phaseElapsed = 0;
        }
      } else if (openSubPhase === "opening") {
        if (envelope.isOpen()) {
          openSubPhase = "waiting-after";
          phaseElapsed = 0;
        }
      } else if (openSubPhase === "waiting-after") {
        if (phaseElapsed >= cfg.open.pauseAfter) {
          // Fin de la primera parte del final (sobre completamente
          // abierto) → arranca la segunda parte sin ningún corte: la
          // misma máquina de estados sigue, en la misma fase de
          // `update()`, sin volver a IDLE ni reiniciar ningún reloj
          // que no corresponda (ver "CONTINUIDAD CON LA PRIMERA PARTE"
          // en el encargo de la segunda parte).
          phase = PHASE.PAUSE_AFTER_OPEN;
          phaseElapsed = 0;
        }
      }
      return;
    }

    // -----------------------------------------------------------------------
    // SEGUNDA PARTE DEL FINAL (ver comentario de cabecera y
    // finale.config.js → cfg.letter/cfg.message/cfg.finalHold/cfg.idle).
    // -----------------------------------------------------------------------

    if (phase === PHASE.PAUSE_AFTER_OPEN) {
      // 1) Pequeña pausa de anticipación con el sobre ya abierto (ver
      // sección 1 del encargo de la segunda parte). Nada más ocurre
      // aquí: ni la cámara, ni la iluminación, ni el sobre se tocan.
      if (phaseElapsed >= cfg.letter.pauseAfterOpen) {
        computeLetterEmergePath();
        phase = PHASE.LETTER_RISE;
        phaseElapsed = 0;
      }
      return;
    }

    if (phase === PHASE.LETTER_RISE) {
      // ITERACIÓN — SE ABANDONA POR COMPLETO EL DOBLADO (ver encargo:
      // "no queremos que la hoja se doble, se despliegue ni se divida
      // en dos partes... quiero simplificarlo al máximo"). Antes esta
      // fase tenía tres etapas secuenciales ("emerging" → "fold-pause"
      // → "unfolding") para coordinar un pliegue que ya no existe (ver
      // letterMesh.js: cada hoja es ahora una única malla completa, sin
      // pivotes de pliegue ni caras frontal/trasera distintas). Ahora es
      // una única transición: la hoja avanza desde el sobre hasta su
      // posición final —ya completa, a su escala definitiva y con el
      // texto ya visible desde el primer instante en que tiene opacidad
      // > 0— y ahí se queda quieta. Sin pausa de 1s, sin apertura
      // posterior.
      letter.group.scale.setScalar(cfg.letter.emerge.finalScale);

      const t = clamp01(phaseElapsed / cfg.letter.emerge.duration);
      const eased = easeOutCubic(t);
      const oneMinusT = 1 - eased;
      letter.group.position.set(
        oneMinusT * oneMinusT * letterEmergeStart.x +
          2 * oneMinusT * eased * letterEmergeControl.x +
          eased * eased * letterEmergeEnd.x,
        oneMinusT * oneMinusT * letterEmergeStart.y +
          2 * oneMinusT * eased * letterEmergeControl.y +
          eased * eased * letterEmergeEnd.y,
        oneMinusT * oneMinusT * letterEmergeStart.z +
          2 * oneMinusT * eased * letterEmergeControl.z +
          eased * eased * letterEmergeEnd.z
      );
      letter.setAppearance(eased);

      if (t >= 1) {
        // Fijado explícito al destino exacto — posición y opacidad
        // quedan resueltas AQUÍ (la escala ya estaba fija desde el
        // primer frame de esta fase, ver arriba). La hoja pasa
        // directamente a FINAL_HOLD: no hay ninguna fase de apertura
        // posterior.
        letter.group.position.copy(letterEmergeEnd);
        letter.setAppearance(1);
        letterRestPosition.copy(letter.group.position);
        phase = PHASE.FINAL_HOLD;
        phaseElapsed = 0;
      }
      return;
    }

    if (phase === PHASE.FINAL_HOLD) {
      // 7) Estado final estable (ver sección 7 del encargo): pausa
      // corta antes de considerar la secuencia completamente
      // terminada. La carta, el mensaje y el sobre ya no cambian de
      // aquí en adelante salvo la respiración muy sutil de DONE.
      if (phaseElapsed >= cfg.finalHold.duration) {
        phase = PHASE.DONE;
        idleElapsed = 0;
        emit("phase-complete");
      }
      return;
    }
  }

  // -----------------------------------------------------------------------
  // updateParticles(delta): comportamiento de BIRTH/RISE/CONVERGE — same
  // shape de idea que flameWords.js (brasa pura → convergencia con arco,
  // arranque escalonado), reimplementado aquí de forma independiente
  // porque flameWords.js no exporta estas piezas y no se quiere acoplar
  // este sistema al suyo (ver sección 3 del encargo).
  // -----------------------------------------------------------------------
  function updateParticles() {
    camera.updateMatrixWorld(true);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    const cycleElapsed =
      phase === PHASE.BIRTH
        ? phaseElapsed
        : phase === PHASE.RISE
          ? cfg.particles.birthDuration + phaseElapsed
          : cfg.particles.birthDuration + cfg.particles.riseDuration + phaseElapsed;

    for (let i = 0; i < activeCount; i++) {
      const s = state[i];
      let influence = 0;
      let alpha = 1;

      if (phase === PHASE.BIRTH) {
        const local = clamp01((phaseElapsed / cfg.particles.birthDuration - s.delay * 0.5) / 0.5);
        alpha = clamp01(local * 1.6);
      } else if (phase === PHASE.RISE) {
        alpha = 1;
      } else {
        const spread = cfg.formation.stagger;
        const local = clamp01((phaseElapsed / cfg.formation.convergeDuration - s.delay * spread) / (1 - spread));
        influence = easeOutBack(local);
        alpha = 1;
      }

      const influenceClamped = clamp01(influence);

      const drift = computeDrift(
        s.spawnBase,
        cycleElapsed,
        cfg.particles.birthDuration + cfg.particles.riseDuration,
        cfg.particles.birthScatter * s.driftLateralBias,
        cfg.particles.riseHeight,
        s,
        elapsedTotal
      );

      const bell = Math.sin(Math.PI * influenceClamped);
      const curlScale = bell * cfg.formation.curlAmount;
      const curlWorldX = right.x * s.curl.x * curlScale + up.x * s.curl.y * curlScale;
      const curlWorldY = right.y * s.curl.x * curlScale + up.y * s.curl.y * curlScale;
      const curlWorldZ = right.z * s.curl.x * curlScale + up.z * s.curl.y * curlScale;

      positions[i * 3] = drift.x * (1 - influenceClamped) + s.target.x * influenceClamped + curlWorldX;
      positions[i * 3 + 1] = drift.y * (1 - influenceClamped) + s.target.y * influenceClamped + curlWorldY;
      positions[i * 3 + 2] = drift.z * (1 - influenceClamped) + s.target.z * influenceClamped + curlWorldZ;

      particleColors[i * 3] = s.color.r;
      particleColors[i * 3 + 1] = s.color.g;
      particleColors[i * 3 + 2] = s.color.b;

      sizes[i] = s.size * (0.7 + 0.3 * influenceClamped);
      alphas[i] = clamp01(alpha);
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.particleColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
    geometry.attributes.alpha.needsUpdate = true;
  }

  onUpdate(update);

  // -----------------------------------------------------------------------
  // API DE PÁGINAS (ver "API / CONTROL" del encargo de esta iteración:
  // "candela.finale.nextPage()"/"previousPage()" — aquí adaptado al
  // nombre que ya usa el proyecto, `candela.candelaFinale`, ver
  // main.js). Delega directamente en letter.js (que ya sabe si hay una
  // transición en curso, cuál es el límite, etc. — ver "REGLAS DE
  // ANIMACIÓN" del encargo), con un único guardado propio de esta capa:
  // no tiene sentido pasar de hoja mientras la carta todavía no se ha
  // revelado del todo (durante PAUSE/FLAME_SURGE/BIRTH/.../LETTER_RISE
  // la carta o su página actual siguen apareciendo) — solo se permite
  // desde FINAL_HOLD en adelante (incluyendo DONE, el estado estable
  // de reposo).
  // -----------------------------------------------------------------------
  function isLetterReadable() {
    return phase === PHASE.FINAL_HOLD || phase === PHASE.DONE;
  }

  function nextPage() {
    if (!isLetterReadable()) return false;
    return letter.nextPage();
  }

  function previousPage() {
    if (!isLetterReadable()) return false;
    return letter.previousPage();
  }

  function getCurrentPage() {
    return letter.getCurrentPage();
  }

  function getPageCount() {
    return letter.getPageCount();
  }

  return { start, isActive, getPhase, on, off, nextPage, previousPage, getCurrentPage, getPageCount };
}

// NOTA para quien siga ampliando esto: `isActive()` ya cubre toda la
// secuencia (primera + segunda parte) sin cambios, porque solo compara
// contra IDLE/DONE — cualquier fase intermedia nueva (PAUSE_AFTER_OPEN,
// LETTER_RISE, FINAL_HOLD) cuenta como "activa" automáticamente.

// -----------------------------------------------------------------------
// sampleEnvelopeOutlinePoints: dibuja el CONTORNO (nunca el relleno) de
// un sobre en un canvas 2D oculto y devuelve puntos {x, y} en unidades
// de mundo, centrados en (0,0) — mismo concepto que sampleWordPoints()
// en flameWords.js (canvas nunca visible, solo para muestrear píxeles),
// implementado aquí de forma independiente (ver sección 4 del encargo:
// "no hagas una gran refactorización de FlameWords").
//
// El contorno incluye: rectángulo del cuerpo (laterales + base) y las
// dos líneas de la solapa (una "V" desde las esquinas superiores hasta
// el pico central) — suficiente para reconocer un sobre sin que se lea
// como una mancha rellena (ver sección 4 del encargo).
// -----------------------------------------------------------------------
function sampleEnvelopeOutlinePoints(cfg) {
  const e = cfg.envelope;
  const s = e.sampling;

  const canvasWidth = Math.max(16, Math.round(e.width * s.pixelsPerUnit));
  const canvasHeight = Math.max(16, Math.round(e.height * s.pixelsPerUnit));

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = s.strokeWidthPx;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const flapPx = e.flapHeight * s.pixelsPerUnit;
  const inset = s.strokeWidthPx * 0.5;
  const left = inset;
  const right = canvasWidth - inset;
  const bodyTop = inset;
  const bodyBottom = canvasHeight - inset;

  // Contorno del cuerpo: laterales + base (rectángulo completo — la
  // línea superior queda cubierta/duplicada por la solapa, pero
  // dibujarla también no perjudica el muestreo).
  ctx.strokeRect(left, bodyTop, right - left, bodyBottom - bodyTop);

  // Líneas de la solapa: "V" desde las esquinas superiores del cuerpo
  // hacia la punta que cuelga hacia ABAJO, flapHeight más abajo de la
  // parte superior y centrada — contenida dentro del propio cuerpo
  // (misma silueta que la geometría real en envelopeMesh.js: la punta
  // está en (0, -flapHeight) relativo al pivote del borde superior, que
  // vive en y = +height/2).
  ctx.beginPath();
  ctx.moveTo(left, bodyTop);
  ctx.lineTo(canvasWidth / 2, bodyTop + flapPx);
  ctx.lineTo(right, bodyTop);
  ctx.stroke();

  const { data } = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const candidates = [];
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const alpha = data[(y * canvasWidth + x) * 4 + 3];
      if (alpha > s.alphaThreshold) candidates.push({ x, y });
    }
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const scale = 1 / s.pixelsPerUnit;
  const count = Math.min(candidates.length, cfg.particles.count);
  const selected = candidates.length > 0 ? selectEvenlyLocal(candidates, count) : [];

  return selected.map((c) => ({
    x: (c.x - canvasWidth / 2) * scale,
    y: -(c.y - canvasHeight / 2) * scale,
  }));
}

// -----------------------------------------------------------------------
// selectEvenlyLocal: mismo algoritmo (rejilla + una partícula por celda)
// que selectEvenly() en flameWords.js, copiado aquí como función local
// independiente (no exportada por ese archivo, y no merece una
// extracción compartida por ~25 líneas — ver sección 4 del encargo).
// -----------------------------------------------------------------------
function selectEvenlyLocal(candidates, targetCount) {
  if (candidates.length === 0 || targetCount <= 0) return [];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of candidates) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);
  const cellSize = Math.sqrt((boxW * boxH) / targetCount);

  const buckets = new Map();
  for (const c of candidates) {
    const key = Math.floor((c.x - minX) / cellSize) + "," + Math.floor((c.y - minY) / cellSize);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }

  const cells = [...buckets.values()];
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const selected = [];
  for (const cell of cells) {
    selected.push(cell[Math.floor(Math.random() * cell.length)]);
    if (selected.length >= targetCount) return selected;
  }

  const byDensity = [...cells].sort((a, b) => b.length - a.length);
  let idx = 0;
  while (selected.length < targetCount && byDensity.length > 0) {
    const cell = byDensity[idx % byDensity.length];
    selected.push(cell[Math.floor(Math.random() * cell.length)]);
    idx++;
  }
  return selected;
}

// -----------------------------------------------------------------------
// sampleFlameOriginPoint: copia local independiente de la función del
// mismo nombre en flameWords.js (no exportada por ese archivo) — mismo
// criterio de "lágrima" que la silueta real de la llama (ver
// CONFIG.flame.shape), aplicado aquí sobre cfg.particles.origin en vez
// de cfg.flameOrigin.
// -----------------------------------------------------------------------
function sampleFlameOriginPoint(o) {
  const t = Math.random();
  const bulgeT = o.bulgeT;

  const maxRadius =
    t <= bulgeT
      ? o.radiusAtBase + (o.radiusAtBulge - o.radiusAtBase) * (t / bulgeT)
      : o.radiusAtBulge + (o.radiusAtTop - o.radiusAtBulge) * ((t - bulgeT) / (1 - bulgeT));

  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * maxRadius;

  return {
    offsetX: Math.cos(angle) * radius,
    offsetY: o.heightRange[0] + t * (o.heightRange[1] - o.heightRange[0]),
    offsetZ: Math.sin(angle) * radius,
  };
}

// Copia local independiente de computeDrift() en flameWords.js (mismo
// criterio: comportamiento de brasa pura, crecimiento acotado por
// ageCap, varias ondas senoidales con semillas por partícula).
function computeDrift(origin, age, ageCap, scatterAmount, riseAmount, s, elapsedTotal) {
  const growth = clamp01(age / Math.max(0.0001, ageCap));
  const wobbleA = Math.sin(elapsedTotal * 1.3 + s.seedA);
  const wobbleB = Math.sin(elapsedTotal * 0.7 + s.seedB);
  const wobbleC = Math.cos(elapsedTotal * 1.1 + s.seedB * 1.3);

  return {
    x: origin.x + (wobbleA * 0.6 + wobbleB * 0.4) * growth * scatterAmount,
    y: origin.y + growth * riseAmount + wobbleC * growth * scatterAmount * 0.3,
    z: origin.z + wobbleC * growth * scatterAmount * 0.7,
  };
}

function createSoftGlowTexture(size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.7)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function easeOutBack(t) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

function easeInCubic(t) {
  const x = clamp01(t);
  return x * x * x;
}
