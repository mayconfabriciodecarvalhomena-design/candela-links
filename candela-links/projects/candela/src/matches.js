import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// MATCHES: mecánica de las cerillas.
//
// No sabe nada de Three.js ni de la representación visual: solo lleva la
// cuenta de cerillas y gestiona su estado mediante eventos.
//
// IMPORTANTE: una vez encendida, la cerilla NO se apaga por tiempo. La
// llama permanece encendida de forma indefinida mientras el usuario la
// esté usando; solo se apaga cuando se llama a `extinguish()` (uso sobre
// la vela, o apagado manual). Por eso este módulo ya no necesita
// engancharse al render loop: no hay ningún contador que actualizar
// frame a frame.
//
// Flujo:
//   attemptStrike() → si es válido, consume una cerilla y pasa a
//     "pending" (ni encendida ni disponible todavía). Emite
//     "strike-sequence-start".
//   confirmIgnited() → quien orquesta la animación (el controller) llama
//     a esto cuando la llamita ya ha prendido de verdad. Pasa a "lit".
//     Emite "strike". A partir de aquí la cerilla permanece encendida
//     hasta que algo llame a extinguish().
//   cancelPending() → por si la secuencia se interrumpe antes de
//     prender (no se usa todavía, pero deja la mecánica preparada).
// -----------------------------------------------------------------------

export function createMatches(options = {}) {
  const settings = { ...CONFIG.matches.mechanics, ...options };

  let matchesRemaining = settings.totalMatches;
  let attemptsUsed = 0;
  let pending = false; // durante el gesto de raspado, antes de prender
  let lit = false; // llama real, ya prendida, sin límite de tiempo

  // ---- Eventos ----
  //   "strike-sequence-start" → cerilla consumida, empieza el gesto.
  //   "strike"                → la llama ha prendido de verdad.
  //   "strike-failed"         → intento inválido. payload: { reason }
  //   "extinguish"             → apagado (uso sobre la vela o manual).
  //                              payload: { reason }
  //   "depleted"               → ya no quedan cerillas.
  //   "reset"                  → estado reiniciado.
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

  // Inicia el gesto: consume una cerilla y marca "pending". Todavía no
  // hay llama; eso llega con confirmIgnited().
  function attemptStrike() {
    if (pending || lit) {
      emit("strike-failed", { reason: "already-lit" });
      return { success: false, reason: "already-lit" };
    }

    if (matchesRemaining <= 0) {
      emit("strike-failed", { reason: "depleted" });
      emit("depleted", { attemptsUsed });
      return { success: false, reason: "depleted" };
    }

    matchesRemaining -= 1;
    attemptsUsed += 1;
    pending = true;

    emit("strike-sequence-start", { matchesRemaining, attemptsUsed });
    return { success: true, matchesRemaining, attemptsUsed };
  }

  // Llamado por el controller cuando la animación de raspado termina y
  // la llamita ya está visualmente prendida.
  function confirmIgnited() {
    if (!pending) return;
    pending = false;
    lit = true;
    emit("strike", { matchesRemaining, attemptsUsed });
  }

  // La secuencia se interrumpió antes de prender (no usado todavía por
  // el controller actual, pero deja la mecánica lista para admitirlo).
  function cancelPending(reason = "cancelled") {
    if (!pending) return;
    pending = false;
    emit("strike-failed", { reason });
  }

  // Único punto por el que una cerilla encendida deja de estarlo: uso
  // real sobre la vela ("used-on-candle") o apagado manual.
  function extinguish(reason = "manual") {
    if (!lit) return;
    lit = false;
    emit("extinguish", { reason });
  }

  function reset() {
    matchesRemaining = settings.totalMatches;
    attemptsUsed = 0;
    pending = false;
    lit = false;
    emit("reset", { matchesRemaining, attemptsUsed });
  }

  return {
    attemptStrike,
    confirmIgnited,
    cancelPending,
    extinguish,
    reset,

    isPending: () => pending,
    isLit: () => lit,
    matchesRemaining: () => matchesRemaining,
    attemptsUsed: () => attemptsUsed,
    totalMatches: () => settings.totalMatches,
    canStrike: () => !lit && !pending && matchesRemaining > 0,
    isDepleted: () => !lit && !pending && matchesRemaining <= 0,

    on,
    off,
  };
}