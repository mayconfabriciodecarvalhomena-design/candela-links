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


    meaning: "El nombre Candela simboliza luz, claridad, guía y esperanza; una luz capaz de iluminar incluso en los momentos más oscuros. Y para mí, tú has sido justamente eso. Has sido esa luz en momentos en los que todo parecía un poco más oscuro, esa persona capaz de hacer que todo se sintiera mejor simplemente estando ahí. Eres de esas personas que hacen que la vida se sienta más bonita, y no creo que pueda explicar con palabras lo mucho que significas para mí. Solo sé que, entre tantas personas, tuve la suerte de encontrarte a ti. Y si Candela significa luz, para mí tú siempre vas a ser la más bonita de todas.",



    buttonLabel: "CARGAR ESCENA",
    // Texto del botón opcional "saltar animación" (ver src/intro.js,
    // createIntro({ showSkip })): solo se crea/usa cuando
    // src/skipIntro.js detecta una visita anterior en este navegador.
    skipButtonLabel: "SALTAR ANIMACIÓN",
    // Mientras la escena todavía se está preparando, el botón muestra
    // este texto seguido del porcentaje real de carga (p. ej.
    // "CARGANDO ESCENA 42%"). En cuanto termina, se sustituye por
    // `buttonLabel`. Ver src/intro.js (setLoadingProgress/setReady).
    loadingLabel: "CARGANDO ESCENA",
    // Ver src/intro.js (setLoadError) y src/main.js (FASE 2/3/4 de esta
    // iteración): se muestran solo si la carga/inicialización de la
    // escena falla de forma irrecuperable (loader, timeout, excepción
    // síncrona o pérdida de contexto WebGL). En el uso normal, sin
    // errores, estos dos textos nunca llegan a mostrarse.
    loadErrorMessage: "No se ha podido cargar la escena.",
    retryButtonLabel: "REINTENTAR",
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
    firstExtinguish: "La primera vez fue un destello de amor fuerte pero no fue lo suficiente para que la llama siguiera.",

    // Aparece justo después de que la llama se apague por segunda vez.
    secondExtinguish: "La segunda vez con un poco de inteligencia se intenta reavivar, aunque por otros motivos no sigue adelante algo a cambiado.",

    // Aparece cuando la llama se enciende por tercera vez y ya no se
    // apaga: el momento en el que la vela se queda encendida de verdad.
    finalLight: "La terceraa vez se queda con nosotros, quien sabe si se apagara pero lo unico que podemos estar seguros es que ahi una llama entre nosotros.",
  },
};
