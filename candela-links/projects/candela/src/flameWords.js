import * as THREE from "three";
import { CONFIG } from "./config.js";
import { onUpdate } from "./scene.js";
import { onWickReady } from "./candle.js";
import { EMBER_VERTEX_SHADER, EMBER_FRAGMENT_SHADER } from "./flameShader.js";

// -----------------------------------------------------------------------
// FLAME WORDS (v0.5 — "DENSIDAD ADAPTATIVA"): partículas que nacen
// DENTRO del volumen real de la llama (ver cfg.flameOrigin en
// flameWords.config.js), ascienden y se dispersan como brasas, y SOLO
// DESPUÉS empiezan a converger hasta formar una palabra o frase
// legible; se queda completamente QUIETA mientras se lee, y luego puede
// deshacerse de nuevo en brasas. La CANTIDAD de partículas usada en
// cada show() ya no es fija: se calcula según la longitud/complejidad
// real de la frase (ver cfg.particleDensity y sampleWordPoints), así
// que una frase larga mantiene aproximadamente la misma densidad
// legible que una corta, hasta un techo razonable de rendimiento.
// Módulo completamente ADITIVO: no importa nada de flame.js, no lo
// modifica, y no depende de su estado interno — solo reutiliza dos
// piezas que YA estaban pensadas para reutilizarse fuera de ese
// archivo:
//
//   - onWickReady() (candle.js), el mismo anclaje real que usa flame.js
//     para saber dónde está la mecha, así este sistema se posiciona
//     igual de bien sin necesitar leer nada de dentro de flame.js.
//   - EMBER_VERTEX_SHADER / EMBER_FRAGMENT_SHADER (flameShader.js), el
//     mismo shader que ya usan las brasas reales de la llama. Se
//     reutiliza tal cual (no se copia ni se reescribe) precisamente
//     para que estas partículas sean, técnicamente, LA MISMA cosa que
//     una brasa — mismo blending, mismo glow, mismo comportamiento de
//     tamaño por distancia — y no una imitación aparte.
//
// CICLO DE VIDA (6 fases, ver flameWords.config.js → timing):
//
//   BIRTH → RISE → FORMATION → READING(readable) → HOLD → DISSOLVE
//
// La influencia del target (la posición de la letra) es 0 durante
// BIRTH y RISE (comportamiento de brasa pura, sin ninguna letra
// "tirando" todavía de la partícula), empieza a crecer en FORMATION,
// termina de tensarse en READING (y de paso aclara el color hacia
// readableColor, ver más abajo — legibilidad y convergencia avanzan
// juntas), y en HOLD la palabra queda CONGELADA — sin drift, sin curl,
// sin jitter, sin ningún recálculo de posición/color/tamaño (ver
// freezeAtTargets() más abajo) — hasta pasar a DISSOLVE, momento en el
// que la partícula vuelve a comportarse como una brasa que se aleja de
// donde estaba la letra, no como algo que simplemente se desvanece en
// el sitio.
//
// SECUENCIA AUTOMÁTICA: además del modo manual (show/hide de toda la
// vida), este módulo expone startAutoSequence()/stopAutoSequence(), que
// reproducen una detrás de otra las frases de cfg.autoSequence.words
// hasta terminar la lista (sin repetir). Se dispara sola en cuanto la
// vela queda encendida de forma definitiva — ver
// candleSequence.on("completed", ...) en main.js. show()/hide()/
// isActive() no cambian de comportamiento ni de firma: siguen
// funcionando exactamente igual desde la consola.
// -----------------------------------------------------------------------

