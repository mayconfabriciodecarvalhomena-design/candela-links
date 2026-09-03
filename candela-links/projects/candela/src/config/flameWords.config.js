// -----------------------------------------------------------------------
// FLAME_WORDS_CONFIG: fuente de verdad de la configuración del sistema
// de "palabras que nacen de la llama" (src/flameWords.js). Mismo
// patrón de arquitectura que flame.config.js, cat.config.js,
// matches.config.js, etc: este archivo es responsabilidad exclusiva de
// este sistema. src/config.js solo lo importa y lo expone como
// CONFIG.flameWords, sin duplicar valores.
//
// ESTADO: v0.4 — ITERACIÓN "NACIMIENTO REAL + LEGIBILIDAD". Hasta ahora
// las partículas "nacían" en un disco pequeño alrededor del mismo punto
// donde luego se lee la palabra (cfg.anchor, bastante por encima de la
// llama real) — visualmente parecía una nube ya organizada apareciendo
// encima de la vela, no algo saliendo de la llama. Esta versión separa
// dos puntos de referencia distintos:
//
//   - cfg.anchor    → dónde se LEE la palabra (sin cambios).
//   - cfg.flameOrigin → dónde NACEN las partículas en BIRTH: dentro del
//     volumen real de la llama (ver más abajo), no encima de ella.
//
// También ajusta la paleta usada en HOLD (ver flameWords.js) para
// mejorar el contraste sobre el ambiente naranja de la habitación sin
// introducir ningún color nuevo ajeno a la estética del proyecto — ver
// comentario junto a `colors` más abajo.
// -----------------------------------------------------------------------
export const FLAME_WORDS_CONFIG = {
  // -----------------------------------------------------------------------
  // POSICIÓN DE LECTURA: dónde se forma/lee la palabra respecto a la
  // llama. No leemos ni modificamos flame.js — nos apoyamos, igual que
  // hace smoke.js, en la posición real de la mecha que expone candle.js
  // (onWickReady) más un offset propio. offset.y positivo la sube por
  // encima de la punta de la llama (CONFIG.flame.shape.height ronda
  // 0.34), para que quede delante/encima del fuego sin taparlo.
  // -----------------------------------------------------------------------
  anchor: {
    offset: [0, 0.42, 0.02],
  },

  // -----------------------------------------------------------------------
  // POSICIÓN DE NACIMIENTO (FASE 1/BIRTH): a diferencia de `anchor` de
  // arriba, este punto SÍ está dentro del volumen real de la llama, no
  // encima de ella — es de aquí de donde salen físicamente las
  // partículas antes de subir hacia `anchor`. offset usa el MISMO
  // wickOffset que ya aplica flame.js (ver flame.config.js →
  // wickOffset: [0,-0.026,0]) para que "altura 0" de este sistema
  // coincida exactamente con la base real de la silueta de la llama, no
  // con la mecha.
  //
  // El radio de nacimiento se ensancha desde la base hasta el "bulge"
  // (el punto más ancho, mismo criterio que shape.bulgeHeight en
  // flame.config.js) y luego se estrecha otra vez hacia la punta,
  // imitando la silueta real en forma de lágrima de la llama en vez de
  // un disco/cilindro genérico — así cada partícula nace de un punto
  // distinto de la SUPERFICIE de la llama, no de un volumen abstracto.
  // Los radios están calculados a partir de shape.baseWidth/bodyWidth
  // (flame.config.js), ligeramente por dentro para que ninguna
  // partícula asome claramente fuera de la silueta visible nada más
  // nacer.
  // -----------------------------------------------------------------------
  flameOrigin: {
    offset: [0, -0.026, 0.01],
    // [altura mínima, altura máxima] del volumen de nacimiento, en las
    // mismas unidades que shape.height (0.34) — 0 = base real de la
    // llama, 0.30 = cerca de la punta (no justo en la punta: ahí la
    // llama ya es casi un hilo, apenas cabe una partícula).
    heightRange: [0.0, 0.3],
    // Fracción de heightRange en la que se alcanza el radio máximo
    // (radiusAtBulge) — 0.0884 (bulge real, 0.26 × 0.34) ÷ 0.30 ≈ 0.29.
    bulgeT: 0.29,
    radiusAtBase: 0.03, // base real ronda 0.0725 (baseWidth/2) — más contenido para que se note que "nace" desde el centro/mecha
    radiusAtBulge: 0.075, // bulge real ronda 0.085 (bodyWidth/2)
    radiusAtTop: 0.012, // cerca de la punta la llama ya es muy fina (real ronda 0.0135 a esta altura, ver flame.config.js)
    // Multiplicador aleatorio por partícula sobre `birthScatter` (ver
    // más abajo): con esto, algunas partículas se desvían mucho más
    // hacia el lado que otras nada más nacer, en vez de que todas
    // tengan exactamente la misma dispersión — pedido explícito:
    // "algunas partículas puedan salir ligeramente hacia los lados
    // antes de subir".
    lateralBiasRange: [0.6, 1.9],
  },

  // Tamaño del "lienzo" de texto en unidades de mundo. width/height es
  // el área aproximada que ocupa la silueta de la palabra ya formada.
  // Para frases más largas que "mira" el ancho real sale de la propia
  // tipografía (ver sampleWordPoints) y se recorta con maxWidthScale
  // más abajo si hiciera falta, en vez de forzar coordenadas por frase.
  wordSize: {
    width: 0.62,
    height: 0.22,
    // Si una frase más larga ("te quiero", "siempre contigo"...) sale
    // más ancha que este múltiplo de wordSize.width, se reduce toda la
    // escala (alto Y ancho igual, sin deformar letras) hasta caber. No
    // es una coordenada especial por frase: es el mismo cálculo para
    // cualquier texto.
    maxWidthScale: 2.5,
  },

  // Tipografía usada SOLO para generar la nube de puntos objetivo (el
  // canvas 2D nunca se muestra, se usa exclusivamente para calcular
  // dónde caen las partículas). Georgia coincide con la familia ya
  // usada en el resto del proyecto (ver styles.css), por coherencia
  // tipográfica aunque aquí no se vea una fuente real, sino su huella
  // en forma de partículas.
  font: {
    family: "Georgia, 'Times New Roman', serif",
    weight: "normal",
    // Resolución del canvas de muestreo (píxeles). Más alto = silueta
    // más fiel pero más partículas candidatas entre las que elegir.
    sampleCanvasHeight: 220,
    // Solo se consideran píxeles con alfa por encima de este umbral
    // (0-255) al muestrear el canvas — evita partículas parásitas en
    // el antialiasing muy tenue del borde de cada letra.
    alphaThreshold: 120,
  },

  // -----------------------------------------------------------------------
  // DENSIDAD DE PARTÍCULAS — cuántas partículas usa cada frase, según su
  // longitud/complejidad real (ver sampleWordPoints() en flameWords.js).
  // Sustituye al antiguo `particleCount` fijo: en vez de un único número
  // para cualquier frase, ahora se calcula dividiendo el nº de píxeles
  // candidatos de la silueta real de ESA frase (ver selectEvenly) entre
  // `pixelsPerParticle`, y se recorta entre `min` y `max`.
  //
  // `pixelsPerParticle: 32` está calibrado para reproducir EXACTAMENTE
  // el particleCount=260 que ya estaba validado con "mira" (8338
  // píxeles candidatos ÷ 32 ≈ 260) — así las frases cortas mantienen la
  // densidad ya probada, y las frases más largas escalan
  // proporcionalmente a partir de ese mismo punto de referencia, no de
  // un número inventado nuevo. Medido empíricamente reproduciendo
  // sampleWordPoints() fuera del navegador: la cantidad de píxeles
  // candidatos por letra se mantiene muy estable (~1800-2100) sea cual
  // sea la longitud de la frase, así que esta división SÍ refleja la
  // "cantidad de tinta" real a representar, no solo el nº de
  // caracteres.
  // -----------------------------------------------------------------------
  particleDensity: {
    // Partículas mínimas para cualquier frase, por corta que sea (evita
    // que una sola palabra muy corta se vea "rota"/con huecos por tener
    // muy pocas partículas).
    min: 200,
    // Techo absoluto — a partir de aquí una frase muy larga deja de
    // ganar más partículas, para mantener el rendimiento razonable
    // (llega a solaparse con frases largas de 25+ letras; ver informe).
    max: 900,
    pixelsPerParticle: 32,
  },

  // Tamaño de partícula, en las mismas unidades que CONFIG.flame.embers
  // (multiplicador de pixelHeight en el shader — ver EMBER_VERTEX_SHADER,
  // reutilizado tal cual desde flameShader.js). Heredado de v0.1: a
  // este tamaño (~7% de wordSize.height de diámetro) la silueta deja
  // huecos reconocibles entre trazos en vez de fundirse en una mancha.
  size: {
    min: 0.013,
    max: 0.02,
  },

  // Paleta EXACTAMENTE igual a CONFIG.flame.colors (ver
  // flame.config.js) — no se define una paleta propia a propósito: la
  // intención es que estas partículas sean, cromáticamente,
  // indistinguibles de una brasa real de la llama.
  //
  // `core` cumple un segundo papel: es también el color hacia el que
  // se aclaran las partículas al converger en su letra (ver update() en
  // flameWords.js) y el color fijo que usan en HOLD. No es blanco puro
  // (0xfffcf0 sigue siendo cálido, el mismo tono ya usado como "núcleo"
  // de la llama real) — simplemente es el tono MÁS claro que ya existía
  // en la paleta, así que la palabra se lee con contraste sobre el
  // ambiente naranja sin introducir ningún color ajeno al resto de la
  // escena.
  colors: {
    core: 0xfffcf0,
    yellow: 0xffcf3d,
    orange: 0xff7215,
    edge: 0x7a1808,
  },

  // -----------------------------------------------------------------------
  // FASES — duración en segundos de cada una de las 6 fases pedidas.
  // El ciclo completo es: BIRTH → RISE → FORMATION → READING(readable)
  // → HOLD → DISSOLVE → (idle). Cuando show() se llama con una palabra
  // ya visible, el ciclo entra directamente en FORMATION (ver
  // show() en flameWords.js) para no repetir un nacimiento completo
  // sobre partículas que ya están "vivas".
  // -----------------------------------------------------------------------
  timing: {
    birth: 0.6, // FASE 1: aparecen como brasas sueltas junto a la llama
    // FASE 2: ascienden/se dispersan, todavía sin letra. Subido de 1.0 a
    // 1.3 al ampliar la distancia real de nacimiento→lectura (ver
    // flameOrigin más arriba): con más recorrido, un poco más de tiempo
    // de ascenso puro se nota más elegante y menos precipitado.
    rise: 1.3,
    formation: 1.8, // FASE 3: empiezan a converger hacia las letras
    reading: 0.9, // FASE 4 (READABLE): tensa el último tramo hasta legible
    // FASE 5: se mantiene legible y COMPLETAMENTE ESTÁTICA (ver
    // freezeAtTargets()). Subido de 4.0 a 5.5 — más margen para leer
    // tranquilamente sin sentir que "hay que darse prisa".
    hold: 5.5,
    dissolve: 2.2, // FASE 6: se deshace y vuelve a comportarse como brasas
  },

  // FASES 1-2 (BIRTH + RISE): comportamiento de brasa PURA. El target
  // de la letra tiene influencia 0 aquí (ver sección 9 del encargo:
  // "el target NO puede estar activo al 100% desde el primer frame" —
  // en estas dos fases está literalmente al 0%, para que se lea primero
  // como fuego y solo después como intención de formar algo).
  // birthScatter: dispersión lateral máxima durante ese arranque (luego
  // multiplicada por flameOrigin.lateralBiasRange particula a
  // partícula, así no todas se dispersan igual).
  // riseHeight: cuánto ascienden en total durante BIRTH+RISE. Subido de
  // 0.09 a 0.16 junto con flameOrigin: al nacer ahora dentro de la
  // llama (mucho más abajo que antes) hace falta más recorrido propio
  // de "brasa ascendiendo" antes de que FORMATION empiece a tirar hacia
  // la letra, para que el ascenso se perciba con claridad.
  // Ambas magnitudes crecen de forma ACOTADA con el tiempo (no siguen
  // creciendo sin límite si por lo que sea la fase tarda), así que no
  // hay riesgo de que una partícula salga disparada lejos de la escena.
  birthScatter: 0.06,
  riseHeight: 0.16,

  // FASE 3 (FORMATION): aquí empieza la convergencia hacia las letras.
  formation: {
    // Influencia del target que se alcanza al FINAL de esta fase (no
    // el 100%: el último tramo hasta legibilidad total ocurre en la
    // FASE 4/READABLE, no aquí — ver sección 3 del encargo, "60%: la
    // forma de las letras empieza a aparecer").
    targetInfluenceCap: 0.85,
    // Reparto del arranque entre partículas (0–1). Con 0.5, la mitad
    // "más lenta" (según su delay individual) no empieza a moverse
    // hasta la mitad de la fase — así aparecen primero fragmentos
    // sueltos de letra y solo después se reconoce la palabra completa,
    // en vez de aparecer todo de golpe.
    stagger: 0.5,
    // Arco/curvatura del trayecto durante la convergencia (sección 8:
    // "NO quiero una interpolación lineal simple... parecería que cada
    // partícula sabe desde el principio dónde tiene que ir"). Cada
    // partícula se desvía lateralmente de la línea recta
    // spawn→target con un pequeño arco propio que crece y vuelve a
    // cero según avanza la influencia del target (0 al empezar, 0 al
    // llegar, máximo a mitad de camino) — así el trayecto es una curva,
    // no una recta ni una teletransportación.
    curlAmount: 0.045,
  },

  // FASE 4 (READABLE): terminar de tensar hasta legibilidad. El
  // reparto de arranque es más pequeño que en FORMATION porque para
  // entonces casi todas las partículas ya están cerca de su target;
  // solo falta el último ajuste fino.
  reading: {
    stagger: 0.25,
  },

  // FASE 6 (DISSOLVE): las partículas abandonan la letra y vuelven a
  // comportarse como brasas — no desaparecen sin más, se dispersan y
  // ascienden igual que en BIRTH/RISE pero partiendo de su posición
  // actual en la letra en vez de la zona de la llama.
  dissolve: {
    // Reparto de salida (usa 1-delay respecto al de entrada, así el
    // orden de disolución no es un calco exacto del de formación).
    stagger: 0.5,
    scatter: 0.07,
    riseHeight: 0.1,
  },

  // FASE 5 (HOLD): además de la posición (congelada del todo, ver
  // freezeAtTargets()), el tamaño de partícula se aumenta ligeramente
  // respecto al tamaño normal en movimiento — refuerza la presencia de
  // la palabra ya formada sin tocar alpha (que ya está al máximo) ni
  // recurrir a un color puramente blanco/neón.
  hold: {
    sizeBoost: 1.28,
  },

  // Turbulencia/vida propia durante READING: aunque la palabra ya casi
  // esté formada, cada partícula se sigue moviendo un poco, como fuego
  // vivo y no texto congelado — SOLO hasta llegar a HOLD, donde deja de
  // aplicarse por completo (ver freezeAtTargets()). Heredado de v0.1
  // (valores ya validados: más alto que esto emborronaba visiblemente
  // los trazos).
  readingJitter: {
    amplitude: 0.0021,
    speed: 1.6,
  },

  // Dispersión residual mínima respecto al punto exacto incluso en el
  // pico de legibilidad (nunca 0 del todo — "temblor mínimo"). Solo se
  // aplica DURANTE la transición hacia legibilidad (READING); una vez
  // en HOLD la palabra queda completamente congelada (ver
  // freezeAtTargets() en flameWords.js) y este valor deja de tener
  // ningún efecto.
  residualScatter: 0.0014,

  // -----------------------------------------------------------------------
  // SECUENCIA AUTOMÁTICA — reproduce varias frases seguidas, una detrás
  // de otra, disparada con flameWords.startAutoSequence() (ver
  // flameWords.js). Aquí es donde se cambian las frases: NO hace falta
  // tocar la lógica de partículas para editar este listado ni sus
  // tiempos.
  // -----------------------------------------------------------------------
  autoSequence: {
    // Frases de la secuencia automática, en orden. Cámbialas
    // libremente — el sistema calcula la posición/tamaño de cada una
    // dinámicamente (ver sampleWordPoints), así que cualquier texto
    // funciona sin tocar nada más.
    words: [
      "te quiero",
      "aquí estoy",
      "gracias por venir",
      "qué suerte tenerte",
      "siempre contigo",
      "esto es para ti",
    ],

    // Segundos de margen entre que se dispara startAutoSequence() (la
    // llama ya está en su estado estable) y que empieza a nacer la
    // primera frase — un pequeño respiro antes de arrancar, para que
    // no se sienta instantáneo.
    triggerDelay: 1.5,

    // Segundos de "solo llama, sin ninguna palabra" entre que una
    // frase termina de disolverse del todo y empieza a nacer la
    // siguiente. Subido de 1.0 a 4.0 — pedido explícito de "pausa
    // clara" (rango sugerido 3-5s); con esto cada frase tiene su propio
    // momento antes de que aparezca la siguiente, en vez de sentirse
    // encadenadas.
    gapBetweenPhrases: 4.0,
  },
};
