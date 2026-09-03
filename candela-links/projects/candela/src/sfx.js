import { SFX_CONFIG } from "./config/sfx.config.js";

// -----------------------------------------------------------------------
// SFX: efectos de sonido de Candela.
//
// ÚNICO sonido implementado: el maullido ocasional del gato, con varias
// variantes de audio (SFX_CONFIG.cat.sounds) entre las que se elige una
// al azar en cada maullido. No hay sonido de cerilla ni de vela.
//
// Sistema independiente de src/music.js a propósito: usa sus propios
// elementos <audio> HTML5 (nunca el de la música), así que la música
// ambiental y el maullido conviven sin tocarse entre sí — reproducir el
// maullido nunca pausa, reinicia ni cambia el volumen de la música, y
// viceversa.
//
// Fuente de verdad de qué suena, a qué volumen y con qué rutas:
// src/config/sfx.config.js — este módulo solo reproduce lo que dice esa
// configuración, sin duplicar valores.
//
// El maullido no se dispara desde fuera con un play() genérico: se
// programa a sí mismo con sfx.startCatSounds() (y se detiene con
// sfx.stopCatSounds()), esperando cada vez un tiempo aleatorio entre
// SFX_CONFIG.cat.minInterval y .maxInterval antes de cada maullido, y
// eligiendo entonces al azar una de las variantes de SFX_CONFIG.cat.sounds
// — nunca más de un temporizador activo a la vez.
// -----------------------------------------------------------------------

function createSfxPlayer(config = SFX_CONFIG) {
  // Un <audio> por CADA variante de maullido definida en
  // SFX_CONFIG.cat.sounds, creado la primera vez que hace falta y
  // reutilizado siempre después — nunca se crean elementos <audio>
  // nuevos en cada reproducción.
  const catEntries = []; // { audio, src }[], mismo índice que cfg.sounds

  function isEnabledGlobally() {
    return config.enabled !== false;
  }

  function catSounds() {
    const cfg = config.cat;
    return cfg && Array.isArray(cfg.sounds) ? cfg.sounds : [];
  }

  function getCatEntry(index) {
    if (catEntries[index]) return catEntries[index];

    const cfg = config.cat;
    const src = catSounds()[index];
    if (!cfg || !src) return null;

    const audio = new Audio();
    audio.preload = "auto";
    audio.src = src;
    audio.volume = Math.max(0, Math.min(1, cfg.volume ?? 1));

    // Si este archivo en concreto no existe o no puede cargarse todavía,
    // avisamos por consola pero no rompemos nada más: las otras
    // variantes de maullido (y la música) siguen funcionando con
    // normalidad.
    audio.addEventListener("error", () => {
      console.warn(`Candela (sfx): no se pudo cargar "${src}" (variante de maullido del gato).`, audio.error);
    });

    const entry = { audio, src };
    catEntries[index] = entry;
    return entry;
  }

  // Elige al azar una de las variantes de SFX_CONFIG.cat.sounds y la
  // reproduce. Nueva selección aleatoria en cada llamada — nunca una
  // secuencia fija. Uso interno del programador de más abajo.
  function playRandomCatSound() {
    if (!isEnabledGlobally()) return;

    const cfg = config.cat;
    if (!cfg || cfg.enabled === false) return;

    const sounds = catSounds();
    if (sounds.length === 0) return;

    const index = Math.floor(Math.random() * sounds.length);
    const entry = getCatEntry(index);
    if (!entry) return;

    const { audio, src } = entry;
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise?.catch) {
      playPromise.catch((err) => {
        console.warn(`Candela (sfx): no se pudo reproducir "${src}" (maullido del gato).`, err);
      });
    }
  }

  // Crea (sin reproducir) los elementos <audio> de todas las variantes
  // de maullido, para que la primera reproducción real no tenga que
  // esperar a su creación. Pensado para llamarse durante el propio
  // click de "Cargar escena" (mismo punto donde ya arranca
  // music.play(), ver main.js) — no reproduce nada, así que no hay
  // ningún riesgo de autoplay bloqueado.
  function prepare() {
    catSounds().forEach((_, index) => getCatEntry(index));
  }

  // ---- Maullidos del gato: programación aleatoria, no predecible ----
  let catTimeoutId = null;

  function scheduleNextMeow() {
    const cfg = config.cat;
    if (!cfg) return;

    const min = cfg.minInterval ?? 15000;
    const max = Math.max(min, cfg.maxInterval ?? 35000);
    const delay = min + Math.random() * (max - min);

    catTimeoutId = setTimeout(() => {
      playRandomCatSound();
      // Solo se reprograma si sigue activo: si stopCatSounds() se llamó
      // mientras tanto (catTimeoutId ya a null), no vuelve a programar.
      if (catTimeoutId !== null) scheduleNextMeow();
    }, delay);
  }

  // Empieza a programar maullidos ocasionales del gato. Nunca suena de
  // inmediato: siempre espera primero un intervalo aleatorio entre
  // minInterval y maxInterval (ese intervalo se calcula igual que
  // antes; lo único nuevo es qué variante de audio suena al terminar la
  // espera). Idempotente — si ya hay un temporizador en marcha, no crea
  // uno nuevo en paralelo (nunca más de uno a la vez); llamar dos veces
  // seguidas no duplica los maullidos.
  function startCatSounds() {
    if (!isEnabledGlobally()) return;
    const cfg = config.cat;
    if (!cfg || cfg.enabled === false) return;
    if (catTimeoutId !== null) return; // ya en marcha

    scheduleNextMeow();
  }

  // Detiene la programación de maullidos (p. ej. cuando el gato deja de
  // estar revelado). Seguro llamarlo aunque no hubiera ninguno activo.
  function stopCatSounds() {
    if (catTimeoutId !== null) {
      clearTimeout(catTimeoutId);
      catTimeoutId = null;
    }
  }

  return { prepare, startCatSounds, stopCatSounds };
}

// Instancia única compartida por todo el proyecto, mismo criterio que
// `music` en src/music.js.
export const sfx = createSfxPlayer();

// Se expone también la fábrica por si hiciera falta una instancia
// independiente (p. ej. para pruebas).
export { createSfxPlayer };
