// -----------------------------------------------------------------------
// SMOKE_CONFIG: configuración del hilo de humo que queda tras apagar la
// llama de la vela (src/smoke.js). Sigue el mismo patrón que
// flame.config.js: esta es la fuente de verdad de sus parámetros;
// config.js solo la importa y la expone como CONFIG.smoke.
//
// El humo NO es protagonista: pocas partículas, muy transparentes, que
// suben despacio desde la mecha y se dispersan en unos segundos. Ver
// smoke.js para cómo se usan estos valores.
// -----------------------------------------------------------------------
export const SMOKE_CONFIG = {
  // Cuántas partículas forman el hilo de humo. Subido de 18 a 28: más
  // densidad/continuidad, sin tocar el aspecto individual de cada
  // partícula (startSize/endSize/maxOpacity/sizeVariation intactos) ni
  // el shader — solo hay más partículas con ese mismo aspecto.
  count: 28,

  // Pequeño ajuste sobre la punta real de la mecha (medida por
  // candle.js, igual que hace flame.js con su propio wickOffset). El
  // humo debe salir justo de la mecha recién apagada, ni flotando por
  // encima ni hundido dentro de ella.
  originOffset: [0, 0.006, 0],

  // Las partículas no nacen todas a la vez: se reparten a lo largo de
  // esta ventana, en segundos, para que el hilo "brote" progresivamente
  // en vez de aparecer de golpe. Reducida de 0.25 a 0.12 para que el
  // conjunto de partículas arranque casi de inmediato al apagarse la
  // vela (con más count, además, la densidad inicial llega antes aun
  // con esta ventana más corta). La partícula 0 sigue forzada a
  // delay = 0 en smoke.js (sin tocar en esta iteración), así que el
  // primer indicio de humo ya era inmediato; esto acelera al resto.
  emissionWindow: 0.12,

  // Vida de cada partícula, en segundos (con variación individual entre
  // min y max). Junto con emissionWindow, el hilo completo dura unos
  // 3-4s desde que empieza a nacer la primera partícula hasta que se
  // apaga la última, tal y como se pidió.
  lifetime: { min: 2.6, max: 3.6 },

  // Cuánto tarda CADA partícula, en segundos absolutos, en alcanzar su
  // opacidad máxima al nacer. Reducido de 0.12 a 0.04: con 0.12, a los
  // 50ms de smoke.start() la partícula 0 solo había alcanzado ~42% de
  // su opacidad máxima (ya de por sí baja, 0.12) — prácticamente
  // imperceptible. La cadena de llamadas hasta smoke.start() ya era
  // 0ms (misma frame que la llama pasa a OFF, confirmado por la
  // estructura síncrona de scene.js), así que este era el único punto
  // real con margen de mejora. Con 0.04s la partícula alcanza su
  // opacidad máxima en ~2-3 frames a 60fps, dentro de la ventana de
  // 0-50ms pedida, sin cambiar el aspecto del humo una vez formado.
  fadeInSeconds: 0.04,

  // Velocidad de ascenso (unidades/segundo) y su variación individual
  // (fracción). Muy lento: el humo debe leerse como "sube poco a poco",
  // no como algo que se dispara hacia arriba.
  riseSpeed: 0.1,
  riseSpeedVariation: 0.35,

  // Desviación lateral orgánica: cada partícula combina dos ondas
  // (lenta + rápida, seno y coseno) con su propia fase y frecuencia, en
  // vez de subir en línea recta. driftOnset retrasa cuándo empieza a
  // notarse esa desviación (fracción de vida, 0-1): con esto, la base
  // del hilo —justo saliendo de la mecha— se mantiene compacta y
  // solapada (más "hilo único"), y solo se dispersa lateralmente una
  // vez que ya ha subido un poco, que es como se comporta el humo real.
  driftAmount: 0.026,
  driftOnset: 0.2,
  driftFrequency: { min: 0.5, max: 1.3 },

  // Tamaño de cada partícula (unidades de mundo) al nacer y al final de
  // su vida: crece con el tiempo, para dar sensación de dispersión del
  // humo según sube.
  //
  // Subidos respecto a la versión anterior (0.022 → 0.075) porque, a la
  // distancia real cámara-mecha del proyecto (cámara en [0,1.2,4], mecha
  // en ~[0,1.1,0], distancia ≈ 4 unidades), esos valores ocupaban solo
  // ~2-8 píxeles en pantalla — demasiado poco para que el ruido
  // procedural del shader (smokeShader.js, sin tocar en esta iteración)
  // tuviera margen visible: a 2-8px, cualquier forma colapsa en un punto
  // borroso indistinguible de un círculo, sea cual sea el shader.
  //
  // Con estos valores, la misma partícula ocupa aproximadamente:
  //   startSize 0.08 -> ~9px  (900px de alto) / ~6px (720px) / ~11px (1080px)
  //   endSize   0.24 -> ~27px (900px de alto) / ~18px (720px) / ~32px (1080px)
  // Suficiente para que el contorno irregular del shader sea legible sin
  // dejar de ser partículas discretas.
  startSize: 0.08,
  endSize: 0.24,
  sizeVariation: 0.3, // variación individual sobre los dos valores anteriores

  // Opacidad máxima que alcanza cada partícula (en el pico de su curva
  // de aparición/desaparición). Se bajó un poco respecto a la versión
  // anterior (0.16 → 0.12) porque ahora hay más partículas solapándose:
  // el volumen total percibido es similar o incluso más continuo, sin
  // que cada una individualmente sea más "sólida".
  maxOpacity: 0.12,
  opacityVariation: 0.25,

  // Color: gris cálido y pálido cerca de la mecha (todavía con algo del
  // calor de la llama apagada), virando a un gris más frío y claro
  // según se aleja y se enfría.
  colorNear: 0xcfc6ba,
  colorFar: 0xe9e7e4,
};