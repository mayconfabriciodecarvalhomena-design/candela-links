// -----------------------------------------------------------------------
// HELLO_KITTY_INSPECTION_CONFIG: fuente de verdad de la configuración de
// la interacción "coger e inspeccionar" la Hello Kitty de la mesa (ver
// src/helloKittyInspection.js). Mismo patrón que el resto de sistemas:
// este archivo es responsabilidad exclusiva de esta interacción, y
// src/config.js solo lo importa y lo expone como
// CONFIG.helloKittyInspection, sin duplicar valores.
//
// Nada de esto es una posición de cámara hardcodeada: helloKittyInspection.js
// calcula la posición/target reales a partir de la bounding box real de
// la Kitty ya cargada (THREE.Box3) y de la orientación real de su
// grupo — estos valores son solo los parámetros de ese cálculo (cuánto
// debe ocupar en pantalla, cuánto puede acercarse/alejarse como máximo,
// cuánto duran las transiciones).
// -----------------------------------------------------------------------
export const HELLO_KITTY_INSPECTION_CONFIG = {
  // Fracción del encuadre (vertical y horizontal, se usa la más
  // estricta de las dos según el aspect ratio real) que debe ocupar el
  // diámetro de la esfera que envuelve a la Kitty al quedar en posición
  // de inspección. Ni tan grande que se corte por los bordes, ni tan
  // pequeña que no se aprecien los detalles.
  screenFraction: 0.42,

  // Límites de distancia (metros) para la cámara de inspección, con
  // independencia de lo que salga del cálculo anterior — evita que un
  // FOV/aspect ratio extremo (p. ej. una ventana muy estrecha) acerque
  // la cámara hasta atravesar la geometría, o la aleje tanto que deje
  // de sentirse como "tenerla delante".
  minDistance: 0.55,
  maxDistance: 1.8,

  // Cuánto se eleva la cámara por encima del centro de la Kitty, como
  // fracción de su altura real (size.y de su bounding box). Un pequeño
  // ángulo ligeramente por encima se siente más natural ("la tengo en
  // la mano, la miro") que una vista perfectamente frontal a su misma
  // altura.
  heightLift: 0.25,

  // Duración de las transiciones de cámara, en segundos. Entrada un
  // poco más lenta que la salida (asentarse cuesta más que volver),
  // ambas dentro del rango "se nota que se mueve, pero no pesa".
  transitionInDuration: 1.1,
  transitionOutDuration: 0.85,
};
