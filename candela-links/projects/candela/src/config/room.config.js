// -----------------------------------------------------------------------
// ROOM_CONFIG: fuente de verdad del "plano" de habitación de Candela
// (src/room.js): suelo, pared, mesa, espejo y puerta. Sigue el mismo
// patrón que el resto de sistemas (flame.config.js, cat.config.js...):
// este archivo es responsabilidad exclusiva de room.js, y src/config.js
// solo lo importa y lo expone como CONFIG.room.
//
// IMPORTANTE — esto NO es la habitación completa de Candela, es
// deliberadamente un fragmento: un plano compuesto para reconocer la
// arquitectura (mesa, pared, espejo, puerta, suelo) sin construir las
// cuatro paredes ni un techo. Están hechas justo las dos paredes que se
// ven en cámara (fondo + lateral izquierda, formando una esquina real),
// nada más — así no hay geometría fantasma fuera de plano que mantener.
//
// TABLE_TOP_Y (altura de la superficie de la mesa) es la referencia que
// usan candle.config (vía config.js), cat.config.js y matches.config.js
// para saber dónde apoyan sus objetos. Como esos otros sistemas son
// independientes (mismo criterio ya usado con
// particles.config.js/lightInfluence.center o
// matches.config.js/candleWickPosition: valores world-space definidos
// por separado, no derivados automáticamente unos de otros), si
// TABLE_TOP_Y cambia aquí, hay que ajustar a mano la Y de:
//   - CONFIG.candle.position  (src/config.js)
//   - CAT_CONFIG.position     (src/config/cat.config.js)
//   - MATCHES_CONFIG.visual.position / box.position / heldPosition /
//     interaction.dragPlaneHeight / interaction.candleWickPosition
//     (src/config/matches.config.js)
//   - PARTICLES_CONFIG.lightInfluence.center
//     (src/config/particles.config.js)
// Todos estos ya están sincronizados a día de hoy con TABLE_TOP_Y = 1.0.
// -----------------------------------------------------------------------

export const TABLE_TOP_Y = 1.0;

