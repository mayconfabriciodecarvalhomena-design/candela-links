import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// NARRATIVE: capa mínima para mostrar frases de texto en pantalla, con
// fade in/out. No sabe nada de la vela, de las cerillas ni de ninguna
// otra mecánica: solo expone `showNarrativeLine(text)`. Los textos
// concretos viven en content.js, nunca aquí.
//
// Este es el primer punto de la experiencia que necesita mostrar texto
// narrativo (hasta ahora content.js estaba vacío), así que crea su
// propio contenedor DOM en vez de depender de una estructura de
// index.html que todavía no existe. Cuando se implementen el resto de
// fases narrativas (intro, frases, mensaje final), este mismo módulo
// debería poder reutilizarse.
// -----------------------------------------------------------------------

let container = null;
let hideTimeoutId = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement("div");
  container.className = "narrative-text";
  document.body.appendChild(container);
  return container;
}

// Muestra una frase durante `CONFIG.candleSequence.narrativeLineDuration`
// segundos (o `durationSeconds` si se pasa explícitamente) y luego la
// desvanece. Si ya había una frase visible, la sustituye.
export function showNarrativeLine(text, durationSeconds) {
  if (!text) return;

  const duration = durationSeconds ?? CONFIG.candleSequence.narrativeLineDuration;
  const el = ensureContainer();

  if (hideTimeoutId !== null) {
    clearTimeout(hideTimeoutId);
    hideTimeoutId = null;
  }

  el.textContent = text;

  // Si ya estaba visible, forzamos un reflow antes de volver a añadir
  // la clase para que la transición se reinicie visualmente en vez de
  // no notarse (quitar y añadir la misma clase sin reflow de por medio
  // no dispara la transición CSS de nuevo).
  el.classList.remove("is-visible");
  void el.offsetWidth;
  el.classList.add("is-visible");

  hideTimeoutId = setTimeout(() => {
    hideTimeoutId = null;
    el.classList.remove("is-visible");
  }, Math.max(0, duration) * 1000);
}
