// -----------------------------------------------------------------------
// CAMERA_PAN_CONFIG: fuente de verdad del paneo lateral de cámara por
// drag/swipe táctil (ver src/cameraPan.js, que es quien la consume, y
// scene.js, que solo sabe "rotar la cámara N radianes" sin conocer
// ninguno de estos valores — ver setCameraPanYaw() en scene.js).
//
// FILOSOFÍA — mismo criterio que RESPONSIVE_CONFIG (responsive.config.js):
// nada aquí es un valor inventado a ciegas. Los LÍMITES de paneo
// (cuántos grados puede girar la cámara a cada lado) NO se definen en
// este archivo como constantes fijas — se calculan en cameraPan.js, en
// cada frame, a partir de las posiciones REALES de la puerta y el
// espejo (CONFIG.room.door.position / CONFIG.room.mirror.position, ya
// definidas en room.config.js) y de la posición REAL de la cámara en
// ese instante (camera.position, que ya varía con `t` — ver
// responsive.config.js). Lo que este archivo sí define son los factores
// que convierten "el ángulo exacto que centraría la puerta/el espejo"
// en "el límite de paneo cómodo" (`centerMarginFactor`) y una válvula de
// seguridad para aspect ratios extremos no contemplados (`maxYawDegrees`).
// -----------------------------------------------------------------------
export const CAMERA_PAN_CONFIG = {
  // Solo se activa con gestos táctiles reales (event.pointerType ===
  // "touch", ver cameraPan.js) — nunca con ratón. Esta es la ÚNICA razón
  // por la que la composición de escritorio (sin pantalla táctil) queda
  // "prácticamente exactamente igual" sin necesidad de ninguna
  // comprobación adicional de aspect ratio/dispositivo: si no hay dedo
  // sobre la pantalla, panYawOffset nunca se toca y sigue en 0 — el
  // mismo comportamiento (nulo) que existía antes de esta iteración.
  limits: {
    // Cuánto se acerca cada límite al ángulo que centraría EXACTAMENTE
    // la puerta/el espejo en pantalla (1.0 = centrado exacto, 0.0 =
    // nada de paneo). REVISADO — 1.0 empujaría el resto de la
    // composición (mesa, vela, gato) casi por completo fuera de
    // encuadre en el extremo del recorrido, ya que el ángulo real hasta
    // la puerta/el espejo (~45°/~38° en el aspect ratio más ancho, algo
    // menos en portrait — ver el análisis numérico entregado junto a
    // esta iteración) es mayor que la mitad del FOV horizontal real
    // incluso en su versión más ancha (portrait.maxFov). 0.82 dado dos
    // márgenes: uno de sobra para que la puerta/el espejo entren
    // limpiamente sin quedar pegados al borde exacto de la pantalla, y
    // otro para que la mesa/vela/gato sigan asomando por el lado
    // contrario del encuadre en vez de desaparecer del todo — "siguen
    // formando parte de la escena" tal y como pide el encargo, no solo
    // "no se han movido de la escena".
    centerMarginFactor: 0.82,

    // Techo de seguridad absoluto (grados), independiente del cálculo
    // geométrico de arriba — red de seguridad para aspect ratios
    // extremos no contemplados en las comprobaciones (p. ej. una
    // ventana de escritorio redimensionada a mano a un ancho
    // absurdamente estrecho, o un futuro cambio de layout de la
    // habitación): ningún límite calculado puede superar este valor,
    // así que el paneo nunca puede llegar a mostrar "detrás" de la
    // cámara ni salirse de la habitación por muy raro que sea el
    // viewport.
    maxYawDegrees: 58,
  },

  // ---- Sensibilidad del gesto de arrastre ----
  drag: {
    // Cuántos grados de giro corresponden a un arrastre que recorra el
    // ANCHO COMPLETO del canvas (de lado a lado), antes de clampear al
    // límite real. No pretende ser "edge-to-edge = límite exacto" (los
    // límites varían con `t` y no tendría sentido fijar la sensibilidad
    // a un valor que solo encaja en un aspect ratio): es, simplemente,
    // una sensibilidad cómoda de panorámica táctil — un arrastre de
    // medio ancho de pantalla ya cubre la mayor parte del recorrido
    // típico en portrait (~20-25° de límite por lado a t=1).
    degreesPerFullWidth: 70,
  },

  // Velocidad de amortiguación (suavizado exponencial por segundo, ver
  // cameraPan.js): valores altos = la cámara "seagunta" el dedo con
  // menos retraso, valores bajos = paneo más gelatinoso/lento. Se aplica
  // TANTO durante el arrastre como después de soltar el dedo (el valor
  // objetivo se queda donde el usuario lo dejó — no hay "vuelta al
  // centro" automática al soltar, tal y como pide el encargo: "el
  // usuario podrá desplazar... para descubrir", una exploración que se
  // queda donde el usuario la deja).
  dampingSpeed: 9,
};
