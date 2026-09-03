import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// INTRO PARTICLES: capa decorativa de puntos de luz de colores para la
// pantalla de entrada. Cada cierto tiempo aleatorio, un grupo de las
// partículas que YA están flotando se ve atraído hacia una posición
// común y forma brevemente la silueta de un corazón, para luego
// dispersarse y volver a su movimiento ambiental normal.
//
// Deliberadamente NO usa Three.js: la escena 3D (particlesBackground.js
// incluido) no existe todavía mientras la intro está en pantalla — ver
// main.js, `initScene()` se retrasa hasta `onCompositionSettled()` para
// que nada de Three.js compita con las animaciones CSS de la intro. Un
// `<canvas>` 2D normal, con un puñado de partículas y sin WebGL, es la
// forma más ligera de añadir esta capa sin reabrir ese problema de
// rendimiento. Es un sistema completamente independiente, sin relación
// con particlesBackground.js (ese vive dentro de la escena 3D, con
// Three.js, y no se puede reutilizar aquí).
//
// TODO el movimiento (ambiental y del corazón) se resuelve con física
// de verdad — posición + velocidad + fuerzas + amortiguación — nunca
// con una asignación directa de posición (`p.x = targetX`).
//
// Esta versión corrige tres problemas diagnosticados numéricamente en
// la iteración anterior (ver PROJECT_STATE.md para las simulaciones):
//   1. Glow: cada partícula tiene ahora un único CanvasGradient radial
//      real (núcleo casi sólido → fundido continuo → transparente),
//      no dos arcos planos. Se crea una vez por partícula y se
//      reutiliza cada frame trasladando/escalando el contexto.
//   2. Movimiento ambiental: modelo de "velocidad objetivo suavizada"
//      en vez de ruido acumulado contra un damping fuerte (que apenas
//      producía ~0.3px de desplazamiento en 3s pese al maxSpeed).
//   3. Corazón: los puntos de la silueta se muestrean por LONGITUD DE
//      ARCO (no por t equiespaciado, que agrupaba puntos de forma
//      desigual), y cada partícula se asigna a su punto más cercano
//      disponible (no al azar), dando recorridos más cortos y
//      creíbles. La dispersión final usa un impulso y un damping
//      retuneados para un desplazamiento real de ~80-115px, no solo
//      unas decenas de píxeles.
//
// API pública que devuelve createIntroParticles():
//   - destroy() → detiene el bucle de animación (cancela el
//     requestAnimationFrame en curso y cualquier temporizador de
//     corazón pendiente), quita los listeners y elimina el <canvas>
//     del DOM. Pensado para llamarse una vez cuando la intro
//     desaparece del todo (fadeOutAndDestroy), para no dejar ningún
//     bucle corriendo de fondo ni fugas de memoria.
// -----------------------------------------------------------------------

