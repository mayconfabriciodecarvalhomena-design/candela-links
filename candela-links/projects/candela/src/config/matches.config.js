// -----------------------------------------------------------------------
// MATCHES CONFIG: fuente de verdad de la configuración del sistema de
// cerillas (`matches.js`, `matchVisual.js`, `matchesController.js`).
// -----------------------------------------------------------------------

export const MATCHES_CONFIG = {
  // ---- MECÁNICA (matches.js) ----
  // Ya NO hay duración de combustión: una vez encendida, la llama de la
  // cerilla permanece estable indefinidamente. Solo se apaga cuando se
  // usa sobre la vela (o manualmente). Ver matches.js.
  mechanics: {
    totalMatches: 3,
  },

  // ---- VISUAL: la cerilla 3D (matchVisual.js) ----
  //
  // ACTUALIZADO — mesa de noche (room.config.js): `position` y
  // `box.position` (más abajo) ahora colocan las cerillas SOBRE LA
  // MESA, cerca de CONFIG.candle.position ([-0.4, 1.0, -1.25]) en vez
  // de en el suelo abierto. Es un cambio deliberadamente pequeño y
  // acotado: solo estos dos puntos de reposo, más `heldPosition` y los
  // dos valores de `interaction` de más abajo (candleWickPosition), que son los únicos que codifican posición
  // ABSOLUTA en el mundo. Todo lo demás en este archivo (secuencia de
  // encendido, chispas, humo, radios de interacción...) son
  // desplazamientos/tiempos RELATIVOS y no se han tocado.
  //
  // REVISADO (excepción puntual, solo coordenadas X) — inversión
  // horizontal de la composición de la habitación (ver room.config.js/
  // CONFIG.camera): las 4 posiciones absolutas de este archivo
  // (visual.position, box.position, heldPosition, interaction.
  // candleWickPosition) tienen su X negada, en consonancia con el
  // nuevo CONFIG.candle.position ([0.4, 1.0, -1.25]) y la mesa movida
  // (room.config.js). Y/Z, rotaciones de reposo, radios de contacto y
  // el resto del archivo (secuencia de encendido, chispas, humo,
  // matchesController.js/matches.js/matchvisual.js) permanecen
  // exactamente igual — cero cambios de comportamiento/interacción.
  visual: {
    // AJUSTE DE COMPOSICIÓN (distribución de mesa): reubicación de
    // solo posición para agrupar cerillas en el lado DERECHO de la
    // mesa junto a la vela. La cámara diagonal requiere combinar X
    // alto + Z más alto para que los objetos proyecten a la derecha
    // en pantalla. Cerilla y caja acompañan a la vela (x=0.4) en su
    // zona, formando un grupo visual con Hello Kitty (más a la derecha).
    // Sin cambios en rotación ni en ninguna otra propiedad.
    position: [1.12, 1.0, -1.07],
    restRotationY: -0.35,
    restTiltX: 0.06,

    // Palo: cilindro cónico con una ligera curva orgánica (nunca
    // perfectamente recto) y una textura de veta horneada en un canvas,
    // para que se lea como madera y no como una barra de color liso.
    shaftLength: 0.21,
    shaftRadiusBottom: 0.0035,
    shaftRadiusTop: 0.0026,
    shaftBend: 0.004, // desviación lateral máxima, hacia la punta

    // Cabeza: perfil de revolución (LatheGeometry) bulboso y redondeado,
    // como una cerilla real — un único sólido, no esferas superpuestas.
    headRadius: 0.0078,
    headHeight: 0.016,
    headOverlap: 0.003, // cuánto se hunde en el palo, para que no haya hueco

    // A qué fracción de headHeight se ancla la base de la llama.
    // REVISADO esta iteración: ya NO es una fracción elegida a ojo
    // (antes 0.55, el punto de radio máximo del perfil) — es el
    // CENTROIDE VOLUMÉTRICO real del sólido de revolución de la cabeza,
    // calculado integrando el área de sección (pi·r(y)²) sobre el mismo
    // perfil de 7 puntos que usa `buildMatchStick` en matchVisual.js
    // (regla del trapecio, 2000 muestras). Da 0.4946, más profundo que
    // el ecuador de 0.55 — el centroide de este perfil concreto cae por
    // debajo del punto de radio máximo porque la base (aunque estrecha)
    // aporta volumen a lo largo de un tramo más largo que la punta
    // afilada de arriba. Ver el bloque de investigación junto a
    // `headAnchorY` en matchVisual.js para el porqué de este cambio
    // (incluye por qué NO se ha tocado `restTiltX`/`heldTiltX`, que es
    // la causa real de que la cerilla se vea distinta entre poses). Si
    // se cambia el perfil de la cabeza, hay que recalcular este valor.
    headFlameAnchorFrac: 0.4946,

    woodColor: 0xc9975e,
    woodColorDark: 0x6b4a2e, // color de las vetas
    headColor: 0x6b2f22,
    headColorLit: 0xff8a3d,
    litLight: {
      color: 0xff9a4a,
      intensity: 0.9,
      distance: 1.4,
    },

    // Pose "sujeta en la mano", una vez encendida y libre de moverse
    // (fin del click 1 / secuencia de raspado, ver "release" en
    // matchvisual.js). CORREGIDO: la posición anterior ([0.1, 1.4,
    // -0.6]) quedaba muy por delante de la vela hacia la cámara (Z=-0.6
    // frente a Z=-1.25 de la vela/mecha) y por debajo de la mecha
    // (Y=1.4 frente a Y=1.57) — se leía como "cerilla flotando delante
    // de la vela", no como "preparada al lado". Ahora: misma Y que
    // candleWickPosition (1.57, misma altura que la mecha) y misma Z
    // que la vela (-1.25, ni delante ni detrás), con un desplazamiento
    // lateral en X (mismo lado +X en el que ya descansan la cerilla y
    // la caja respecto a la vela en x=0.4) para separarla del cuerpo de
    // la vela sin cruzarse por delante. Nota: esto NO afecta al destino
    // del click 2 (ver approachOffset más abajo, en `interaction` —
    // son dos posiciones independientes; startAutoIgnition en
    // matchvisual.js nunca lee heldPosition).
    heldPosition: [0.8, 1.57, -1.25],
    heldRotationY: -0.5,
    heldTiltX: -0.3,
  },

  // ---- CAJA DE CERILLAS: geometría propia, con una superficie de
  // fricción lateral bien definida. Ya NO se queda fija en el suelo
  // durante el encendido: se levanta junto con la cerilla (ver
  // `liftOffset`/`strikeSequence` más abajo). ----
  box: {
    // Ver nota de "ACTUALIZADO — mesa de noche" en `visual` más arriba:
    // misma coordinación, ahora sobre la mesa junto a la cerilla.
    //
    // AJUSTE DE COMPOSICIÓN (distribución de mesa): la caja acompaña
    // a la cerilla en el grupo derecho, ligeramente a la izquierda y
    // por detrás. Solo posición — rotación (`rotationY`) sin cambios.
    position: [0.96, 1.0, -1.10],
    rotationY: -0.15,
    size: { width: 0.16, height: 0.05, depth: 0.09 },
    color: 0xb3452f,
    strikingSurface: {
      color: 0x3a332c,
      width: 0.1,
      height: 0.028,
      inset: 0.001,
    },
    // Desplazamiento (en espacio local de reposo de la caja) hasta la
    // posición "levantada, en uso" que adopta durante todo el gesto de
    // encendido: más arriba y algo más cerca/orientada hacia la cámara,
    // como si el usuario la hubiera cogido del suelo.
    liftOffset: [-0.04, 0.32, 0.18],
    liftRotationY: 0.5, // gira ligeramente hacia la cerilla al levantarla
  },

  // ---- LLAMA PROPIA DE LA CERILLA: un THREE.Sprite (billboard real,
  // siempre orientado a cámara — nunca muestra un canto plano/geométrico
  // desde ningún ángulo) con una textura de canvas donde el gradiente de
  // temperatura está pintado con círculos suaves superpuestos, SIN
  // ningún contorno recortado — así no hay ningún borde duro en toda la
  // silueta. Independiente por completo de flame.js/flameShader.js. ----
  matchFlame: {
    // REVISADO esta iteración: el anclaje se mide desde headAnchorY
    // (arriba en `visual`, headFlameAnchorFrac — ahora el centroide
    // volumétrico real de la cabeza, no un punto elegido a ojo; ver el
    // bloque de investigación junto a headAnchorY en matchVisual.js).
    // Como el centroide ya cae bien dentro del cuerpo del bulbo,
    // headSink baja de 0.004 a un ajuste fino mucho menor: ya no hace
    // falta que cargue con la mayor parte del "hundido en la cabeza",
    // solo un pequeño empujón adicional hacia el cuerpo.
    headSink: 0.0015,

    // Tamaño: SIN CAMBIOS esta iteración (petición explícita: primero
    // orientación/anclaje, la altura se revisa después). Se mantiene en
    // 0.05 (antes 0.039), ~3.1x la altura de la cabeza (0.016).
    width: 0.025,
    height: 0.05,

    // ---- FORMA: misma fórmula que flameShader.js (flameWidth), no solo
    // los mismos números — es la pieza que evita el "rombo/vértice": al
    // construirse como riseFactor*fallFactor con smoothstep en ambos
    // tramos, la pendiente es CERO exactamente en el vientre por
    // construcción, así que el punto más ancho queda redondeado (como
    // una duna), nunca como la punta de un diamante. ----
    shape: {
      baseWidthRel: 0.62, // anchura en la base, relativa a bodyWidthRel — ancha, envuelve la cabeza
      bodyWidthRel: 1.0, // anchura máxima (el "vientre"), siempre 1.0 — el resto se expresa relativo a esto
      bulgeHeight: 0.24, // a qué fracción de la altura está el vientre (tercio inferior, como una llama real)
      tipSharpness: 1.9, // más alto que la vela (1.6): cerilla = punta más fina y nerviosa
    },

    // ---- BORDE: ruido fractal (FBM, varias octavas rotadas) en vez de
    // sumas de senos — contorno irregular de verdad, no una silueta lisa
    // con un temblor superpuesto. ----
    edge: {
      scale: 9, // frecuencia del ruido a lo largo de la altura
      strength: 0.16, // cuánto desvía el borde respecto a la anchura "limpia"
    },

    // ---- CAMPO DE CALOR: el color no se pinta por bandas geométricas
    // (una franja azul, luego naranja, luego amarilla) — se calcula un
    // único campo escalar de "calor" por píxel (tendencia según altura y
    // distancia al eje central, más ruido fractal) y ES ESE CAMPO el que
    // decide el color. La frontera entre naranja/amarillo/blanco sale
    // del ruido, no de una curva geométrica limpia. ----
    heat: {
      riseStart: 0, // el calor empieza a subir desde la base...
      riseEnd: 0.16, // ...y llega a su tendencia máxima aquí
      fallStart: 0.4, // ...se mantiene hasta aquí...
      fallEnd: 0.92, // ...y baja hacia la punta (más fría/rojiza) hasta aquí
      turbulence: 0.55, // cuánto pesa el ruido fractal frente a la tendencia limpia
      fieldScale: 5, // frecuencia del campo de ruido interno
    },

    // COLORES: mismo lenguaje que la llama de la vela (misma paleta,
    // mismos nombres) para que ambas se sientan del mismo universo
    // visual, adaptados a una llama más pequeña y nerviosa.
    colors: {
      core: 0xfffcf0, // blanco cálido, el punto más caliente
      yellow: 0xffcf3d,
      orange: 0xff7a1a,
      edge: 0x7a1808, // rojo oscuro, borde exterior y punta
      blue: 0x5a95f0, // azul luminoso (no oscuro/apagado), como en la vela

      // Zona azul: debe llegar físicamente hasta el punto de contacto
      // con la cabeza y mezclarse con el naranja/amarillo, no quedar
      // como una mancha pegada encima — por eso `heatSuppress` (ver
      // abajo): en vez de mezclar azul ENCIMA de un fondo que ya podría
      // ser amarillo por el ruido, se apaga el calor DENTRO de la zona
      // azul ANTES de decidir el color, así el azul manda de verdad ahí.
      blueHeight: 0.24, // hasta qué fracción de la altura llega
      blueRadius: 0.62, // qué proporción de la anchura local ocupa
      blueStrength: 0.95, // cuánto se mezcla en su punto más fuerte
      blueHeatSuppress: 0.92, // cuánto impide que el ruido encienda amarillo/blanco ahí dentro
    },

    // Envolvente exterior más transparente (separa visualmente
    // núcleo/cuerpo/exterior, en vez de una opacidad uniforme hasta el
    // borde difuso).
    outer: {
      start: 0.5, // a partir de qué distancia al eje (0=centro,1=borde) empieza a bajar
      alpha: 0.5, // opacidad mínima de la envolvente exterior
    },

    // ---- ANIMACIÓN: dos capas superpuestas (texturas con semillas de
    // ruido distintas, ver buildFlame en matchvisual.js) — igual que la
    // vela superpone varios planos con patrones distintos para dar
    // sensación de volumen en vez de "cartón plano", aquí se superponen
    // dos sprites (no planos: un sprite SIEMPRE mira a cámara, lo que
    // evita que la llama se vea de canto durante el giro de ~110° de la
    // cerilla al rascar — un plano rígido sí sufriría eso). Cada capa
    // tiene su propio desfase de tiempo, así no se mueven en bloque.
    // Todo más SUTIL que antes (sway más bajo) y más rápido/nervioso
    // (flickerSpeed más alto) que la llama, más grande y calmada, de la
    // vela. ----
    animation: {
      flickerSpeed: 3.2,
      flickerAmount: 0.16,
      sway: 0.1,
      driftSpeed: 0.5,
      driftAmount: 0.14,
    },

    light: {
      color: 0xffab5c, // cálido, naranja — nunca blanco
      maxIntensity: 1.5,
      distance: 1.2,
    },
  },

  // ---- CHISPAS: se usan en DOS momentos — ráfagas direccionales
  // durante el raspado (fricción, ver strikeSequence) y una emisión
  // ambiental suave y continua mientras la llama está realmente
  // encendida (embers ascendiendo desde la llamita). Pocas, con tamaño y
  // vida variables por partícula, varios colores. ----
  sparks: {
    enabled: true,
    // Nº máximo de chispas ambientales vivas a la vez (además del pool
    // usado por las ráfagas de fricción, que reutiliza el mismo sistema).
    count: 12,
    speed: { min: 0.15, max: 0.5 },
    // Tamaño: se usa el promedio de min/max como tamaño único de todo el
    // sistema (sin variación individual por partícula — simplificado
    // para reducir código; el color sí varía por partícula, ver `colors`).
    size: { min: 0.006, max: 0.016 },
    life: { min: 0.4, max: 0.9 },
    // Dispersión angular respecto a la dirección principal (radianes).
    spread: 0.35,
    colors: [0xffaa33, 0xffee88, 0xfffeef],
    // Cadencia de aparición de la emisión AMBIENTAL (mientras arde,
    // fuera del raspado): un intervalo aleatorio entre min y max.
    ambientEmitInterval: { min: 0.12, max: 0.3 },
    // Partículas por emisión durante el RASPADO (fricción); la emisión
    // ambiental siempre añade 1 por disparo.
    countPerEmit: 2,
    gravity: 0.6,
  },

  // ---- HUMO: MUY sutil. Pocas partículas grisáceas que aparecen de vez
  // en cuando sobre la llama, ascienden despacio y se desvanecen (se
  // apagan al final de su vida, sin fade progresivo individual — ver
  // buildEmbers en matchvisual.js, simplificado para reducir código).
  // Desactivable con `enabled: false`. ----
  smoke: {
    enabled: true,
    count: 6,
    speed: 0.4,
    size: { min: 0.01, max: 0.02 },
    life: { min: 1.2, max: 2.5 },
    color: 0x555555,
    // Pequeño balanceo lateral mientras asciende.
    sway: 0.05,
    // "Ocasionalmente": intervalo aleatorio entre puffs.
    spawnInterval: { min: 0.5, max: 1.1 },
  },

  // ---- ANIMACIÓN DE ESTADOS SIMPLES (matchVisual.js): fallo de intento
  // (cerilla en reposo) y caída por agotamiento. El apagado real ahora
  // solo ocurre tras encender la vela (ver strikeSequence más abajo para
  // la secuencia de encendido en sí). ----
  animation: {
    extinguishDuration: 0.4,
    returnDuration: 0.6,
    failShake: {
      duration: 0.28,
      strength: 0.14,
      frequency: 26,
    },
    depletedTiltX: 1.1,
    depletedDuration: 0.5,
  },

  // ---- SECUENCIA DE ENCENDIDO (matchesController.js orquesta,
  // matchVisual.js anima). Pensada para ser claramente perceptible y
  // cinematográfica, no instantánea: caja y cerilla se levantan juntas,
  // varias pasadas de raspado con pequeñas pausas y variación natural
  // entre ellas, encendido progresivo y una fase de estabilización antes
  // de soltar el control al usuario. ----
  strikeSequence: {
    // Caja y cerilla suben juntas desde su pose de reposo hasta la
    // posición de uso (box.liftOffset / posición junto a la franja).
    liftDuration: 0.55,

    // Raspado: varias pasadas de ida, cada una con una pequeña pausa
    // detrás para que se lea como gesto repetido, no como un único
    // barrido. `scrapeStrokeVariation` (0-1) aplica una variación
    // aleatoria pequeña a la duración/distancia de cada pasada, para que
    // no se vea mecánicamente idéntica.
    scrapeStrokes: 4,
    scrapeStrokeDuration: 0.22,
    scrapePauseDuration: 0.1,
    scrapeStrokeVariation: 0.18,
    scrapeDistance: 0.06,
    scrapeJitter: 0.045,
    // Cada cuántos segundos se emite un pequeño grupo de chispas
    // mientras la cabeza está en la zona de contacto de la pasada
    // (emisión continua, no una única ráfaga al final).
    sparkEmitInterval: 0.035,

    // Pausa breve tras la última pasada, antes de que prenda.
    igniteDelay: 0.12,

    // Encendido progresivo de la cabeza y la llamita, y tiempo que se
    // mantiene "asentándose" antes de devolver el control al usuario.
    flameGrowDuration: 0.45,
    flameStabilizeDuration: 0.5,

    // Caja vuelve a su sitio mientras la cerilla pasa a la pose "sujeta
    // en la mano", en paralelo.
    releaseDuration: 0.45,
  },

  // ---- INTERACCIÓN (matchesController.js) ----
  interaction: {
    hitRadius: 0.28,
    cursor: "pointer",

    // Auto-ignición: al hacer click sobre la cerilla ya encendida y
    // libre, la raíz se anima suavemente (easeInOut) hasta que la llama
    // coincide con candleWickPosition. Duración de la animación.
    autoIgnitionDuration: 0.8,

    // Punto de contacto con la mecha de la vela, definido aquí de forma
    // INDEPENDIENTE (mismo criterio que particles.config.js con
    // lightInfluence.center): el sistema de cerillas no debe depender de
    // candle.js ni de flame.js. Si la posición de la vela/llama cambia
    // de forma notable, este valor puede necesitar un ajuste manual.
    // ACTUALIZADO — corrección de composición: coordinado con el nuevo
    // CONFIG.candle.targetHeight (0.62, antes 0.55); X/Z siguen copiando
    // los de la vela (sin cambios) y la Y sube para mantener el mismo
    // desnivel relativo (+0.05) que antes tenía sobre su punto de apoyo.
    candleWickPosition: [0.4, 1.57, -1.25],
    // PRUEBA de contacto visual: radio ajustado para que la cerilla
    // siga avanzando durante el click 2 hasta que la llama quede
    // prácticamente tocando la mecha antes de encenderse la vela.
    // 0.05 dejaba la llama perfecta pero la vela no llegaba a encenderse
    // (quedaba estática); subido a 0.08 buscando el equilibrio:
    // llama visualmente sobre la mecha Y detección de contacto disparada.
    candleContactRadius: 0.08,

    // Offset visual respecto a `candleWickPosition`, aplicado SOLO al
    // destino del click 2 (startAutoIgnition en matchvisual.js) — NO
    // afecta a heldPosition (click 1), que es una posición fija
    // independiente. PRUEBA: primero componente llevado a -0.05 (antes
    // 0.09) para desplazar el destino visual de la llama ~0.14 unidades
    // más a la izquierda (-X) y que la llama, no solo el extremo del
    // palo, quede tocando la mecha. El resto (0, 0.05) sin cambios.
    // Nota: el encendido se dispara por distancia de la llama a
    // candleWickPosition (candleContactRadius=0.22) durante la
    // animación, así que el destino exacto de este offset condiciona
    // menos la posición final de lo que cabría esperar; pendiente de
    // verificación visual.
    approachOffset: [-0.05, 0, 0.05],
  },
};