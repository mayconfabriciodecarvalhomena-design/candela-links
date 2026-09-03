// -----------------------------------------------------------------------
// INTRO PARTICLES CONFIG: fuente de verdad de los parámetros del sistema
// de partículas decorativas de la pantalla de entrada
// (src/introParticles.js). Sistema 2D con Canvas puro (sin Three.js):
// vive y muere junto con la intro, completamente al margen de la escena
// 3D — ver introParticles.js para el porqué.
//
// Esta versión corrige, con números verificados por simulación (ver
// PROJECT_STATE.md, iteración "diagnóstico y corrección quirúrgica"),
// tres problemas de la iteración anterior:
//   1. El movimiento ambiental era casi imperceptible (~0.3px en 3s)
//      pese a un `maxSpeed` de 7px/s, porque el modelo de ruido
//      acumulado nunca llegaba a acercarse a ese tope. Sustituido por
//      un modelo de "velocidad objetivo suavizada" (ver `motion`).
//   2. El glow de cada partícula (halo + núcleo, dos `arc()` con
//      mezcla aditiva) seguía leyéndose como círculos. Sustituido por
//      un gradiente radial real por partícula (ver `glow`).
//   3. El impulso de dispersión del corazón apenas desplazaba unas
//      decenas de píxeles. Retuneado para un desplazamiento real de
//      ~80-115px (ver `heartMotion.dispersal*`).
// -----------------------------------------------------------------------

