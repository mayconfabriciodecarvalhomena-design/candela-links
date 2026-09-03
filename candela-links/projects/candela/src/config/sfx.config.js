// -----------------------------------------------------------------------
// SFX_CONFIG: efectos de sonido de Candela (src/sfx.js).
//
// ÚNICO efecto de sonido del proyecto: el maullido ocasional del gato.
// No hay sonido de cerilla ni de vela — si en el futuro hiciera falta
// alguno, se añadiría aquí como una nueva entrada, igual que "cat".
//
// Fuente de verdad de este sistema: es el único archivo que hace falta
// tocar para cambiar el audio del maullido, su volumen o sus intervalos.
//
// Sistema independiente de MUSIC_CONFIG/music.js: el maullido usa su
// propio <audio> (ver src/sfx.js), nunca el de la música, así que música
// ambiental y maullido suenan a la vez sin interferirse entre sí.
// -----------------------------------------------------------------------
export const SFX_CONFIG = {
  // Interruptor general: si es false, el maullido no se reproduce nunca
  // (la música no se ve afectada, son sistemas independientes).
  enabled: true,

  // -----------------------------------------------------------------------
  // Gato: maullido ocasional mientras el gato está revelado en la
  // escena (empieza/para exactamente donde ya se llama a
  // cat.reveal()/cat.hide() en main.js — nunca antes de que el gato
  // aparezca, y se cancela en cuanto desaparece). No es un intervalo
  // fijo: tras cada maullido se espera un tiempo aleatorio entre
  // minInterval y maxInterval (en milisegundos) antes del siguiente,
  // para que no sea predecible.
  // -----------------------------------------------------------------------
  cat: {
    enabled: true,
    volume: 0.4,

    sounds: [
      "assets/audio/sfx/cat-meow-1.mp3",
      "assets/audio/sfx/cat-meow-2.mp3",
      "assets/audio/sfx/cat-meow-3.mp3",
    ],

    minInterval: 15000, // 15 s
    maxInterval: 35000, // 35 s
  },
};
