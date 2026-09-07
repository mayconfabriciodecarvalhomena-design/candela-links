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
// -----------------------------------------------------------------------
// CÓMO SE OBTUVIERON estos valores (portrait.*): NO por prueba y error
// visual (no hay forma de "ver" el resultado desde aquí), sino
// calculando, con la posición/geometría REAL del proyecto
// (CONFIG.candle.position = [0.4,1.0,-1.25], CAT_CONFIG.position =
// [-0.5,1.0,-1.15], ambas ver config.js/cat.config.js), el ángulo
// horizontal que ocupan la vela y el gato vistos desde distintas
// combinaciones de posición/lookAt/FOV de cámara, y comprobando cuáles
// caben dentro del FOV horizontal disponible (que en portrait es mucho
// más estrecho que el vertical: FOVₕ = 2·atan(tan(FOVᵥ/2)·aspect), así
// que a aspect≈0.45 un FOV vertical de 76° da solo ~19° de FOV
// horizontal medio — ese es el recurso realmente escaso en portrait, no
// el vertical).
//
// Con la composición ANTERIOR (maxFov 66°, lookAtTarget x=-0.05) el
// FOV horizontal medio disponible era de solo ~16.3°, y la vela+el gato
// solos ya ocupaban prácticamente ese ángulo completo (candle≈9.7°,
// cat≈10.5° de sus ~16.3° disponibles) — por eso el encuadre quedaba
// "pegado" a ambos, sin ningún margen para el resto de la habitación:
// no era que el lado derecho se recortara por una mala posición de
// cámara, es que casi no sobraba ángulo para NADA más que la vela y el
// gato mismos. Los valores de abajo (maxFov 76°, lookAtTarget x=0.0,
// menos desplazado hacia el gato que antes) dejan a ambos con margen
// real (≈8° y ≈2-4° de aire respectivamente, según el móvil — 76° de
// FOV vertical es más que antes pero se mantiene por debajo del rango
// donde empieza a notarse distorsión de ojo de pez, ~85-90°+) — y como
// consecuencia se recupera visiblemente más habitación alrededor,
// aunque el espejo y el borde derecho de la mesa (mucho más
// periféricos, y que en el propio escritorio ya solo entran
// parcialmente — ver la nota de `mirror` en room.config.js) sigan
// fuera en el extremo más estrecho: mostrarlos enteros exigiría un FOV
// vertical superior a 120° (comprobado por cálculo), inviable sin
// distorsión severa. Verificado numéricamente contra varios aspect
// ratios de móvil reales (iPhone/Pixel/Galaxy en portrait, ~0.45-0.56)
// y contra el propio desktop (t=0, sin cambios) — no contra un
// dispositivo físico, así que sigue siendo el punto de partida a
// confirmar visualmente, no un cierre definitivo.
// -----------------------------------------------------------------------
export const RESPONSIVE_CONFIG = {
  referenceAspect: 16 / 9,
  narrowAspect: 0.45,

  // ---- CÁMARA en portrait completo (t=1) — ver scene.js,
  // applyResponsiveCamera(). Interpolada linealmente con CONFIG.camera
  // (t=0) según `t`. ----
  portrait: {
    // FOV vertical máximo. Subido de 66° a 76° (ver derivación arriba):
    // con solo 66° el FOV horizontal resultante en portrait no dejaba
    // margen ni siquiera para la vela y el gato solos. 76° sigue en
    // rango "moderado" (no es hasta 85-90°+ cuando el ojo de pez se
    // vuelve realmente perceptible).
    maxFov: 76,

    // Retroceso máximo de cámara (unidades de mundo) — sin cambios,
    // sigue siendo el ajuste fino final, no el mecanismo principal.
    maxDollyBack: 0.32,

    // Punto hacia el que se recentra el ENCUADRE (lookAt) en portrait
    // completo. ANTES en x=-0.05 (casi el punto medio exacto entre
    // vela y gato) — eso por sí solo ya "giraba" la cámara hacia la
    // izquierda lo suficiente como para consumir la mayor parte del
    // FOV horizontal disponible, sin dejar margen para nada más (ver
    // derivación arriba). Con el FOV más amplio de esta iteración ya
    // no hace falta recentrar tan agresivamente: x=0.0 (más cerca del
    // x=0.7 de escritorio) basta para que el gato quede dentro de
    // cuadro con margen real, y conserva más vela+mesa+aire a su
    // alrededor que antes.
    lookAtTarget: [0.0, 1.28, -1.2],

    // Punto hacia el que se recentra la POSICIÓN de la cámara, mismo
    // criterio y misma reducción de desplazamiento que el lookAt de
    // arriba (mantiene la vista en diagonal, nunca frontal-plana).
    positionTarget: [0.05, 1.55, 1.25],
  },

  // ---- CARTA — ver candelaFinale.js, computeSafeLetterScale(). A
  // diferencia de una iteración anterior de este archivo, aquí NO hay
  // ningún multiplicador de escala "a ojo": la función de
  // candelaFinale.js calcula, cada vez que hace falta, el ÁNGULO
  // horizontal y vertical real que ocupan cfg.letter.width/height (ver
  // finale.config.js) a `finalScale` y a la distancia de cámara
  // vigente, lo compara contra el FOV horizontal/vertical REAL
  // disponible en ese instante (camera.fov + aspect actuales, más el
  // hueco que necesitan las flechas de letterPageControls.js) y solo
  // reduce la escala por debajo de `finalScale` cuando de verdad no
  // cabría entera — nunca la amplía por encima de `finalScale` (la
  // base de escritorio, sin tocar). Con el FOV/recentrado de arriba
  // esto ya solo entra en juego en los aspect ratios más extremos.
  // `ARROW_RESERVE_WORLD` (candelaFinale.js) es el margen reservado
  // para esas flechas; debe mantenerse en sintonía con `EDGE_MARGIN`
  // de letterPageControls.js.
  letter: {},
};
