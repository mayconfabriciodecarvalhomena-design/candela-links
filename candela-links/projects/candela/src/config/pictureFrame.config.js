// -----------------------------------------------------------------------
// PICTURE_FRAME_CONFIG: cuadro decorativo colgado en la pared del fondo
// (`src/pictureFrame.js`), la misma pared contra la que está pegada la
// mesa de noche y la vela (ver `ROOM_CONFIG.wall.back` en
// room.config.js). Fuente de verdad de este sistema — config.js solo lo
// importa y lo expone como CONFIG.pictureFrame, sin duplicar valores.
//
// Elemento nuevo, independiente y estático (no se anima, no se registra
// en onUpdate() — mismo criterio que room.js): igual que el espejo
// (ROOM_CONFIG.mirror), pero fuera de room.js porque es un añadido
// posterior y modular, no parte del "plano" original de la habitación.
//
// POSICIÓN — inspección hecha antes de elegir estos números:
//   - La vela (CONFIG.candle, src/config.js) está en x=0.4, z=-1.25,
//     apoyada en la mesa (TABLE_TOP_Y=1.0) con targetHeight=0.62, así
//     que su punto más alto ronda y≈1.62 (la mecha real, algo más baja,
//     vive en candleWickPosition.y=1.57 — ver matches.config.js).
//   - La pared del fondo (ROOM_CONFIG.wall.back) es la pared contra la
//     que está pegada la mesa (su borde trasero, en z≈-1.58, casi toca
//     la cara frontal de esta pared, en z=-1.57 = back.position[1]
//     (-1.6) + thickness/2 (0.03)) — es, sin duda, la pared "donde está
//     la vela".
//   - Cámara (CONFIG.camera): position=[-0.05,1.55,1.3],
//     lookAt=[0.7,1.3,-1.25] — mira hacia la zona de la vela/mesa, con
//     margen vertical de sobra por encima de esa línea de mira para que
//     un cuadro alrededor de y≈2.0-2.4 quede dentro de encuadre, y
//     margen horizontal de sobra a la derecha de la vela (x=0.4) antes
//     de llegar a la esquina con la pared lateral (wall.side, en x=3.0).
//   - `position` de aquí abajo son las coordenadas [x, z] del PLANO DE
//     LA FOTO (no del marco — igual que en `ROOM_CONFIG.mirror`, el
//     marco se calcula hacia atrás desde este plano, ver
//     pictureFrame.js). z coincide con la cara frontal de la pared del
//     fondo (mismo criterio que el espejo con su pared): el cuadro
//     queda PEGADO a la pared, no flotando delante de ella.
export const PICTURE_FRAME_CONFIG = {
  // x: a la derecha de la vela. Desplazado +0.15 esta iteración
  // (1.30 → 1.45) para mover el cuadro un poco más a la derecha,
  // manteniendo el resto igual. Con el ancho exterior (0.85 + margin*2
  // = 0.94) el marco ahora ocupa aprox. x=[0.98, 1.92] — comprobado que
  // sigue dentro del encuadre de la cámara
  // (camera.position=[-0.05,1.55,1.3], camera.lookAt=[0.7,1.3,-1.25])
  // y con margen de sobra antes de la esquina de la habitación (x=3.0).
  // z: cara frontal de wall.back (back.position[1] + thickness/2 =
  // -1.6 + 0.03 = -1.57).
  position: [1.45, -1.57],

  // Altura del centro del cuadro. Con height=0.55 (más margin, ver
  // frame.margin) el borde inferior queda en ≈1.83 — claramente por
  // encima de la vela (≈1.62) — y el superior en ≈2.47, bien por debajo
  // del techo de la pared (wall.height=4.2). Sin cambios respecto a la
  // iteración anterior: el nuevo tamaño (más ancho) no afecta a esta Y.
  centerY: 2.15,

  // Orientación: 0 = pared del fondo (cara visible hacia +Z, hacia la
  // cámara) — mismo campo/criterio que ROOM_CONFIG.mirror.rotationY y
  // ROOM_CONFIG.wall.side.rotationY. Se deja explícito (en vez de
  // asumir 0 a pelo en pictureFrame.js) para poder mover el cuadro a
  // otra pared en el futuro sin tocar código, igual que ya soporta
  // addMirror en room.js.
  rotationY: 0,

  // Tamaño de la ZONA DE IMAGEN (dentro del marco, sin contar el
  // borde). CORREGIDO esta iteración: la petición anterior pedía
  // "retrato" (más alto que ancho, 0.45x0.62) por error — ahora debe
  // ser HORIZONTAL, claramente más ancho que alto, proporción ~1.5:1
  // (0.85 / 0.55 = 1.545), y bastante más grande en área que antes
  // (0.45x0.62=0.279 antes, 0.85x0.55=0.4675 ahora, ~1.7x más grande)
  // sin dominar la pared: con margin=0.045 el marco exterior mide
  // 0.94x0.64, dejando de sobra los márgenes ya comprobados en
  // `position`/`centerY` (respecto a la vela, la esquina de la
  // habitación y el techo).
  width: 0.85,
  height: 0.55,

  frame: {
    // Grosor del borde de madera visible alrededor de la imagen
    // (mismo campo que ROOM_CONFIG.mirror.frame.margin).
    margin: 0.045,
    // Profundidad del marco (cuánto sobresale de la pared). Pequeña
    // pero perceptible — para que se note como objeto con volumen
    // real, no como una foto pegada a la pared.
    depth: 0.035,
    color: 0x4a3323, // madera oscura cálida, tono similar al marco del espejo
    roughness: 0.65,
  },

  // Cuánto se hunde la imagen respecto a la cara frontal del marco —
  // como el cristal/passe-partout de un cuadro real, ligeramente
  // recedido dentro del borde. Ese pequeño hueco es lo que permite que
  // la luz de la escena (la llama, la ambiental) dibuje una sombra
  // sutil del marco sobre la imagen, en vez de quedar todo en el mismo
  // plano.
  imageInset: 0.012,

  // Refuerza el "colgado en la pared, no flotando": separación mínima
  // entre la cara trasera del marco y la pared, solo para evitar
  // z-fighting con la geometría de la pared (mismo criterio que
  // `frameGap` en addMirror, room.js).
  wallGap: 0.001,

  // -----------------------------------------------------------------------
  // IMAGEN: ruta al archivo que el usuario coloca en el proyecto.
  //
  // PARA CAMBIAR LA FOTO DEL CUADRO: sustituye el archivo en
  //   assets/images/cuadro.jpeg
  // por tu propia imagen (mismo nombre y extensión, o cambia
  // `imagePath` aquí abajo si prefieres otro nombre/ruta/formato). No
  // hace falta tocar ningún otro archivo ni recompilar nada especial —
  // pictureFrame.js la carga con THREE.TextureLoader al arrancar la
  // escena.
  //
  // Si el archivo todavía no existe (o falla la carga), el cuadro NO
  // rompe la escena: se rellena automáticamente con una textura de
  // marcador de posición (generada por canvas, mismo criterio "sin
  // imágenes externas" que ya usa room.js para la madera del suelo),
  // en los mismos tonos cálidos de Candela, para que sea evidente que
  // ahí falta poner una foto sin desentonar visualmente mientras tanto.
  // -----------------------------------------------------------------------
  imagePath: "assets/images/cuadro.jpeg",

  // La imagen puede no tener exactamente la proporción width/height de
  // aquí arriba. En vez de estirarla (deformando la foto),
  // pictureFrame.js la encuadra en modo "cover" (como
  // background-size:cover en CSS): recorta el sobrante manteniendo su
  // proporción original y centrando el recorte. Autocontenido en el
  // propio módulo, no necesita configuración aparte.
};
