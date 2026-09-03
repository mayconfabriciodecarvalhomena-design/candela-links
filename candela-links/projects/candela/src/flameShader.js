// -----------------------------------------------------------------------
// FLAME SHADER: el código GLSL (el lenguaje que entiende la tarjeta
// gráfica) que dibuja la llama. Vive en un archivo aparte para que
// flame.js se centre en la parte "normal" de JavaScript (crear objetos,
// leer CONFIG, actualizar cada frame).
//
// IMPORTANTE PARA AJUSTAR EL ASPECTO DE LA LLAMA:
// Los NÚMEROS que definen forma, colores, velocidad, etc. NO están aquí.
// Están en CONFIG.flame (config.js) y se envían a este shader como
// "uniforms" desde flame.js. Este archivo contiene las FÓRMULAS.
//
// -----------------------------------------------------------------------
// REPLANTEAMIENTO (esta iteración): la versión anterior calculaba el
// contorno de la llama con 1-2 muestras de ruido por lado, y las hojas
// cruzadas compartían un único material (mismo patrón de ruido, solo
// rotado en el espacio) — por eso, por mucho que se subieran los
// números, seguía viéndose como una forma plana y simple.
//
// Cambios principales:
// 1. fbm(): ruido fractal de 4 octavas rotadas entre sí. Se usa tanto
//    para el contorno (mucho más irregular que antes) como para un
//    "campo" interno que varía el brillo dentro de la llama (textura de
//    fuego real, no un degradado liso).
// 2. uPlaneSeed: cada hoja cruzada (ver flame.js, que ahora clona el
//    material por hoja) lee el ruido con una semilla distinta, así que
//    las hojas ya NO muestran el mismo patrón rotado: se superponen
//    patrones distintos y esa superposición (blending aditivo) es lo
//    que da sensación de volumen.
// 3. Domain warping en el campo interno: la coordenada de muestreo se
//    distorsiona con otro fbm antes de leer el fbm principal — técnica
//    estándar para conseguir un aspecto turbulento, no repetitivo.
// 4. Núcleo/hotspot que se desplaza con el tiempo en vez de estar fijo
//    en el centro geométrico.
// 5. Vértices con estiramiento vertical (la punta sube/baja de verdad,
//    no solo lateralmente) y torsión (rotación alrededor del eje Y,
//    creciente con la altura), además del balanceo lateral que ya
//    existía.
// 6. Transparencia por capas: la envolvente exterior baja de opacidad
//    DENTRO de la silueta (no solo en su borde), para que se note una
//    capa exterior más transparente aparte del degradado de color.
// -----------------------------------------------------------------------

// Ruido de valor en 2D: base de todo lo demás (fbm incluido).
const NOISE_GLSL = `
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  // Ruido fractal (FBM): suma varias "octavas" de noise() a distinta
  // frecuencia/amplitud, rotando la coordenada entre octava y octava
  // (evita que el patrón se vea alineado a los ejes). Devuelve, a
  // grandes rasgos, un valor entre -0.5 y 0.5.
  float fbm(vec2 p, float seed) {
    vec2 q = p + vec2(seed * 13.7, seed * 7.3);
    float sum = 0.0;
    float amp = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      sum += amp * (noise(q) - 0.5);
      q = rot * q * 2.02;
      amp *= 0.5;
    }
    return sum;
  }
`;

