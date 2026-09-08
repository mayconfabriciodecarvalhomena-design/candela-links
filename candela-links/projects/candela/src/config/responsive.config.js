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
  //
  // REVISADO — el recentrado hacia gato+vela (versión anterior de este
  // archivo) resultaba en un encuadre PEOR, no mejor: al desplazar el
  // lookAt/posición hacia x≈-0.05/-0.32 (lejos del centro real de la
  // habitación), la puerta, el espejo Y el cuadro quedaban todos fuera
  // de encuadre a la vez (comprobado numéricamente proyectando las
  // esquinas reales de puerta/espejo/cuadro/mesa con la cámara
  // resultante — ver el histórico de esta conversación). La causa
  // geométrica del recorte NUNCA fue "el lookAt de escritorio prioriza
  // mal los elementos": es que `camera.fov` en three.js es el FOV
  // VERTICAL, así que un aspect ratio muy estrecho (portrait) reduce
  // muchísimo el FOV HORIZONTAL aunque el vertical no cambie — a
  // fov=56/aspect=16:9 el hFov real es ≈87°, pero ese mismo fov=56 a
  // aspect=0.45 (portrait) da un hFov real de solo ≈23°. Ensanchar el
  // FOV vertical ayuda, pero solo hasta el límite "moderado" (ver
  // `maxFov` abajo) antes de caer en distorsión de ojo de pez — así que
  // el resto de la recuperación de encuadre viene de RETROCEDER la
  // cámara (`maxDollyBack`, mecanismo PRINCIPAL en esta revisión, no
  // secundario): al alejar la cámara a lo largo de su MISMA dirección
  // de mirada de escritorio (sin recentrar), el tamaño angular de toda
  // la habitación se reduce proporcionalmente y el hFov —aunque siga
  // siendo estrecho en grados— cubre una franja de mundo mucho más
  // ancha. `lookAtTarget`/`positionTarget` se dejan IGUALES a
  // CONFIG.camera (ver config.js) a propósito: con esos dos valores
  // iguales a la base, el lerp() de scene.js no mueve nada (mismo lookAt/
  // posición base en cualquier `t`) y toda la adaptación queda a cargo
  // de `maxFov` + `maxDollyBack` — exactamente la composición de
  // escritorio, la misma que ya incluye gato, vela, mesa, cuadro y
  // (parcialmente) puerta/espejo, solo que vista desde más lejos y con
  // algo más de FOV vertical.
  portrait: {
    // FOV vertical máximo — sigue siendo MODERADO: a este fov, en el
    // aspect ratio más estrecho contemplado (≈0.45), el FOV HORIZONTAL
    // real es ≈41° (fov horizontal = 2·atan(tan(fov/2)·aspect); ver la
    // nota geométrica arriba) — bastante MÁS ESTRECHO que el horizontal
    // de escritorio (≈87° a fov=56/16:9), así que no hay sensación de
    // gran angular/ojo de pez: sigue siendo, en términos de campo de
    // visión horizontal real, una vista más cerrada que la de
    // escritorio, solo que más alta verticalmente (apropiado para una
    // pantalla más alta que ancha).
    //
    // REVISADO (segunda iteración) — subido de 71 a 78. Comprobado
    // numéricamente (proyectando las esquinas reales de la puerta y el
    // espejo) que, por debajo de `maxDollyBack≈3`, la puerta y el
    // espejo quedan en 0% de visibilidad sin importar cuánto se suba
    // este valor (hasta 80-84°) — o sea, el retroceso de cámara es
    // condición NECESARIA, no basta con FOV. Pero, superado ese umbral
    // de retroceso, el FOV es la palanca con más recorrido por grado:
    // con `maxDollyBack` FIJO en 3.6 (sin subirlo respecto a la
    // primera iteración), pasar de 71° a 78° mejora la puerta de ~9%
    // a ~36% visible y el espejo de ~17% a ~77% visible — así que la
    // forma correcta de "buscar el mínimo retroceso necesario" (ver el
    // encargo) es dejar `maxDollyBack` como está y mover este valor,
    // no al revés.
    maxFov: 78,

    // Retroceso máximo de cámara (unidades de mundo, a lo largo de su
    // propia dirección de mirada de ESCRITORIO — ver nota arriba: no
    // hay recentrado antes de este retroceso) en el extremo más
    // estrecho.
    //
    // REVISADO (segunda iteración) — mismo valor que antes (3.6), NO
    // subido: se ha comprobado explícitamente (barrido numérico
    // proyectando puerta/espejo con `maxDollyBack` de 1.0 a 6.0
    // combinado con fov de 66 a 84) que este es, aproximadamente, el
    // MÍNIMO retroceso a partir del cual la puerta y el espejo empiezan
    // a entrar en encuadre de forma no despreciable con CUALQUIER fov
    // moderado — por debajo de ~3 unidades ambos se quedan en 0% de
    // visibilidad incluso a fov=80. Con 3.6 fijo, la mesa, el gato, la
    // vela, el cuadro completo y la mayor parte del espejo caben en
    // encuadre en un móvil vertical típico (~390×844), y la puerta pasa
    // de "una porción mínima" (~9%, iteración anterior) a mostrar una
    // porción clara de su hoja (~36%, incluido el pomo, su lado más
    // reconocible) — sin que la cámara dé la sensación de estar fuera
    // de la habitación (la profundidad real del suelo, ver
    // ROOM_CONFIG.floor en room.config.js, deja margen de sobra: a
    // t=1 la cámara queda en z≈4.7, el suelo llega hasta z≈5.2).
    //
    // Dato de referencia importante: incluso la composición de
    // ESCRITORIO original (t=0, sin tocar) ya deja la puerta
    // parcialmente fuera de encuadre (mismo borde izquierdo/superior
    // cortado, el pomo/derecha siempre visible) — así que el patrón de
    // recorte de la puerta en portrait con estos valores es
    // CONSISTENTE con el de la composición de referencia, no un
    // criterio nuevo.
    maxDollyBack: 3.6,

    // Sin recentrado (ver nota arriba de este bloque): mismo lookAt que
    // CONFIG.camera.lookAt (config.js). Duplicado aquí a propósito
    // (mismo criterio que ya usa el resto de config/*.config.js con
    // valores world-space definidos por separado, p. ej. TABLE_TOP_Y) —
    // si CONFIG.camera.lookAt cambia alguna vez, este valor debe
    // actualizarse a mano para seguir siendo un no-op.
    lookAtTarget: [0.7, 1.3, -1.25],

    // Sin recentrado (ver nota arriba de este bloque): mismo valor que
    // CONFIG.camera.position (config.js), mismo criterio de duplicado
    // explícito que `lookAtTarget`.
    positionTarget: [-0.05, 1.55, 1.3],
  },

  // ---- CARTA — ver candelaFinale.js. Ajuste ADITIVO/MULTIPLICATIVO
  // sobre cfg.letter.emerge (finale.config.js): NUNCA sustituye
  // finalScale (1.4) ni finalDistanceFromCamera (0.54), que se
  // conservan intactos como base — solo se combinan con estos factores,
  // que valen 1 (escala) y 0 (cercanía extra) en t=0, es decir, cero
  // cambio de comportamiento en desktop. ----
  letter: {
    // Multiplicador ADICIONAL sobre finalScale en el extremo portrait
    // (t=1): finalScale efectivo = 1.4 × hasta 1.52 ≈ 2.13 como mucho,
    // nunca sustituyendo el 1.4 base.
    //
    // REVISADO (segunda iteración) — subido de 1.34 a 1.52,
    // EXCLUSIVAMENTE como compensación directa de subir
    // portrait.maxFov (71→78, ver arriba, único cambio de esta
    // iteración que afecta a la carta). La carta se coloca a una
    // distancia FIJA en unidades de mundo delante de la cámara
    // (finalDistanceFromCamera, SIN TOCAR — ver candelaFinale.js/
    // computeLetterEmergePath), así que su tamaño EN PANTALLA depende
    // del fov vigente en ese momento (a más fov, el mismo objeto a la
    // misma distancia ocupa menos pantalla). El factor
    // 1.52/1.34 ≈ 1.135 es exactamente tan(78°/2)/tan(71°/2) — compensa
    // ese encogimiento para que la carta ocupe, en portrait completo,
    // el MISMO tamaño en pantalla que ya tenía con la combinación
    // anterior (maxFov=71, multiplier=1.34), la que el usuario
    // confirmó que "está mucho mejor" — no un tamaño MAYOR, solo evita
    // que se encoja como efecto colateral del nuevo fov. No es un
    // cambio de criterio de la carta, es la parte de "solo debe
    // cambiar si es consecuencia directa del nuevo encuadre" (ver el
    // encargo).
    maxScaleMultiplier: 1.52,

    // Acercamiento ADICIONAL (unidades de mundo RESTADAS a
    // finalDistanceFromCamera) en el extremo portrait — más cerca de
    // cámara = más grande en pantalla, sin tocar la escala del sobre ni
    // el resto de la secuencia. finalDistanceFromCamera (0.54) menos
    // esto (como mucho 0.10) sigue con margen de sobra sobre el near
    // plane de la cámara (0.1, ver config.js).
    maxExtraCloseness: 0.1,
  },
};