export function createFlameWords(scene, camera) {
  const cfg = CONFIG.flameWords;
  // Capacidad MÁXIMA reservada de una vez (buffers de tamaño fijo, sin
  // recrear geometría por frame — ver sección de rendimiento del
  // encargo). Cuántas de esas partículas están realmente EN USO en
  // cada momento lo controla `activeCount` (dinámico, se recalcula en
  // cada show() según la longitud real de la frase — ver
  // cfg.particleDensity y sampleWordPoints()).
  const capacity = cfg.particleDensity.max;
  // Partículas activas para la frase actual. Arranca en el mínimo
  // (nada se ve hasta el primer show(), points.visible=false) y se
  // recalcula cada vez que se llama a show().
  let activeCount = cfg.particleDensity.min;

  // ---- Geometría / material: mismo patrón que embers en flame.js ----
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

  // ---- Anclaje real: igual que smoke.js, sin tocar flame.js ----
  // Posición de arranque de respaldo (por si show() se llamara antes de
  // que candle.glb termine de cargar) + el offset propio de este
  // sistema. En cuanto la mecha real esté lista, se recoloca ahí.
  const anchor = new THREE.Vector3(...CONFIG.candle.position).add(
    new THREE.Vector3(...cfg.anchor.offset)
  );
  // Segundo punto de anclaje, DISTINTO del anterior: dónde nacen
  // realmente las partículas en BIRTH (dentro del volumen de la llama),
  // no dónde se lee la palabra — ver cfg.flameOrigin y
  // sampleFlameOriginPoint() más abajo.
  const flameOrigin = new THREE.Vector3(...CONFIG.candle.position).add(
    new THREE.Vector3(...cfg.flameOrigin.offset)
  );
  onWickReady((wickWorld) => {
    anchor.copy(wickWorld).add(new THREE.Vector3(...cfg.anchor.offset));
    flameOrigin.copy(wickWorld).add(new THREE.Vector3(...cfg.flameOrigin.offset));
  });

  // ---- Paleta (idéntica a CONFIG.flame.colors a propósito) ----
  const palette = [
    new THREE.Color(cfg.colors.core),
    new THREE.Color(cfg.colors.yellow),
    new THREE.Color(cfg.colors.orange),
    new THREE.Color(cfg.colors.edge),
  ];
  // Pesos: más partículas amarillas/naranjas (el cuerpo dominante del
  // fuego), pocas del núcleo blanco y del borde rojo oscuro — mismo
  // criterio de mezcla que un fuego real, sin copiar código de
  // flame.js (que no expone esta función).
  function sampleFireColor() {
    const t = Math.pow(Math.random(), 1.15) * 3; // sesgado hacia el centro de la rampa
    const i = Math.min(2, Math.floor(t));
    const localT = t - i;
    return palette[i].clone().lerp(palette[i + 1], localT);
  }

  // Color hacia el que se aclaran las partículas al converger en su
  // letra (ver update()) y color fijo en HOLD — es el mismo `core` de
  // la paleta de arriba (palette[0]), reutilizado tal cual: el tono más
  // claro que ya existía, no un color nuevo. Ver comentario junto a
  // `colors` en flameWords.config.js.
  const readableColor = palette[0];

  // ---- Estado por partícula ----
  // curl: pequeño offset lateral propio (dirección + magnitud), fijado
  // en cada show() y usado durante FORMATION/READING/DISSOLVE para que
  // el trayecto spawn→target sea un arco, no una recta (ver sección 8
  // del encargo). Se pondera por `bell` dentro de update() (una curva
  // en forma de campana sobre la influencia: 0 en influence=0 o 1,
  // máxima a mitad de camino), así en BIRTH/RISE/HOLD no pinta nada —
  // solo se nota durante la transición.
  // driftLateralBias: multiplicador aleatorio (ver
  // cfg.flameOrigin.lateralBiasRange) sobre la dispersión lateral de
  // BIRTH/RISE — con esto no todas las partículas se apartan lo mismo
  // al nacer, algunas salen bastante más hacia el lado que otras.
  //
  // Se reserva estado para TODA la capacidad (no solo activeCount): así
  // no hay que crear/destruir objetos cuando una frase pasa de usar
  // pocas partículas a usar muchas — las de más ya existen, solo
  // estaban inactivas (alpha=0).
  const state = [];
  for (let i = 0; i < capacity; i++) {
    state.push({
      target: { x: anchor.x, y: anchor.y, z: anchor.z },
      spawnBase: { x: anchor.x, y: anchor.y, z: anchor.z },
      delay: Math.random(),
      seedA: Math.random() * Math.PI * 2,
      seedB: Math.random() * Math.PI * 2,
      curl: { x: 0, y: 0 },
      driftLateralBias: 1,
      size: cfg.size.min + Math.random() * (cfg.size.max - cfg.size.min),
      color: sampleFireColor(),
    });
  }

  let active = false;
  let phase = "idle"; // "birth" | "rise" | "formation" | "reading" | "hold" | "dissolve"
  let phaseElapsed = 0;
  let elapsedTotal = 0;
  // Tiempo transcurrido desde que arrancó el ciclo actual (desde el
  // show() más reciente que arrancó en BIRTH, o desde que se saltó
  // directamente a FORMATION por venir de una palabra ya activa). Se
  // usa para acotar el crecimiento de la deriva/dispersión de llegada
  // (ver computeDrift) — a diferencia de elapsedTotal, este SÍ
  // se resetea en cada show(), así la dispersión de nacimiento no seguiría
  // creciendo indefinidamente si HOLD durase mucho.
  let cycleElapsed = 0;

  // -----------------------------------------------------------------------
  // ESTADO DE LA SECUENCIA AUTOMÁTICA (independiente del ciclo de fases
  // de arriba, que sigue siendo el mismo para cualquier show(), manual o
  // automático). Ver startAutoSequence()/stopAutoSequence() más abajo.
  // -----------------------------------------------------------------------
  let autoActive = false;
  let autoState = "idle"; // "waiting" | "showing" | "gap"
  let autoWords = [];
  let autoIndex = 0;
  let autoTimer = 0; // cuenta atrás (segundos) en "waiting" y "gap"

  // -----------------------------------------------------------------------
  // EVENTOS (añadido para el final de Candela): mismo patrón mínimo de
  // bus de eventos que ya usa candleSequence.js (on/off/emit con un
  // Map<evento, Set<callback>>), añadido aquí de forma puramente
  // aditiva — show()/hide()/isActive()/startAutoSequence()/
  // stopAutoSequence() no cambian ni de firma ni de comportamiento.
  //
  //   "sequence-completed" → se emite UNA vez, exactamente cuando la
  //   secuencia automática (startAutoSequence) termina de reproducir su
  //   última frase Y esa frase ha terminado de disolverse del todo (ver
  //   updateAutoSequence() más abajo) — nunca en modo manual (show()/
  //   hide() sueltos, sin autoSequence de por medio) y nunca si
  //   stopAutoSequence() cortó la lista antes de llegar al final. Quien
  //   escuche esto (main.js) es quien decide qué pasa después (el resto
  //   del final de Candela); este módulo no sabe nada de sobres ni de
  //   llama creciendo, solo avisa de que ya no queda ninguna frase más
  //   por mostrar.
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
  // show(word): calcula la nube de puntos objetivo de la palabra (canvas
  // 2D, nunca visible — solo se usa para leer su mapa de píxeles) y
  // arranca la fase de formación. El NÚMERO de puntos que devuelve
  // sampleWordPoints() ya varía según la longitud/complejidad real de
  // `word` (ver cfg.particleDensity) — así que aquí simplemente se usa
  // esa cantidad como `activeCount` de esta frase, sin ningún cálculo
  // adicional.
  //
  // Si ya hay una palabra en curso, no reinicia de golpe desde cero:
  // usa las posiciones ACTUALES como nuevo punto de partida, para poder
  // repetir la prueba sin esperar a que termine la anterior y sin que
  // se note un salto brusco.
  // -----------------------------------------------------------------------
  function show(word) {
    camera.updateMatrixWorld(true);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    const targets = sampleWordPoints(word, cfg);
    const wasActive = active;
    // Cuántas de las partículas "heredadas" de la palabra anterior
    // pueden reutilizarse tal cual (continuar desde su posición
    // actual). Si la frase nueva necesita MÁS partículas que la
    // anterior, las de más no tienen una posición previa real que
    // continuar — nacen frescas desde la llama, igual que si no
    // hubiera ninguna palabra activa (ver más abajo).
    const previousActiveCount = wasActive ? activeCount : 0;
    const newActiveCount = targets.length;

    for (let i = 0; i < newActiveCount; i++) {
      const p = targets[i];
      const jitterX = (Math.random() - 0.5) * 0.004;
      const jitterY = (Math.random() - 0.5) * 0.004;

      state[i].target.x = anchor.x + right.x * (p.x + jitterX) + up.x * (p.y + jitterY);
      state[i].target.y = anchor.y + right.y * (p.x + jitterX) + up.y * (p.y + jitterY);
      state[i].target.z = anchor.z + right.z * (p.x + jitterX) + up.z * (p.y + jitterY);

      if (wasActive && i < previousActiveCount) {
        // Continúa desde donde esté ahora mismo cada partícula, no
        // desde el ancla — evita un "salto" visible al repetir show().
        // Además nos saltamos BIRTH/RISE (ver más abajo): estas
        // partículas ya son fuego vivo, no hace falta que "nazcan" otra
        // vez, así que entran directamente en FORMATION hacia la nueva
        // frase.
        state[i].spawnBase.x = positions[i * 3];
        state[i].spawnBase.y = positions[i * 3 + 1];
        state[i].spawnBase.z = positions[i * 3 + 2];
      } else {
        // Nace dentro del volumen real de la llama (ver
        // sampleFlameOriginPoint()/cfg.flameOrigin), no en un disco
        // encima de la vela — así se percibe que la partícula sale
        // físicamente de la llama antes de subir hacia la palabra. Esto
        // incluye tanto el caso normal (no había ninguna palabra
        // activa) como las partículas "extra" que una frase más larga
        // necesita por encima de lo que tenía la anterior — esas
        // tampoco tienen una posición previa real que continuar.
        const originPoint = sampleFlameOriginPoint(cfg);
        state[i].spawnBase.x = flameOrigin.x + originPoint.offsetX;
        state[i].spawnBase.y = flameOrigin.y + originPoint.offsetY;
        state[i].spawnBase.z = flameOrigin.z + originPoint.offsetZ;
      }

      // Multiplicador de dispersión lateral propio de esta partícula
      // (ver comentario en la creación de `state`) — se recalcula en
      // cada show(), no solo al nacer, así también afecta un poco a la
      // deriva residual de partículas "heredadas" de una palabra
      // anterior (wasActive).
      const [biasMin, biasMax] = cfg.flameOrigin.lateralBiasRange;
      state[i].driftLateralBias = biasMin + Math.random() * (biasMax - biasMin);

      // Curl propio (ver comentario en la creación de `state`): ángulo
      // y magnitud aleatorios en el plano right/up de la cámara, para
      // que el arco de cada partícula durante la convergencia sea
      // distinto al de sus vecinas.
      const curlAngle = Math.random() * Math.PI * 2;
      const curlMag = 0.35 + Math.random() * 0.65;
      state[i].curl.x = Math.cos(curlAngle) * curlMag;
      state[i].curl.y = Math.sin(curlAngle) * curlMag;

      state[i].delay = Math.random();
    }

    // Partículas que estaban en uso por una frase anterior más larga,
    // pero que esta frase ya no necesita: se apagan (alpha/size a 0) en
    // vez de quedar "colgadas" con su última posición visible — si no,
    // se verían como puntos sueltos inmóviles que ya no pertenecen a
    // ninguna letra. update()/freezeAtTargets() ya no las recorren
    // (ambas usan `activeCount`), así que esto es lo único que hace
    // falta para que desaparezcan del todo.
    for (let i = newActiveCount; i < capacity; i++) {
      alphas[i] = 0;
      sizes[i] = 0;
    }
    geometry.attributes.alpha.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;

    activeCount = newActiveCount;

    phase = wasActive ? "formation" : "birth";
    phaseElapsed = 0;
    cycleElapsed = 0;
    active = true;
    points.visible = true;
  }

  // Fuerza el paso a disolución de inmediato, sin esperar a que termine
  // la fase de lectura — útil sobre todo para pruebas repetidas.
  function hide() {
    if (!active || phase === "dissolve") return;
    phase = "dissolve";
    phaseElapsed = 0;
  }

  function isActive() {
    return active;
  }

  // -----------------------------------------------------------------------
  // startAutoSequence(words?): arranca la reproducción automática de
  // varias frases seguidas (una detrás de otra, sin intervención
  // manual), usando cfg.autoSequence.words salvo que se pase una lista
  // propia (útil para pruebas puntuales desde consola sin tocar el
  // config). Al terminar la última frase de la lista, el sistema se
  // para solo — no vuelve a empezar por su cuenta.
  //
  // No decide POR SÍ SOLA cuándo debe dispararse (ver el bloque de
  // comentarios al principio del archivo): hay que llamarla desde
  // fuera, ya sea a mano desde consola (candela.flameWords.startAutoSequence())
  // o desde el punto del código que sepa que la llama ya está estable.
  //
  // Si ya había una secuencia automática en marcha, la reinicia desde
  // el principio de la lista (no la acumula ni la duplica).
  // -----------------------------------------------------------------------
  function startAutoSequence(words) {
    const list = Array.isArray(words) && words.length ? words : cfg.autoSequence.words;
    if (!list || !list.length) return;

    autoWords = list.slice();
    autoIndex = 0;
    autoActive = true;
    autoState = "waiting";
    autoTimer = Math.max(0, cfg.autoSequence.triggerDelay);
  }

  // Corta la secuencia automática. Si había una frase visible en ese
  // momento, la deja terminar su ciclo normal (formada, o
  // disolviéndose) — solo evita que aparezca la siguiente. Para cortar
  // también la frase visible de inmediato, combínalo con hide().
  function stopAutoSequence() {
    autoActive = false;
    autoState = "idle";
  }

  function isAutoActive() {
    return autoActive;
  }

  // Lógica de la secuencia automática, separada de update() para que
  // sea fácil de leer: solo decide CUÁNDO llamar a show() con la
  // siguiente frase de la lista. Toda la animación real (fases,
  // congelado en HOLD, disolución) la sigue llevando el propio
  // update() de siempre, exactamente igual que en modo manual.
  function updateAutoSequence(delta) {
    if (!autoActive) return;

    if (autoState === "waiting" || autoState === "gap") {
      autoTimer -= delta;
      if (autoTimer > 0) return;

      if (autoIndex >= autoWords.length) {
        // Se acabó la lista: la secuencia termina sola, sin repetirse.
        autoActive = false;
        autoState = "idle";
        // La última frase ya se disolvió del todo (estamos aquí porque
        // el bloque "showing && !active" de más abajo ya pasó a "gap" en
        // su momento, y ese "gap" es justo el que acaba de agotarse) —
        // este es el instante exacto en el que "ya no queda ninguna
        // frase más", ver comentario junto a `listeners` más arriba.
        emit("sequence-completed");
        return;
      }

      show(autoWords[autoIndex]);
      autoIndex++;
      autoState = "showing";
      return;
    }

    if (autoState === "showing" && !active) {
      // La frase actual ya ha terminado de disolverse del todo
      // (update() puso active=false al acabar DISSOLVE). Empieza la
      // pausa antes de la siguiente.
      autoState = "gap";
      autoTimer = Math.max(0, cfg.autoSequence.gapBetweenPhrases);
    }
  }

  // -----------------------------------------------------------------------
  // freezeAtTargets(): "foto fija" de la palabra ya formada. Se llama
  // UNA sola vez, exactamente al entrar en HOLD (ver update()). Fuerza
  // cada partícula a su posición de letra exacta (sin el residuo de
  // jitter/curl que pudiera quedar del último frame de READING), la
  // deja en su color más claro/legible (readableColor, ver arriba) y
  // con el tamaño reforzado de HOLD (cfg.hold.sizeBoost) — máxima
  // legibilidad sin recurrir a blanco puro ni a más brillo del ya
  // existente en la paleta. A partir de aquí, update() no vuelve a
  // tocar estos arrays mientras dure HOLD — así la palabra se lee sin
  // ningún movimiento, tal como pide el encargo.
  // -----------------------------------------------------------------------
  function freezeAtTargets() {
    for (let i = 0; i < activeCount; i++) {
      const s = state[i];
      positions[i * 3] = s.target.x;
      positions[i * 3 + 1] = s.target.y;
      positions[i * 3 + 2] = s.target.z;

      particleColors[i * 3] = readableColor.r;
      particleColors[i * 3 + 1] = readableColor.g;
      particleColors[i * 3 + 2] = readableColor.b;

      sizes[i] = s.size * cfg.hold.sizeBoost;
      alphas[i] = 1;
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.particleColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
    geometry.attributes.alpha.needsUpdate = true;
  }

  function update(delta) {
    // Igual que embers/partículas de fondo: se mantiene en sincronía
    // con el tamaño real de pantalla en cada frame, no con un listener
    // de resize aparte (mismo criterio que flame.js/particlesBackground.js).
    material.uniforms.pixelHeight.value = window.innerHeight;

    // Se comprueba SIEMPRE, incluso mientras `active` es false (en
    // "waiting"/"gap" no hay ninguna palabra visible todavía) — es la
    // única forma de que la secuencia automática pueda arrancar la
    // siguiente frase por sí sola.
    updateAutoSequence(delta);

    if (!active) return;
    elapsedTotal += delta;
    phaseElapsed += delta;
    cycleElapsed += delta;

    const t = cfg.timing;
    if (phase === "birth" && phaseElapsed >= t.birth) {
      phase = "rise";
      phaseElapsed = 0;
    } else if (phase === "rise" && phaseElapsed >= t.rise) {
      phase = "formation";
      phaseElapsed = 0;
    } else if (phase === "formation" && phaseElapsed >= t.formation) {
      phase = "reading";
      phaseElapsed = 0;
    } else if (phase === "reading" && phaseElapsed >= t.reading) {
      phase = "hold";
      phaseElapsed = 0;
      // FASE 5 arranca: se congela la palabra en sus posiciones
      // exactas de letra (ver freezeAtTargets()) — a partir de aquí y
      // hasta DISSOLVE no se vuelve a tocar ni una posición.
      freezeAtTargets();
    } else if (phase === "hold" && phaseElapsed >= t.hold) {
      phase = "dissolve";
      phaseElapsed = 0;
    }

    if (phase === "hold") {
      // Completamente estática: ni drift, ni curl, ni jitter, ni
      // ningún recálculo de posición/color/tamaño/alpha — las
      // partículas se quedan exactamente donde las dejó
      // freezeAtTargets() hasta que empiece DISSOLVE. Ni siquiera se
      // marcan los atributos de geometría como "needsUpdate" (no ha
      // cambiado nada que subir a la GPU).
      return;
    }

    // right/up de cámara para el offset de curl (ver curlAmount): se
    // calcula una vez por frame, no por partícula.
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    for (let i = 0; i < activeCount; i++) {
      const s = state[i];
      let influence; // 0 = pura brasa (sin target), 1 = totalmente en su letra
      let alpha;
      let useReleaseDrift = false; // true en DISSOLVE: la brasa "sale" del target, no del spawn original

      if (phase === "birth") {
        // FASE 1: aparecen escalonadas junto a la llama, sin ninguna
        // influencia de letra todavía.
        const local = clamp01((phaseElapsed / t.birth - s.delay * 0.5) / 0.5);
        influence = 0;
        alpha = clamp01(local * 1.6);
      } else if (phase === "rise") {
        // FASE 2: siguen sin influencia de letra, solo ascienden y se
        // dispersan como brasas (ver computeDrift más abajo).
        influence = 0;
        alpha = 1;
      } else if (phase === "formation") {
        // FASE 3: empieza la convergencia. Arranque escalonado
        // (cfg.formation.stagger) para que primero se reconozcan
        // fragmentos sueltos de letra y solo después la palabra
        // completa — nunca aparece de golpe. easeOutBack añade un
        // pequeño "asentamiento" con overshoot en vez de frenar en seco.
        const spread = cfg.formation.stagger;
        const local = clamp01((phaseElapsed / t.formation - s.delay * spread) / (1 - spread));
        influence = easeOutBack(local) * cfg.formation.targetInfluenceCap;
        alpha = 1;
      } else if (phase === "reading") {
        // FASE 4 (READABLE): termina de tensar el último tramo hasta
        // legibilidad completa. Reparto de arranque más pequeño: para
        // entonces casi todas las partículas ya están cerca de su target.
        const spread = cfg.reading.stagger;
        const local = clamp01((phaseElapsed / t.reading - s.delay * spread) / (1 - spread));
        const eased = easeOutCubic(local);
        influence = cfg.formation.targetInfluenceCap + eased * (1 - cfg.formation.targetInfluenceCap);
        alpha = 1;
      } else {
        // FASE 6 (DISSOLVE): orden de salida distinto al de llegada
        // (usamos 1 - delay) para que la palabra no se deshaga en el
        // mismo orden exacto en que se formó. easeInCubic: arranca
        // despacio y acelera hacia fuera, como una brasa que se suelta.
        const spread = cfg.dissolve.stagger;
        const local = clamp01((phaseElapsed / t.dissolve - (1 - s.delay) * spread) / (1 - spread));
        const eased = easeInCubic(local);
        influence = 1 - eased;
        alpha = 1 - clamp01(local * 1.3);
        useReleaseDrift = true;
      }

      const influenceClamped = clamp01(influence);

      // ---- Comportamiento de brasa (deriva orgánica) ----
      // Se usa ponderado por (1 - influence): en BIRTH/RISE domina por
      // completo (influence=0); en el tramo de transición de
      // FORMATION/READING/DISSOLVE se va desvaneciendo o apareciendo
      // según corresponda. (En HOLD, influence ya vale 1 y esta parte
      // del código ni se ejecuta — ver freezeAtTargets()/el `return`
      // temprano de arriba.)
      const drift = useReleaseDrift
        ? computeDrift(
            s.target,
            phaseElapsed,
            t.dissolve,
            cfg.dissolve.scatter,
            cfg.dissolve.riseHeight,
            s,
            elapsedTotal
          )
        : computeDrift(
            s.spawnBase,
            cycleElapsed,
            t.birth + t.rise,
            // driftLateralBias (ver cfg.flameOrigin.lateralBiasRange):
            // algunas partículas se apartan bastante más hacia el lado
            // que otras nada más nacer, en vez de que todas tengan
            // exactamente la misma dispersión.
            cfg.birthScatter * s.driftLateralBias,
            cfg.riseHeight,
            s,
            elapsedTotal
          );

      // ---- Arco/curvatura de convergencia (ver formation.curlAmount) ----
      // bell(influence): 0 en los extremos (influence=0 o 1), máximo a
      // mitad de camino — así el trayecto se curva y vuelve a
      // enderezarse, en vez de ser una recta o un salto.
      const bell = Math.sin(Math.PI * influenceClamped);
      const curlScale = bell * cfg.formation.curlAmount;
      const curlWorldX = right.x * s.curl.x * curlScale + up.x * s.curl.y * curlScale;
      const curlWorldY = right.y * s.curl.x * curlScale + up.y * s.curl.y * curlScale;
      const curlWorldZ = right.z * s.curl.x * curlScale + up.z * s.curl.y * curlScale;

      // Turbulencia fina: más fuerte cuanto menos asentada está la
      // partícula, y un temblor mínimo incluso ya formada
      // (cfg.readingJitter + cfg.residualScatter), para que nunca se
      // vea perfectamente congelada / tipográfica.
      const chaos = (1 - influenceClamped) * 0.05 + cfg.residualScatter;
      const jitter =
        Math.sin(elapsedTotal * cfg.readingJitter.speed + s.seedA) * 0.6 +
        Math.sin(elapsedTotal * cfg.readingJitter.speed * 1.9 + s.seedB) * 0.4;

      const px =
        drift.x * (1 - influenceClamped) +
        s.target.x * influenceClamped +
        curlWorldX +
        jitter * (cfg.readingJitter.amplitude + chaos);
      const py =
        drift.y * (1 - influenceClamped) +
        s.target.y * influenceClamped +
        curlWorldY +
        Math.cos(elapsedTotal * cfg.readingJitter.speed * 1.3 + s.seedB) * (cfg.readingJitter.amplitude + chaos);
      const pz =
        drift.z * (1 - influenceClamped) +
        s.target.z * influenceClamped +
        curlWorldZ +
        jitter * chaos * 0.5;

      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;

      // Color: se aclara hacia `readableColor` según avanza `influence`
      // (0 = color de brasa tal cual, 1 = totalmente aclarado) — así la
      // palabra gana contraste JUSTO al mismo ritmo que se organiza,
      // reforzando visualmente "se está formando" con "se está
      // aclarando para poder leerse". En HOLD, influence siempre vale 1
      // aquí (aunque en la práctica esta rama ni se ejecuta en HOLD, ver
      // el `return` de más arriba / freezeAtTargets()).
      particleColors[i * 3] = s.color.r + (readableColor.r - s.color.r) * influenceClamped;
      particleColors[i * 3 + 1] = s.color.g + (readableColor.g - s.color.g) * influenceClamped;
      particleColors[i * 3 + 2] = s.color.b + (readableColor.b - s.color.b) * influenceClamped;

      sizes[i] = s.size * (0.7 + 0.3 * influenceClamped);
      alphas[i] = clamp01(alpha);
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.particleColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
    geometry.attributes.alpha.needsUpdate = true;

    if (phase === "dissolve" && phaseElapsed >= t.dissolve) {
      active = false;
      phase = "idle";
      points.visible = false;
    }
  }

  onUpdate(update);

  return {
    show,
    hide,
    isActive,
    startAutoSequence,
    stopAutoSequence,
    isAutoActive,
    // on/off: ver el bloque de comentarios "EVENTOS" más arriba. Añadido
    // puramente aditivo — nada de lo anterior en este objeto cambia de
    // comportamiento.
    on,
    off,
  };
}

// -----------------------------------------------------------------------
// Muestrea la silueta de una palabra dibujándola en un canvas 2D oculto
// (nunca se añade al DOM, nunca se muestra) y devuelve un array de
// puntos {x, y} en unidades de mundo, centrados en (0,0), con la altura
// total de la palabra ya escalada a cfg.wordSize.height. El ancho sale
// de forma natural de la propia tipografía (no se fuerza a
// cfg.wordSize.width, que queda documentado como referencia pero no se
// impone a costa de deformar las letras).
// -----------------------------------------------------------------------
function sampleWordPoints(word, cfg) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const fontCfg = cfg.font;
  const fontSizePx = Math.round(fontCfg.sampleCanvasHeight * 0.72);

  ctx.font = `${fontCfg.weight} ${fontSizePx}px ${fontCfg.family}`;
  const measuredWidth = Math.ceil(ctx.measureText(word).width);

  canvas.width = Math.max(8, measuredWidth + fontSizePx * 0.6);
  canvas.height = fontCfg.sampleCanvasHeight;

  // Redimensionar el canvas resetea el contexto: hay que reaplicar font.
  ctx.font = `${fontCfg.weight} ${fontSizePx}px ${fontCfg.family}`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(word, canvas.width / 2, canvas.height / 2);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Frases más largas que "mira" salen más anchas del canvas de forma
  // natural (no se fuerza el ancho tipográfico, ver comentario de
  // wordSize más abajo). Si el resultado excede
  // wordSize.width * maxWidthScale, se reduce la escala completa
  // (alto Y ancho igual, sin deformar letras) para que quepa cerca de
  // la llama — mismo cálculo para cualquier texto, ninguna coordenada
  // especial por frase.
  const naturalWidthAtTargetScale = canvas.width * (cfg.wordSize.height / canvas.height);
  const maxAllowedWidth = cfg.wordSize.width * cfg.wordSize.maxWidthScale;
  const widthCorrection =
    naturalWidthAtTargetScale > maxAllowedWidth ? maxAllowedWidth / naturalWidthAtTargetScale : 1;
  const candidates = [];
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const alpha = data[(y * canvas.width + x) * 4 + 3];
      if (alpha > fontCfg.alphaThreshold) candidates.push({ x, y });
    }
  }

  // Baraja (Fisher-Yates) para que, si hay que repetir candidatos por
  // tener más partículas que píxeles útiles, la repetición no siga
  // ningún orden reconocible (barrido de arriba a abajo, etc).
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const scale = (cfg.wordSize.height / canvas.height) * widthCorrection;

  // Densidad adaptativa (ver cfg.particleDensity): cuántas partículas
  // hacen falta para ESTA frase en concreto, a partir del nº real de
  // píxeles candidatos de su silueta (candidates.length) — no de su
  // longitud en caracteres. Frases cortas usan pocas, frases largas
  // escalan proporcionalmente, con un suelo y un techo por legibilidad
  // y rendimiento respectivamente.
  const density = cfg.particleDensity;
  const desiredCount = Math.round(candidates.length / density.pixelsPerParticle);
  const count = Math.min(density.max, Math.max(density.min, desiredCount));

  const selected =
    candidates.length > 0
      ? selectEvenly(candidates, count)
      : new Array(count).fill({ x: canvas.width / 2, y: canvas.height / 2 });
  const points = selected.map((c) => ({
    x: (c.x - canvas.width / 2) * scale,
    y: -(c.y - canvas.height / 2) * scale, // canvas Y crece hacia abajo, mundo hacia arriba
  }));
  return points;
}

