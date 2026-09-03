// -----------------------------------------------------------------------
// CANDLE SEQUENCE CONFIG: fuente de verdad de los tiempos de la
// secuencia narrativa de encendido de la vela (src/candleSequence.js).
//
// La vela necesita encenderse tres veces antes de quedarse encendida
// definitivamente: las dos primeras veces se apaga sola al cabo de unos
// segundos (ver `autoExtinguishDelay`); la tercera vez ya no se apaga
// por tiempo.
// -----------------------------------------------------------------------

export const CANDLE_SEQUENCE_CONFIG = {
  // Segundos que la llama permanece encendida antes de apagarse sola,
  // en cada encendido previo al definitivo. Valores iniciales de prueba
  // (5-7s); ajustar libremente.
  autoExtinguishDelay: {
    first: 6,
    second: 6,
  },

  // Segundos que cada frase narrativa permanece visible en pantalla
  // antes de desvanecerse (ver src/narrative.js).
  narrativeLineDuration: 4.5,
};
