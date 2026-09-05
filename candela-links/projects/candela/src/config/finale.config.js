// -----------------------------------------------------------------------
// FINALE_CONFIG: fuente de verdad de la configuración de la primera
// parte del final de Candela (src/candelaFinale.js + src/envelopeMesh.js).
// Mismo patrón que el resto de sistemas (flame.config.js,
// flameWords.config.js...): este archivo es responsabilidad exclusiva de
// este sistema; config.js solo lo importa y lo expone como
// CONFIG.finale, sin duplicar valores.
//
// ALCANCE DE ESTA FASE (ver el encargo): desde que termina la última
// frase de FlameWords hasta que el sobre, ya formado y viajado hasta el
// centro de la cámara, queda completamente abierto. NO incluye hojas,
// texto editable, ni nada de backend — eso es responsabilidad de una
// fase posterior.
//
// SECUENCIA COMPLETA (ver candelaFinale.js para la máquina de estados
// real):
//
//   pause → flameSurge → (particles) birth → rise → converge →
//   materialize → travel → settle → open → done
//
// -----------------------------------------------------------------------
export const FINALE_CONFIG = {
  // -----------------------------------------------------------------------
  // 1) PAUSA tras la última frase de FlameWords (ver sección 1 del
  // encargo). Debe notarse claramente más larga que la separación
  // normal entre frases de la secuencia automática
  // (CONFIG.flameWords.autoSequence.gapBetweenPhrases, 4.0s) — aquí
  // 5.5s. No es la misma pausa: FlameWords ya inserta su propio
  // "gapBetweenPhrases" antes de darse cuenta de que la lista se ha
  // acabado (ver flameWords.js → updateAutoSequence), así que esta
  // pausa se SUMA a esa, no la sustituye. Sin efectos nuevos, sin mover
  // la cámara, sin cambiar la iluminación — la habitación simplemente
  // sigue viva.
  // -----------------------------------------------------------------------
  pause: {
    duration: 5.5,
  },

  // -----------------------------------------------------------------------
  // 2) CRECIMIENTO DE LA LLAMA — "estado agresivo" (ver sección 2 del
  // encargo). Gobierna flame.setSurge() (añadido aditivo en flame.js —
  // ver el bloque de comentarios "SURGE" ahí) llamado desde
  // candelaFinale.js. La MAGNITUD de la respuesta visual (cuánto
  // crece/brilla/parpadea la llama) vive en CONFIG.flame.surge
  // (flame.config.js, responsabilidad de ese sistema, NO TOCADO en esta
  // iteración — el pico sigue siendo el mismo tamaño/luz máximos de
  // siempre); aquí se define el RITMO, en forma de una serie de
  // PULSACIONES en vez de un único bombeo:
  //
  //   pulseCount × pulseDuration → `pulseCount` pulsaciones de
  //     crecimiento seguidas ("normal → grande → normal", repetido),
  //     cada una de duración `pulseDuration`.
  //   dipDuration → una pulsación FINAL, de signo contrario
  //     (contracción, "normal → pequeña → normal"), que también sirve
  //     de resolución/asentamiento. ITERACIÓN (ajuste de
  //     sincronización): YA NO se solapa con el nacimiento de las
  //     partículas — ver particles.postSurgePause más abajo, la fase
  //     siguiente espera a que la llama esté COMPLETAMENTE en reposo
  //     (incluida esta pulsación final) antes de empezar.
  //
  // ITERACIÓN (ver el encargo — "quiero más pulsaciones, la secuencia
  // debe durar el doble, sin menearse, con la luz sincronizada a cada
  // pulsación"):
  //   - Antes había un único tramo rise→hold→fall (2.2+1.0+3.2=6.4s) y,
  //     por separado, un `deform` con osciladores de anchura/altura
  //     (widthFrequency/heightFrequency) que producían el efecto de
  //     "varias pulsaciones" — pero esos osciladores NUNCA llegaban a
  //     flame.setSurge(), solo a flame.setSurgeDeform(), así que la LUZ
  //     (que solo lee `surge`, ver flameLight.intensity en flame.js)
  //     jamás pulsaba con ellos: se quedaba con el nivel de la curva
  //     rise→hold→fall de fondo. Ese mismo `deform` también traía el
  //     balanceo lateral/inclinación (rotation.x/z) que se percibía
  //     como "meneo".
  //   - Ahora el pulso de tamaño/intensidad se codifica DIRECTAMENTE en
  //     el valor que se pasa a flame.setSurge() (pulseShape() más abajo
  //     en candelaFinale.js) — la MISMA variable que ya alimenta a la
  //     vez escala, parpadeo y luz en flame.js (surgeScale,
  //     surgeFlicker, flameLight.intensity), así que cada pulsación de
  //     tamaño y su pulsación de luz correspondiente quedan
  //     sincronizadas por construcción, no por coincidencia de
  //     temporizadores.
  //   - `deform` (más abajo) se conserva como mecanismo (mismo
  //     flame.setSurgeDeform() de siempre) pero con sus amplitudes en 0:
  //     ya no aporta ni el balanceo lateral/inclinación (el "meneo" que
  //     no se quería) ni una pulsación de anchura/altura independiente
  //     (redundante ahora que el pulso ya vive en `surge`). El
  //     movimiento orgánico mínimo para que la llama no se vea estática
  //     lo sigue aportando el shader base de la llama (turbulencia
  //     normal, siempre activa, ver flame.config.js), que esta
  //     iteración no toca.
  // -----------------------------------------------------------------------
  flameSurge: {
    // Nº de pulsaciones de CRECIMIENTO ("grande") antes de la
    // pulsación final de contracción ("pequeña"). 4 → el patrón pedido
    // normal→grande→normal→grande→normal→grande→normal→grande→pequeña→normal.
    pulseCount: 4,

    // Duración de CADA pulsación de crecimiento (subida + bajada
    // completas), en segundos. 4 × 2.4 = 9.6s de pulsaciones de
    // crecimiento.
    pulseDuration: 2.4,

    // Duración de la pulsación final de contracción ("pequeña"),
    // también subida + bajada completas — termina exactamente en 0
    // ("normal"), así que no hace falta ningún tramo adicional de
    // asentamiento aparte. 2.4×4 + 3.2 = 12.8s en total: EXACTAMENTE
    // el doble de los 6.4s que duraba antes (2.2+1.0+3.2), tal y como
    // pedía el encargo.
    dipDuration: 3.2,

    // Intensidad máxima de cada pulsación de crecimiento — MISMO valor
    // que el `peak` anterior, para conservar la misma diferencia de
    // tamaño/luz que ya existía (ver CONFIG.flame.surge.scaleBoost/
    // lightBoost en flame.config.js, no tocados): esto NO hace la
    // llama más grande, solo pulsa hasta el mismo tamaño de siempre,
    // más veces.
    peak: 1.0,

    // Profundidad de la pulsación final de contracción, como fracción
    // de `peak` pero en sentido NEGATIVO (ver setSurge() en flame.js,
    // que ahora admite valores por debajo de 0) — es lo que hace que la
    // llama se vea más PEQUEÑA que su tamaño normal, y la luz ambiental
    // baje por debajo de su nivel normal, justo antes de asentarse.
    dipDepth: 0.4,

    // -----------------------------------------------------------------------
    // DEFORM (ver flame.setSurgeDeform() en flame.js). Se mantiene el
    // mecanismo por si se quisiera reintroducir algo de movimiento en
    // el futuro, pero TODAS las amplitudes están en 0 en esta
    // iteración: el encargo pide explícitamente que el efecto principal
    // sea el pulso de tamaño/intensidad (ya cubierto arriba vía
    // `surge`) y NO balanceo lateral, NO inclinación adicional, NO
    // pulsación de anchura/altura independiente — nada que se lea como
    // "menearse" o "temblar". El movimiento orgánico mínimo que evita
    // que la llama se vea completamente estática lo sigue dando el
    // shader base (turbulencia normal siempre activa, ver
    // flame.config.js), que esta iteración no toca.
    // -----------------------------------------------------------------------
    deform: {
      lateralFrequency1: 2.4,
      lateralAmplitude1: 0,
      lateralFrequency2: 4.3,
      lateralAmplitude2: 0,
      lateralPhase2: 1.7,

      tiltFrequency: 1.7,
      tiltAmplitude: 0,
      tiltPhase: 0.9,

      widthFrequency: 5.1,
      widthAmplitude: 0,
      widthPhase: 2.4,
      heightFrequency: 3.6,
      heightAmplitude: 0,
      heightPhase: 0.3,
    },
  },

  // -----------------------------------------------------------------------
  // 3) PARTÍCULAS DEL SOBRE (ver secciones 3 y 5 del encargo). Mismo
  // lenguaje visual que FlameWords a propósito (mismo shader de brasa,
  // ver EMBER_VERTEX_SHADER/EMBER_FRAGMENT_SHADER reutilizados en
  // candelaFinale.js) pero un sistema totalmente independiente — no
  // comparte estado con flameWords.js ni lo modifica.
  // -----------------------------------------------------------------------
  particles: {
    // ITERACIÓN (ajuste de sincronización): cuándo nacen las
    // partículas respecto a la llama. ANTES esto era `startDelay: 2.6`
    // — un temporizador fijo contado desde que EMPIEZA FLAME_SURGE,
    // pensado para los 6.4s de la curva única que había en su momento.
    // Al pasar FLAME_SURGE a 12.8s con varias pulsaciones (ver
    // flameSurge más arriba) ese fijo se quedó desfasado: caía dentro
    // de la 2ª pulsación, con la llama todavía animándose — de ahí el
    // solapamiento con el nacimiento de las partículas.
    //
    // Ahora la transición FLAME_SURGE → BIRTH ya NO usa ningún
    // temporizador fijo: espera a que `surgeActive` (candelaFinale.js)
    // sea false, es decir, a que la animación de la llama haya
    // terminado REALMENTE — pulsaciones + contracción final incluidas —
    // sea cual sea su duración total. `postSurgePause` es solo el
    // pequeño margen de transición DESPUÉS de ese final real (nunca un
    // adelanto), así que este valor puede quedarse pequeño sin riesgo
    // de desincronizarse si `flameSurge` cambia de duración en el
    // futuro.
    postSurgePause: 0.3,

    // Capacidad reservada de una vez (buffer de tamaño fijo, sin crear
    // geometría nueva por frame — ver sección 13 del encargo). El
    // número real de partículas EN USO se recorta al nº de puntos que
    // consiga generar realmente el contorno del sobre (ver
    // envelope.sampling más abajo y selectEvenlyLocal en
    // candelaFinale.js) — así que esto es un TECHO, no una cantidad
    // fija garantizada.
    count: 340,

    // Paleta EXACTAMENTE igual a CONFIG.flame.colors/CONFIG.flameWords.colors
    // a propósito — mismo criterio que flameWords.config.js: estas
    // partículas deben ser, cromáticamente, indistinguibles de una brasa
    // real de la llama.
    colors: {
      core: 0xfffcf0,
      yellow: 0xffcf3d,
      orange: 0xff7215,
      edge: 0x7a1808,
    },

    size: {
      min: 0.012,
      max: 0.019,
    },

    // NACIMIENTO (ver sección 3 del encargo: "el origen debe basarse en
    // la referencia real de la llama"). Mismo criterio y misma fórmula
    // que cfg.flameOrigin en flameWords.config.js (radio que se ensancha
    // desde la base hasta el "bulge" y se estrecha hacia la punta,
    // calculado a partir de CONFIG.flame.shape) — se mantiene como una
    // copia independiente, no una importación cruzada, para que este
    // sistema no dependa de flameWords.js ni de su configuración (ver
    // sección 3 del encargo: "sin romper FlameWords").
    origin: {
      offset: [0, -0.026, 0.01],
      heightRange: [0.0, 0.3],
      bulgeT: 0.29,
      radiusAtBase: 0.03,
      radiusAtBulge: 0.075,
      radiusAtTop: 0.012,
      lateralBiasRange: [0.6, 1.9],
    },

    // FASES 1-2 de las propias partículas (BIRTH/RISE, igual criterio
    // que flameWords.js): comportamiento de brasa pura, sin ninguna
    // influencia todavía del contorno del sobre.
    birthDuration: 0.6,
    riseDuration: 1.1,
    birthScatter: 0.07,
    riseHeight: 0.2,
  },

  // -----------------------------------------------------------------------
  // 4) FORMA DEL SOBRE + 6) FORMACIÓN (ver secciones 4 y 6 del encargo).
  // La silueta se genera proceduralmente dibujando el CONTORNO (no el
  // relleno) del sobre en un canvas 2D oculto — igual concepto que
  // sampleWordPoints() en flameWords.js (nunca se muestra, solo se usa
  // para muestrear píxeles), pero una función propia e independiente
  // (ver sampleEnvelopeOutlinePoints() en candelaFinale.js): no se toca
  // flameWords.js para nada de esto.
  // -----------------------------------------------------------------------
  envelope: {
    // Tamaño del sobre en unidades de mundo. width/height es el cuerpo
    // rectangular; flapHeight es la altura de la solapa triangular, que
    // en estado cerrado cuelga hacia abajo DESDE el borde superior
    // (pivote en y = +height/2, punta en y = height/2 - flapHeight) —
    // vive DENTRO de la altura del cuerpo, sin sobresalir por encima
    // (ver flapVerts en envelopeMesh.js).
    width: 0.27,
    height: 0.18,
    flapHeight: 0.095,

    // -----------------------------------------------------------------------
    // APARIENCIA DEL OBJETO FÍSICO (ver sección 8 del encargo: "color
    // papel cálido, iluminación coherente con la llama"). depth es el
    // grosor de la caja del cuerpo (muy fino, solo para que no sea un
    // plano sin volumen). roughness alto (mate, no brillante — un sobre
    // de papel, no plástico). No se define ninguna luz propia: el sobre
    // se ilumina con la PointLight de la llama y la luz ambiental que
    // ya existen en la escena (MeshStandardMaterial reacciona a ambas
    // sin configuración adicional).
    // -----------------------------------------------------------------------
    depth: 0.02,
    color: 0xe8d3a6,
    edgeColor: 0xc9a468,
    roughness: 0.85,

    // -----------------------------------------------------------------------
    // ITERACIÓN VISUAL — arreglo del "sobre gris" (ver diagnóstico
    // completo en envelopeMesh.js, justo donde se usan estos valores).
    // Resumen: lejos de la llama, la cara del sobre que mira a cámara
    // recibe muy poca luz directa de la PointLight de la llama (ángulo
    // rasante) y queda dominada por la luz ambiental/hemisférica de la
    // escena, que tiene un tono FRÍO/azulado (CONFIG.scene.hemisphere.
    // skyColor = 0x3a3f52) — al multiplicarse por ese tono, el papel
    // cálido (0xe8d3a6) se ve gris/apagado. Arreglo LOCAL, sin tocar
    // CONFIG.scene ni flame.js: una PointLight cálida pequeña, hija del
    // propio sobre (viaja con él, siempre ilumina su cara frontal desde
    // donde está la cámara) + un emissive sutil como suelo de color, no
    // como sustituto de la iluminación real (sigue reaccionando a
    // fillLight/flameLight/ambiente para conservar el volumen 3D).
    // -----------------------------------------------------------------------
    fillLight: {
      color: 0xffb066, // mismo tono que CONFIG.flame.light.color, a propósito
      intensity: 1.1,
      distance: 0.9,
      decay: 1.4,
      // Desplazamiento respecto al centro del sobre, en espacio LOCAL
      // del propio objeto (eje Z = hacia donde mira la cara frontal) —
      // así la luz sigue apuntando a la cara visible sea cual sea la
      // posición/orientación actual del sobre.
      offsetZ: 0.18,
    },
    // Suelo de color cálido (emissive) para que la cara frontal nunca
    // caiga a negro/gris puro en las zonas peor iluminadas — deliberadamente
    // bajo para no aplanar el sombreado 3D real (ver sección 1 del
    // encargo: "no quiero un material completamente emisivo").
    emissiveIntensity: 0.16,

    // Posición donde se LEE/forma el sobre, respecto a la mecha real de
    // la vela (igual criterio que cfg.anchor en flameWords.config.js —
    // onWickReady + este offset propio).
    anchorOffset: [0, 0.4, 0.05],

    // Resolución del muestreo del contorno. pixelsPerUnit define la
    // escala del canvas oculto (canvas = tamaño en unidades × este
    // valor), así el contorno mantiene SIEMPRE las proporciones reales
    // de width/height/flapHeight, sea cual sea su tamaño — no hay ningún
    // número de píxeles hardcodeado independiente del tamaño real.
    sampling: {
      pixelsPerUnit: 720,
      strokeWidthPx: 7,
      // Solo se consideran píxeles con alfa por encima de este umbral
      // (0-255) al muestrear el trazo — mismo criterio que
      // font.alphaThreshold en flameWords.config.js.
      alphaThreshold: 60,
    },
  },

  // FASE 3 de las partículas (CONVERGE): del comportamiento de brasa
  // pura al contorno del sobre — mismo criterio que
  // formation/reading en flameWords.config.js (arranque escalonado +
  // arco de curvatura, nunca una interpolación lineal directa).
  formation: {
    convergeDuration: 2.1,
    // Reparto del arranque entre partículas (0–1): con esto no todas
    // convergen a la vez, así se reconocen primero fragmentos sueltos
    // del contorno (esquinas, líneas de la solapa) y solo después el
    // sobre completo — ver sección 6 del encargo.
    stagger: 0.55,
    curlAmount: 0.05,
  },

  // -----------------------------------------------------------------------
  // 8) TRANSICIÓN PARTÍCULAS → SOBRE FÍSICO (ver sección 8 del encargo).
  // Una vez el contorno de partículas está formado y congelado, esta
  // fase hace aparecer el objeto físico (envelopeMesh.js) mientras las
  // partículas se desvanecen — ambas cosas a la vez, nunca un pop
  // instantáneo.
  // -----------------------------------------------------------------------
  materialize: {
    duration: 1.4,
  },

  // -----------------------------------------------------------------------
  // 7) EL SOBRE VIAJA AL CENTRO + 9) VIAJE Y ESTABILIZACIÓN (ver
  // secciones 7 y 9 del encargo). El destino se calcula en
  // candelaFinale.js a partir de la cámara REAL en ese momento
  // (camera.position + dirección de vista × distanceFromCamera +
  // desplazamiento vertical), nunca una coordenada fija — así funciona
  // sea cual sea el encuadre actual de CONFIG.camera.
  // -----------------------------------------------------------------------
  travel: {
    // Distancia delante de la cámara (unidades de mundo) a la que queda
    // el sobre una vez ha llegado.
    distanceFromCamera: 0.8,
    // Desplazamiento vertical (eje "up" de la propia cámara, no del
    // mundo) respecto al centro exacto del encuadre — ligeramente hacia
    // abajo para que no tape el techo del encuadre.
    verticalOffset: -0.04,
    // Punto de control de la curva (Bézier cuadrática spawn→destino):
    // cuánto se separa de la línea recta en altura ("arcHeight", eje
    // "up" de cámara) y lateralmente ("lateralOffset", eje "right" de
    // cámara) — ver sección 7 del encargo, "no quiero start → target
    // mecánico".
    arcHeight: 0.16,
    lateralOffset: 0.07,
    duration: 2.6,
  },

  // FASE de asentamiento tras llegar (ver sección 9: "no quiero que
  // llegue al centro y se abra inmediatamente").
  settle: {
    duration: 0.9,
  },

  // -----------------------------------------------------------------------
  // 10) APERTURA (ver sección 10 del encargo). flapAngle en radianes:
  // cuánto rota la solapa desde su borde (pivote real, ver
  // envelopeMesh.js — nunca desde su centro). pauseBefore/pauseAfter son
  // las dos pequeñas pausas pedidas explícitamente: una antes de que
  // empiece a levantarse, otra una vez ya está abierta antes de
  // continuar (a partir de ahí, "DETENTE" — ver sección 11 del
  // encargo).
  // -----------------------------------------------------------------------
  open: {
    flapAngle: Math.PI * 0.62,
    duration: 1.5,
    pauseBefore: 0.5,
    pauseAfter: 1.0,
  },

  // -----------------------------------------------------------------------
  // SEGUNDA PARTE DEL FINAL (ver encargo "SEGUNDA PARTE DEL FINAL
  // NARRATIVO"): continúa exactamente donde termina la primera parte
  // (sobre abierto, fase `open`/DONE de arriba) y no toca ninguno de los
  // bloques anteriores. Responsabilidad de src/letterMesh.js + la cola
  // de fases añadida en candelaFinale.js:
  //
  //   pause-after-open → letter-rise → final-hold → done
  //
  // El texto vive en `letter.pages` (más abajo), completamente
  // separado de cómo se anima/renderiza — cambiar el mensaje no
  // requiere tocar ninguna lógica.
  // -----------------------------------------------------------------------
  message: {
    // NOTA: ya no es la fuente de contenido de la carta (ver
    // `letter.pages` más abajo, que sustituyó a este campo cuando se
    // implementó el sistema de varias hojas) — se conserva sin usar
    // por si en el futuro hiciera falta un mensaje de referencia
    // fuera del sistema de páginas.
    text: "Te quiero",
  },

  letter: {
    // 1) PAUSA TRAS LA APERTURA (ver sección 1 del encargo de la
    // segunda parte): pequeña espera con el sobre ya abierto, antes de
    // que la carta empiece a salir — sensación de anticipación.
    pauseAfterOpen: 1.1,

    // Tamaño BASE de la carta, en unidades de mundo — proporcionado al
    // tamaño del sobre (cfg.envelope.width/height) para que se lea como
    // "la carta que estaba dentro de ESTE sobre", no un tamaño inventado
    // aparte. La carta es una única hoja completa (nunca mitades) — ver
    // letterMesh.js. Escalado durante la animación es del `group` (ver
    // `emerge.finalScale`), nunca un cambio de esta geometría base.
    width: 0.205,
    height: 0.29,

    // Apariencia física (mismo criterio que envelope: color papel
    // cálido, mate, sin textura externa; MeshStandardMaterial
    // reacciona a la PointLight de la llama y a la luz ambiental ya
    // existentes, sin luces propias). Un tono ligeramente más claro
    // que el sobre, como el papel interior real de una carta.
    color: 0xf7edd8,
    // NOTA: ya no se usa (vivía la línea decorativa del pliegue de la
    // hoja, eliminada junto con todo el sistema de doblado). Se conserva
    // documentado por si una futura iteración quisiera un acabado
    // decorativo en el borde de la hoja.
    edgeColor: 0xd9c39c,
    roughness: 0.92,

    // -----------------------------------------------------------------------
    // ITERACIÓN — SE ABANDONA POR COMPLETO EL DOBLADO (ver encargo: "no
    // queremos que la hoja se doble, se despliegue ni se divida en dos
    // partes... quiero simplificarlo al máximo"). Ya no existen etapas
    // de pliegue/pausa/apertura: `emerge` gobierna una única transición
    // — la carta avanza desde el sobre hasta su posición final (ver
    // PHASE.LETTER_RISE en candelaFinale.js), ya completa, a su escala
    // definitiva y con el texto visible desde que aparece.
    // -----------------------------------------------------------------------
    emerge: {
      // Cuánto tarda la carta en llegar a su posición/opacidad final
      // (recorrido Bézier, ver computeLetterEmergePath() en
      // candelaFinale.js). Sin pausa de 1s ni apertura posterior.
      duration: 1.9,

      // Punto de partida: igual criterio que iteraciones anteriores,
      // justo saliendo por la apertura del sobre ya asentado (ver
      // computeLetterEmergePath() en candelaFinale.js), cerca del
      // pivote real de la solapa (flapPivot en envelopeMesh.js, en
      // y = +height/2 = 0.09).
      startForwardOffset: 0.06,
      startHeight: 0.075,

      // Punto final: calculado respecto a la CÁMARA REAL (mismo
      // criterio que cfg.travel del sobre más arriba), NUNCA respecto
      // al sobre — así la carta termina SIEMPRE delante de él, sea
      // cual sea su posición exacta.
      //
      // ITERACIÓN — MÁS PRESENCIA EN PANTALLA (ver encargo: "quiero que
      // al finalizar la animación la hoja tenga una presencia
      // claramente mayor... una ampliación razonable, no exagerada").
      // `finalDistanceFromCamera` baja de 0.6 a 0.54 (10% más cerca de
      // la cámara). Sigue siendo deliberadamente MENOR que
      // `travel.distanceFromCamera` del sobre (0.8): más cerca de la
      // cámara que el sobre significa, por definición, delante de él
      // (ver "REGLA DE ORO" de un encargo anterior: "el sobre puede
      // quedar parcialmente tapado, eso es correcto"), y sigue con
      // margen de sobra respecto al near plane de la cámara (0.1, ver
      // config.js) — sin riesgo de clipping.
      finalDistanceFromCamera: 0.54,
      finalVerticalOffset: 0.02,

      // Curvatura sutil de la trayectoria (Bézier cuadrática, mismo
      // criterio que cfg.travel del sobre) — nunca una línea recta
      // "robótica".
      arcHeight: 0.05,
      lateralOffset: 0.02,

      // ESCALA FINAL del `group` de la carta (nunca de la geometría
      // base, ver width/height más arriba), fijada DESDE EL PRIMER
      // FRAME de LETTER_RISE (ver candelaFinale.js) — nunca una rampa:
      // "debe aparecer ya con su geometría final/tamaño final" (ver
      // encargo de una iteración anterior).
      //
      // ITERACIÓN — sube de 1.2 a 1.3 (junto con el acercamiento de
      // `finalDistanceFromCamera` de arriba) para una presencia
      // claramente mayor en pantalla, sin resultar exagerada: a 60cm
      // de la cámara real (fov=56°, ver config.js) la carta pasa de
      // ocupar ≈54% a ≈66% de la altura del encuadre y de ≈22% a ≈26%
      // del ancho — sigue leyéndose como una hoja delante del sobre,
      // nunca tapando la escena. 1.3 → un 30% más grande que el
      // tamaño base (0.205×0.29 → 0.267×0.377). Sigue del mismo orden
      // de magnitud que el sobre (cuerpo 0.27×0.18 + solapa 0.095 de
      // alto ≈ 0.27×0.275 de silueta total).
      finalScale: 1.3,
    },

    // -----------------------------------------------------------------------
    // ITERACIÓN — OBJETIVO 2: SISTEMA REAL DE PASAR HOJAS (ver encargo).
    //
    // `pages` es la ÚNICA fuente de verdad del CONTENIDO de la carta:
    // un array de { title?, text }, en el orden en que se leen. Añadir,
    // quitar, reordenar o editar hojas es cambiar SOLO este array — ni
    // candelaFinale.js ni letterMesh.js hardcodean ningún número de
    // hojas ni su contenido (ver letterMesh.js: `pages.map(...)`
    // construye tantas hojas físicas como entradas tenga este array).
    //
    // `title` es opcional (una hoja sin `title` simplemente no dibuja
    // ninguno, ver buildPageTexture() en letterMesh.js).
    //
    // Se mantiene un único ejemplo por defecto con el mismo mensaje que
    // ya existía ("Te quiero", antes en `message.text` de arriba) para
    // no cambiar el comportamiento visible si nadie añade más hojas.
    // -----------------------------------------------------------------------
    // ITERACIÓN — ÚLTIMA HOJA COMO PÁGINA DE RESPUESTA (ver encargo:
    // "integrar completamente la escritura dentro de la última página
    // de la carta"). La última entrada de este array sigue siendo la
    // única fuente de verdad de su TÍTULO (se pinta exactamente igual
    // que el de cualquier otra hoja, ver letterMesh.js →
    // buildPageTexture()/paintTitle()); su `text` queda vacío a
    // propósito porque el cuerpo de esa hoja concreta lo gobierna
    // desde ahora el borrador del usuario (ver `write` más abajo y
    // letterMesh.js → setWritableDraft()/paintWritablePage()), nunca
    // un texto estático.
    pages: [
      { title: "Hoja 1", text: "Texto de la hoja 1" },
      { title: "Hoja 2", text: "Texto de la hoja 2" },
      { title: "Hoja 3", text: "Texto de la hoja 3" },
      { title: "Hoja 4", text: "Texto de la hoja 4" },
      { title: "Ahora escribe tú...", text: "" },
    ],

    // -----------------------------------------------------------------------
    // PASE DE HOJA (ITERACIÓN — REDISEÑO: se abandona el pivote de
    // libro. Ver letterMesh.js, cabecera de la sección "SISTEMA DE
    // HOJAS", para la explicación completa. Las hojas son ahora una
    // PILA física: cada hoja tiene una ranura (slot) de profundidad
    // fija en la pila (0 = arriba/delante, N-1 = abajo/detrás) y
    // `nextPage()`/`previousPage()` reordenan qué hoja ocupa qué
    // ranura, animando SOLO la hoja que se mueve con una trayectoria
    // en arco (levantar → recorrer por encima de la pila → posar)
    // — nunca girando sobre un pivote de lomo. `flight` controla la
    // forma de ese arco.
    // -----------------------------------------------------------------------
    page: {
      // Duración de la animación de pasar hoja (segundos), igual en
      // ambos sentidos (ver "Quiero que el movimiento sea coherente en
      // ambas direcciones" del encargo).
      turnDuration: 0.9,
      // ITERACIÓN — CORRECCIÓN "LA HOJA ATRAVIESA/PENETRA LA HOJA DE
      // DETRÁS" (ver vídeo aportado + letterMesh.js, comentario junto a
      // `slotDepth()`). Sustituye a la antigua `stackSpacing` (una
      // separación lineal repartida entre las `pageCount` ranuras).
      // Ahora la pila es de DOS posiciones físicas: la hoja actual
      // (`FRONT_DEPTH`) y TODAS las demás (`FRONT_DEPTH - stackGap`) —
      // ver letterMesh.js para el porqué de este cambio de arquitectura.
      //
      // El valor 0.03 no es arbitrario: una hoja en vuelo está
      // inclinada (`tiltMax`, más abajo) y una hoja inclinada tiene
      // distinta profundidad en su borde superior y en su borde
      // inferior (∝ `height · sin(tilt)`). Simulé punto a punto la
      // propia hoja (no solo su centro) a lo largo de todo el vuelo, en
      // ambos sentidos, y comprobé para qué valor de separación ninguna
      // esquina de la hoja llega a "verse delante" antes de que le
      // toque: el umbral exacto está en ≈0.0225 unidades (por debajo de
      // eso, la punta de la hoja que vuelve desde atrás asoma delante
      // de la hoja actual mientras aún debería estar oculta). 0.03 deja
      // un margen de seguridad de ~30% sobre ese umbral, para absorber
      // variaciones de framerate reales sin reintroducir la
      // penetración. Sigue siendo un valor minúsculo frente al tamaño
      // real de la carta (`height` ≈0.29): invisible en reposo (las
      // hojas traseras están siempre completamente ocultas detrás de
      // la actual) y no afecta al desplazamiento en Z hacia cámara
      // (`popFraction`/`behindFraction`, sin cambios, ver más abajo).
      stackGap: 0.03,

      // ARCO DE VUELO de la hoja que se está pasando (ver "FLECHA
      // DERECHA"/"FLECHA IZQUIERDA" del encargo: separación → recorrido
      // por encima de la pila, sin atravesarla → posado final). Todas
      // las fracciones son relativas a `width`/`height` de la carta
      // (cfg.letter.width/height), así el arco se mantiene proporcional
      // sea cual sea el tamaño real configurado de la hoja.
      flight: {
        // Altura del arco por encima de la hoja, fracción de
        // `height` — debe superar el borde superior de la carta para
        // que se lea como "por encima de la pila", nunca atravesándola.
        //
        // ITERACIÓN — CORRECCIÓN "LA HOJA ATRAVIESA LA HOJA DE ABAJO"
        // (ver vídeo aportado + letterMesh.js, comentario junto al uso
        // de `liftHeight` en updatePageTurn()): con 0.6 el CENTRO de la
        // hoja subía 0.6·height, pero como el borde inferior de la
        // propia hoja está 0.5·height por debajo de su centro, el
        // margen de despeje real sobre el borde superior de la pila era
        // solo de 0.1·height en el mejor de los casos (el pico de la
        // curva) — insuficiente, la hoja nunca llegaba a salir de la
        // franja vertical de la pila. Subido a 1.3: el borde inferior de
        // la hoja voladora queda, en el pico, a 0.8·height por encima
        // del borde superior de la pila — un margen amplio y a
        // propósito (ver encargo: "prefiero que la hoja se eleve
        // demasiado antes que verla atravesar otra hoja"). No afecta al
        // desplazamiento en Z hacia cámara (`popFraction`/
        // `behindFraction`, sin cambios) — la corrección es
        // exclusivamente en altura, tal y como pide el encargo.
        liftHeightFraction: 1.3,
        // ITERACIÓN — CORRECCIÓN "LA HOJA PARECE UNA PLACA ENORME
        // VOLANDO HACIA LA CÁMARA" (ver vídeo aportado + cabecera de
        // letterMesh.js): estas fracciones se aplican sobre
        // `width`/`height` de la HOJA (≈0.2 unidades), pero el
        // desplazamiento resultante ocurre en el mismo eje Z que la
        // distancia real hoja↔cámara (`letter.emerge.
        // finalDistanceFromCamera`, ≈0.54 unidades) — con las
        // fracciones antiguas (0.85/0.9 de `width`) la hoja llegaba a
        // desplazarse ~0.17-0.19 unidades en Z, es decir, un 30-35% de
        // esa distancia: suficiente para que la perspectiva la agrande
        // (o encoja) dramáticamente en pantalla, leyéndose como una
        // placa gigante lanzándose hacia la cámara en vez de una hoja
        // separándose de la pila. Se reducen aquí a una fracción de
        // `width` mucho menor — el desplazamiento en Z sigue siendo
        // muchísimo mayor que el grosor real de la pila (`stackGap`,
        // 0.03 — ver arriba), de sobra para una separación clara, pero
        // pequeño frente a la distancia a
        // cámara, para que la perspectiva apenas cambie durante el
        // vuelo.
        popFraction: 0.16,
        behindFraction: 0.22,
        driftFraction: 0.12,
        // Inclinación máxima (radianes) mientras la hoja está en el
        // aire — se anula por completo al posarse, la hoja nunca queda
        // torcida en reposo. Reducida junto con lo anterior (ver "no
        // hace falta exagerar la curvatura" del encargo).
        tiltMax: 0.22,
        // Ligero balanceo lateral (radianes) durante el recorrido, para
        // reforzar la sensación de papel físico en el aire (no un
        // sólido rígido perfectamente estable).
        wobbleMax: 0.035,
      },

      // TÍTULO (ver "TEXTO DE CADA HOJA" del encargo: centrado, arriba,
      // con margen, nunca pegado al borde). Comparte canvas con el
      // cuerpo del texto (ver buildPageTexture() en letterMesh.js) —
      // mismo criterio que el resto del proyecto: un único canvas
      // oculto, nunca HTML/DOM.
      //
      // ITERACIÓN — REDISEÑO (ver encargo: "el título debe tener un
      // tamaño MAYOR que el texto normal" — antes 40px de título contra
      // 46px de cuerpo, exactamente al revés). `sizePx` sube a 44
      // (claramente mayor que `text.font.sizePx` = 27, más abajo — la
      // jerarquía título/cuerpo se mantiene pese a que ambos han
      // bajado). Se añade `separator`: una línea fina decorativa bajo
      // el título (ver mockup del encargo), horneada en la misma
      // textura — nunca un elemento aparte.
      //
      // ITERACIÓN — WRAPPING DEL TÍTULO + AJUSTE DE TAMAÑOS (ver
      // encargo: "Ahora escribe tú..." quedaba parcialmente cortado
      // por ser demasiado grande para el ancho disponible). Se añade
      // `maxWidthFraction` (nueva, antes el título no tenía ajuste de
      // línea propio — se dibujaba con un único fillText() sin
      // comprobar el ancho, ver letterMesh.js → paintTitle()) y
      // `lineHeightPx` para el interlineado cuando ocupa 2 líneas —
      // ver "TÍTULO DE LA ÚLTIMA PÁGINA" del encargo: nunca se corta,
      // nunca se reduce a un tamaño diminuto solo para caber en una
      // línea, puede ocupar 2.
      //
      // ITERACIÓN — AJUSTE GENERAL DE TIPOGRAFÍA (ver encargo: "quiero
      // reducir el tamaño de TODOS los títulos... el resultado debe
      // sentirse más delicado, como una carta real"). `sizePx` baja de
      // 44 a 36 y `lineHeightPx` de 52 a 44, en la misma proporción
      // (≈1.2×). Esta es la ÚNICA configuración de título de TODA la
      // carta (ver `pages` arriba: cada hoja usa `pageCfg.title`, este
      // mismo objeto) — cambiarla aquí reduce a la vez los títulos de
      // las hojas 1-4 Y el título de la última hoja ("Ahora escribe
      // tú..."), nunca por separado.
      title: {
        // Margen superior antes del título, y separación entre el
        // título (o el separador, si existe) y el texto que viene
        // debajo — ambos como fracción de la altura del canvas oculto
        // (mismo criterio de resolución relativa que
        // `text.font.canvasHeightPx` más abajo, así el margen se
        // mantiene proporcional sea cual sea el tamaño real de la
        // carta).
        marginTopFraction: 0.09,
        gapFraction: 0.05,
        // Fracción del ancho del canvas disponible para el ajuste de
        // línea del título (mismo criterio que `text.font.
        // maxWidthFraction` más abajo, pero algo más generoso: el
        // título es corto — normalmente 1-2 palabras más una elipsis
        // — así que puede aprovechar casi todo el ancho de la hoja
        // respetando el mismo margen lateral visual que el resto de
        // la composición).
        maxWidthFraction: 0.84,
        font: {
          family: "Georgia, 'Times New Roman', serif",
          weight: "bold",
          sizePx: 36,
          // Interlineado cuando el título ocupa más de una línea (ver
          // paintTitle() en letterMesh.js) — mismo criterio
          // proporcional que `text.font.lineHeightPx` (≈1.2× el
          // tamaño de fuente para una lectura cómoda, sin quedar
          // apretado ni demasiado separado).
          lineHeightPx: 44,
          color: "#3d2a17",
        },
        // Línea fina decorativa bajo el título, centrada — marca con
        // claridad la frontera entre título y cuerpo (ver mockup del
        // encargo). `widthFraction` es su longitud como fracción del
        // ancho del canvas; `color` reutiliza el mismo tono cálido que
        // ya usa el borde del sobre (cfg.envelope.edgeColor) para
        // mantener una paleta coherente en toda la escena.
        separator: {
          enabled: true,
          widthFraction: 0.22,
          thicknessPx: 2,
          color: "#c9a468",
          gapAboveFraction: 0.022,
        },
      },
    },

    // -----------------------------------------------------------------------
    // ESCRITURA EN LA ÚLTIMA HOJA (ver encargo: "quiero integrar
    // completamente la escritura dentro de la última página de la
    // carta"). `enabled: true` convierte la hoja en la ranura
    // `pages.length - 1` (NUNCA un índice distinto/hardcodeado aparte
    // — ver letterWriteControls.js, que lo calcula siempre a partir de
    // `getPageCount()`) en una superficie de escritura real en cuanto
    // es la hoja actual y la carta ya es legible (candelaFinale.
    // isLetterReadable()). Toda la lógica de detección/captura de
    // teclado/envío vive en src/letterWriteControls.js — esta sección
    // es solo configuración de apariencia y comportamiento, mismo
    // criterio que `page`/`text` de arriba.
    // -----------------------------------------------------------------------
    write: {
      enabled: true,

      // Texto atenuado que se muestra en el cuerpo de la hoja mientras
      // no se ha escrito nada (ver "EL TÍTULO DE LA ÚLTIMA PÁGINA" del
      // encargo: el título NUNCA hace de placeholder, así que este
      // placeholder es un texto de cuerpo aparte, en cursiva y con
      // menos opacidad — ver letterMesh.js → paintWritablePage()).
      placeholder: "Escribe aquí, como si esta hoja fuera tuya…",

      // Límite de longitud del mensaje — igual que MAX_LEN en
      // api/message.js (ver ese archivo): se valida también aquí para
      // dar feedback inmediato en el propio `<textarea>` de captura
      // (ver letterWriteControls.js), pero el backend sigue siendo la
      // única fuente de verdad real de la validación.
      maxLength: 2000,

      // Margen inferior reservado en el cuerpo de la hoja (fracción de
      // `text.font.canvasHeightPx`, mismo criterio que
      // `text.topMarginFraction`) — junto con `bodyTop` (calculado a
      // partir del título, ver letterMesh.js) determina cuántas líneas
      // caben antes de empezar a recortar por arriba (ver "MENSAJES
      // MUY LARGOS" del encargo: la hoja nunca crece, se muestra
      // siempre la parte más reciente de lo escrito).
      bottomMarginFraction: 0.08,

      // Cursor visual sobre la hoja (ver letterMesh.js →
      // paintWritablePage()) — una barra vertical estable en la
      // posición real de `selectionStart`, mientras el campo tiene el
      // foco.
      //
      // ITERACIÓN — SIN PARPADEO (ver encargo: "no quiero que
      // parpadee... debe ser estable"). Antes existía `blinkMs`
      // (intervalo de parpadeo) y `char` (un carácter "|" pensado para
      // una implementación anterior que insertaba el cursor como texto
      // — ya no se usa, el cursor se dibuja como trazo, ver
      // paintWritablePage()); ambos se retiran por no tener ya ningún
      // efecto: el parpadeo se controlaba en letterWriteControls.js
      // con un setInterval que se ha eliminado por completo, no solo
      // "ralentizado" — `enabled: false` sigue permitiendo desactivar
      // el cursor del todo si hiciera falta en el futuro.
      cursor: {
        enabled: true,
      },

      // Endpoint YA existente (ver api/message.js) — se reutiliza tal
      // cual, mismo payload { slug, content } que ya usaba el widget
      // flotante retirado (message-widget.js). Nunca un endpoint
      // nuevo.
      endpoint: "/api/message",

      button: {
        label: "Enviar",
        sendingLabel: "Enviando…",
      },

      status: {
        sentLabel: "Enviado ✓",
        errorLabel: "No se pudo enviar. Inténtalo de nuevo.",
        // Cuánto tiempo se mantiene visible la confirmación antes de
        // desvanecerse sola (ver letterWriteControls.js) — igual
        // criterio temporal que ya usaba el widget flotante retirado.
        sentHoldMs: 2500,
      },
    },

    // 4)-6) TEXTO DE CADA HOJA (ver secciones 4, 5 y 6 del encargo
    // original + "TEXTO DE CADA HOJA" del encargo de esa iteración).
    // El texto se genera como una textura de canvas 2D (mismo criterio
    // que createSoftGlowTexture()/sampleWordPoints() en este proyecto:
    // canvas oculto, nunca visible como tal, solo usado para generar
    // una textura), horneada directamente sobre la propia hoja — nunca
    // HTML/DOM (ver buildPageTexture() en letterMesh.js). Esta
    // configuración de fuente/ajuste de línea se aplica a TODAS las
    // hojas por igual (el contenido, no el estilo, es lo que cambia
    // entre hojas — ver `pages` arriba).
    //
    // ITERACIÓN — LA HOJA QUE SALE YA TIENE EL TEXTO (ver encargo: "no
    // quiero hoja vacía → espera → segunda capa con el texto"). Antes,
    // `delay`/`revealDuration` gobernaban un fundido de la página
    // SEPARADO y POSTERIOR al del libro (ver antigua fase
    // MESSAGE_REVEAL en candelaFinale.js) — eso era precisamente la
    // causa del retraso visible de ~1s. Ahora la página actual se
    // desvanece con el MISMO progreso que el libro, dentro de
    // `setAppearance()` (ver letterMesh.js) — ya no hay un fundido
    // propio y retrasado para el texto, así que `delay`/
    // `revealDuration` han dejado de usarse (se conservan documentados
    // por si una futura iteración quisiera reintroducir un matiz de
    // temporización propio para el texto). `riseDistance` SÍ se sigue
    // usando: la ligera subida de la página ahora está sincronizada
    // con esa misma `a` compartida, nunca con un progreso propio.
    text: {
      // NOTA: ya NO gobiernan un fundido propio y retrasado de la
      // página (ver nota de iteración arriba) — no usados actualmente.
      delay: 0.55,
      revealDuration: 1.9,
      // Cuánto "sube" el texto mientras aparece (unidades de mundo,
      // muy sutil) — sincronizado con la MISMA opacidad que el libro
      // (ver setAppearance() en letterMesh.js), nunca con un progreso
      // propio.
      riseDistance: 0.018,
      // Margen superior del cuerpo (fracción de la altura del canvas)
      // cuando la página NO tiene título — ver buildPageTexture() en
      // letterMesh.js.
      topMarginFraction: 0.12,
      font: {
        // Georgia: misma familia que ya usa flameWords.config.js para
        // coherencia tipográfica en todo el proyecto.
        //
        // ITERACIÓN — SEGUNDA PASADA DE AJUSTE GENERAL (ver encargo:
        // "quiero reducir el tamaño de TODOS los textos de las
        // hojas... el resultado debe sentirse más delicado, como una
        // carta real"). `sizePx` baja de 27 a 22 y `lineHeightPx` de
        // 35 a 29, misma proporción (~1.32×) que antes. Esta es la
        // ÚNICA configuración de cuerpo de TODA la carta — la usan
        // tanto las hojas 1-4 (buildPageTexture()) como el texto
        // escrito y el placeholder de la última hoja
        // (paintWritablePage()), así que la reducción es coherente en
        // todo el documento sin tocar nada por separado. Frente al
        // título (36px, ver arriba), la proporción título/cuerpo
        // (36/22 ≈ 1.64×) se mantiene tan marcada como antes.
        family: "Georgia, 'Times New Roman', serif",
        weight: "normal",
        sizePx: 22,
        lineHeightPx: 29,
        color: "#3d2a17",
        // Resolución del canvas oculto usado para generar la textura
        // (alto en píxeles; el ancho se calcula a partir de esto y de
        // letter.width/letter.height para que el texto nunca salga
        // deformado, sea cual sea el tamaño real de la carta).
        canvasHeightPx: 640,
        // Fracción del ancho del canvas disponible para el ajuste de
        // línea automático (word-wrap) antes de saltar de línea —
        // también actúa como margen lateral visual (a menor fracción,
        // mayor margen a los lados).
        maxWidthFraction: 0.74,
        // NOTA: ya no gobierna un plano de texto aparte (antes existía
        // `textMesh`, un plano independiente más pequeño que el papel).
        // Desde esta iteración el texto se hornea directamente sobre
        // la propia hoja (ver `pages`/`page` arriba y buildPageTexture()
        // en letterMesh.js), a tamaño completo de la carta — se
        // conserva este valor sin usar por si una futura iteración
        // vuelve a necesitar un margen de plano independiente.
        marginFraction: 0.86,
      },
    },
  },

  // FASE FINAL ESTABLE (ver sección 7 del encargo: "la escena no debe
  // continuar haciendo animaciones innecesarias" + "puede haber...
  // respiración visual muy ligera"). `finalHold` es la pausa tras
  // completarse la aparición del mensaje antes de considerar la
  // secuencia terminada del todo (DONE); `idle` gobierna la
  // respiración vertical, sutil y continua, de la carta una vez
  // terminado — nunca de la cámara, la iluminación ni el sobre.
  finalHold: {
    duration: 1.2,
  },
  idle: {
    amplitude: 0.0035,
    frequency: 0.45,
  },
};