// -----------------------------------------------------------------------
// ITERACIÓN v0.1: reparto UNIFORME de partículas sobre la silueta, en
// vez de una elección puramente al azar entre los píxeles candidatos.
//
// El problema real de la primera versión no era (solo) el tamaño de
// partícula: con selección aleatoria pura, es estadísticamente
// probable que varias partículas caigan muy juntas por casualidad en
// una zona y dejen huecos grandes en otra — sobre todo en trazos finos
// como la "i" o la "r", que tienen pocos píxeles candidatos frente al
// cuerpo de la "m". Verificado reproduciendo el muestreo real fuera
// del navegador: con el mismo nº de partículas objetivo, la versión
// aleatoria se leía peor que esta, incluso con partículas más pequeñas.
//
// La idea: se divide el área ocupada por la palabra en una rejilla
// cuyo tamaño de celda se calcula para que haya, en promedio, una
// partícula por celda — así cada partícula "cubre" su propia zona de
// la letra en vez de competir por las mismas zonas densas. Si hacen
// falta más partículas que celdas ocupadas, las adicionales se reparten
// dando prioridad a las celdas con más píxeles candidatos (el cuerpo
// de los trazos, no el aire entre ellos).
// -----------------------------------------------------------------------
function selectEvenly(candidates, targetCount) {
  if (candidates.length === 0) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
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
  // Baraja el ORDEN de las celdas (no los píxeles dentro de cada una)
  // para que, si se necesitan partículas extra más allá de una por
  // celda, no se asignen siempre a las mismas primero.
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const selected = [];
  for (const cell of cells) {
    selected.push(cell[Math.floor(Math.random() * cell.length)]);
    if (selected.length >= targetCount) return selected;
  }

  // Sobran partículas por asignar (más partículas que celdas
  // ocupadas): se reparten en las celdas con más candidatos —el cuerpo
  // más grueso de los trazos— en vez de al azar total.
  const byDensity = [...cells].sort((a, b) => b.length - a.length);
  let idx = 0;
  while (selected.length < targetCount && byDensity.length > 0) {
    const cell = byDensity[idx % byDensity.length];
    selected.push(cell[Math.floor(Math.random() * cell.length)]);
    idx++;
  }
  return selected;
}