export const ROOM_CONFIG = {
  // ---- SUELO: madera marrón oscura pero CÁLIDA, con textura de vetas
  // por canvas (sin imágenes externas), mismo criterio que ya usa
  // matchvisual.js para el palo de las cerillas.
  //
  // REVISADO — el color anterior (0x2a1710) leía como negro puro en
  // pantalla: bajo la luz ambiental tenue de la escena (0.15) un marrón
  // tan oscuro queda por debajo del umbral perceptible y el tone
  // mapping ACES lo aplasta a negro. Subido a un marrón cálido más
  // claro (sigue siendo "oscuro", pero perceptible como madera, no como
  // vacío) y el veteado ahora usa MÁS contraste (grainColor más oscuro
  // relativo, líneas de junta más marcadas) para que la textura se lea
  // incluso con poca luz. ----
  floor: {
    width: 10,
    depth: 8,
    // Centrado para cubrir toda la zona visible desde cámara (primer
    // plano incluido) sin dejar huecos en los bordes del encuadre.
    position: [0.5, 1.2],
    color: 0x5a3a24,
    grainColor: 0x2c1a0f,
    roughness: 0.8,
  },

  // ---- PAREDES: rosa empolvado, cálido y luminoso — no oscuro, no
  // rojizo/marrón/magenta. Dos tramos (fondo + lateral izquierda) que
  // forman una esquina real de habitación — no una caja completa.
  //
  // REVISADO — el rosa anterior (0xa07d78) tenía demasiado marrón
  // mezclado y leía como terracota apagada, no como "rosa empolyado
  // claro". Subido de luminosidad y de componente rosa/rojo relativo al
  // verde/azul. ----
  wall: {
    color: 0xdcb0a8,
    height: 4.2,
    thickness: 0.06,
    // Pared del fondo: recta a lo largo de X. La mesa larga y la puerta
    // viven ambas sobre este mismo tramo (mesa a la izquierda, puerta
    // inmediatamente a su derecha — ver `table` y `door` más abajo).
    back: {
      width: 9,
      position: [0, -1.6], // [x, z] — el centro en Y es height/2, calculado en room.js
    },
    // Pared lateral: perpendicular a la del fondo, cierra la esquina
    // por detrás de la mesa. rotationY determina hacia qué lado mira su
    // cara visible: +90° = mira hacia +X (pared a la izquierda, cara
    // visible hacia la habitación a su derecha), -90° = mira hacia -X
    // (pared a la derecha, cara visible hacia la habitación a su
    // izquierda).
    //
    // REVISADO — inversión horizontal de la composición (ver nota en
    // `mirror` y `door` más abajo, y CONFIG.camera en config.js): esta
    // pared pasa de la esquina IZQUIERDA (x=-3.0, rotationY=+90°) a la
    // DERECHA (x=+3.0, rotationY=-90°) — reflejo especular exacto
    // respecto al eje x=0 (el centro real de wall.back, que sí es
    // simétrico: spans de x=-4.5 a x=4.5).
    side: {
      width: 6, // tras la rotación, esta es su extensión a lo largo de Z
      position: [3.0, 0.9], // [x, z]
      rotationY: -Math.PI / 2,
    },
  },

  // ---- MESA: rediseñada como mesa larga de dormitorio/escritorio
  // real, pegada a la pared del fondo, ocupando casi todo el tramo
  // entre la esquina izquierda y la puerta.
  //
  // REVISADO — antes era un único bloque cerrado de suelo a tablero
  // (una "caja"): dominaba la composición y no dejaba hueco para
  // sentarse delante. Ahora es TABLERO + DOS PATAS/PIES (uno en cada
  // extremo), con la zona central bajo el tablero completamente
  // abierta — espacio real para piernas. Los pies siguen siendo
  // "cerrados" (bloques, no patas finas): cumple "los laterales pueden
  // estar cerrados", solo el centro debe quedar libre. ----
  table: {
    // Tablero: la pieza que define el largo real de la mesa.
    //
    // REVISADO — corrección de composición: el gato (cat.config.js,
    // huella aprox. 1.27 x 1.10 con su targetHeight actual) se salía
    // del tablero por el lado abierto de la habitación (la profundidad
    // Z original, 0.56, se quedaba corta). Aumentada la profundidad a
    // 0.9 SOLO hacia el frente (el lado de la habitación, no el de la
    // pared): el borde trasero se mantiene en el mismo sitio exacto
    // (pegado a la pared, sin tocarla ni separarse), y el centro (Z) se
    // desplaza lo justo para que ese borde trasero no se mueva. El
    // ancho (X) y la posición general no cambian.
    //
    // REVISADO — inversión horizontal de la composición: x pasa de
    // -0.7 a +0.7 (reflejo especular exacto respecto a x=0, el centro
    // real de wall.back). La profundidad (Z) NO cambia — la mesa
    // sigue igual de pegada a la pared del fondo que antes, la
    // inversión es solo de izquierda↔derecha, no de cerca↔lejos.
    top: {
      size: [3.4, 0.06, 0.9], // [ancho X, alto, profundo Z]
      position: [0.7, -1.13], // [x, z] — el centro en Y se calcula en room.js
      color: 0xede9e1,
      roughness: 0.55,
    },
    // Pies: dos bloques idénticos, uno bajo cada extremo del tablero,
    // ligeramente hacia dentro (inset) para que el tablero vuele un
    // poco en los bordes, como una mesa real. Mismo material que antes
    // (blanco cálido) para no introducir un color nuevo.
    //
    // Profundidad ajustada en la misma proporción que el tablero (misma
    // diferencia de 0.06 entre ambos que ya existía).
    leg: {
      size: [0.46, 0.94, 0.84], // [ancho X, alto, profundo Z]
      inset: 0.05, // separación desde el borde exterior del tablero
      color: 0xe1ded4,
    },
    // TABLE_TOP_Y (altura final de la superficie, leg.size[1] +
    // top.size[1]) se exporta arriba por separado para que otros
    // sistemas la usen sin importar toda la mesa. Con estos valores
    // (0.94 + 0.06) sigue dando 1.0, igual que antes — así candle,
    // cat, matches y particles NO necesitan tocar su coordenada Y.
  },

  // ---- ESPEJO: rectangular vertical, claramente más alto que ancho,
  // colgado en la PARED LATERAL IZQUIERDA (wall.side), cerca de la
  // esquina donde se une con la pared del fondo — NO sobre la mesa ni
  // en la pared de la mesa. Es un elemento secundario de fondo: desde
  // la cámara actual solo entra parcialmente en el encuadre por el
  // borde izquierdo, dando a entender que está ahí sin protagonizar la
  // composición.
  //
  // REVISADO — este era un material sólido (color/metalness/roughness/
  // emissive) que simulaba un "cristal claro", no un reflejo real —
  // por eso el espejo nunca reflejaba nada de la habitación, y con la
  // iluminación ambiental subida en la iteración anterior (ver
  // CONFIG.scene en config.js) ese emissive fijo se veía blanco puro.
  // Sustituido por un THREE.Reflector real (ver addMirror en room.js):
  // `color` ahora es el tinte que Reflector aplica sobre la reflexión
  // (lo multiplica, no lo sustituye) — 0x889999 es el valor estándar
  // de los ejemplos oficiales de Three.js: atenúa la reflexión a un
  // ~53% en vez de un espejo 100% perfecto (más realista, y evita que
  // la reflexión "queme" más que el resto de la habitación).
  //
  // REVISADO (2ª pasada) — corrección de composición: el espejo estaba
  // colgado sobre la propia mesa, en la pared del fondo. Movido a
  // wall.side (`rotationY: Math.PI/2`, igual que la propia pared lateral
  // — ver addMirror en room.js, ahora soporta cualquier orientación de
  // pared). La cámara NO se toca: es la posición del espejo la que se
  // ajusta para entrar solo parcialmente en su encuadre actual. ----
  mirror: {
    width: 0.78,
    height: 1.98,
    rotationY: -Math.PI / 2,
    // x: reflejo especular exacto de -2.94 respecto a x=0 (mismo
    // margen de ~0.03 respecto a la cara visible de wall.side, ahora en
    // +2.97). z: SIN cambios — la inversión es solo horizontal, la
    // distancia a la pared del fondo/esquina no se toca.
    position: [2.94, -0.8], // [x, z]
    // REVISADO (3ª pasada) — altura: centerY=1.95 hacía que el espejo
    // empezara aprox. a la altura de la mesa (TABLE_TOP_Y=1.0) y
    // terminara muy arriba, leyendo como "flotando junto a la mesa".
    // Bajado para que sea un espejo de pared normal: con height=1.98,
    // centerY=1.3 dado un borde inferior en 1.3-1.98/2=0.31 (cerca del
    // suelo, sin tocarlo) y superior en 2.29 (proporcionado a la altura
    // de la pared, 4.2).
    centerY: 1.3,
    color: 0x889999,
    frame: {
      color: 0x3b2a1e,
      margin: 0.04, // cuánto sobresale el marco respecto al cristal
      depth: 0.03,
    },
  },

  // ---- PUERTA: en la MISMA pared que la mesa (el fondo), inmediatamente
  // a la derecha del tablero, sin hueco de pared en medio. Panel sencillo
  // + pomo, sin marco decorativo elaborado.
  //
  // REVISADO — antes vivía en la pared lateral izquierda (una pared
  // distinta a la de la mesa). Movida a la pared del fondo y reorientada
  // (ahora es una caja fina en Z, ancha en X — antes era al revés,
  // pensada para la pared lateral).
  //
  // REVISADO (3ª pasada) — queda demasiado cerrada contra la pared (que
  // también es oscura). Un marco blanco de 3 cm separa visualmente la
  // puerta de la pared sin añadir elementos decorativos innecesarios: el
  // marco se lee por sombra/geometría (un leve relieve blanco sobre fondo
  // blanco), no por diferencia de color. El desnivel entre hoja y marco es
  // mínimo (reveal), pero suficiente para que la luz rasante de la llama
  // trace una línea de sombra que marque el contorno de la puerta. Diseño
  // minimalista preservado: blanco continuo, sin molduras, sin base. ----
  door: {
    width: 0.9,
    height: 2.0,
    // Posición sobre la pared del fondo (x la sitúa a lo largo del
    // muro; z fijo, pegada a la cara visible de la pared).
    //
    // REVISADO — inversión horizontal de la composición: x pasa de
    // +1.65 a -1.65 (reflejo especular exacto respecto a x=0). Antes la
    // puerta estaba inmediatamente a la DERECHA de la mesa; ahora, tras
    // invertir también la mesa (arriba), queda inmediatamente a su
    // IZQUIERDA — mismo hueco de separación (~0.2) que ya tenía.
    position: [-1.65, -1.58],
    color: 0xd8cfc2,
    frame: {
      color: 0xefe9e0, // blanco, casi idéntico a la hoja — la distinción viene del relieve, no del color
      margin: 0.045, // cuánto sobresale el marco respecto a la hoja, por lado
      depth: 0.03,
      reveal: 0.012, // hueco entre la cara frontal de la hoja y la del marco
    },
    knob: {
      radius: 0.035,
      color: 0x8a7550,
      // Desplazamiento respecto al borde de la puerta más cercano a la
      // mesa (lado de apertura natural).
      insetFromEdge: 0.08,
      height: 1.0,
      // REVISADO — inversión horizontal: la mesa ahora queda al lado
      // OPUESTO de la puerta respecto a antes (ver addDoor en room.js,
      // que generalizó la fórmula del pomo con este signo). -1 = mesa
      // en X negativo respecto a la puerta (comportamiento original);
      // +1 = mesa en X positivo (composición invertida, este caso).
      edgeSign: 1,
    },
  },
};
