// -----------------------------------------------------------------------
// RESPONSIVE_CONFIG: fuente de verdad de la adaptación de cámara/carta a
// distintos tamaños de viewport (ver src/responsiveLayout.js, que es
// quien la consume, y el encargo de esta iteración: "sistema responsive
// dinámico basado en el viewport real, no un if(mobile)").
//
// FILOSOFÍA — nada aquí es "un valor para el iPhone 14" ni "un valor
// para tablet": son DOS extremos de una composición (escritorio / t=0 y
// portrait completo / t=1) definidos a mano, exactamente igual que ya
// hace el resto del proyecto con posiciones world-space (candle.position,
// cat.config.js, matches.config.js/candleWickPosition...). Lo que hace
// que esto sea "responsive de verdad" y no una tabla de dispositivos es
// que `t` — la variable de la que dependen TODOS los valores de abajo —
// se deriva de forma continua del aspect ratio REAL del viewport
// (ver getResponsiveLayout() en responsiveLayout.js), nunca de una
// detección de "es un móvil". Aspect ratios intermedios (tablets en
// portrait, ventanas de escritorio redimensionadas a mano, un móvil en
// landscape más cuadrado de lo normal...) obtienen una mezcla
// proporcional entre ambos extremos, no un salto binario.
//
// referenceAspect: el aspect ratio con el que está pensada la
// composición de escritorio (CONFIG.camera, sin tocar). En aspect ratios
// iguales o más anchos que esto, t=0 y la experiencia es IDÉNTICA a
// antes de esta iteración (ver el encargo: "desktop debe mantenerse
// prácticamente EXACTAMENTE igual"). La inmensa mayoría de móviles en
// horizontal (~2.1-2.2 de aspect) ya caen aquí de forma natural, sin
// necesitar ninguna rama especial para "landscape" — es simplemente un
// aspect ratio más ancho que 16:9.
//
// narrowAspect: el aspect ratio más estrecho para el que está pensada la
// adaptación portrait completa (t=1) — un móvil vertical típico
// (390×844 ≈ 0.46). Aspect ratios más estrechos todavía se quedan
// clampados en t=1 (no se extrapola más allá de lo que se ha podido
// razonar/comprobar).
// -----------------------------------------------------------------------
export const RESPONSIVE_CONFIG = {
  referenceAspect: 16 / 9,
  narrowAspect: 0.45,

  // ---- CÁMARA en portrait completo (t=1) — ver scene.js,
  // applyResponsiveCamera(). Interpolada linealmente con CONFIG.camera
  // (t=0) según `t`. ----
  portrait: {
    // FOV vertical máximo — deliberadamente MODERADO (no 80-90°): un
    // FOV muy amplio introduce distorsión de ojo de pez y, además,
    // encoge todo lo que hay delante de la cámara (efecto contrario al
    // que se busca: "los elementos importantes mantengan un tamaño
    // visual razonable"). La recuperación de encuadre en portrait viene
    // principalmente de RECENTRAR la composición (lookAtTarget/
    // positionTarget, abajo), no de forzar un FOV extremo.
    maxFov: 66,

    // Retroceso máximo de cámara (unidades de mundo, a lo largo de su
    // propia dirección de mirada tras recentrar) en el extremo más
    // estrecho — pequeño a propósito, mismo motivo que maxFov: es solo
    // el ajuste FINO que queda tras recentrar, no el mecanismo
    // principal.
    maxDollyBack: 0.32,

    // Punto hacia el que se recentra el ENCUADRE (lookAt) en portrait
    // completo: punto medio aproximado entre el gato (CAT_CONFIG.
    // position, x=-0.5, ver cat.config.js) y la vela (CONFIG.candle.
    // position, x=0.4, ver config.js) — los dos elementos de mayor
    // prioridad narrativa (ver el encargo: "1. vela, 2. carta/sobre,
    // 3. gato..."). Al recentrar aquí en vez de ensanchar el FOV de
    // forma simétrica sobre el lookAt de escritorio (que está pensado
    // para incluir también el espejo/la puerta, más a la derecha,
    // x≈1.45+), se sacrifica DELIBERADAMENTE parte de esa zona de menor
    // prioridad ("resto de la habitación") a cambio de que el gato y la
    // vela quepan enteros y a buen tamaño — exactamente el orden de
    // prioridad pedido.
    lookAtTarget: [-0.05, 1.28, -1.2],

    // Punto hacia el que se recentra la POSICIÓN de la cámara, mismo
    // criterio: se desplaza en la misma dirección que el lookAt (para
    // seguir siendo una vista en diagonal, nunca frontal-plana, mismo
    // estilo cinematográfico que la composición de escritorio) y se
    // acerca ligeramente en Z (1.3→1.22) para compensar en parte el
    // alejamiento que introduce maxDollyBack.
    positionTarget: [-0.32, 1.55, 1.22],
  },

  // ---- CARTA — ver candelaFinale.js. Ajuste ADITIVO/MULTIPLICATIVO
  // sobre cfg.letter.emerge (finale.config.js): NUNCA sustituye
  // finalScale (1.4) ni finalDistanceFromCamera (0.54), que se
  // conservan intactos como base — solo se combinan con estos factores,
  // que valen 1 (escala) y 0 (cercanía extra) en t=0, es decir, cero
  // cambio de comportamiento en desktop. ----
  letter: {
    // Multiplicador ADICIONAL sobre finalScale en el extremo portrait
    // (t=1): finalScale efectivo = 1.4 × hasta 1.22 ≈ 1.71 como mucho,
    // nunca sustituyendo el 1.4 base.
    maxScaleMultiplier: 1.22,

    // Acercamiento ADICIONAL (unidades de mundo RESTADAS a
    // finalDistanceFromCamera) en el extremo portrait — más cerca de
    // cámara = más grande en pantalla, sin tocar la escala del sobre ni
    // el resto de la secuencia. finalDistanceFromCamera (0.54) menos
    // esto (como mucho 0.10) sigue con margen de sobra sobre el near
    // plane de la cámara (0.1, ver config.js).
    maxExtraCloseness: 0.1,
  },
};