// Textura de brillo suave (círculo con caída radial), mismo criterio
// visual que createSoftCircleTexture() en flame.js — pero generada aquí
// de forma propia porque esa función no está exportada (flame.js no se
// toca ni siquiera para exportar algo).
function createSoftGlowTexture(size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
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

// Easing con ligero "overshoot" (se pasa un poco de 1 y vuelve) para
// que el asentamiento de cada partícula se sienta como que se posa,
// no como que se pega en seco a su destino. Usado en FORMATION.
function easeOutBack(t) {
  const c1 = 1.4;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// Arranca rápido y frena suave. Usado en READING (FASE 4) para el
// último tramo de tensado hasta legibilidad: transición suave, sin el
// overshoot de easeOutBack (aquí ya no queremos que se "pase" del
// target, solo que llegue con delicadeza).
function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

// Arranca despacio y acelera. Usado en DISSOLVE: la partícula tarda un
// poco en "soltarse" de su letra y luego se aleja cada vez más rápido,
// como una brasa real despegándose.
function easeInCubic(t) {
  const x = clamp01(t);
  return x * x * x;
}

// -----------------------------------------------------------------------
// sampleFlameOriginPoint: punto aleatorio dentro/alrededor del volumen
// REAL de la llama (ver cfg.flameOrigin), no un disco plano genérico
// encima de la vela. El radio se ensancha desde la base hasta el
// "bulge" (el punto más ancho) y luego se estrecha otra vez hacia la
// punta, imitando la silueta real en forma de lágrima de la llama
// (misma referencia que usa flame.js: shape.baseWidth/bodyWidth/
// bulgeHeight, ver flame.config.js) — así cada partícula nace de un
// punto distinto de la superficie de la llama, en vez de todas
// aparecer ya organizadas en el mismo sitio.
//
// offsetY/offsetX/offsetZ son relativos a `flameOrigin` (el punto de
// anclaje ya calculado a partir de la mecha real, ver onWickReady más
// arriba) — usa los ejes del MUNDO (X/Z), no el plano de la cámara,
// porque la llama es (aproximadamente) simétrica alrededor de su eje
// vertical, no de cara a la cámara.
// -----------------------------------------------------------------------
function sampleFlameOriginPoint(cfg) {
  const o = cfg.flameOrigin;
  const t = Math.random(); // 0 = base real de la llama, 1 = tope del volumen de nacimiento
  const bulgeT = o.bulgeT;

  const maxRadius =
    t <= bulgeT
      ? o.radiusAtBase + (o.radiusAtBulge - o.radiusAtBase) * (t / bulgeT)
      : o.radiusAtBulge + (o.radiusAtTop - o.radiusAtBulge) * ((t - bulgeT) / (1 - bulgeT));

  const angle = Math.random() * Math.PI * 2;
  // sqrt(random) reparte los puntos de forma uniforme por ÁREA del
  // disco a esa altura, en vez de amontonarlos hacia el eje central.
  const radius = Math.sqrt(Math.random()) * maxRadius;

  return {
    offsetX: Math.cos(angle) * radius,
    offsetY: o.heightRange[0] + t * (o.heightRange[1] - o.heightRange[0]),
    offsetZ: Math.sin(angle) * radius,
  };
}

// -----------------------------------------------------------------------
// computeDrift: comportamiento de brasa PURA (sin ninguna influencia
// de letra), usado tanto para la llegada (BIRTH/RISE, origin=spawnBase,
// age=cycleElapsed) como para la salida (DISSOLVE, origin=target,
// age=phaseElapsed dentro de esa fase — "se suelta" de donde estaba la
// letra, no de donde nació la partícula originalmente).
//
// El crecimiento de la dispersión/ascenso está ACOTADO por ageCap (se
// alcanza el máximo y se queda ahí, no sigue creciendo sin límite) —
// así una fase larga (p.ej. HOLD) nunca hace que una partícula salga
// disparada lejos de la escena. Se combinan varias ondas senoidales
// con semillas por partícula (seedA/seedB) para que el vaivén lateral
// no se sienta idéntico entre partículas.
// -----------------------------------------------------------------------
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
