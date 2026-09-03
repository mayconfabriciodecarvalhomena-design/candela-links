// -----------------------------------------------------------------------
// FLAME_CONFIG: configuración de la llama (src/flame.js +
// src/flameShader.js). Fuente de verdad de este sistema — config.js solo
// la importa y la expone como CONFIG.flame, sin duplicar valores.
//
// La llama, creada íntegramente con Three.js, empieza apagada; se
// enciende con flame.ignite(). El cuerpo principal NO son partículas: es
// una malla con un shader procedural que dibuja la forma y el color
// (secciones "shape", "turbulence" y "colors" de aquí abajo). Encima se
// añaden unas pocas partículas de "brasas" (sección "embers") solo para
// dar detalle y movimiento adicional.
//
// -----------------------------------------------------------------------
// REPLANTEAMIENTO VISUAL (esta iteración): las iteraciones anteriores
// ajustaban números (anchura, altura, fuerza de ruido...) sobre la MISMA
// idea de shader: una silueta con anchura por altura + ruido de borde
// izquierda/derecha, con 4 hojas cruzadas compartiendo un único
// material (mismo patrón de ruido, solo rotado en el espacio). Resultado:
// por mucho que se subieran los números, seguía leyéndose como "una
// forma plana que oscila", nunca como una llama con volumen.
//
// Esta vez cambia el propio shader (flameShader.js), no solo estos
// valores:
// - El borde ya no usa 2 muestras de ruido por lado: usa FBM (ruido
//   fractal, varias octavas rotadas entre sí) para un contorno mucho más
//   irregular y con detalle a varias escalas a la vez.
// - Cada una de las hojas cruzadas tiene su PROPIA semilla de ruido
//   (uPlaneSeed, asignada en flame.js al clonar el material por hoja),
//   así que ya no son la misma silueta rotada: se superponen patrones
//   distintos, y esa superposición (con blending aditivo) es lo que da
//   sensación de volumen en vez de "cartón plano".
// - Hay un campo de ruido interno (deformado/"warped") que varía el
//   brillo dentro de la llama, y un punto caliente (núcleo) que se
//   desplaza ligeramente en vez de estar fijo en el centro.
// - La punta ahora se ESTIRA y se ENCOGE de verdad (desplazamiento de
//   vértices en Y, no solo lateral) y tiene una ligera TORSIÓN
//   (rotación de vértices alrededor del eje Y, creciente con la altura),
//   aparte del balanceo lateral que ya existía.
// - Hay una banda exterior más transparente dentro de la propia silueta
//   (no solo en el borde geométrico), para separar visualmente
//   núcleo/cuerpo/envolvente.
//
// Si esta sección llega desde otra conversación con una forma de
// "shape"/"turbulence" distinta a la de aquí abajo (por ejemplo, sin
// "edge", "field", "stretch" o "twist"), está desincronizada respecto al
// flameShader.js actual: avisar antes de sustituirla sin más.
// -----------------------------------------------------------------------
export const FLAME_CONFIG = {
  // ANCLAJE A LA MECHA (cambiado esta iteración): la llama YA NO usa
  // esta posición como su posición real. flame.js se suscribe a
  // candle.js (onWickReady) y, en cuanto el modelo candle.glb termina
  // de cargar, mide la punta REAL de la mecha sobre su geometría y
  // ancla la llama ahí — así que si cambia CONFIG.candle.position,
  // .rotationY o .targetHeight, la llama sigue naciendo exactamente de
  // la mecha sin tocar ningún número aquí.
  //
  // Esta entrada ahora cumple dos papeles, los dos secundarios:
  // 1. Posición de ARRANQUE: createFlame() se ejecuta de forma
  //    síncrona, antes de que termine de cargar el .glb (asíncrono), así
  //    que hace falta algo razonable mientras tanto (y como red de
  //    seguridad si la carga fallase). No debería verse nunca en
  //    pantalla en uso normal: la llama solo es visible tras ignite(),
  //    momento en el que la mecha ya lleva rato cargada.
  // 2. Ejemplo de referencia de la escala esperada — pero el AJUSTE FINO
  //    real sobre la punta ya medida se hace con "wickOffset", justo
  //    debajo, no aquí.
  position: [0, 1.03, 0],

  // Pequeño ajuste FINO sobre la punta real de la mecha (ya medida, no
  // adivinada): cuánto se "hunde" la base de la llama en la mecha, para
  // que no quede ni flotando por encima ni con hueco visible. Antes,
  // sin anclaje real, este ajuste tenía que absorber TODO el error de
  // adivinar la posición a mano (de ahí que la iteración anterior usara
  // 1.03 en vez de 1.05 — una corrección grande, 0.07, para compensar
  // una base incorrecta). Ahora que la base es correcta, el ajuste que
  // hace falta es mucho más pequeño. Si la mecha se ve flotando por
  // encima de la llama, baja este valor (más negativo); si no se ve
  // nada de mecha ni azul cerca de la base, súbelo (menos negativo).
  //
  // AJUSTE FINO (esta iteración): −0.015 → −0.026. Petición explícita
  // de bajar TODA la llama un poco para que la base quede más cerca de
  // la mecha; el resto de la forma no cambia, solo su posición vertical.
  wickOffset: [0, -0.026, 0],

  // FORMA: la silueta base de la llama (antes de turbulencia).
  //
  // REESCRITO esta iteración — no es un simple reajuste de números. La
  // versión anterior tenía un bug geométrico real en `flameWidth()`
  // (flameShader.js), verificado numéricamente (no solo "a ojo") antes
  // de tocar el shader: justo encima de la base, la anchura CAÍA de
  // 0.075 a 0.05 (un pellizco/cintura, la "falda" de más abajo restando
  // en vez de sumar presencia) antes de volver a subir hacia el cuerpo;
  // y en el punto más ancho, la pendiente de subida llegaba a 0 pero la
  // de bajada no, dejando un vértice geométrico real en la silueta — no
  // una curva, un rombo de verdad. Los dos problemas están arreglados en
  // la fórmula nueva de `flameWidth()` (una sola curva continua, sin
  // tramos, con pendiente 0 en el punto más ancho por construcción); los
  // valores de aquí abajo están elegidos para esa fórmula nueva, no
  // tienen el mismo significado que en iteraciones anteriores.
  shape: {
    height: 0.34, // altura total de la llama (sin cambios — el problema era la forma, no la escala)

    // Anchura en v=0 (la base): con la fórmula nueva esto YA NO es el
    // punto de partida de una "falda" que luego se estrecha — es
    // directamente la anchura real ahí, sin pellizco después (esa es la
    // propiedad que permite subir este número con seguridad: al ser una
    // sola curva monótona de la base al bulge, no puede reaparecer
    // ningún pellizco por subir esto). 0.12 → 0.145 (85% de bodyWidth)
    // esta iteración: petición explícita de que la base envuelva más la
    // mecha, "ahora solo la toca en una puntita".
    baseWidth: 0.145,

    // Anchura máxima, en el punto más ancho (el bulge).
    bodyWidth: 0.17,

    // A qué fracción de la altura está el bulge. Antes 0.34 (bulge
    // relativamente alto); ahora 0.26, más abajo — el vientre de una
    // llama de vela real está en el tercio inferior, no a media altura.
    bulgeHeight: 0.26,

    // Cuánto se afila la punta a partir del bulge (más bajo = más
    // redondeado/orgánico, más alto = más fino). El punto de partida de
    // la caída (justo en el bulge) siempre tiene pendiente 0 por
    // construcción — este valor solo controla qué tan rápido se afila
    // DESPUÉS de esa zona redondeada, no crea ningún vértice.
    tipSharpness: 1.6,

    // Punta que se separa/deshilacha de vez en cuando (un ruido lento
    // decide cuándo "abrirse" un poco), en vez de acabar siempre en una
    // punta única y perfecta.
    tipSplitStrength: 0.55,
    tipSplitScale: 0.24,

    // Estiramiento vertical de la punta: además del balanceo lateral, la
    // parte alta de la llama sube y baja realmente (se desplazan los
    // propios vértices en Y), como una llama real que se "alarga" hacia
    // arriba y luego se relaja. Solo afecta a la parte alta (multiplicado
    // por el mismo "tipFactor" que ya limita otras cosas a la punta).
    //
    // Pequeño refinamiento esta iteración (0.055→0.065): un poco más de
    // comportamiento orgánico en la punta, pedido explícitamente. No
    // afecta a la base: "tipFactor" (flameShader.js) vale 0 por debajo
    // de v=0.55, así que este valor no puede mover nada por debajo de
    // ese punto por construcción, no solo por casualidad de los números.
    stretchSpeed: 0.35, // velocidad del ruido lento que decide cuánto se estira
    stretchStrength: 0.065,

    // Torsión: los vértices se rotan ligeramente alrededor del eje
    // vertical, más cuanto más arriba (y con más ruido, así que no es
    // una torsión constante sino que varía con el tiempo). Da una
    // sensación de "remolino" sutil que el balanceo lateral solo no da.
    //
    // Pequeño refinamiento esta iteración (0.5→0.62): la "ligera
    // curvatura" pedida explícitamente sale principalmente de aquí. Sin
    // efecto en la base por la misma razón que stretchStrength arriba.
    twistScale: 2.6, // frecuencia de la torsión a lo largo de la altura
    twistSpeed: 0.45, // velocidad a la que cambia
    twistStrength: 0.62,
  },

  // TURBULENCIA: cómo se deforma la malla con el tiempo (desplazamiento
  // de vértices). Slow/fast/mid son tres octavas con distinta
  // velocidad/frecuencia, para que base, cuerpo y punta no se muevan
  // todas igual. Además, cada hoja cruzada usa una semilla distinta
  // (uPlaneSeed, ver flame.js) al leer estas octavas, así que las 4-6
  // hojas NO se mueven en espejo unas de otras.
  turbulence: {
    slowSpeed: 0.4,
    slowScale: 2.0,
    slowStrength: 0.03,
    fastSpeed: 2.2,
    fastScale: 6.0,
    fastStrength: 0.016,
    tipMultiplier: 3.0,
    // Pequeño refinamiento esta iteración (0.05→0.065): "pequeñas
    // variaciones laterales" y asimetría pedidas explícitamente en la
    // punta — este es el ruido que rompe la simetría, ya multiplicado
    // por "tipFactor" en flameShader.js, así que solo afecta a la parte
    // alta, no a la base.
    tipChaos: 0.065,

    // Tercera octava, centrada en la zona media (peso en forma de
    // campana calculado en el shader), para que el cuerpo tenga
    // carácter de movimiento propio.
    midSpeed: 1.1,
    midScale: 3.6,
    midStrength: 0.022,

    // NUEVO — borde por FBM: sustituye a la antigua "una muestra de
    // ruido por lado". Varias octavas rotadas entre sí (ver fbm() en
    // flameShader.js) dan un contorno con detalle a la vez grueso y
    // fino, irregular de verdad, no una simple ondulación.
    edgeScale: 4.5,
    edgeSpeed: 0.9,
    edgeStrength: 0.62, // fracción de la anchura local que puede variar el borde

    // NUEVO — campo interno ("field"): un ruido deformado (domain
    // warping: se distorsiona la coordenada de muestreo con otro ruido
    // antes de leer el principal) que varía el brillo DENTRO de la
    // llama, no solo en el borde. Es lo que rompe el aspecto de
    // "degradado plano" y da textura de fuego real.
    fieldScaleX: 9.0,
    fieldScaleY: 3.2,
    fieldSpeed: 0.55, // velocidad a la que el campo "sube" (convección)
    fieldWarpScale: 2.4,
    fieldWarpSpeed: 0.35,
    fieldWarpStrength: 0.8,
    fieldStrength: 0.4, // cuánto afecta el campo al brillo final

    // Punto caliente que se desplaza: la zona más caliente no está fija
    // en el centro geométrico, sino que se desvía un poco con el tiempo
    // (ruido lento e independiente por hoja). Ahora solo desplaza la
    // TENDENCIA de calor (ver heatTurbulence, más abajo) — ya no dibuja
    // una forma propia, así que no puede volver a leerse como una figura
    // geométrica (el problema del "rombo" de la iteración anterior).
    hotspotDrift: 0.4, // fracción de la anchura/altura que puede desviarse
    hotspotSpeed: 0.5,

    // NUEVO — heatTurbulence: cuánto perturba el ruido (mismo campo que
    // "field", ver arriba) a la tendencia suave de calor antes de decidir
    // qué color aparece en cada píxel. A propósito MAYOR que el rango de
    // la propia tendencia (que va de 0 a 1): así el resultado final casi
    // nunca se parece a la tendencia "limpia", que es justo lo que evita
    // que el núcleo vuelva a leerse como una forma geométrica (rombo,
    // óvalo...) en vez de una zona de temperatura dentro de un fluido.
    heatTurbulence: 0.9,

    // NUEVO — dónde, en altura (0 = base, 1 = punta), se concentra el
    // calor (y por tanto el amarillo/blanco): sube entre heatRiseStart y
    // heatRiseEnd, se mantiene, y baja entre heatFallStart y
    // heatFallEnd. Antes eran números fijos dentro del shader
    // (0.03 / 0.22 / 0.42 / 0.92); se exponen aquí para poder ajustar la
    // altura de la zona luminosa sin tocar flameShader.js.
    //
    // AJUSTE FINO (esta iteración): los cuatro bajados respecto a esos
    // valores originales, para que la zona blanca/amarilla empiece más
    // cerca de la base (antes se notaba un tramo naranja-solo abajo,
    // "la parte blanca comienza un poco más arriba" — pedido explícito
    // de que empiece más abajo).
    heatRiseStart: 0.015,
    heatRiseEnd: 0.13,
    heatFallStart: 0.3,
    heatFallEnd: 0.75,
  },

  // COLORES del shader: núcleo blanco/amarillo muy brillante, cuerpo
  // amarillo-naranja, borde exterior rojizo oscuro y difuso. La sección
  // "outer*" controla, aparte del color, la TRANSPARENCIA por zonas (no
  // solo el color) para separar visualmente núcleo / cuerpo / envolvente
  // exterior, como pide el objetivo visual.
  colors: {
    core: 0xfffcf0, // blanco cálido, el punto más caliente
    yellow: 0xffcf3d,

    // AJUSTADO (esta pasada) — 0xff7a1a → 0xff6a10. Medido antes de
    // tocarlo: el naranja actual (G=122) está relativamente cerca del
    // amarillo (G=207, uColorYellow) en el canal que más los diferencia
    // — quedaba poco "espacio" cromático entre ambos, y con la rampa
    // mezclando naranja→amarillo de forma continua (smoothstep, no un
    // corte), esa cercanía se notaba como un naranja "apagado" en vez
    // de un naranja con identidad propia. Bajar G (122→96) sin tocar R
    // (se mantiene al máximo) aumenta la saturación y separa más el
    // tono del amarillo, sin oscurecerlo de forma drástica (luminancia
    // 0.353→0.32, una bajada pequeña, no un naranja apagado). No se han
    // tocado los umbrales de la rampa (smoothstep de heatForRamp) en
    // esta pasada — cambio mínimo y localizado, tal como se pidió.
    // AJUSTADO (2ª pasada de este color) — 0xff6a10 → 0xff7215. Punto
    // intermedio, tal como se pidió, entre este valor (G=106) y el
    // naranja anterior a la pasada previa (0xff7a1a, G=122): G=114. Más
    // "naranja reconocible" que el actual, conservando bastante más
    // separación del amarillo (G=207) que el original. Luminancia
    // 0.316→0.333, cambio pequeño.
    orange: 0xff7215,
    edge: 0x7a1808, // rojo oscuro, borde exterior y punta

    // Pequeña zona azul junto a la mecha, como en una llama de vela
    // real. Restringida a una zona pequeña (blueHeight/blueRadius,
    // ambos como fracción de la altura/anchura local) con su propio
    // borde ruidoso (ver flameShader.js), no un círculo limpio.
    //
    // Historial de diagnóstico (para no repetir el mismo camino si hay
    // que volver a tocar esto):
    // 1ª pasada — el azul casi no existía: blueHeight=0.05 era una
    //    franja casi de un solo píxel, y un desvanecido redundante en
    //    el shader recortaba justo su pico. Arreglado subiendo
    //    blueHeight/blueRadius/blueStrength y quitando el desvanecido.
    // 2ª pasada (esta) — el azul existía pero se veía tapado: el fondo
    //    sobre el que se mezclaba el azul YA estaba en amarillo/blanco
    //    antes de aplicar el mix, porque "heat" (que decide
    //    amarillo/blanco) lleva ruido de turbulencia SIN relación con
    //    dónde vive la zona azul — un pico de ruido moderado a solo
    //    v=0.05 ya empujaba heat a zona amarilla. Confirmado
    //    numéricamente antes de tocar el shader. Arreglo: "heat" se
    //    atenúa en proporción a blueZone ANTES de la rampa de color
    //    (blueHeatSuppress, nuevo), así que ya no puede encender
    //    amarillo/blanco dentro de la zona azul pase lo que pase con el
    //    ruido — ver flameShader.js. Vuelto a simular numéricamente con
    //    los valores de abajo, incluso en el peor caso de ruido: azul
    //    dominante hasta v≈0.05, transición azul-naranja hasta v≈0.11,
    //    naranja/amarillo a partir de ahí.
    // 3ª pasada (esta) — el azul existía y ya no se tapaba, pero seguía
    //    leyéndose "sutil". Comprobado numéricamente antes de tocar
    //    nada más: no era la fracción de mezcla (ya al 97%), era el
    //    color en sí. La luminancia (brillo percibido) del azul antiguo
    //    (0x4d78e0) es ~0.46, notablemente más oscura que naranja
    //    (~0.56), amarillo (~0.81) o el núcleo blanco (~0.99) — así que
    //    incluso al 97% de mezcla, el azul quedaba más oscuro que TODO
    //    lo que lo rodea, y se leía como una sombra/mancha tenue en vez
    //    de una zona de color con presencia propia. No se ha tocado la
    //    geometría de la zona (blueHeight/blueRadius/blueStrength/
    //    blueHeatSuppress, la parte que ya costó dos pasadas dejar
    //    bien) — solo el propio tono, más luminoso pero igual de
    //    azul de tinte (b/r ≈2.7, sigue leyéndose claramente azul, no
    //    cian ni blanco).
    blue: 0x4a86f5,
    blueHeight: 0.17, // hasta qué fracción de la altura llega (antes 0.11) — "más alta", pedido explícito
    blueRadius: 0.62, // qué proporción de la anchura local ocupa (antes 0.5) — rodea un poco más la base
    blueStrength: 0.97, // cuánto se mezcla el azul en su punto más fuerte (antes 0.95)

    // CORREGIDO (6ª pasada) — "blueBrightness" YA NO es un multiplicador
    // plano del color (ver flameShader.js para el diagnóstico numérico
    // completo de por qué eso era la causa real de que cambiar el RGB
    // de "blue" apenas se notara: un multiplicador plano, con
    // ACESFilmicToneMapping, sube mucho más los canales débiles R/G que
    // el ya-dominante B, así que en vez de "más intenso" el resultado
    // era "más pálido/desaturado" — y peor aún al superponerse varias
    // hojas en el eje central compartido, donde vive la zona azul).
    // Ahora es un factor de SATURACIÓN: aleja el color de su propia
    // luminancia (extrapola hacia fuera del gris) en vez de escalarlo
    // entero — R se queda anclado en vez de subir hacia B. Mismo
    // nombre/valor para no tener que volver a enganchar nada; el
    // "1.6" ahora significa "extrapolar un 60% más lejos del gris",
    // no "brillar un 60% más". Sigue ponderado por blueZone (fuera de
    // ella, factor exacto 1.0 — no toca el resto de la llama). Si tras
    // probarlo visualmente el azul sigue sin distinguirse, SUBIR este
    // número (nunca blueStrength/blueHeight/blueRadius); si empieza a
    // verse antinatural/artificial, BAJARLO.
    blueBrightness: 1.6,

    // NUEVO — cuánto atenúa la zona azul al "calor" (heat) antes de que
    // la rampa de color decida amarillo/blanco. Es la pieza que evita
    // que el ruido de turbulencia encienda amarillo/blanco DENTRO de la
    // zona azul (antes competían sin relación entre sí). 0 = no atenúa
    // nada (comportamiento antiguo, el azul se ve tapado); 1 = anula el
    // calor del todo donde blueZone=1 (azul totalmente puro en el
    // centro de la zona). 0.95 dominante pero no absoluto, deja algo de
    // variación por debajo del blanco/amarillo puro.
    blueHeatSuppress: 0.95,

    // A partir de qué "r" (0 = centro, 1 = borde geométrico) empieza la
    // envolvente exterior, y cuánto baja su opacidad respecto al cuerpo:
    // así se nota una capa exterior más transparente incluso ANTES de
    // llegar al borde difuso de la silueta, en vez de que todo el cuerpo
    // tenga la misma opacidad hasta el borde.
    outerStart: 0.5,
    outerAlpha: 0.45,

    // CORRECCIÓN DE SOBREEXPOSICIÓN (2ª pasada) — "coreLayerNormalize",
    // no un multiplicador plano de todo el color.
    //
    // 1ª pasada (revertida): un "layerNormalize" que multiplicaba TODO
    // el color por un factor fijo (0.42), pensado para compensar que
    // las 6 hojas cruzadas se dibujan con blending ADITIVO (sus colores
    // se SUMAN, no se mezclan). No funcionó: el problema real no está
    // repartido por igual en todo el color, está concentrado casi por
    // completo en el eje vertical central de la llama, donde —por pura
    // geometría de rotación alrededor del eje Y— el punto "localX=0" de
    // las 6 hojas coincide EXACTAMENTE en el mismo punto del mundo. Ahí
    // la máscara vale 1 para las 6 a la vez Y su "calor" (heat, que
    // depende de v/r, también compartidos en ese eje) tiende a ser
    // máximo para las 6 a la vez — así que es justo ahí donde 6 colores
    // casi blancos se apilan. Lejos de ese eje, cada hoja tiene su
    // propio localX (por la rotación) y rara vez coincide con otra en
    // el mismo punto de pantalla, mucho menos en su zona más caliente —
    // el cuerpo naranja/amarillo casi nunca sufre esta suma. Un
    // multiplicador plano no puede distinguir ambos casos: para domar
    // el eje central tenía que ser tan bajo que apagaba también el
    // cuerpo, que nunca fue el problema (de ahí que, tras aplicarlo, la
    // llama siguiera leyéndose como un destello sin forma, solo que más
    // tenue en general).
    //
    // Arreglo real: "coreLayerNormalize" solo atenúa la porción del
    // color que la rampa ya identifica como núcleo/blanco (heatForRamp
    // alto, ver la aplicación exacta — dependiente del calor, con
    // transición suave — en flameShader.js). Naranja, amarillo, borde y
    // azul se quedan con su brillo de siempre, sin tocar: es ahí donde
    // vivía la "forma de llama reconocible" que se quería recuperar.
    // 0.3 como punto de partida: con las 6 hojas apiladas en el peor
    // caso (el eje central), el núcleo queda brillante y saturado (como
    // corresponde al punto más caliente de una llama real) sin blanquear
    // por completo toda la silueta a su alrededor. Si el núcleo sigue
    // sin distinguirse de un destello, BAJAR este número (más
    // atenuación); si el núcleo se ve apagado/gris en vez de blanco
    // brillante, SUBIRLO — nunca hace falta tocar naranja/amarillo para
    // este ajuste, ya están desacoplados.
    coreLayerNormalize: 0.3,
  },

  // BRASAS: partículas pequeñas de detalle, aparte de la silueta
  // principal (que ya dibuja el shader). Deben ser sutiles y discretas,
  // no protagonistas: pocas, pequeñas y poco opacas. Altura ajustada
  // para acompañar la nueva altura de la llama (antes 0.3).
  embers: {
    count: 6,
    height: 0.36,
    maxRadius: 0.09,
    particleSize: 0.022,
    minSizeFactor: 0.6,
    maxSizeFactor: 1.1,
    riseSpeed: 0.45,
    speedVariation: 0.4,
    wobbleAmount: 0.022,
    opacity: 0.5,
    colorNear: 0xfff6d8, // casi blanco al nacer
    colorFar: 0xffb347, // ámbar al final de su vida
  },

  // GLOW: halo de luz muy sutil alrededor de la llama, aparte de las
  // partículas y el shader. Desaparece por completo cuando la llama está
  // apagada. Tamaño/altura ajustados a la nueva escala de la llama
  // (antes size 0.5 / height 0.12), manteniendo la opacidad tan sutil
  // como antes para que siga sin verse como un círculo.
  glow: {
    color: 0xffb066,
    size: 0.62,
    height: 0.15,
    opacity: 0.2,
  },

  light: {
    color: 0xffb066,
    height: 0.18, // altura a la que se sitúa la luz sobre la base de la llama (subida ligeramente, ver depthOffset más abajo)

    // AJUSTADO (3ª pasada) — el ajuste anterior (maxIntensity 6→2,
    // distance 10→5) redujo el punto blanco de la pared pero dejó dos
    // problemas nuevos, confirmados con una captura real: 1) la pared
    // seguía bastante concentrada/brillante justo detrás de la llama, y
    // 2) el propio cuerpo de la vela (su cara vertical, de cara a
    // cámara) se veía casi negro.
    //
    // Diagnóstico del punto 2, verificado geométricamente: la luz vivía
    // justo ENCIMA de la mecha (x/z ≈ los de la llama, solo desplazada
    // en altura) y ligeramente hacia el fondo de la habitación (la
    // llama nace pegada a la mecha, que está muy cerca de la pared). Una
    // cara vertical de la vela que mira hacia cámara (normal ≈ +Z) con
    // una luz situada arriba-y-detrás recibe N·L prácticamente nulo — la
    // luz solo alcanzaba a iluminar el borde superior (la cera fundida),
    // nunca el cuerpo. No es un problema de intensidad: subir
    // maxIntensity no arregla un ángulo de incidencia rasante/negativo.
    //
    // Arreglo: "depthOffset" desplaza la PointLight (solo la luz —la
    // malla/glow de la llama se quedan exactamente donde estaban,
    // ancladas a la mecha) hacia DELANTE (+Z, hacia la cámara, alejándola
    // de la pared del fondo), sin moverla lateralmente. Esto consigue
    // DOS cosas con un único cambio, verificado numéricamente
    // reproduciendo la fórmula real de atenuación de THREE.PointLight +
    // ACESFilmicToneMapping (mismo método que la pasada anterior,
    // ampliado ahora con N·L real sobre una cara vertical de la vela, la
    // mesa y el suelo, no solo la pared):
    //   1) aleja la luz de la pared (antes ~0.35 m, ahora ~0.6 m),
    //      bajando su punto más brillante de luminancia tonemapeada
    //      ~0.84 a ~0.51 — ya no es un blanco puro concentrado;
    //   2) pone la luz delante de la vela en vez de detrás, así que la
    //      cara frontal pasa de N·L≈0 (negro) a recibir luz de verdad
    //      (luminancia estimada 0.00 → ~0.22 en esa cara).
    //
    // decay (nuevo — antes no se pasaba explícitamente al constructor de
    // THREE.PointLight, así que usaba el valor por defecto, 2, físico):
    // bajado a 1.3. Con caída puramente física (2), a la distancia real
    // del suelo (~1.7 m) prácticamente no llega nada de luz por mucho
    // que se suba la intensidad sin volver a quemar la pared/vela,
    // que están mucho más cerca. Un decay menor (más plano, "no físico"
    // a propósito, permitido explícitamente para esto) reparte mejor la
    // luz entre lo cercano y lo lejano: en la simulación, ayuda a que la
    // mesa/suelo dejen de estar en negro absoluto sin necesitar subir
    // mucho la intensidad — y, efecto colateral bueno, reduce AÚN MÁS
    // el brillo relativo del punto más cercano de la pared, porque deja
    // de tener tanta "ventaja" por cercanía frente al resto de la
    // escena.
    //
    // maxIntensity (2→2.6) y distance (5→6.5): subidas solo lo
    // necesario para compensar el reparto más uniforme del decay más
    // bajo — la mesa se queda prácticamente igual de iluminada que antes
    // de este cambio (no es "una PointLight más intensa" sin más, es la
    // combinación de las cuatro cosas a la vez).
    // AJUSTADO (4ª pasada) — con una captura real tras la 3ª pasada:
    // distance 6.5→8, decay 1.3→1.0. Objetivo único: repartir algo más
    // de luz hacia el suelo/esquinas/parte baja de la mesa sin subir
    // maxIntensity (que volvería a quemar la pared). Simulación
    // numérica (misma fórmula de THREE.PointLight + ACESFilmic):
    // pared 0.514→0.464 (baja, no sube), vela 0.225→0.183 (baja un
    // poco — aviso realista: el margen físico de una sola luz puntual a
    // esta escala es pequeño, el suelo/esquina siguen quedando muy
    // oscuros incluso así, ver PROJECT_STATE.md para el detalle
    // completo de por qué no se ha empujado más este valor).
    depthOffset: 0.26,
    maxIntensity: 2.6,
    distance: 8,
    decay: 1.0,

    // NUEVO (4ª pasada) — corrige la línea horizontal recta en el
    // cuerpo de la vela. Diagnóstico: `candle.js` pone
    // `castShadow = true` y `receiveShadow = true` en todas las mallas
    // de la vela (se hace sombra a sí misma, por diseño — no se ha
    // tocado), y `flameLight.shadow` no tenía `bias`/`normalBias`
    // definidos (0 por defecto). Con el ángulo de incidencia bastante
    // más rasante que antes (por el `depthOffset` de la pasada
    // anterior), esa combinación es el caldo de cultivo clásico para
    // "shadow acne": el shadow map de un PointLight, sin bias, genera
    // un corte de sombra artificialmente recto/duro en vez de una
    // transición — no es un problema de `decay` (que da caída
    // continua, nunca un corte recto), ni del material, ni de la
    // geometría de la vela en sí. shadowBias (un empuje pequeño en la
    // comparación de profundidad) y shadowNormalBias (empuja el punto
    // de muestreo a lo largo de la normal, más eficaz que bias a solas
    // en superficies curvas como el cuerpo cilíndrico de la vela) son
    // los ajustes estándar para este artefacto — se aplican sobre la
    // propia PointLight (ver createFlameLight() en flame.js), sin
    // tocar candle.js ni ningún material.
    shadowBias: -0.0015,
    shadowNormalBias: 0.02,

    igniteDuration: 0.6,

    // AJUSTADO esta iteración: 0.45 → 0.9. No es un capricho — antes
    // gobernaba solo un apagado simple (opacidad bajando a la vez en
    // toda la llama); ahora también gobierna el ritmo de EXTINGUISHING,
    // que necesita tiempo suficiente para que se note la secuencia
    // "arriba desaparece antes que la base" (ver states.extinguishing.
    // topFadeDuration, más abajo, deliberadamente más rápido que este
    // valor). Con 0.45s no habría margen para percibir esa secuencia.
    extinguishDuration: 0.9,

    flickerSpeed: 1.5,
    flickerStrength: 0.13,
    positionJitter: 0.012,

    // NUEVO — "respiración": una variación adicional, mucho más lenta
    // que el parpadeo de arriba (flickerSpeed=1.5), y con su propio
    // ruido suave independiente. El parpadeo ya daba vida a corto
    // plazo; esto añade una ondulación larga y suave por debajo — la
    // luz "respira" además de "vivir". Afecta tanto a la intensidad
    // como, muy ligeramente, al alcance (distance) de la PointLight —
    // nunca a la iluminación ambiental ni a ningún otro objeto de la
    // escena, que no se tocan en esta iteración.
    breatheSpeed: 0.22, // muy lento comparado con flickerSpeed
    breatheStrength: 0.05, // variación de intensidad, pequeña
    rangeBreatheStrength: 0.035, // variación de distance, muy pequeña — "sin que parezca que la luz se acerca/aleja"
  },

  // -----------------------------------------------------------------------
  // SURGE (añadido para el final de Candela) — respuesta visual de la
  // llama a flame.setSurge(valor 0..1), ver el bloque de comentarios
  // "SURGE" en flame.js. Describe SOLO cuánto crece/brilla/parpadea la
  // llama para un valor de surge dado; el RITMO (cuánto tarda en subir,
  // cuánto se mantiene en el pico, cuánto tarda en bajar) es
  // responsabilidad de quien llama a setSurge() en cada frame — ver
  // src/config/finale.config.js, que es quien de verdad orquesta la
  // transición final. Deliberadamente NO es lo mismo que states.unstable
  // (más abajo): unstable existe para una llama amenazada/temblando
  // (encoge, growthTarget 0.9) y no está conectado a flame.js todavía;
  // surge es lo contrario — una llama que CRECE y GANA intensidad — así
  // que se mantienen como dos cosas separadas a propósito, tal y como
  // pedía el encargo ("mantenla separada del estado normal de
  // encendido/apagado").
  // -----------------------------------------------------------------------
  surge: {
    scaleBoost: 0.55, // surge=1 → la llama alcanza ~155% de su tamaño normal
    lightBoost: 0.9, // surge=1 → la luz casi duplica su intensidad
    flickerBoost: 0.35, // surge=1 → turbulencia/parpadeo extra del shader (uFlicker)
  },

  // NUEVO — parámetros exclusivos de cada estado no-permanente de la
  // llama (ver createFlame()/setState() en flame.js). NORMAL e IGNITING
  // no tienen sección propia porque reutilizan sin cambios los valores
  // de "shape"/"turbulence"/"light" de más arriba — esta iteración no
  // toca ni un valor de los ya ajustados.
  states: {
    // UNSTABLE: multiplicadores/objetivos aplicados POR ENCIMA del
    // sistema existente (nunca reescriben shape/turbulence en este
    // archivo, solo lo que se envía a la GPU en tiempo real desde
    // flame.js, ver setTurbulenceBoost-equivalente en update()).
    unstable: {
      // Cuánto tarda en entrar/salir de la inestabilidad (afecta a
      // TODOS los valores de aquí abajo a la vez, de forma coordinada
      // — así ninguno "salta" antes que los demás al cambiar de estado).
      transitionDuration: 0.7,

      // Ligera reducción de tamaño objetivo (0.9 = 90% del tamaño
      // normal). Se aplica sobre el mismo "growth" que ya existía, no
      // es un mecanismo nuevo — solo un objetivo distinto.
      growthTarget: 0.9,

      // Multiplica la amplitud de slow/fast/mid/tipChaos/stretch/twist
      // — los uniforms YA EXISTENTES que gobiernan cuánto se mueve la
      // malla — sin tocar sus valores base aquí en config (esos son los
      // que ya estaban ajustados y no se re-tocan). 1.4 = 40% más de
      // movimiento: perceptible, no exagerado.
      turbulenceBoost: 1.4,

      // Acelera el "tiempo" que alimenta TODO el ruido del shader
      // (vértices y color a la vez, es un único reloj). 1.35 = 35% más
      // rápido: da irregularidad temporal sin llegar a un parpadeo tipo
      // bombilla (eso dependería de la FRECUENCIA de flickerSpeed, que
      // no se toca).
      timeScale: 1.35,

      // Multiplican, temporalmente, el parpadeo y la respiración de luz
      // ya definidos en light.flickerStrength/breatheStrength — no los
      // sustituyen, los amplifican mientras dura la inestabilidad.
      flickerMultiplier: 1.6,
      breatheMultiplier: 1.8,

      // Inclinación del grupo visual completo (pivote en la base, sobre
      // la mecha — la base no se desplaza, solo se inclina lo que hay
      // encima, como pediría una corriente de aire suave). Ángulo
      // máximo en radianes (0.05 rad ≈ 2.9°: sutil) y velocidad del
      // ruido que lo mueve (muy lento, no es un temblor).
      tiltAmplitude: 0.05,
      tiltSpeed: 0.5,
    },

    // EXTINGUISHING: solo necesita un parámetro nuevo de verdad — el
    // resto de su ritmo ya lo gobierna light.extinguishDuration (ajustado
    // arriba).
    extinguishing: {
      // Cuánto tarda uTopFadeAmount en llegar a 1 (máximo debilitamiento
      // desde arriba). Deliberadamente más RÁPIDO que
      // light.extinguishDuration (0.9): así la parte alta ya está muy
      // debilitada bastante antes de que el resto (tamaño/opacidad
      // general, que sigue el ritmo más lento de extinguishDuration)
      // termine de desvanecerse — es lo que hace que la base "aguante
      // un instante" de forma natural, sin necesitar lógica de
      // secuenciación aparte.
      topFadeDuration: 0.4,
    },
  },

  // Marcador técnico de posición (una pequeña cruz + esfera wireframe en
  // el ancla de la llama, ver createDebugMarker() en flame.js).
  //
  // CAUSA DEL "CÍRCULO MORADO" (encontrada esta iteración, no es un bug
  // nuevo de código — ya existía, solo que antes DEBUG estaba en false):
  // `config.js` tiene `DEBUG = true`. El marcador se creaba con
  // `if (DEBUG) { ... }` en flame.js — es decir, se mostraba SIEMPRE que
  // el flag de desarrollo global estuviera activo, sin ninguna forma de
  // desactivarlo solo para la llama sin tocar ese flag global (que
  // probablemente otras partes del proyecto — cerillas, escena — también
  // usan para SU propio desarrollo, y `config.js` está fuera del ámbito
  // de estos cambios). El marcador es una esfera wireframe magenta
  // (0xff00ff) sin transparencia ni iluminación, exactamente en el punto
  // de anclaje de la llama (la base) — de ahí el "círculo/halo morado
  // separado, como un objeto independiente" que se veía.
  //
  // Arreglo: se desacopla del DEBUG global con este flag propio de la
  // llama, en false por defecto. Así, aunque DEBUG esté en true para
  // desarrollar otra cosa, el marcador de la llama se queda oculto salvo
  // que se active explícitamente aquí.
  showDebugMarker: false,

  // Color del marcador técnico, si se activa showDebugMarker arriba.
  // Deliberadamente NO es un color de fuego, para no confundirlo nunca
  // con la llama real.
  debugMarkerColor: 0xff00ff,
};