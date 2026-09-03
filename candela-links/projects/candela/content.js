// -----------------------------------------------------------------------
// CONTENT: todos los textos de la experiencia vivirán aquí, separados de
// la lógica de Three.js. Se irá rellenando fase a fase (intro, mensajes
// de intentos fallidos, frases de la llama, mensaje final, botones...).
// -----------------------------------------------------------------------
export const CONTENT = {
  // ---------------------------------------------------------------------
  // INTRO: textos de la pantalla negra de entrada (src/intro.js), antes
  // de que el usuario pulse "cargar escena". Textos temporales —
  // sustitúyelos libremente por los definitivos, la lógica no depende
  // de su contenido.
  // ---------------------------------------------------------------------
  intro: {
    title: "CANDELA",
    // Pregunta introductoria: aparece primero, sola, y se desvanece
    // antes de que aparezca el título. Ver src/intro.js (.intro-question).
    question: "¿Qué significa Candela?",
    // Aparece justo debajo del título + subrayado, con menos presencia
    // que ambos. Reutiliza el mismo elemento/estilo que ya existía
    // (.intro-meaning); solo ha cambiado el texto.
    meaning: "Del latín candēla: vela, luz.",
    buttonLabel: "CARGAR ESCENA",
    // Mientras la escena todavía se está preparando, el botón muestra
    // este texto seguido del porcentaje real de carga (p. ej.
    // "CARGANDO ESCENA 42%"). En cuanto termina, se sustituye por
    // `buttonLabel`. Ver src/intro.js (setLoadingProgress/setReady).
    loadingLabel: "CARGANDO ESCENA",
  },

  // ---------------------------------------------------------------------
  // CANDLE SEQUENCE: frases que acompañan la secuencia de encendido de
  // la vela (src/candleSequence.js). La vela se enciende tres veces
  // antes de quedarse encendida para siempre; las dos primeras veces se
  // apaga sola y aparece una frase. Textos temporales — sustitúyelos
  // libremente por los definitivos, la lógica no depende de su
  // contenido.
  // ---------------------------------------------------------------------
  candleSequence: {
    // Aparece justo después de que la llama se apague por primera vez.
    firstExtinguish: "La llama tiembla y se rinde, como si aún no fuera el momento.",

    // Aparece justo después de que la llama se apague por segunda vez.
    secondExtinguish: "Otra vez la oscuridad. Pero algo, esta vez, se ha quedado despierto.",

    // Aparece cuando la llama se enciende por tercera vez y ya no se
    // apaga: el momento en el que la vela se queda encendida de verdad.
    finalLight: "Ahora sí. La luz se queda, y contigo también.",
  },
};
