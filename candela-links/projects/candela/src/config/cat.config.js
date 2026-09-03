// -----------------------------------------------------------------------
// CAT_CONFIG: fuente de verdad de la configuración del sistema del gato
// (src/cat.js). Sigue exactamente el mismo patrón de arquitectura que
// flame.config.js, matches.config.js y particles.config.js: este
// archivo es responsabilidad exclusiva del sistema del gato.
// src/config.js solo lo importa y lo expone como CONFIG.cat, sin
// duplicar valores.
//
// MODELO DEFINITIVO — "Sleeping Cat":
// `modelPath` apunta a `assets/models/cat.glb`, que ahora contiene un
// modelo distinto al anterior ("Calico Cami"): un gato ya modelado/
// escaneado en pose de dormido (ver atribución en PROJECT_STATE.md).
// Es una malla ESTÁTICA (sin esqueleto, sin animaciones, 3 primitivas /
// 1 solo material) que trae su propio pequeño cojín/manta bajo el
// cuerpo como parte de la misma geometría. Por eso cat.js ya NO
// necesita nada relacionado con huesos, skinning ni postura manual: la
// pose "dormido" viene ya resuelta en el propio archivo .glb, igual que
// candle.js no necesita posar la vela.
//
// El material usa la extensión KHR_materials_unlit (iluminación ya
// "horneada" en la propia textura, típico de un escaneado). GLTFLoader
// lo convierte automáticamente en un MeshBasicMaterial: se ve
// correctamente y con su aspecto realista de pelaje, pero NO reacciona
// a las luces de Three.js (ni a la luz ambiental de la escena ni a
// ninguna PointLight). Por eso el "revelado" del gato (de oscuro a
// iluminado) se resuelve por OPACIDAD (ver reveal.minOpacity/maxOpacity
// abajo), no por iluminación real de su material — es la única palanca
// que de verdad cambia su aspecto en pantalla. cat.js NO añade ninguna
// luz propia: la luz cálida real de la escena (cuando la vela está
// encendida) la aporta exclusivamente la PointLight de flame.js. Ver
// PROJECT_STATE.md para más detalle sobre esta limitación conocida del
// material.
// -----------------------------------------------------------------------
export const CAT_CONFIG = {
  // Ruta del modelo, relativa a index.html (mismo criterio que
  // CONFIG.candle.modelPath). Mismo nombre de archivo que el modelo
  // anterior (cat.glb): solo ha cambiado el contenido del archivo, no
  // hace falta tocar nada más para que el resto del proyecto lo recoja.
  modelPath: "assets/models/cat.glb",

  // Posición del grupo del gato en la escena. Se mantiene el mismo
  // criterio conceptual que con el modelo anterior: a un lado de la
  // vela, en la zona de penumbra.
  //
  // ACTUALIZADO: el gato ahora vive sobre la mesa de noche (ver
  // room.config.js), no en el suelo. Y = TABLE_TOP_Y (1.0, la misma
  // constante que usa CONFIG.candle.position): cat.js calcula el apoyo
  // sobre esa superficie en tiempo de ejecución (Box3 simple, igual que
  // candle.js), así que aquí solo hace falta indicar la altura DE LA
  // MESA, no la del gato. X/Z lo sitúan a la derecha de la vela
  // (CONFIG.candle.position = [0.4, 1.0, -1.25]), sobre la mesa,
  // dejando espacio libre a la izquierda de la vela (hacia la puerta)
  // para futuros elementos personales — ver PROJECT_STATE.md.
  //
  // REVISADO (excepción puntual, position únicamente) — inversión
  // horizontal de la composición de la habitación (mesa/puerta/espejo,
  // ver room.config.js y CONFIG.camera en config.js): esta X se negó
  // (-1.35→1.35) porque, si no, el gato quedaba flotando fuera de la
  // mesa ya movida (mesa nueva: x∈[-1.0, 2.4]; gato sin mover: x∈
  // [-1.99,-0.72], casi entero fuera). ÚNICAMENTE se tocó esta
  // coordenada de posición — geometría, materiales, skeleton,
  // rotationY (pose/orientación) y el resto de cat.js/cat.config.js
  // permanecen exactamente igual.
  position: [-0.5, 1.0, -1.15],

  // Rotación en el eje Y (radianes). A diferencia del modelo anterior,
  // este SÍ tiene un lado "bueno" claro: es un escaneado 3D real y solo
  // la cara frontal (aprox. eje Z local positivo) está completamente
  // capturada — de perfil se aprecia geometría incompleta, y de
  // espaldas el escaneado es directamente una superficie plana sin
  // detalle (ver capturas de inspección / PROJECT_STATE.md). Con
  // rotationY = 0 esa cara buena ya mira hacia +Z, que es
  // aproximadamente hacia la cámara en esta escena, así que se deja un
  // giro pequeño (no uno grande tipo el -0.3 del modelo anterior) solo
  // para romper la simetría frontal sin llegar a enseñar una zona mal
  // escaneada.
  // SIN VERIFICAR EN NAVEGADOR — si el gato se ve de perfil/espaldas,
  // reducir este valor hacia 0 en vez de aumentarlo.
  //
  // AJUSTE (giro sutil hacia la izquierda): restar a rotationY gira la
  // cara del gato más hacia la izquierda de la pantalla (misma dirección
  // que razonaba el ZIP antiguo). El valor era 0.05 (un giro pequeño
  // hacia la derecha para romper la simetría frontal); pasarlo a -0.05
  // lo orienta la misma cantidad hacia la izquierda — un giro pequeño y
  // simétrico, sin llegar a enseñar la zona mal escaneada, que ya está
  // cubierta por la nota de arriba. NO se usa el antiguo -Math.PI/3-0.1.
  rotationY: -0.10,

  // Altura deseada del gato en la escena. Mismo mecanismo que
  // candle.js: el modelo se mide con THREE.Box3 nada más cargar y se
  // escala de forma UNIFORME (mismo factor en X/Y/Z) para alcanzar esta
  // altura, sea cual sea el tamaño original del archivo.
  //
  // A diferencia del modelo anterior (donde targetHeight medía la
  // altura de una pose DE PIE, antes de tumbar el gato a mano), aquí la
  // malla ya está en su pose final de "dormido/enroscado": esta altura
  // SÍ es la altura final visible del gato en la escena, no una
  // referencia intermedia.
  //
  // Proporciones reales del archivo (medidas por inspección, pose ya
  // enroscada): ancho ≈ 3.0x la altura, profundidad ≈ 2.6x la altura —
  // coherente con un gato dormido en ovillo visto de lado (más largo
  // que alto). 0.42 deja al gato con una altura aprox. al 38% de
  // CONFIG.candle.targetHeight (1.1): claramente visible, pero muy por
  // debajo de la vela, que sigue siendo el elemento principal de la
  // escena. Verificar en el navegador y ajustar este único número si se
  // ve demasiado pequeño/grande, o si su huella horizontal (~1.27 x
  // ~1.10 unidades con este valor) queda demasiado ancha junto a la
  // vela.
  targetHeight: 0.36,

  // REVELADO: cómo pasa el gato de "invisible en la oscuridad" a
  // "revelado por la luz de la vela". Sistema sin cambios respecto al
  // modelo anterior — no depende de si el modelo tiene esqueleto o no,
  // solo actúa sobre los materiales del modelo cargado (ver cat.js).
  reveal: {
    // El "progreso" del brillo ya NO es un estado animado propio del
    // gato: se lee en vivo, cada frame, del progreso REAL de luz de la
    // vela (flame.getLightProgress(), inyectado desde scene.js). Por
    // eso ya no existen `initialProgress` ni `revealDuration`/
    // `hideDuration`: no hay animación propia que parametrizar — el
    // gato sigue automáticamente la curva de encendido/apagado de la
    // llama. De aquí solo se leen los dos extremos del mapeo
    // minBrightness/maxBrightness (ver abajo).
    // iluminación ya NO se hace por opacidad — ver más abajo
    // `minBrightness`/`maxBrightness`.
    //
    // CORREGIDO (bug de "desvanecimiento"): antes este sistema variaba
    // `material.opacity` (con `transparent = true`) entre minOpacity y
    // maxOpacity. Aunque la intención era solo "oscurecer", cualquier
    // opacity < 1 con transparent=true hace que Three.js mezcle
    // (alpha-blend) el gato con lo que hay detrás — el fondo casi negro
    // de la escena y el hueco entre pelos de la textura — así que a ojo
    // se lee como semitransparente/"desvaneciéndose", no como "objeto
    // sólido en sombra". Ahora opacity se queda fija en 1 y
    // transparent en false (ver cat.js): el gato es 100% sólido en todo
    // momento, con normal (no alpha) blending.
    minOpacity: 1.0,
    maxOpacity: 1.0,

    // CORREGIDO (2ª pasada — bug del "tinte marrón"): la versión
    // anterior oscurecía multiplicando `material.color` por un color
    // HEX (`darkColor: 0x6b5c48`, `litColor: 0xffffff`). El problema no
    // era "qué color" se eligiera, sino que CUALQUIER color con canales
    // R/G/B distintos entre sí (0x6b5c48 → R=107,G=92,B=72, es decir
    // R>G>B, un tono cálido/marrón) cambia el matiz (hue) del pelaje al
    // multiplicarse con la textura, además de oscurecerlo — por eso el
    // gato se veía "con un filtro sepia", no "el mismo gato en penumbra".
    //
    // Sustituido por un ESCALAR de luminosidad (minBrightness/
    // maxBrightness, 0..1), no por un color: en cat.js se construye un
    // gris NEUTRO (mismo valor en R, G y B) a partir de este escalar y
    // se multiplica sobre la textura. Multiplicar por un gris neutro
    // (R=G=B=k) escala por igual los tres canales: el matiz (hue) y la
    // saturación de la textura original no cambian —
    // matemáticamente equivale a bajar solo el "Value" en HSV—, así que
    // el resultado es "el mismo pelaje, con menos luz encima", nunca un
    // filtro de color. minBrightness NO es 0 (que sería negro puro,
    // perdiendo todo el relieve/detalle de la textura, igual que pasaba
    // con opacity baja) sino un gris medio que deja pasar más luminancia
    // que el tinte anterior (0.46 aquí vs. ~0.37 de luminancia
    // percibida que tenía 0x6b5c48): corrige a la vez la queja de "se ve
    // demasiado oscuro" y la de "se ve marrón".
    minBrightness: 0.46,
    maxBrightness: 1.0,

    // Empuje de emisión/color adicional, solo si el material lo
    // soporta (propiedad `emissiveIntensity`). El material de este
    // modelo (MeshBasicMaterial, por KHR_materials_unlit) NO tiene esa
    // propiedad, así que cat.js lo detecta y lo ignora sin error — el
    // revelado sigue funcionando igualmente vía el escalar de
    // luminosidad. Se deja este valor tal cual por si en el futuro se
    // sustituye el material por uno que sí la soporte (p.ej. el
    // placeholder de desarrollo, que es MeshStandardMaterial).
    emissiveBoost: 0.18,
  },

  // PLACEHOLDER DE DESARROLLO: red de seguridad para cuando la carga
  // del .glb falla (archivo ausente, ruta incorrecta, red...). Sigue
  // sin usarse en el día a día porque el modelo real carga
  // correctamente, pero se deja el mecanismo activable para depurar.
  placeholder: {
    enabled: false,
    color: 0x3a2f22,
    size: 0.3,
  },

  // -----------------------------------------------------------------------
  // RESPIRACIÓN: el modelo es una malla ESTÁTICA sin esqueleto (ver nota
  // de arriba), así que no hay huesos de torso/pecho que animar. La
  // alternativa usada en cat.js ya NO es un escalado de `model.scale`
  // (eso movía también el cojín, que está soldado al gato en la misma
  // geometría): ahora se inyecta un pequeño fragmento en el vertex
  // shader del material (ver `attachBreathingShader` en cat.js) que
  // empuja hacia fuera SOLO los vértices de la zona elevada (el cuerpo
  // del gato), dejando fijos los bajos (el cojín), mediante un
  // "smoothstep" según su altura. La escala base (targetHeight) queda
  // exactamente fija. El pulso es casi enteramente horizontal (plano
  // local X/Y) y NO toca el eje de altura (Z), así el gato "se hincha"
  // muy sutilmente al inhalar sin efecto ascensor ni despegue de la
  // mesa.
  //
  // Curva por ciclo (no sinusoidal pura, para que se sienta orgánica):
  // inhalación suavizada → breve pausa arriba → exhalación suavizada →
  // pausa en reposo, y vuelta a empezar. Las cuatro fracciones deben
  // sumar 1 (la última, la pausa en reposo, se deduce del resto).
  // -----------------------------------------------------------------------
  breathing: {
    enabled: true,

    // Segundos que dura un ciclo completo (inhalación + pausa +
    // exhalación + pausa). Lento a propósito: es un gato dormido, no
    // jadeando.
    cycleDuration: 4.6,

    // Escala extra (fracción, no porcentaje) en el pico de la
    // inhalación sobre la escala base — p. ej. 0.021 = un 2.1% más
    // grande en X/Y en el punto más alto de la respiración.
    //
    // AJUSTADO (0.016 → 0.021 → 0.024): el valor 0.016 se percibía
    // demasiado poco (~3/10); 0.021 ya se nota y este incremento final
    // moderado (~14% más) lo lleva a un punto claramente visible como
    // respiración de gata dormida pero aún sutil y natural. Se mantiene
    // intacto todo lo demás: la máscara cuerpo/cojín (bodyMask*), el
    // pulso NO vertical, la escala base fija y la cadencia del ciclo.
    amplitude: 0.024,

    // Fracciones del ciclo (deben sumar ≤ 1; el resto es la pausa en
    // reposo antes de la siguiente inhalación).
    inhaleFraction: 0.34,
    holdInFraction: 0.08,
    exhaleFraction: 0.4,

    // -----------------------------------------------------------------------
    // MÁSCARA CUERPO/COJÍN: el .glb de "Sleeping Cat" trae el gato y el
    // cojín soldados en la MISMA geometría (confirmado inspeccionando el
    // archivo: 3 primitivas, pero repartidas por todo el modelo sin
    // ninguna que sea "solo cojín" o "solo gato" — no se pueden separar
    // por nodo/mesh). Por eso la respiración ya NO escala `model.scale`
    // entero (eso movía también el cojín): en su lugar, cat.js inyecta
    // un pequeño fragmento en el vertex shader del material que empuja
    // hacia fuera SOLO los vértices de la zona elevada (el cuerpo del
    // gato), dejando fijos los vértices bajos (el cojín), mediante un
    // "smoothstep" según su altura.
    //
    // Estos tres valores están en el espacio LOCAL/crudo del propio
    // archivo .glb (los ejes tal cual vienen en el fichero, antes de
    // cualquier rotación/escala que aplica este proyecto) — se han
    // medido analizando la nube de vértices del modelo, NO son
    // coordenadas del mundo de Candela ni hace falta tocarlas si se
    // reemplaza el modelo por otro con la misma estructura de ejes.
    //
    //   bodyMaskLowZ / bodyMaskHighZ: umbral bajo/alto en el eje "Z" del
    //     archivo (que es el que corresponde a la altura real del gato
    //     sobre el cojín). Por debajo de bodyMaskLowZ = cojín, sin
    //     ningún efecto (peso 0); por encima de bodyMaskHighZ = cuerpo
    //     del gato, con el pulso de respiración completo (peso 1); en
    //     medio hay una transición suave, para que no se note ningún
    //     borde/costura entre ambas zonas.
    //   bodyMaskCenterXY: punto (x, y), también en ejes del archivo,
    //     desde el que se "hincha" el cuerpo del gato — el centroide
    //     horizontal real de su zona elevada, para que la expansión se
    //     sienta centrada en el propio gato y no desplazada hacia un
    //     lado.
    bodyMaskLowZ: 18,
    bodyMaskHighZ: 23,
    bodyMaskCenterXY: [-7, 3],
  },

  // -----------------------------------------------------------------------
  // ETIQUETA DE HOVER: nombre que aparece con un fundido suave al pasar
  // el cursor sobre el gato (ver src/catHover.js). Sistema totalmente
  // aparte del revelado por brillo de arriba: no toca materiales ni
  // afecta al render 3D, solo un pequeño overlay HTML posicionado sobre
  // su posición en pantalla cada frame.
  // -----------------------------------------------------------------------
  hoverLabel: {
    text: "Chloe",

    // Altura (mismas unidades que el resto de la escena) por encima del
    // punto más alto del bounding box del gato a la que flota el texto.
    verticalOffset: 0.12,
  },
};