export function createIntroParticles(root, options = {}) {
  const cfg = CONFIG.introParticles;
  const protectedSelectors = options.protectedSelectors ?? [".intro-question", ".intro-content"];
  const protectedEls = protectedSelectors
    .map((selector) => root.querySelector(selector))
    .filter(Boolean);

  const canvas = document.createElement("canvas");
  canvas.className = "intro-particles";
  // Pinta ANTES que el marco/pregunta/composición (que se añaden
  // después, ver intro.js): al no tener z-index explícito ninguno de
  // esos elementos, el orden del DOM decide el orden de pintado, así
  // que insertarlo como primer hijo lo deja siempre detrás del texto,
  // nunca tapándolo.
  root.insertBefore(canvas, root.firstChild);

  const ctx = canvas.getContext("2d");
  let dpr = Math.min(window.devicePixelRatio || 1, 2); // 2 de tope: de sobra para partículas pequeñas, sin gastar más de la cuenta

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  function isMobileViewport() {
    return window.innerWidth < cfg.mobileBreakpoint;
  }

  // ---- Efecto de luz: gradiente radial real, cacheado por partícula ----
  // Un único CanvasGradient por partícula, definido en espacio LOCAL
  // (centrado en 0,0, radio = glowRadius). Un CanvasGradient es un
  // objeto independiente del estado del canvas: sigue siendo válido
  // aunque se redimensione el canvas (resize()) o cambie el resto del
  // contexto, así que se crea una única vez y se reutiliza siempre —
  // nunca se reconstruye por frame. Para dibujarlo en la posición real
  // de la partícula, el contexto se traslada (y se escala durante el
  // "boost" del corazón) antes de rellenar un arco centrado en el
  // origen con este gradiente.
  function makeGlowGradient(hue, saturation, lightness, glowRadius) {
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    const hotL = Math.min(96, lightness + cfg.glow.coreLightnessBoost);
    const hotS = Math.max(0, saturation - cfg.glow.coreSaturationDrop);
    gradient.addColorStop(0, `hsla(${hue}, ${hotS}%, ${hotL}%, ${cfg.glow.hotStopAlpha})`);
    gradient.addColorStop(
      cfg.glow.hotStopPosition,
      `hsla(${hue}, ${hotS}%, ${hotL}%, ${cfg.glow.hotStopAlpha})`
    );
    gradient.addColorStop(
      cfg.glow.midStopPosition,
      `hsla(${hue}, ${saturation}%, ${lightness}%, ${cfg.glow.midStopAlpha})`
    );
    gradient.addColorStop(1, `hsla(${hue}, ${saturation}%, ${lightness}%, 0)`);
    return gradient;
  }

  // ---- Creación de partículas ----
  let deviceCfg = isMobileViewport() ? cfg.mobile : cfg.desktop;
  let particles = createParticles(deviceCfg.count);

  function createParticles(count) {
    const list = [];
    for (let i = 0; i < count; i++) list.push(makeParticle());
    return list;
  }

  function makeParticle() {
    const hue = Math.random() * 360;
    const saturation = randRange(cfg.color.saturation[0], cfg.color.saturation[1]);
    const lightness = randRange(cfg.color.lightness[0], cfg.color.lightness[1]);
    const glowRadius = randRange(cfg.glow.radius[0], cfg.glow.radius[1]);

    return {
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: 0,
      vy: 0,
      glowRadius,
      glowGradient: makeGlowGradient(hue, saturation, lightness, glowRadius),
      brightness: randRange(cfg.glow.brightnessRange[0], cfg.glow.brightnessRange[1]),
      twinklePeriod: randRange(cfg.twinkle.periodRange[0], cfg.twinkle.periodRange[1]),
      twinklePhase: Math.random() * Math.PI * 2,
      // ---- Movimiento ambiental: velocidad objetivo suavizada ----
      // Ver updateWander() más abajo. Se inicializa ya con un primer
      // objetivo para que la partícula empiece a moverse desde el
      // primer frame, nunca quieta.
      wander: {
        targetVx: 0,
        targetVy: 0,
        nextChangeAt: 0,
        tau: randRange(cfg.motion.smoothingTauRange[0], cfg.motion.smoothingTauRange[1]),
      },
      // Estado del evento del corazón (ver más abajo). "wander" es el
      // movimiento ambiental normal, activo desde el primer frame para
      // TODAS las partículas — nunca hay ninguna quieta "esperando" a
      // ser elegida.
      heart: {
        mode: "wander",
        targetX: 0,
        targetY: 0,
        phaseStart: 0,
        pauseDuration: 0,
        boost: 0,
      },
    };
  }

  // ---- Movimiento ambiental: velocidad objetivo suavizada ----
  // Cada partícula "aspira" a una velocidad objetivo (ángulo y rapidez
  // aleatorios) que cambia cada pocos segundos; la velocidad real se
  // acerca a ese objetivo con un suavizado exponencial (nunca un salto
  // ni una asignación directa). Verificado por simulación: ~25-35px de
  // desplazamiento real en 3s, con una curva continua — no un temblor
  // en el sitio ni un movimiento imperceptible.
  function updateWander(p, dt, now) {
    if (now >= p.wander.nextChangeAt) pickWanderTarget(p, now);

    const smoothing = 1 - Math.exp(-dt / p.wander.tau);
    p.vx += (p.wander.targetVx - p.vx) * smoothing;
    p.vy += (p.wander.targetVy - p.vy) * smoothing;

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    wrapEdges(p);
  }

  function pickWanderTarget(p, now) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randRange(cfg.motion.speedRange[0], cfg.motion.speedRange[1]);
    p.wander.targetVx = Math.cos(angle) * speed;
    p.wander.targetVy = Math.sin(angle) * speed;
    p.wander.nextChangeAt =
      now + randRange(cfg.motion.directionChangeRange[0], cfg.motion.directionChangeRange[1]);
  }

  function clampSpeed(p, maxSpeed) {
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      p.vx *= scale;
      p.vy *= scale;
    }
  }

  // Envuelve por los bordes (con un pequeño margen) en vez de rebotar:
  // así nunca desaparecen "chocando" contra un límite visible.
  function wrapEdges(p) {
    const pad = 20;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (p.x < -pad) p.x = w + pad;
    else if (p.x > w + pad) p.x = -pad;
    if (p.y < -pad) p.y = h + pad;
    else if (p.y > h + pad) p.y = -pad;
  }

  // ---- Física de "steering" hacia un punto (muelle + amortiguación) ----
  // aceleración = rigidez·(objetivo − posición) − amortiguación·velocidad
  // Es un muelle amortiguado clásico: tira más fuerte cuanto más lejos
  // está el objetivo y frena según la propia velocidad, así converge de
  // forma natural sin necesitar nunca asignar la posición directamente
  // ni moverse en línea recta. `pullScale` (0-1) permite que la fuerza
  // se aplique progresivamente en vez de saltar de golpe a su valor
  // final.
  function applySpringSteering(p, targetX, targetY, stiffness, damping, maxSpeed, pullScale, dt) {
    const dx = targetX - p.x;
    const dy = targetY - p.y;
    const ax = stiffness * pullScale * dx - damping * p.vx;
    const ay = stiffness * pullScale * dy - damping * p.vy;
    p.vx += ax * dt;
    p.vy += ay * dt;
    clampSpeed(p, maxSpeed);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return Math.hypot(dx, dy);
  }

  // ---- Evento especial: el corazón ----
  const heartState = {
    active: false,
    phase: "idle", // "forming" | "holding" | "dispersing"
    chosen: [],
    allArrivedAt: null,
    holdDuration: 0,
  };
  let heartTimeoutId = null;

  function scheduleNextHeart(isFirst) {
    const [minMs, maxMs] = isFirst
      ? cfg.heartTiming.firstDelayRange
      : cfg.heartTiming.intervalRange;
    const delay = randRange(minMs, maxMs);
    heartTimeoutId = window.setTimeout(startHeart, delay);
  }
  scheduleNextHeart(true);

  // Margen de seguridad alrededor de la composición central, relativo
  // al ancho del viewport (más cuidadoso en pantallas pequeñas) y
  // acotado entre marginMin/marginMax.
  function getProtectedMargin() {
    const relative = window.innerWidth * cfg.protectedZone.viewportFraction;
    return Math.max(cfg.protectedZone.marginMin, Math.min(cfg.protectedZone.marginMax, relative));
  }

  // Rectángulo (en coordenadas de viewport) que envuelve toda la
  // composición central protegida — se recalcula en cada corazón nuevo
  // a partir del layout real (getBoundingClientRect), así siempre
  // encaja con el tamaño de pantalla y la fase de la intro actuales.
  function getProtectedRect() {
    const margin = getProtectedMargin();
    const rects = protectedEls
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);

    if (rects.length === 0) return null;

    const left = Math.min(...rects.map((r) => r.left)) - margin;
    const top = Math.min(...rects.map((r) => r.top)) - margin;
    const right = Math.max(...rects.map((r) => r.right)) + margin;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + margin;
    return { left, top, right, bottom };
  }

  function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // Busca un centro válido para el corazón: aleatorio dentro del
  // viewport, evitando por completo el rectángulo protegido (con
  // reintentos). Si no encuentra hueco en unos pocos intentos (viewport
  // muy pequeño), recurre a colocarlo pegado arriba del todo, que casi
  // siempre queda libre.
  function pickHeartCenter(halfWidth, halfHeight) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const edgeMargin = 14;
    const protectedRect = getProtectedRect();

    for (let attempt = 0; attempt < 24; attempt++) {
      const x = randRange(
        edgeMargin + halfWidth,
        Math.max(edgeMargin + halfWidth, w - edgeMargin - halfWidth)
      );
      const y = randRange(
        edgeMargin + halfHeight,
        Math.max(edgeMargin + halfHeight, h - edgeMargin - halfHeight)
      );

      if (!protectedRect) return { x, y };

      const heartRect = {
        left: x - halfWidth,
        right: x + halfWidth,
        top: y - halfHeight,
        bottom: y + halfHeight,
      };
      if (!rectsOverlap(heartRect, protectedRect)) return { x, y };
    }

    // Fallback: pegado arriba del todo, centrado horizontalmente.
    const fallbackY = protectedRect
      ? Math.max(edgeMargin + halfHeight, protectedRect.top - halfHeight - edgeMargin)
      : edgeMargin + halfHeight;
    return { x: w / 2, y: fallbackY };
  }

  // Puntos de la silueta del corazón mediante la curva paramétrica
  // clásica (x = 16sin³t, y = 13cos t − 5cos 2t − 2cos 3t − cos 4t),
  // muestreados de forma SIMÉTRICA Y ANCLADA en vez de recorrer toda
  // la curva de un tirón:
  //   1. Se recorre solo la MITAD DERECHA (t: 0 → π), que va del hueco
  //      central superior (t=0, x=0) al lóbulo derecho, baja por el
  //      lateral derecho y termina en la punta inferior (t=π, x=0) —
  //      by construcción, esos dos puntos ancla (notch central y
  //      punta) siempre están incluidos.
  //   2. Esa mitad se muestrea por LONGITUD DE ARCO (400 pasos finos,
  //      posiciones equiespaciadas por distancia real recorrida, no
  //      por t) para que lóbulo y lateral queden bien cubiertos sin
  //      huecos ni amontonamientos.
  //   3. Se refleja (x → −x) para obtener la mitad izquierda completa
  //      (notch, lóbulo izquierdo, lateral izquierdo), sin duplicar
  //      los dos puntos ancla (que están sobre el eje de simetría).
  // Con pocas partículas, un muestreo de la curva completa de un
  // tirón podía dejar un hueco justo junto a la punta (verificado por
  // simulación: para 13 puntos, un segmento de 7px entre vecinos de
  // contorno frente a ~15px del resto) — anclar y reflejar por mitades
  // elimina esa irregularidad en cualquier recuento: verificado con
  // 8-22 puntos, la desviación de la separación entre vecinos de
  // contorno se queda entre el 0.6% y el 4.6% de la media (antes hasta
  // ~15-20% en según qué recuento). El total resultante es siempre par
  // (2 puntos ancla + parejas simétricas); si `count` es impar se
  // entrega uno más de lo pedido — el resto del sistema ya lo asume
  // (`assignParticlesToPoints` usa `points.length`, no `count`). El
  // signo de Y se invierte porque en canvas el eje Y crece hacia
  // abajo (si no, la silueta saldría boca abajo).
  function heartPoints(count, centerX, centerY, scale) {
    const SAMPLES = 220;
    const raw = new Array(SAMPLES + 1);
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * Math.PI; // solo la mitad derecha: notch → lóbulo → lateral → punta
      const hx = 16 * Math.pow(Math.sin(t), 3);
      const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      raw[i] = { x: hx, y: hy };
    }

    const cumLen = new Array(raw.length).fill(0);
    for (let i = 1; i < raw.length; i++) {
      const dx = raw[i].x - raw[i - 1].x;
      const dy = raw[i].y - raw[i - 1].y;
      cumLen[i] = cumLen[i - 1] + Math.hypot(dx, dy);
    }
    const totalLen = cumLen[cumLen.length - 1];

    const halfCount = Math.max(2, Math.round(count / 2) + 1);
    const half = new Array(halfCount);
    for (let i = 0; i < halfCount; i++) {
      const targetLen = (i / (halfCount - 1)) * totalLen;
      let idx = 1;
      while (idx < cumLen.length && cumLen[idx] < targetLen) idx++;
      idx = Math.min(idx, cumLen.length - 1);
      const segStart = cumLen[idx - 1];
      const segEnd = cumLen[idx];
      const segT = segEnd > segStart ? (targetLen - segStart) / (segEnd - segStart) : 0;
      const px = raw[idx - 1].x + (raw[idx].x - raw[idx - 1].x) * segT;
      const py = raw[idx - 1].y + (raw[idx].y - raw[idx - 1].y) * segT;
      half[i] = { x: px, y: py };
    }

    // Mitad derecha tal cual (incluye los dos anclas: notch y punta).
    const points = half.map(({ x, y }) => ({
      x: centerX + (x / 16) * scale,
      y: centerY - (y / 16) * scale,
    }));
    // Mitad izquierda: reflejo, excluyendo los dos anclas (índices 0 y
    // halfCount-1) para no duplicarlos.
    for (let i = half.length - 2; i >= 1; i--) {
      const { x, y } = half[i];
      points.push({
        x: centerX - (x / 16) * scale,
        y: centerY - (y / 16) * scale,
      });
    }
    return points;
  }

  // Asigna cada partícula disponible a su punto del corazón más
  // cercano (greedy: recorre los puntos en orden aleatorio y, para
  // cada uno, elige la partícula libre más próxima), en vez de una
  // asignación al azar. Con la asignación al azar, una partícula podía
  // tocarle un punto al otro lado de la pantalla mientras una partícula
  // vecina de ese punto quedaba libre — recorridos innecesariamente
  // largos y cruzados, y una sensación de "convergencia agresiva" en
  // vez de una atracción natural. Con proximidad real, cada partícula
  // recorre (en general) la distancia más corta disponible, y la
  // trayectoria de cada una depende de verdad de su posición inicial.
  function assignParticlesToPoints(available, points) {
    const remaining = available.slice();
    const pointOrder = shuffleInPlace(points.map((_, i) => i));
    const assignments = [];

    for (const pointIndex of pointOrder) {
      const target = points[pointIndex];
      let bestIdx = -1;
      let bestDistSq = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const p = remaining[i];
        const dx = p.x - target.x;
        const dy = p.y - target.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break; // no debería faltar partícula, pero por robustez
      assignments.push({ particle: remaining[bestIdx], target });
      remaining.splice(bestIdx, 1);
    }
    return assignments;
  }

  function startHeart() {
    const deviceHeartCfg = deviceCfg.heart;
    const particleCount = Math.round(
      randRange(deviceHeartCfg.minParticles, deviceHeartCfg.maxParticles)
    );
    const scale = randRange(deviceHeartCfg.minScale, deviceHeartCfg.maxScale);
    // Bounding box aproximado de la curva ya escalada: X ∈ [-scale,
    // scale], Y ∈ [-6/16·scale, 17/16·scale] antes de invertir el
    // signo — usamos un cuadrado generoso para simplificar la
    // comprobación de solape con la zona protegida.
    const halfWidth = scale * 1.05;
    const halfHeight = scale * 1.2;

    const center = pickHeartCenter(halfWidth, halfHeight);
    const points = heartPoints(particleCount, center.x, center.y, scale);

    const available = particles.filter((p) => p.heart.mode === "wander");
    const assignments = assignParticlesToPoints(available, points);
    if (assignments.length === 0) {
      // Rarísimo (todas las partículas estarían participando ya en otro
      // corazón, algo que no debería pasar con como mucho un corazón
      // activo a la vez), pero por robustez simplemente se reintenta
      // más tarde en vez de dejar un corazón vacío.
      scheduleNextHeart(false);
      return;
    }

    const now = performance.now();
    const holdDuration = randRange(
      cfg.heartTiming.holdDurationRange[0],
      cfg.heartTiming.holdDurationRange[1]
    );

    const chosen = [];
    for (const { particle: p, target } of assignments) {
      p.heart.mode = "forming";
      p.heart.targetX = target.x;
      p.heart.targetY = target.y;
      p.heart.phaseStart = now;
      p.heart.pauseDuration = randRange(
        cfg.heartTiming.pauseDurationRange[0],
        cfg.heartTiming.pauseDurationRange[1]
      );
      p.heart.boost = 0;
      chosen.push(p);
    }

    heartState.active = true;
    heartState.phase = "forming";
    heartState.chosen = chosen;
    heartState.allArrivedAt = null;
    heartState.holdDuration = holdDuration;
  }

  // Aplica el impulso de dispersión: una fuerza radial hacia afuera del
  // punto del corazón, SUMADA a la velocidad que ya tuviera la
  // partícula (nunca la sustituye del todo) — conserva algo de la
  // inercia previa además del empujón. Impulso y damping verificados
  // por simulación para un desplazamiento real de ~80-115px (ver
  // cabecera del archivo y PROJECT_STATE.md).
  function applyDispersalImpulse(p) {
    let dx = p.x - p.heart.targetX;
    let dy = p.y - p.heart.targetY;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      const randomAngle = Math.random() * Math.PI * 2;
      dx = Math.cos(randomAngle);
      dy = Math.sin(randomAngle);
    }
    const dist = Math.hypot(dx, dy) || 1;
    const impulse = randRange(
      cfg.heartMotion.dispersalSpeedRange[0],
      cfg.heartMotion.dispersalSpeedRange[1]
    );
    p.vx += (dx / dist) * impulse;
    p.vy += (dy / dist) * impulse;
  }

  const heartMotionCfg = cfg.heartMotion;

  // Una partícula en "forming" viaja hacia su punto del corazón con un
  // muelle amortiguado cuya fuerza aumenta suavemente al principio
  // (formPullRampMs) — nunca aparece de golpe, y conserva su
  // velocidad/dirección ambiental del momento en que fue elegida. En
  // cuanto está lo bastante cerca (o pasa el tope de seguridad, por si
  // empezara muy lejos), pasa a "holding" y se avisa al grupo.
  function updateForming(p, dt, now) {
    const elapsed = now - p.heart.phaseStart;
    const rampT = Math.min(elapsed / heartMotionCfg.formPullRampMs, 1);
    const pullScale = rampT * rampT;

    const dist = applySpringSteering(
      p,
      p.heart.targetX,
      p.heart.targetY,
      heartMotionCfg.formStiffness,
      heartMotionCfg.formDampingCoefficient,
      heartMotionCfg.formMaxSpeed,
      pullScale,
      dt
    );

    p.heart.boost = Math.min(1, p.heart.boost + dt / 0.6);

    if (dist < heartMotionCfg.arrivalThreshold || elapsed > heartMotionCfg.maxFormDurationMs) {
      p.heart.mode = "holding";
      markArrived(p, now);
    }
  }

  // Ya en su sitio: un muelle más rígido y amortiguado la mantiene
  // firme en su posición del corazón (con una pizca de vida física en
  // vez de quedar clavada en un píxel exacto).
  function updateHolding(p, dt) {
    applySpringSteering(
      p,
      p.heart.targetX,
      p.heart.targetY,
      heartMotionCfg.holdStiffness,
      heartMotionCfg.holdDampingCoefficient,
      heartMotionCfg.holdMaxSpeed,
      1,
      dt
    );
    p.heart.boost = 1;
  }

  // Breve pausa quieta (sin nuevo impulso) justo antes de dispersarse:
  // el mismo muelle de "holding", más suave, para que no derive antes
  // del empujón.
  function updatePausing(p, dt, now) {
    applySpringSteering(
      p,
      p.heart.targetX,
      p.heart.targetY,
      heartMotionCfg.holdStiffness * 0.4,
      heartMotionCfg.holdDampingCoefficient,
      heartMotionCfg.holdMaxSpeed,
      1,
      dt
    );
    if (now - p.heart.phaseStart >= p.heart.pauseDuration) {
      applyDispersalImpulse(p);
      p.heart.mode = "dispersing";
      p.heart.phaseStart = now;
    }
  }

  // Dispersión: la velocidad del impulso decae cada frame (más deprisa
  // que el suavizado ambiental normal), así que se siente un "empujón"
  // real que se va apagando en vez de una parada en seco. En cuanto la
  // velocidad ha bajado lo suficiente (o pasa el tope de seguridad),
  // vuelve al paseo aleatorio normal — reengancha el modelo de
  // "velocidad objetivo" ambiental con un nuevo objetivo inmediato, en
  // vez de dejar que decaiga a cero antes de retomarlo.
  function updateDispersing(p, dt, now) {
    const dtRatio = dt / (1 / 60); // referencia a 60fps, para que el decaimiento no dependa del framerate real
    const frameDamping = Math.pow(heartMotionCfg.dispersalDampingPerFrame, dtRatio);
    p.vx *= frameDamping;
    p.vy *= frameDamping;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    wrapEdges(p);

    const elapsed = now - p.heart.phaseStart;
    p.heart.boost = Math.max(0, 1 - elapsed / heartMotionCfg.dispersalMaxDurationMs);

    const speed = Math.hypot(p.vx, p.vy);
    const exitSpeed = cfg.motion.maxSpeed * heartMotionCfg.dispersalExitSpeedMultiplier;
    if (speed <= exitSpeed || elapsed >= heartMotionCfg.dispersalMaxDurationMs) {
      p.heart.mode = "wander";
      p.heart.boost = 0;
      // Retoma el paseo aleatorio con un nuevo objetivo ya mismo (en vez
      // de esperar a `nextChangeAt`, que quedó desactualizado durante
      // el corazón), así no hay un tramo "muerto" antes de que el
      // suavizado vuelva a tomar el control con naturalidad.
      pickWanderTarget(p, now);
    }
  }

  // Cuando una partícula llega a su posición, se anota en el grupo. En
  // cuanto TODAS las elegidas han llegado (o se ha agotado el tope de
  // seguridad de alguna), arranca el conteo compartido de
  // `holdDuration` — así el corazón se mantiene formado como grupo, no
  // como una suma de temporizadores individuales desacompasados.
  function markArrived(p, now) {
    if (heartState.allArrivedAt !== null) return; // ya se marcó el grupo como completo
    const stillForming = heartState.chosen.some((other) => other.heart.mode === "forming");
    if (!stillForming) {
      heartState.allArrivedAt = now;
      heartState.phase = "holding";
    }
  }

  // Una vez formado el grupo, se comprueba cada frame si ya ha pasado
  // `holdDuration` desde que llegó la última partícula; si es así, todo
  // el grupo pasa a "pausing" a la vez (cada una con su propia pequeña
  // pausa aleatoria antes del impulso, ver updatePausing).
  function maybeEndHold(now) {
    if (heartState.phase !== "holding" || heartState.allArrivedAt === null) return;
    if (now - heartState.allArrivedAt < heartState.holdDuration) return;

    for (const p of heartState.chosen) {
      p.heart.mode = "pausing";
      p.heart.phaseStart = now;
    }
    heartState.phase = "dispersing";
    heartState.active = false; // ya se puede programar el siguiente corazón
    scheduleNextHeart(false);
  }

  // ---- Bucle principal ----
  let rafId = null;
  let lastTime = performance.now();
  let elapsedTotal = 0;
  let running = true;

  function update(dt, now) {
    elapsedTotal += dt;

    for (const p of particles) {
      switch (p.heart.mode) {
        case "wander":
          updateWander(p, dt, now);
          break;
        case "forming":
          updateForming(p, dt, now);
          break;
        case "holding":
          updateHolding(p, dt);
          break;
        case "pausing":
          updatePausing(p, dt, now);
          break;
        case "dispersing":
          updateDispersing(p, dt, now);
          break;
        default:
          updateWander(p, dt, now);
      }
    }

    if (heartState.active) maybeEndHold(now);
  }

  function draw() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    // Mezcla aditiva: donde dos resplandores se solapan, se suman en
    // vez de superponerse plano — se lee como luz de verdad. Se activa
    // una vez para todo el frame y se restaura al final.
    ctx.globalCompositeOperation = "lighter";

    for (const p of particles) {
      const twinkle =
        1 +
        Math.sin(elapsedTotal * ((Math.PI * 2) / p.twinklePeriod) + p.twinklePhase) *
          cfg.twinkle.amplitude;
      const alpha = Math.max(0, Math.min(1, twinkle * p.brightness));
      const sizeBoost = 1 + p.heart.boost * 0.3; // ligeramente más grandes mientras forman/mantienen el corazón, para que la silueta se lea con claridad sin ser protagonista

      ctx.save();
      ctx.translate(p.x, p.y);
      if (sizeBoost !== 1) ctx.scale(sizeBoost, sizeBoost);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.glowGradient;
      ctx.beginPath();
      ctx.arc(0, 0, p.glowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05); // recorta saltos grandes (pestaña en segundo plano, etc.)
    lastTime = now;
    update(dt, now);
    draw();
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  function handleResize() {
    const wasMobile = deviceCfg === cfg.mobile;
    const nowMobile = isMobileViewport();
    if (wasMobile !== nowMobile) {
      // Cambio de "familia" de dispositivo (p. ej. rotar el móvil cerca
      // del punto de corte): recreamos el pool con el recuento
      // correspondiente. Solo si no hay un corazón en curso, para no
      // cortarlo a medias.
      deviceCfg = nowMobile ? cfg.mobile : cfg.desktop;
      if (!heartState.active) {
        particles = createParticles(deviceCfg.count);
      }
    }
  }
  window.addEventListener("resize", handleResize);

  function destroy() {
    running = false;
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (heartTimeoutId !== null) window.clearTimeout(heartTimeoutId);
    window.removeEventListener("resize", resize);
    window.removeEventListener("resize", handleResize);
    canvas.remove();
  }

  return { destroy };
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
