import { fastForward } from "./scene.js";

// -----------------------------------------------------------------------
// SKIP INTRO: "SALTAR ANIMACIÓN" para quien ya haya visitado Candela
// antes desde este mismo navegador.
//
// Este módulo NO reimplementa nada de la secuencia de la vela, las
// palabras de la llama ni el final (sobre/carta) — orquesta las MISMAS
// funciones públicas que ya usa la experiencia normal
// (flame.ignite(), candleSequence.notifyIgnited/notifyExtinguished(),
// flameWords.stopAutoSequence/hide(), candelaFinale.start()) y luego usa
// `fastForward()` (ver src/scene.js) para dejar que cada sistema procese
// esas llamadas con su propio código de siempre, solo que en una
// fracción de segundo en vez de en tiempo real. No hay ningún setter
// "instantáneo" nuevo por sistema, ni una segunda implementación de la
// carta/el sobre.
// -----------------------------------------------------------------------

const STORAGE_KEY = "candela_visited_v1";

// localStorage puede fallar (modo privado estricto, cuota agotada,
// política del navegador...) — nunca debe romper la carga de Candela por
// esto, así que toda lectura/escritura va protegida. Si falla, el efecto
// práctico es simplemente que esa visita no se recuerda.
export function hasVisitedBefore() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch (e) {
    return false;
  }
}

export function markVisited() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch (e) {
    // Ver comentario de arriba: no pasa nada, solo no se recuerda.
  }
}

// ---- Supresión de narrativa durante el salto -----------------------
// candleSequence emite el evento "narrative" en cada extinción/encendido
// (ver main.js: candleSequence.on("narrative", ...) → showNarrativeLine).
// Durante el salto llamamos a notifyIgnited()/notifyExtinguished() varias
// veces seguidas para llevar candleSequence a FINAL_LIGHT reutilizando
// sus propias funciones (ver skipToLetterReady más abajo) — sin esta
// bandera, esas llamadas harían aparecer y desaparecer 2-3 frases de
// narrativa de golpe. No toca candleSequence.js ni narrative.js: es una
// bandera de consulta que main.js revisa en su listener existente antes
// de llamar a showNarrativeLine.
let narrativeSuppressed = false;

export function isNarrativeSuppressed() {
  return narrativeSuppressed;
}

function setNarrativeSuppressed(value) {
  narrativeSuppressed = Boolean(value);
}

// ---- skipToLetterReady ------------------------------------------------
// Lleva vela + candleSequence + flameWords + candelaFinale hasta el
// mismo estado final ("carta lista, página 5 escribible") que produce la
// experiencia normal. Recibe los sistemas ya creados por main.js
// (startScene()) como parámetros — este módulo no crea ni conoce
// ninguno de esos objetos por su cuenta.
export function skipToLetterReady({ flame, candleSequence, flameWords, candelaFinale }) {
  // Guard: si ya hay algo en marcha (o ya se completó antes), no
  // interferir — evita un doble disparo si por lo que sea se llamara
  // dos veces (los botones de intro.js ya se protegen a su vez con su
  // propio flag `started`, esto es una segunda red de seguridad).
  if (candelaFinale.getPhase() !== "idle") return;

  setNarrativeSuppressed(true);

  // 1) Vela: un único ignite() real (la función que ya existe). La
  //    curva de crecimiento de flame.js converge sola con un delta
  //    grande — no hace falta ningún "instant" — ver el fastForward()
  //    de más abajo.
  flame.ignite();

  // 2) candleSequence: se lleva a FINAL_LIGHT reutilizando sus propias
  //    funciones públicas. notifyIgnited()/notifyExtinguished() limpian
  //    su propio temporizador pendiente en cada llamada (ver
  //    candleSequence.js), así que encadenarlas sin pausa no deja
  //    ningún auto-extinguish colgado para más tarde. A propósito NO se
  //    llama a flame.extinguish() en ningún momento: la llama se
  //    enciende una sola vez y se queda encendida de forma estable.
  candleSequence.notifyIgnited();
  candleSequence.notifyExtinguished();
  candleSequence.notifyIgnited();
  candleSequence.notifyExtinguished();
  candleSequence.notifyIgnited(); // → FINAL_LIGHT; emite "completed" de verdad
  // (el listener ya existente en main.js reacciona llamando a
  // flameWords.startAutoSequence() — se corta a continuación, antes de
  // que llegue a reproducirse ninguna palabra)

  // 3) flameWords: cortar la secuencia automática ANTES de que llegue a
  //    su propio final natural. stopAutoSequence() (ver flameWords.js)
  //    impide que "sequence-completed" llegue a emitirse nunca a partir
  //    de aquí, así que candelaFinale.start() (más abajo) no puede
  //    volver a dispararse solo más tarde por ese camino. hide() corta
  //    de inmediato cualquier palabra que estuviera a medio formar.
  flameWords.stopAutoSequence();
  flameWords.hide();

  // Pequeño margen sintético para que la disolución de hide() (si había
  // algo a medio formar) y el arranque del crecimiento de la llama
  // terminen de asentarse antes de arrancar el final.
  fastForward(2);

  // 4) candelaFinale: se arranca con su propia función real start()
  //    (que ya resetea sobre/carta a su estado inicial) y se avanza a
  //    base de fastForward() hasta que su propia máquina de estados
  //    llegue sola a "done" — mismo código que la experiencia normal,
  //    comprimido en el tiempo. Margen amplio de sobra (40s virtuales)
  //    sobre la duración real configurada, con parada en cuanto se
  //    llega al final; STEP pequeño para no saltarse el orden relativo
  //    entre sistemas (ver el comentario de fastForward en scene.js).
  candelaFinale.start();

  const STEP = 0.25;
  const MAX_SECONDS = 40;
  let elapsed = 0;
  while (candelaFinale.getPhase() !== "done" && elapsed < MAX_SECONDS) {
    fastForward(STEP);
    elapsed += STEP;
  }

  setNarrativeSuppressed(false);
}