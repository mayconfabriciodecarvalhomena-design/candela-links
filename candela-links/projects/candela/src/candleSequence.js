import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// CANDLE SEQUENCE: máquina de estados de la secuencia narrativa de
// encendido de la vela.
//
// La vela necesita encenderse TRES veces antes de quedarse encendida
// para siempre:
//
//   FIRST_LIGHT  → (unos segundos) → FIRST_EXTINGUISH
//   SECOND_LIGHT → (unos segundos) → SECOND_EXTINGUISH
//   FINAL_LIGHT  → (definitivo, sin apagado automático)
//
// Igual que matches.js, este módulo NO sabe nada de Three.js ni de
// cómo se ve la llama: es lógica pura + un bus de eventos. Quien lo usa
// (main.js) es responsable de:
//   - llamar a `notifyIgnited()` cada vez que la vela se enciende de
//     verdad (p. ej. desde `matchesController.onReadyToLightCandle`).
//   - llamar a `notifyExtinguished()` cada vez que la llama termina de
//     apagarse de verdad (desde `flame.onFlameExtinguished`).
//   - escuchar `"auto-extinguish-request"` y, en respuesta, llamar a
//     `flame.extinguish()` (este módulo nunca toca la llama
//     directamente).
//   - escuchar `"narrative"` y mostrar el texto correspondiente
//     (los textos concretos viven en content.js, no aquí).
//
// De este modo la vela SIGUE encendiéndose solo con las cerillas: este
// módulo nunca enciende ni apaga nada por sí mismo, solo decide CUÁNDO
// pedir un apagado automático y CUÁNDO ha terminado la secuencia.
// -----------------------------------------------------------------------

export const CANDLE_SEQUENCE_STATE = {
  IDLE: "idle", // todavía no se ha encendido la vela ni una vez
  FIRST_LIGHT: "first-light", // primer encendido, temporizador en marcha
  FIRST_EXTINGUISH: "first-extinguish", // apagada tras el primer encendido, esperando el segundo
  SECOND_LIGHT: "second-light", // segundo encendido, temporizador en marcha
  SECOND_EXTINGUISH: "second-extinguish", // apagada tras el segundo encendido, esperando el tercero
  FINAL_LIGHT: "final-light", // tercer encendido: definitivo, sin temporizador
};

export function createCandleSequence(options = {}) {
  const settings = { ...CONFIG.candleSequence, ...options };

  let state = CANDLE_SEQUENCE_STATE.IDLE;
  let pendingTimeoutId = null;

  // ---- Eventos ----
  //   "state-change"          → payload: { state, previous }
  //   "auto-extinguish-request" → payload: { stage } — quien escuche
  //                                debe llamar a flame.extinguish().
  //                                Nunca se emite dos veces sin que
  //                                antes haya un nuevo encendido real.
  //   "narrative"              → payload: { key } — key es una de
  //                                "firstExtinguish", "secondExtinguish"
  //                                o "finalLight" (claves de
  //                                CONTENT.candleSequence en content.js).
  //   "completed"               → la secuencia llegó a FINAL_LIGHT.
  //   "reset"                   → estado reiniciado a IDLE.
  const listeners = new Map();

  function on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(callback);
    return () => off(event, callback);
  }

  function off(event, callback) {
    listeners.get(event)?.delete(callback);
  }

  function emit(event, payload) {
    listeners.get(event)?.forEach((callback) => callback(payload));
  }

  function setState(next) {
    const previous = state;
    state = next;
    emit("state-change", { state, previous });
  }

  function clearPendingTimer() {
    if (pendingTimeoutId !== null) {
      clearTimeout(pendingTimeoutId);
      pendingTimeoutId = null;
    }
  }

  // Programa el apagado automático de este encendido. `clearPendingTimer()`
  // primero garantiza que nunca hay dos apagados programados a la vez,
  // aunque `notifyIgnited()` se llamase más de una vez por error.
  function scheduleAutoExtinguish(stage, delaySeconds) {
    clearPendingTimer();
    pendingTimeoutId = setTimeout(() => {
      pendingTimeoutId = null;
      emit("auto-extinguish-request", { stage });
    }, Math.max(0, delaySeconds) * 1000);
  }

  // Llamar cada vez que la vela se enciende de verdad (p. ej. desde
  // matchesController.onReadyToLightCandle). Resistente a llamadas
  // repetidas: si la vela ya está encendida (en cualquier fase) o la
  // secuencia ya terminó, no hace nada — así nunca se cuenta dos veces
  // el mismo encendido ni se programan apagados duplicados.
  function notifyIgnited() {
    switch (state) {
      case CANDLE_SEQUENCE_STATE.IDLE:
        setState(CANDLE_SEQUENCE_STATE.FIRST_LIGHT);
        scheduleAutoExtinguish(1, settings.autoExtinguishDelay.first);
        return;

      case CANDLE_SEQUENCE_STATE.FIRST_EXTINGUISH:
        setState(CANDLE_SEQUENCE_STATE.SECOND_LIGHT);
        scheduleAutoExtinguish(2, settings.autoExtinguishDelay.second);
        return;

      case CANDLE_SEQUENCE_STATE.SECOND_EXTINGUISH:
        clearPendingTimer(); // el tercer encendido no programa apagado
        setState(CANDLE_SEQUENCE_STATE.FINAL_LIGHT);
        emit("narrative", { key: "finalLight" });
        emit("completed");
        return;

      default:
        // FIRST_LIGHT, SECOND_LIGHT o FINAL_LIGHT: la vela ya está
        // encendida en esta fase (o la secuencia ya es definitiva).
        // Ignorar para no contar el mismo encendido dos veces.
        return;
    }
  }

  // Llamar cada vez que la llama termina de apagarse de verdad (desde
  // flame.onFlameExtinguished). Solo hace algo si el apagado corresponde
  // a una fase de la secuencia que seguía esperando su apagado
  // (FIRST_LIGHT o SECOND_LIGHT); cualquier otro apagado (p. ej. tras
  // FINAL_LIGHT, si alguien apagara la vela manualmente desde la
  // consola) se ignora: la secuencia ya es definitiva y no retrocede.
  function notifyExtinguished() {
    switch (state) {
      case CANDLE_SEQUENCE_STATE.FIRST_LIGHT:
        clearPendingTimer();
        setState(CANDLE_SEQUENCE_STATE.FIRST_EXTINGUISH);
        emit("narrative", { key: "firstExtinguish" });
        return;

      case CANDLE_SEQUENCE_STATE.SECOND_LIGHT:
        clearPendingTimer();
        setState(CANDLE_SEQUENCE_STATE.SECOND_EXTINGUISH);
        emit("narrative", { key: "secondExtinguish" });
        return;

      default:
        return;
    }
  }

  function reset() {
    clearPendingTimer();
    setState(CANDLE_SEQUENCE_STATE.IDLE);
    emit("reset");
  }

  return {
    notifyIgnited,
    notifyExtinguished,
    reset,

    getState: () => state,
    isCompleted: () => state === CANDLE_SEQUENCE_STATE.FINAL_LIGHT,

    on,
    off,
  };
}
