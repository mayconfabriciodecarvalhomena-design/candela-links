// -----------------------------------------------------------------------
// MUSIC CONFIG: configuración del sistema de música ambiental
// (src/music.js). Reproduce una pista a la vez en bucle infinito,
// iniciándose cuando el usuario pulsa "Cargar escena".
//
// Coloca los archivos de audio en assets/audio/ (relativo a index.html).
// -----------------------------------------------------------------------

export const MUSIC_CONFIG = {
  // Si es false, no se reproduce ningún audio. La aplicación funciona
  // exactamente igual sin música.
  enabled: true,

  // Volumen maestro (0.0 a 1.0). Se aplica al elemento <audio> global.
  volume: 0.35,

  // Lista de pistas en orden. Se reproduce la primera, luego la segunda,
  // etc.; al terminar la última vuelve a la primera (bucle infinito).
  // Rutas relativas a index.html.
  // Si el array está vacío, la aplicación funciona sin música.
  tracks: [
    "assets/audio/cancion1.mp4",
    "assets/audio/cancion2.mp4",
    "assets/audio/cancion3.mp4",
    "assets/audio/cancion4.mp4",
    "assets/audio/cancion5.mp4",
    "assets/audio/cancion7.mp4",
    "assets/audio/cancion6.mp4",
    "assets/audio/cancion8.mp4",
    "assets/audio/cancion9.mp4",
    "assets/audio/cancion10.mp4",
  ],
};