export const INTRO_PARTICLES_CONFIG = {
  // Por debajo de este ancho de viewport (px) se usan los valores de
  // `mobile` en vez de `desktop`: menos partículas, corazón más
  // pequeño. Mismo umbral que ya usa el marco decorativo en
  // styles.css (@media max-width: 520px), para mantener coherencia.
  mobileBreakpoint: 520,

  // Recuento de partículas ambientales subido moderadamente (46→56
  // desktop, 22→27 mobile, ~+20%) para dar algo más de vida a la
  // habitación sin dejar de ser sutil. El recuento de partículas por
  // corazón se ha reducido en 3 en cada extremo del rango — con el
  // muestreo simétrico anclado de heartPoints() (ver más abajo) la
  // silueta se sigue leyendo con la misma claridad usando menos
  // partículas, mejor colocadas.
  desktop: {
    count: 56,
    heart: { minParticles: 13, maxParticles: 19, minScale: 26, maxScale: 38 },
  },
  mobile: {
    count: 27,
    heart: { minParticles: 8, maxParticles: 12, minScale: 15, maxScale: 22 },
  },

  // Colores: tono (hue, 0-360, todo el espectro) aleatorio por
  // partícula; saturación y luminosidad moderadas (nada de neón) para
  // que se lean como puntos de luz suaves, no como colores planos.
  color: {
    saturation: [42, 58], // %
    lightness: [60, 74], // %
  },

  // ---- Efecto de luz (ver draw()/makeGlowGradient() en introParticles.js) ----
  // Cada partícula tiene un ÚNICO CanvasGradient radial real (no dos
  // arcos planos): centro pequeño y casi opaco que se funde de forma
  // continua hacia fuera hasta la transparencia total. Se crea UNA VEZ
  // por partícula (en local, centrado en 0,0) y se reutiliza en cada
  // frame trasladando/escalando el contexto — barato, sin recrear
  // gradientes cada frame. `globalAlpha` (twinkle · brightness) se
  // aplica sobre el gradiente ya creado para variar el brillo sin
  // tocar sus stops.
  glow: {
    radius: [5, 10.5], // px, radio total del resplandor (todo el "punto de luz")
    hotStopPosition: 0.16, // fracción del radio donde termina el núcleo casi sólido
    hotStopAlpha: 0.95,
    midStopPosition: 0.45, // fracción donde el color pasa del núcleo "caliente" al tono saturado de la partícula
    midStopAlpha: 0.38,
    coreLightnessBoost: 18, // el núcleo es más claro que el color base (más "caliente")
    coreSaturationDrop: 16, // y algo menos saturado
    brightnessRange: [0.7, 1.4], // algunas partículas son un poco más brillantes que otras
  },

  // Parpadeo muy sutil de la opacidad (variación de luz, no de forma),
  // para que no se sientan del todo estáticas incluso sin el evento del
  // corazón.
  twinkle: {
    periodRange: [5, 10], // segundos por ciclo completo
    amplitude: 0.18, // fracción de la opacidad base
  },

  // ---- Movimiento ambiental: velocidad objetivo suavizada ----
  // Cada partícula "aspira" a una velocidad objetivo (ángulo y rapidez
  // aleatorios dentro de `speedRange`) y su velocidad real se acerca a
  // ese objetivo con un suavizado exponencial (constante de tiempo
  // `smoothingTauRange`) — nunca un salto. Cada `directionChangeRange`
  // milisegundos se elige un nuevo objetivo. Resultado verificado por
  // simulación: ~25-35px de desplazamiento real en 3s (antes ~0.3px),
  // con una curva continua y orgánica, no un temblor en el sitio.
  // Activo desde el primer frame para TODAS las partículas, incluidas
  // las que más tarde participen en un corazón — nunca hay ninguna
  // quieta "esperando".
  motion: {
    speedRange: [14, 28], // px/s, rapidez de "crucero" objetivo
    smoothingTauRange: [1.1, 1.7], // s, cuánto tarda en acercarse a la nueva velocidad objetivo
    directionChangeRange: [2200, 5200], // ms entre cambios de objetivo
    maxSpeed: 28, // px/s, tope duro (por si acaso) y referencia para el resto del sistema (p. ej. cuándo se considera "ya ambiental" tras dispersarse)
  },

  // ---- Evento especial: temporización del corazón ----
  heartTiming: {
    firstDelayRange: [4000, 8000], // ms antes del primer corazón
    intervalRange: [7000, 14000], // ms entre el final de un corazón y el inicio del siguiente
    holdDurationRange: [900, 1600], // ms que el corazón permanece formado (una vez han llegado todas)
    pauseDurationRange: [150, 320], // ms de pausa quieta antes del impulso de dispersión
  },

  // ---- Física del corazón: formación/mantenimiento/dispersión ----
  // Todo por fuerzas (muelle + amortiguación) sobre velocidad y
  // posición — nunca `particle.x = targetX`. La partícula conserva su
  // velocidad/dirección ambiental en el momento de ser elegida y va
  // recibiendo una atracción hacia su punto del corazón que aumenta
  // suavemente (formPullRampMs) en vez de aplicarse de golpe, así que
  // el camino que recorre es una curva orgánica, no una línea recta ni
  // un salto. Además, cada partícula se asigna a su punto del corazón
  // por proximidad real (ver assignParticlesToPoints() en
  // introParticles.js), no al azar — recorridos más cortos y creíbles.
  //
  // formStiffness/formDampingCoefficient/formMaxSpeed/formPullRampMs
  // controlan la VELOCIDAD DE FORMACIÓN. Subidos respecto a la
  // iteración anterior (20→55, 9→15.5, 340→650px/s, rampa 220→110ms)
  // para que la convergencia se sienta claramente más rápida y
  // enérgica — verificado por simulación que, con este muelle más
  // rígido y más amortiguado a la vez (no solo "más rápido", también
  // más crítico), NO aparece ningún rebote/oscilación al llegar
  // (overshoot) en ninguna de las distancias de partida probadas
  // (60-850px): la partícula llega entre un 35% y un 42% más rápido
  // que antes, con una curva que sigue frenando limpiamente en el
  // objetivo en vez de pasarse de largo y volver.
  heartMotion: {
    arrivalThreshold: 4, // px: por debajo de esto se considera que ya ha llegado
    formPullRampMs: 110, // duración de la rampa de entrada de la fuerza de atracción
    formStiffness: 55, // "k" del muelle mientras viaja hacia su posición
    formDampingCoefficient: 15.5, // "c" (amortiguación) durante el viaje
    formMaxSpeed: 650, // px/s, tope durante la formación (más rápido que el crucero ambiental: es un momento especial)
    maxFormDurationMs: 3000, // tope de seguridad para partículas que empiecen muy lejos del corazón

    holdStiffness: 14, // muelle más suave mientras se mantiene formado
    holdDampingCoefficient: 10, // más amortiguación: se queda quieta sin oscilar
    holdMaxSpeed: 60,

    // Dispersión: verificado por simulación que este rango de impulso +
    // este damping produce un desplazamiento REAL de ~80-115px en
    // ~1-1.25s (antes, con valores menores, apenas unas decenas de
    // píxeles) — una separación claramente visible, no un simple
    // "desarmarse" en el sitio.
    dispersalSpeedRange: [140, 210], // px/s, impulso inicial radial al dispersarse
    dispersalDampingPerFrame: 0.976, // decae la velocidad del impulso cada frame de referencia (60fps)
    dispersalExitSpeedMultiplier: 1.5, // vuelve a "wander" cuando la velocidad baja a este múltiplo de motion.maxSpeed
    dispersalMaxDurationMs: 2000, // tope de seguridad
  },

  // Margen de seguridad alrededor de la composición central
  // (.intro-question + .intro-content), calculado sobre su
  // getBoundingClientRect() real en el momento de generar cada
  // corazón. `viewportFraction` lo hace relativo al ancho de pantalla
  // (más cuidadoso en pantallas pequeñas), acotado entre min y max.
  protectedZone: {
    marginMin: 16,
    marginMax: 44,
    viewportFraction: 0.05,
  },
};
