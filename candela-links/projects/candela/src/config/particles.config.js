// -----------------------------------------------------------------------
// PARTICLES_CONFIG: configuración del sistema de partículas de fondo
// (src/particlesBackground.js). Este archivo es la fuente de verdad de
// TODOS los parámetros ajustables de ese sistema.
//
// Arquitectura (varias conversaciones trabajando en paralelo sobre el
// mismo proyecto): esta conversación es responsable únicamente de
// `particlesBackground.js` y de este archivo. Para cambiar cualquier
// parámetro de las partículas de fondo, modifica ÚNICAMENTE este
// archivo — no hace falta tocar src/config.js ni la configuración de
// otros sistemas (llama, cerillas, vela).
//
// src/config.js importa este archivo y lo expone como
// CONFIG.backgroundParticles, así que la interfaz que ya usa
// particlesBackground.js (`CONFIG.backgroundParticles.*`) no cambia.
//
// Contenido igual al que tenía CONFIG.backgroundParticles hasta ahora
// (sin modificar ningún valor): motas de polvo/luz que dan profundidad
// al fondo, independientes de la vela y de la llama. Se construye con
// TRES capas (layers.tiny / medium / large), cada una con su propio
// tamaño, opacidad, velocidad y duración de ciclo — así se consigue
// variedad real (motas casi invisibles, otras claramente visibles, y
// unas pocas grandes y muy difusas) en vez de un único tamaño repetido.
// El resto de ajustes (área, distribución, color, luz, corrientes,
// niebla de profundidad, interacción) son compartidos por las tres.
// -----------------------------------------------------------------------
export const PARTICLES_CONFIG = {
  // Volumen 3D donde viven las partículas. z usa valores negativos
  // porque la cámara mira hacia -Z; zNear está más cerca de la cámara
  // (delante) y zFar más lejos (detrás de la vela), para dar profundidad.
  area: {
    x: 3.4, // mitad de la anchura: las motas viven entre -x y +x
    yMin: -0.2,
    yMax: 3.0,
    zNear: -0.3,
    zFar: -4.8,
  },

  // Cómo se reparten las motas dentro del volumen anterior. En vez de
  // un único sorteo uniforme (que dejaba el espacio con muy pocas
  // motas perceptibles y sin concentración cerca de la vela), cada
  // mota se sortea con dos posibles "modos":
  //   - "nube cercana": una bola alrededor de la luz de la vela
  //     (lightInfluence.center), para dar sensación real de polvo
  //     concentrado donde más se nota la luz.
  //   - "campo lejano": uniforme por todo el volumen, para seguir
  //     llenando el espacio 3D y que las zonas oscuras no queden vacías.
  // nearFieldFraction controla qué proporción de motas usa cada modo.
  distribution: {
    nearFieldFraction: 0.62, // 0-1: fracción de motas que nace cerca de la vela
    nearFieldRadius: 1.7, // radio aproximado de esa "nube" alrededor de la luz
  },

  // Color según lo cerca que esté la partícula de la luz de la vela.
  color: {
    shadow: 0x55432e, // marrón cálido, visible pero apagado, en penumbra
    lit: 0xffe3ad, // dorado cálido, cerca de la luz
  },

  // Centro conceptual de la luz de la vela. Coincide aproximadamente
  // con la posición de la llama, pero se define aquí por separado a
  // propósito: este sistema no debe depender de la configuración de la
  // llama (son sistemas independientes que evolucionan por separado).
  // Si la posición de la vela/llama cambia de forma notable, este valor
  // puede necesitar un ajuste manual — no se actualiza automáticamente.
  // ACTUALIZADO — corrección de composición: CONFIG.candle.targetHeight
  // subió de 0.55 a 0.62. Mismo desnivel relativo en Y (+0.5) que tenía
  // antes sobre el punto de apoyo de la vela (radius: 3.0 es holgado,
  // pero se mantiene coordinado en vez de dejarlo desalineado).
  // ACTUALIZADO — inversión horizontal de la composición: X negada
  // (-0.4→0.4) en consonancia con CONFIG.candle.position (config.js).
  // Y/Z/radius/opacityBoost sin tocar.
  lightInfluence: {
    center: [0.4, 1.57, -1.25],
    radius: 3.0, // a partir de esta distancia ya no hay influencia
    opacityBoost: 0.85, // cuánto aumenta la opacidad cerca de la luz
    contrast: 1.25, // >1 = la transición sombra→luz es más marcada (más cinematográfica)
  },

  // Niebla de profundidad: además de que la perspectiva ya encoge las
  // motas lejanas, esto reduce un poco su presencia y las funde con el
  // fondo, mientras que las cercanas ganan algo de peso visual.
  depthFade: {
    nearOpacityMul: 1.2,
    farOpacityMul: 0.55,
    nearSizeMul: 1.1,
    farSizeMul: 0.88,
    fogAmount: 0.2, // 0-1: cuánto se mezclan las motas lejanas con el color de fondo
  },

  // Pequeñas corrientes de aire compartidas: un campo de movimiento
  // basado en la posición de cada mota (no solo en el tiempo), para
  // que grupos de motas cercanas entre sí se desplacen de forma
  // coherente, como si las arrastrara la misma corriente.
  flow: {
    scale: 0.6,
    speed: 0.12,
    strength: 0.05,
  },

  // Reacción sutil al cursor (ratón, lápiz o dedo).
  interaction: {
    enabled: true,
    planeHeight: 1.0, // altura del plano invisible usado para ubicar el puntero en el mundo 3D
    radius: 0.9, // distancia dentro de la cual el puntero repele
    strength: 0.07, // desplazamiento máximo que puede provocar
    recovery: 3.5, // velocidad de acercamiento/alejamiento al desplazamiento objetivo
  },

  // Duración de cualquier transición de intensidad general, incluida
  // la aparición inicial del sistema (ver setIntensity en
  // particlesBackground.js).
  fadeDuration: 2.5,

  // Las tres capas. La mayoría son "tiny" (sutiles), bastantes menos
  // "medium" (el cuerpo visible del efecto) y muy pocas "large"
  // (grandes y difusas).
  layers: {
    // TINY: la mayoría de las motas. Pequeñas y sutiles, pero con
    // opacidad base suficiente para seguir siendo perceptibles incluso
    // en penumbra, no solo cerca de la vela.
    tiny: {
      count: 420,
      size: { min: 0.02, max: 0.045 },
      opacity: { min: 0.05, max: 0.14 },
      // Rango de velocidad amplio (algunas casi quietas, min cercano a
      // 0; otras ascienden con más ritmo) para que no todas se muevan
      // "igual de despacio".
      speed: { min: 0.004, max: 0.05 },
      drift: { amount: 0.18, frequencyMin: 0.05, frequencyMax: 0.22 },
      cycle: { minDuration: 10, maxDuration: 20, fadeInFraction: 0.18, fadeOutFraction: 0.24 },
    },

    // MEDIUM: el cuerpo principal del efecto, claramente perceptible.
    medium: {
      count: 150,
      size: { min: 0.06, max: 0.11 },
      opacity: { min: 0.14, max: 0.32 },
      speed: { min: 0.004, max: 0.032 },
      drift: { amount: 0.24, frequencyMin: 0.035, frequencyMax: 0.15 },
      cycle: { minDuration: 14, maxDuration: 26, fadeInFraction: 0.18, fadeOutFraction: 0.26 },
    },

    // LARGE: unas pocas motas grandes y muy difusas (textura más
    // suave, ver particlesBackground.js), con velocidad casi nula:
    // dan sensación de polvo suspendido en el aire, casi quieto.
    large: {
      count: 26,
      size: { min: 0.16, max: 0.3 },
      opacity: { min: 0.05, max: 0.15 },
      speed: { min: 0, max: 0.006 },
      drift: { amount: 0.09, frequencyMin: 0.02, frequencyMax: 0.06 },
      cycle: { minDuration: 20, maxDuration: 38, fadeInFraction: 0.28, fadeOutFraction: 0.32 },
    },
  },
};