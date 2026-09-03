import { CONFIG } from "./config.js";

// -----------------------------------------------------------------------
// MUSIC: reproductor de música ambiental. Usa un único elemento <audio>
// y avanza manualmente mediante el evento "ended" para evitar problemas
// de autoplay del navegador (la llamada a play() debe venir de una
// interacción del usuario — ver main.js, intro.onStart).
//
// API pública:
//   - play()    → inicia la reproducción (o reanuda si estaba pausada)
//   - pause()   → pausa la pista actual
//   - stop()    → pausa y vuelve al inicio de la pista actual
//   - setVolume(v) → cambia el volumen en tiempo real (0.0 a 1.0)
//   - next()    → salta a la siguiente pista
//
// Comportamiento:
//   - Solo hay una pista sonando a la vez.
//   - Al terminar una pista avanza automáticamente a la siguiente.
//   - Al terminar la última, vuelve a la primera (bucle infinito).
//   - Si enabled === false o tracks está vacío, play() es un noop.
//   - Si un archivo no existe, se emite console.warn y se intenta
//     continuar con la siguiente pista.
// -----------------------------------------------------------------------

const cfg = CONFIG.music;

const audio = new Audio();
audio.preload = "auto";
audio.volume = cfg.volume;
audio.loop = false; // no usamos loop nativo: controlamos el avance manualmente

let currentIndex = 0;
let playing = false;

// Avisa al usuario si el navegador bloquea la reproducción (por si
// acaso, aunque la llamada debería venir de un gesto del usuario).
audio.addEventListener("error", () => {
  const src = audio.currentSrc || "(desconocido)";
  console.warn(`Candela music: error cargando "${src}". Intentando siguiente pista...`);
  advance();
});

audio.addEventListener("ended", () => {
  advance();
});

// Avanza a la siguiente pista. Si falla la carga, reintenta con la
// siguiente (máximo un intento por pista para no crear un bucle
// infinito si TODO el array es inválido).
function advance() {
  if (!playing || cfg.tracks.length === 0) return;
  currentIndex = (currentIndex + 1) % cfg.tracks.length;
  loadAndPlay(currentIndex);
}

function loadAndPlay(index) {
  if (cfg.tracks.length === 0) return;

  const src = cfg.tracks[index];
  if (!src) return;

  // Si la fuente es la misma que ya está cargada, solo reanudamos
  // (evita un restart innecesario en edge cases).
  if (audio.currentSrc === src && !audio.ended) {
    audio.play().catch(() => {});
    return;
  }

  audio.src = src;
  audio.load();
  audio.play().catch(() => {
    // El .catch ya fue manejado por el listener "error" que avanza
    // automáticamente. Este catch evita que la promesa no manejada
    // llegue al console del navegador.
  });
}

// -----------------------------------------------------------------------
// API pública
// -----------------------------------------------------------------------

function play() {
  if (!cfg.enabled || cfg.tracks.length === 0) return;
  playing = true;
  loadAndPlay(currentIndex);
}

function pause() {
  playing = false;
  audio.pause();
}

function stop() {
  playing = false;
  audio.pause();
  audio.currentTime = 0;
}

function setVolume(v) {
  const clamped = Math.max(0, Math.min(1, v));
  audio.volume = clamped;
  cfg.volume = clamped;
}

function next() {
  if (!cfg.enabled || cfg.tracks.length === 0) return;
  currentIndex = (currentIndex + 1) % cfg.tracks.length;
  loadAndPlay(currentIndex);
}

export const music = { play, pause, stop, setVolume, next };