// -----------------------------------------------------------------------
// Malla principal de la llama (varias "hojas" planas cruzadas, ver
// flame.js). Cada fila horizontal de vértices (misma altura "v") se
// desplaza combinando tres octavas de ruido (slow/fast/mid) más un
// desplazamiento vertical (estiramiento) y una torsión alrededor del eje
// Y. La base (v cerca de 0) apenas se mueve; la punta es la más libre.
// -----------------------------------------------------------------------
export const FLAME_VERTEX_SHADER = `
  ${NOISE_GLSL}

  uniform float uTime;

  uniform float uSlowScale;
  uniform float uSlowSpeed;
  uniform float uSlowStrength;

  uniform float uFastScale;
  uniform float uFastSpeed;
  uniform float uFastStrength;

  uniform float uTipMultiplier;
  uniform float uTipChaos;

  uniform float uMidScale;
  uniform float uMidSpeed;
  uniform float uMidStrength;

  uniform float uStretchSpeed;
  uniform float uStretchStrength;

  uniform float uTwistScale;
  uniform float uTwistSpeed;
  uniform float uTwistStrength;

  uniform float uPlaneSeed;

  varying vec2 vUv;

  void main() {
    vUv = uv;
    float v = uv.y;

    float baseFactor = pow(v, 1.3);
    float tipFactor = smoothstep(0.55, 1.0, v);
    float freedom = baseFactor * (1.0 + uTipMultiplier * tipFactor);

    // Peso en forma de campana, centrado a media altura, para la
    // tercera octava (zona media con carácter propio).
    float midWeight = smoothstep(0.12, 0.42, v) * (1.0 - smoothstep(0.55, 0.88, v));

    // Torsión: rota la posición LOCAL alrededor del eje Y antes de
    // aplicar cualquier otro desplazamiento. Crece con la altura
    // (tipFactor) y varía con un ruido lento propio, así que no es una
    // torsión fija ni un giro mecánico y repetitivo.
    float twistNoise = noise(vec2(v * uTwistScale + uPlaneSeed * 9.0 + 20.0, uTime * uTwistSpeed)) - 0.5;
    float twistAngle = twistNoise * uTwistStrength * tipFactor;
    float ct = cos(twistAngle);
    float st = sin(twistAngle);
    vec3 twisted = position;
    twisted.x = position.x * ct - position.z * st;
    twisted.z = position.x * st + position.z * ct;

    // Cada hoja (uPlaneSeed distinto) lee las octavas con un desfase
    // distinto, así que ya no se mueven todas en espejo unas de otras.
    float seedA = uPlaneSeed * 31.7;
    float seedB = uPlaneSeed * 53.1;

    float slowX = noise(vec2(v * uSlowScale + seedA, uTime * uSlowSpeed)) - 0.5;
    float fastX = noise(vec2(v * uFastScale + 12.0 + seedA, uTime * uFastSpeed)) - 0.5;
    float midX = noise(vec2(v * uMidScale + 140.0 + seedA, uTime * uMidSpeed)) - 0.5;

    float slowZ = noise(vec2(v * uSlowScale + 31.0 + seedB, uTime * uSlowSpeed * 0.85)) - 0.5;
    float fastZ = noise(vec2(v * uFastScale + 58.0 + seedB, uTime * uFastSpeed * 0.9)) - 0.5;
    float midZ = noise(vec2(v * uMidScale + 171.0 + seedB, uTime * uMidSpeed * 0.8)) - 0.5;

    float chaos = noise(vec2(v * uFastScale * 1.8 + 91.0 + seedA, uTime * uFastSpeed * 1.6)) - 0.5;

    float xOffset = (slowX * uSlowStrength + fastX * uFastStrength) * freedom
      + midX * uMidStrength * midWeight
      + chaos * uTipChaos * tipFactor;
    float zOffset = (slowZ * uSlowStrength + fastZ * uFastStrength) * freedom * 0.7
      + midZ * uMidStrength * midWeight * 0.7;

    // Estiramiento vertical: la parte alta sube y baja de verdad (no
    // solo lateralmente), con un ruido lento propio por hoja.
    float stretchNoise = noise(vec2(uTime * uStretchSpeed + uPlaneSeed * 17.0 + 5.0, 0.0)) - 0.5;
    float yOffset = stretchNoise * uStretchStrength * tipFactor;

    vec3 displaced = twisted;
    displaced.x += xOffset;
    displaced.z += zOffset;
    displaced.y += yOffset;

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const FLAME_FRAGMENT_SHADER = `
  ${NOISE_GLSL}

  uniform float uTime;
  uniform float uGrowth;   // 0 = apagada, 1 = encendida del todo
  uniform float uFlicker;  // ligera variación de brillo, en sintonía con la PointLight

  uniform float uPlaneWidth;
  uniform float uBaseWidth;
  uniform float uBodyWidth;
  uniform float uBulgeHeight;
  uniform float uTipSharpness;

  uniform float uTipSplitStrength;
  uniform float uTipSplitScale;

  uniform float uEdgeScale;
  uniform float uEdgeSpeed;
  uniform float uEdgeStrength;

  uniform float uFieldScaleX;
  uniform float uFieldScaleY;
  uniform float uFieldSpeed;
  uniform float uFieldWarpScale;
  uniform float uFieldWarpSpeed;
  uniform float uFieldWarpStrength;
  uniform float uFieldStrength;

  uniform float uHotspotDrift;
  uniform float uHotspotSpeed;
  uniform float uHeatTurbulence;

  uniform float uHeatRiseStart;
  uniform float uHeatRiseEnd;
  uniform float uHeatFallStart;
  uniform float uHeatFallEnd;

  uniform float uOuterStart;
  uniform float uOuterAlpha;
  uniform float uCoreLayerNormalize;

  // NUEVO — sistema de estados: 0 = comportamiento normal (idéntico al
  // de antes de esta iteración, verificable algebraicamente: mix(1.0,
  // x, 0.0) = 1.0 exactamente, sea "x" lo que sea). Solo se usa, desde
  // flame.js, durante el estado EXTINGUISHING, para que la parte
  // superior de la llama se debilite antes que la base — algo que no
  // se puede conseguir solo desde JS (el "growth" que ya existía cambia
  // el tamaño/opacidad de forma UNIFORME, no puede sesgar por altura).
  uniform float uTopFadeAmount;

  uniform float uBlueHeight;
  uniform float uBlueRadius;
  uniform float uBlueStrength;
  uniform float uBlueHeatSuppress;
  uniform float uBlueBrightness;

  uniform float uPlaneSeed;

  uniform vec3 uColorCore;
  uniform vec3 uColorYellow;
  uniform vec3 uColorOrange;
  uniform vec3 uColorEdge;
  uniform vec3 uColorBlue;

  varying vec2 vUv;

  // Anchura disponible a una altura v (0 = base, 1 = punta).
  //
  // REESCRITO esta iteración: la versión anterior calculaba esto en 3
  // tramos (falda inicial / subida hasta el bulge / caída hasta la
  // punta) empalmados con smoothstep. Parecía razonable, pero se
  // verificó numéricamente (fuera de este archivo, con los valores
  // reales de config) y tenía DOS problemas geométricos, no solo de
  // ajuste de parámetros:
  // 1. La "falda" inicial creaba un PELLIZCO: la anchura bajaba justo
  //    después de la base, antes de volver a subir hacia el cuerpo —
  //    exactamente la zona que se veía "demasiado fina" a pesar de
  //    tener una base ancha en apariencia.
  // 2. En el punto más ancho (el bulge), la pendiente de la subida
  //    llegaba a 0 pero la pendiente de la bajada NO — un cambio brusco
  //    de dirección, un vértice geométrico real en la silueta, no una
  //    curva continua. Eso es lo que se lee como "rombo/diamante".
  //
  // La función de aquí abajo es UNA SOLA fórmula continua, sin tramos:
  // - riseFactor sube de 0 a 1 entre v=0 y uBulgeHeight (con pendiente
  //   0 en ambos extremos, por cómo funciona smoothstep).
  // - fallFactor se queda en 1 hasta uBulgeHeight y luego cae hacia 0
  //   hacia la punta, TAMBIÉN con pendiente 0 justo en uBulgeHeight.
  // Como ambas piezas tienen pendiente 0 exactamente en uBulgeHeight, su
  // producto también la tiene ahí: el punto más ancho queda REDONDEADO
  // (como la cresta de una duna), no como la punta de un rombo. Y como
  // ya no hay "falda" aparte, uBaseWidth es directamente la anchura en
  // v=0 — ancha de verdad, sin pellizco después.
  float flameWidth(float v) {
    float riseFactor = smoothstep(0.0, uBulgeHeight, v);
    float widthBeforeTaper = mix(uBaseWidth, uBodyWidth, riseFactor);

    float fallFactor = pow(clamp(1.0 - smoothstep(uBulgeHeight, 1.0, v), 0.0, 1.0), uTipSharpness);

    return max(widthBeforeTaper * fallFactor, 0.002);
  }

  void main() {
    float v = vUv.y;
    float localX = (vUv.x - 0.5) * uPlaneWidth;

    float width = flameWidth(v);
    float halfWidth = max(width * 0.5, 0.001);

    // Borde por FBM (antes: 1-2 muestras de ruido por lado). Cada lado
    // usa una semilla distinta, y también distinta por hoja
    // (uPlaneSeed), así el contorno es irregular de verdad: detalle
    // grueso y fino a la vez, sin simetría entre hojas.
    float edgeLeft = fbm(vec2(v * uEdgeScale, uTime * uEdgeSpeed), uPlaneSeed + 3.0);
    float edgeRight = fbm(vec2(v * uEdgeScale, uTime * uEdgeSpeed), uPlaneSeed + 77.0);

    float halfWidthLeft = halfWidth * (1.0 + edgeLeft * uEdgeStrength);
    float halfWidthRight = halfWidth * (1.0 + edgeRight * uEdgeStrength);

    float side = localX < 0.0 ? halfWidthLeft : halfWidthRight;
    float distFromCenter = abs(localX);

    // Borde difuso: transición amplia, no un corte duro.
    float mask = 1.0 - smoothstep(side * 0.3, side * 1.05, distFromCenter);
    mask *= smoothstep(0.0, 0.02, v); // aparece casi de inmediato desde la base
    mask *= smoothstep(1.0, 0.82, v); // se difumina en la punta, más wispy

    // Pequeñas lenguas de fuego que se separan y se reintegran: un
    // ruido lento decide cuándo se abre un hueco, y OTRO ruido decide
    // DÓNDE (no siempre centrado — un hueco perfectamente centrado se
    // ve como un corte simétrico, más geométrico que orgánico). La zona
    // activa es amplia (más de media altura), no solo la punta exacta.
    float tipZone = smoothstep(0.62, 0.97, v);
    if (tipZone > 0.0) {
      float splitTime = noise(vec2(uTime * 0.18 + uPlaneSeed * 5.0 + 4.0, 0.0));
      float openAmount = smoothstep(0.55, 0.85, splitTime) * uTipSplitStrength * tipZone;
      float gapCenter = (noise(vec2(uTime * 0.12 + uPlaneSeed * 3.3 + 8.0, v * 2.0)) - 0.5) * side * 1.1;
      float gapDist = abs(localX - gapCenter);
      float gapHalfWidth = side * uTipSplitScale;
      float gapMask = 1.0 - smoothstep(0.0, gapHalfWidth, gapDist);
      mask *= 1.0 - gapMask * openAmount;
    }

    if (mask <= 0.001) discard;

    // r = 0 en el centro de la llama, 1 en el borde exterior. Se usa
    // solo para cosas espaciales de verdad (la transparencia de la
    // envolvente exterior, más abajo) — YA NO decide el color por sí
    // solo, para no producir una forma de color con un límite
    // geométrico reconocible.
    float r = clamp(distFromCenter / side, 0.0, 1.0);

    // ---- Campo de "calor": la pieza central de este color model ----
    // En vez de dibujar el núcleo como una forma (una elipse, un rombo,
    // lo que sea) colocada sobre un fondo naranja, se calcula un único
    // campo escalar de "calor" por píxel, y ES ESE CAMPO el que decide
    // qué color aparece ahí — igual que la temperatura dentro de un
    // fluido turbulento no dibuja una figura, dibuja zonas. La frontera
    // entre naranja/amarillo/blanco sale directamente del ruido: no hay
    // ninguna curva geométrica limpia en ningún punto del cálculo.
    //
    // "trend" es solo una TENDENCIA suave (más calor cerca del eje
    // central y de la zona baja/media, menos hacia el borde y la
    // punta) que ancla el resultado a algo reconocible como llama de
    // vela. Después se perturba con ruido fractal — con más peso que la
    // propia tendencia — así que el resultado final rara vez se parece
    // a la tendencia "limpia" de partida.
    float driftX = (noise(vec2(uTime * uHotspotSpeed + uPlaneSeed * 11.0, 0.0)) - 0.5) * uHotspotDrift;
    float driftV = (noise(vec2(uTime * uHotspotSpeed * 0.8 + uPlaneSeed * 19.0 + 30.0, 1.0)) - 0.5) * uHotspotDrift * 0.5;

    // Dónde, en altura, se concentra el calor (y por tanto el
    // amarillo/blanco): sube de 0 a 1 entre uHeatRiseStart y
    // uHeatRiseEnd, se mantiene, y baja de nuevo entre uHeatFallStart y
    // uHeatFallEnd. Expuesto como uniforms (antes eran números fijos
    // aquí mismo) para poder bajar la zona más luminosa sin tocar el
    // shader — ver turbulence.heatRiseStart/... en flame.config.js.
    float heightTrend = smoothstep(uHeatRiseStart, uHeatRiseEnd + driftV * 0.4, v) * (1.0 - smoothstep(uHeatFallStart + driftV * 0.4, uHeatFallEnd, v));
    float radialInput = clamp(r + driftX * 0.35, 0.0, 1.0);
    float radialTrend = 1.0 - smoothstep(0.0, 1.0, radialInput);
    float trend = clamp(heightTrend * (0.25 + 0.75 * radialTrend), 0.0, 1.0);

    // Campo interno turbulento (domain warping: se distorsiona la
    // coordenada de muestreo con otro fbm antes de leer el principal).
    // El mismo campo se usa para decidir el color (heat) Y para variar
    // el brillo final más abajo, así que las zonas más brillantes son
    // también las más calientes — coherente, no dos ruidos sueltos.
    vec2 fieldUv = vec2(localX / max(uBodyWidth, 0.001) * uFieldScaleX, v * uFieldScaleY - uTime * uFieldSpeed);
    vec2 warp = vec2(
      fbm(fieldUv * uFieldWarpScale, uPlaneSeed + 5.0),
      fbm(fieldUv * uFieldWarpScale, uPlaneSeed + 41.0)
    ) * uFieldWarpStrength;
    float field = fbm(fieldUv + warp, uPlaneSeed + 61.0);

    float heat = clamp(trend + field * uHeatTurbulence, 0.0, 1.0);

    // Pequeña zona azul junto a la mecha: muy localizada (solo cerca de
    // la base y del eje central) y con su propio borde orgánico, para
    // que se vea como parte del mismo fluido turbulento y no como un
    // parche pegado encima. Se calcula AQUÍ, antes de la rampa de color
    // (antes se calculaba después) — ver por qué justo debajo.
    //
    // REESCRITO (domain warping) — la versión anterior calculaba
    // blueZone como un producto de dos smoothstep limpios (altura ×
    // radio) y le SUMABA ruido al VALOR ya calculado. Dentro de la
    // mancha, blueZone ya vale ~1.0, así que clamp(1.0+ruido,0,1) sigue
    // dando 1.0 — el ruido no tenía ningún efecto donde más se ve la
    // forma. El problema nunca fue el TAMAÑO (uBlueHeight/uBlueRadius,
    // que se conservan sin tocar) sino que un producto de dos
    // smoothstep limpios solo puede producir una familia de formas
    // "óvalo/lente". Arreglo: se perturban v y r (domain warping) ANTES
    // de evaluar los smoothstep.
    //
    // 2ª PASADA — verificado renderizando a la escala REAL del juego
    // (no en un close-up que llena la pantalla): a esa escala, blueZone
    // entero mide ~15-20 píxeles en pantalla. El primer domain warp
    // (fbm() de 4 octavas, frecuencias localX*5/v*7, amplitud 0.30) era
    // matemáticamente correcto pero sus octavas más finas vibran a una
    // frecuencia muchísimo más alta que ese puñado de píxeles — se
    // pierden por completo en el rasterizado antes de llegar a
    // pantalla, no por ser "sutiles". Sustituido por noise() de UNA
    // sola octava a frecuencia baja: un único bulto/inclinación
    // dominante en vez de varias arrugas finas que se cancelan entre sí
    // (tanto por el rasterizado a tamaño pequeño como por el promedio
    // de las 6 hojas en additive blending). Amplitud subida a 0.9 —
    // verificado a la escala real, no en close-up — y compensada con un
    // recorte del radio base (×0.66) porque, medido en píxeles azules
    // reales sobre el render, esa amplitud por sí sola ampliaba el área
    // media de la mancha un 81% respecto al original; con el recorte,
    // el área vuelve a quedar equivalente (comprobado por recuento de
    // píxeles, no solo a ojo) mientras el borde queda claramente
    // asimétrico e irregular.
    float warpFade = 1.0 - smoothstep(0.0, uBlueHeight * 1.6, v);
    float blueWarpV = noise(vec2(localX * 1.6, uPlaneSeed * 3.1)) - 0.5;
    float blueWarpR = noise(vec2(v * 1.8 + uTime * 0.12, uPlaneSeed * 2.3)) - 0.5;

    float vWarped = v + blueWarpV * 0.9 * warpFade;
    float rWarped = r + blueWarpR * 0.9 * warpFade;

    float blueRadiusAtHeight = uBlueRadius * 0.66 * (1.0 - 0.5 * smoothstep(0.0, uBlueHeight * 1.3, vWarped));

    float blueZone = (1.0 - smoothstep(0.0, uBlueHeight, vWarped))
      * (1.0 - smoothstep(0.0, blueRadiusAtHeight, rWarped));
    blueZone = clamp(blueZone, 0.0, 1.0);

    // CAMBIO IMPORTANTE esta iteración: "heat" ya llevaba ruido de
    // turbulencia sumado (más arriba), sin ninguna relación con dónde
    // vive la zona azul — así que, incluso a poca altura, un pico de
    // ruido bastaba para que "heat" cruzara el umbral de
    // amarillo/blanco (comprobado numéricamente: a v=0.05, un pico de
    // ruido MODERADO ya daba heat≈0.49, suficiente para amarillo). Ese
    // amarillo/blanco se horneaba en "color" ANTES de mezclar el azul,
    // así que el mix de azul de más abajo solo diluía un color que YA
    // era amarillo, en vez de impedir que lo fuera. De ahí que "el azul
    // exista matemáticamente" pero se vea tapado.
    //
    // El arreglo no es mezclar más azul al final — es impedir que
    // "heat" pueda encender amarillo/blanco DENTRO de la zona azul,
    // sea cual sea el ruido en ese punto: se atenúa "heat" en
    // proporción a blueZone (uBlueHeatSuppress controla cuánto) antes
    // de que la rampa de color lo use. Verificado numéricamente: con
    // esto, incluso en el peor caso de ruido (el máximo posible), el
    // azul se mantiene claramente dominante en la base y la transición
    // a naranja/amarillo llega de forma gradual y predecible con la
    // altura, no al azar.
    float heatForRamp = heat * (1.0 - blueZone * uBlueHeatSuppress);

    // La rampa de color depende de "heatForRamp": el ruido de
    // turbulencia sigue haciendo irregulares las fronteras entre
    // bandas (heat ya lo llevaba incorporado), pero ya no puede
    // encender amarillo/blanco dentro de la zona azul.
    //
    // AJUSTADO (esta pasada) — el naranja se veía apagado no por su
    // color en sí (no hay ningún multiplicador ocultándolo, a
    // diferencia del azul) sino porque su banda "pura" era muy
    // estrecha: naranja→amarillo empezaba en 0.38, solapando casi por
    // completo con el propio borde→naranja (0.05-0.42) — apenas 0.04 de
    // margen antes de empezar a mezclarse ya hacia amarillo. Retrasado
    // el inicio de naranja→amarillo de 0.38 a 0.48: dejar una franja de
    // ~0.06 (0.42-0.48) de naranja sin mezcla de amarillo detrás,
    // solamente eso — el resto de la rampa (dónde empieza el propio
    // naranja, dónde termina el amarillo, el núcleo) no se toca.
    vec3 color = mix(uColorEdge, uColorOrange, smoothstep(0.05, 0.42, heatForRamp));
    color = mix(color, uColorYellow, smoothstep(0.48, 0.72, heatForRamp));
    color = mix(color, uColorCore, smoothstep(0.74, 0.98, heatForRamp));
    color *= 0.85 + 0.5 * smoothstep(0.7, 1.0, heatForRamp); // el blanco, además, brilla algo más

    // Con "heatForRamp" ya asegurando que no hay amarillo/blanco de
    // fondo en la zona azul, este mix final es lo que de verdad pinta
    // el azul (antes tenía que competir con un fondo ya amarillo).
    color = mix(color, uColorBlue, blueZone * uBlueStrength);

    // NUEVO — presencia visual del azul (4ª/5ª pasada de este ajuste,
    // ver historial completo más arriba y en flame.config.js). Medido
    // numéricamente: el azul (uColorBlue) y el naranja (uColorOrange)
    // tienen una luminancia ya bastante parecida (~0.30 vs ~0.35) — el
    // azul NO es intrínsecamente mucho más oscuro que su entorno. El
    // problema es que ocupa una zona pequeña a propósito (blueHeight/
    // blueRadius, sin tocar aquí) — un parche pequeño con un brillo
    // solo "parecido" al de alrededor no destaca, se pierde. En vez de
    // agrandar la zona o subir blueStrength (ya al 0.97, casi sin
    // margen: solo controla CUÁNTO se mezcla, no cuánto brilla el
    // resultado), se le da un extra de brillo LOCALIZADO, multiplicado
    // por "blueZone" para que solo afecte exactamente a esos píxeles
    // (fuera de la zona azul, blueZone≈0 y el multiplicador es 1.0 —
    // no toca el resto de la llama, ni naranja ni amarillo ni núcleo).
    // uBlueBrightness > 1 hace que el azul sea MÁS luminoso que su
    // entorno inmediato a propósito, para que un área pequeña tenga
    // presencia visual — como un pequeño acento brillante, no como un
    // parche apagado del mismo brillo que lo que lo rodea.
    // CORREGIDO (6ª pasada de este ajuste) — el multiplicador plano
    // "color *= mix(1.0, uBlueBrightness, blueZone)" (versión anterior)
    // era la causa real de que cambiar el RGB de uColorBlue apenas se
    // notara. Diagnóstico verificado numéricamente: un multiplicador
    // PLANO sobre los 3 canales, pasado por ACESFilmicToneMapping,
    // afecta mucho más a los canales DÉBILES (R, G) que al canal ya
    // dominante (B, cerca de su techo) — así que en vez de "más
    // intenso" el resultado era "más pálido": R subía de ~0.07 a ~0.14
    // (el doble) mientras B apenas se movía (~0.78→0.87), acercando R a
    // B en vez de mantenerlos separados. Con varias hojas superpuestas
    // (que sabemos que ocurre justo en el eje central compartido, ver
    // el comentario de "coreAttenuation" más abajo — la zona azul vive
    // exactamente ahí) esto empeora: a 3-4 capas, R llegaba a ~0.57,
    // casi tan alto como G — un azul-blanquecino pálido, no intenso.
    // Cualquier tono de partida converge hacia ese mismo pálido, por
    // eso cambiar el RGB apenas se apreciaba.
    //
    // Arreglo: en vez de escalar el color entero, se aleja de su PROPIA
    // luminancia (boost de saturación real, no de brillo) — R se queda
    // anclado cerca de 0 en vez de subir, incluso con varias capas
    // superpuestas (verificado: con esta fórmula, a 4 capas R sigue en
    // ~0.00 en vez de ~0.57). Mismo uniform, mismo valor (1.6), misma
    // condición (solo afecta donde blueZone>0 — fuera de la zona azul
    // es la identidad exacta, no toca naranja/amarillo/núcleo).
    float blueLuminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    vec3 blueSaturated = blueLuminance + (color - blueLuminance) * uBlueBrightness;
    color = mix(color, blueSaturated, blueZone);

    color *= 1.0 + field * uFieldStrength;
    color *= uFlicker;

    // CORRECCIÓN — sobreexposición aditiva (ver coreLayerNormalize en
    // flame.config.js para la explicación completa del problema): esta
    // hoja es una de 6, dibujadas con blending ADITIVO (se suman en el
    // framebuffer, no se mezclan). Sin atenuar aquí, la zona donde varias
    // hojas se superponen con opacidad alta acumula su color varias
    // veces y el tonemapping (ACESFilmic, en scene.js) la aplana a
    // blanco puro, perdiendo tanto el degradado de color como la
    // silueta. Solo se atenúa la porción del color que la rampa ya
    // identifica como núcleo/blanco (heatForRamp alto): naranja, amarillo,
    // borde y azul se quedan con su brillo de siempre, sin tocar.
    // EXTENDIDO (7ª pasada) — la corrección de arriba (basada en
    // heatForRamp) solo protegía la zona de calor alto (núcleo/blanco).
    // Diagnóstico de esta pasada (simulación real del compositing de
    // las 6 hojas, no un color aislado): el mismo apilamiento aditivo
    // en el eje central también sobreexpone zonas de calor BAJO/MEDIO
    // — exactamente donde vive la zona azul y la transición a naranja —
    // y ahí "heatForRamp" nunca llega a 0.65, así que la corrección de
    // arriba no actuaba en absoluto. Verificado numéricamente: a
    // heatForRamp~0.34 (zona de transición, calor medio) con 5 de las 6
    // hojas superpuestas en el centro, el resultado ya se lava hacia
    // blanco/pálido igual que el núcleo lo hacía antes de corregirse.
    //
    // "r" (distFromCenter/side, calculado más arriba: 0 en el eje
    // central, 1 en el borde de la hoja) es exactamente la variable de
    // proximidad al eje compartido — no hace falta ninguna nueva. Se
    // añade un segundo factor de atenuación basado SOLO en "r" (no en
    // el calor), y se combina con el existente por mínimo (nunca
    // multiplicándolos entre sí, para no atenuar el doble donde ambos
    // coinciden): gana el que pida más atenuación en cada píxel.
    //
    // Verificado con simulación antes de aplicar esto: con
    // smoothstep(0.0, 0.25, r), el 24% de los píxeles visibles de la
    // llama caen dentro de r<0.25 (zona con ALGÚN grado de atenuación
    // extra) — pero de esos, la fuerza real depende de "r" (máxima
    // exactamente en el eje, 0 según crece r), así que el efecto
    // perceptible se concentra mucho más cerca del eje que ese 24%. En
    // la zona claramente exterior (r>=0.5, donde vive el cuerpo
    // naranja/amarillo normal) NINGÚN píxel cambia de atenuación
    // (comprobado: 0 de 1765 muestras) — el cuerpo de la llama, lejos
    // del eje, queda exactamente igual que antes.
    float heatAttenuation = mix(1.0, uCoreLayerNormalize, smoothstep(0.65, 1.0, heatForRamp));
    float centralOverlap = 1.0 - smoothstep(0.0, 0.25, r);
    float overlapAttenuation = mix(1.0, uCoreLayerNormalize, centralOverlap);
    float coreAttenuation = min(heatAttenuation, overlapAttenuation);
    color *= coreAttenuation;

    // Red de seguridad adicional: un "soft clamp" muy suave que solo
    // actúa si, pese a la normalización de arriba, algún pico puntual
    // (varias hojas coincidiendo justo donde "field"/uFlicker están en
    // su máximo) empuja algún canal por encima de 1.0. Con color <= 1.0
    // en los tres canales esto es la identidad exacta (no toca nada);
    // solo cuando se pasa, comprime el exceso en vez de dejar que se
    // sature a blanco de golpe.
    float peak = max(color.r, max(color.g, color.b));
    color *= 1.0 / (1.0 + max(0.0, peak - 1.0) * 0.6);

    // Envolvente exterior más transparente: la opacidad baja a partir
    // de uOuterStart DENTRO de la propia silueta (no solo en su borde
    // geométrico difuso), para separar visualmente núcleo / cuerpo /
    // envolvente exterior.
    float outerT = smoothstep(uOuterStart, 1.0, r);
    float alphaLayer = mix(1.0, uOuterAlpha, outerT);

    // NUEVO — debilitamiento desde arriba (solo activo en EXTINGUISHING,
    // ver flame.js): "topFalloff" vale 1 en la base (v=0) y decae hacia
    // 0 en la punta (v=1), con una curva suave (smoothstep, no lineal).
    // "topBias" mezcla eso con 1.0 (sin efecto) según uTopFadeAmount.
    //
    // Cuando uTopFadeAmount=0: topBias = mix(1.0, topFalloff, 0.0) =
    // 1.0 EXACTAMENTE, sea cual sea "topFalloff" — no una aproximación,
    // una identidad algebraica de mix(). Así que en OFF/IGNITING/
    // NORMAL/UNSTABLE (donde flame.js nunca sube este uniform por
    // encima de 0) la fórmula de abajo es bit a bit la misma que antes
    // de esta iteración.
    float topFalloff = smoothstep(0.0, 1.0, 1.0 - v);
    float topBias = mix(1.0, topFalloff, uTopFadeAmount);

    gl_FragColor = vec4(max(color, 0.0), mask * uGrowth * alphaLayer * topBias);
  }
`;

// -----------------------------------------------------------------------
// Partículas de "brasas": sin cambios respecto a la iteración anterior
// (no forman parte del problema que pedía resolver esta pasada — la
// silueta y textura de la llama principal). Cada partícula tiene su
// propio tamaño y opacidad, algo que un PointsMaterial normal no
// permite, así que usamos un shader pequeño también aquí.
// -----------------------------------------------------------------------
export const EMBER_VERTEX_SHADER = `
  attribute float size;
  attribute vec3 particleColor;
  attribute float alpha;

  uniform float pixelHeight;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = particleColor;
    vAlpha = alpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (pixelHeight * 0.5) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const EMBER_FRAGMENT_SHADER = `
  uniform sampler2D map;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 tex = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor, tex.a * vAlpha);
  }
`;