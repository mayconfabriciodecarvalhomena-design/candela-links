import * as THREE from "three";

// -----------------------------------------------------------------------
// ENVELOPE MESH: representación física procedural del sobre (final de
// Candela, ver sección 8 del encargo — "NO quiero un modelo .glb
// descargado de internet, NO quiero un objeto realista pegado encima de
// la escena"). Geometría sencilla hecha con Three.js (una caja fina para
// el cuerpo + un plano triangular para la solapa) y un material mate
// cálido color papel, sin textura externa — coherente con el resto de
// la estética 3D-generada del proyecto (mismo criterio que flame.js: la
// forma sale de geometría + shader/material, no de un asset descargado).
//
// La solapa es un objeto INDEPENDIENTE del cuerpo (su propio Group,
// "flapPivot"), con el pivote colocado en el borde SUPERIOR del sobre —
// no en el centro de la solapa — para que open() la haga rotar como una
// solapa real, no como una puerta girando desde su mitad (ver sección 10
// del encargo).
//
// Este módulo no sabe nada de partículas, cámara, ni del resto de la
// secuencia del final: solo construye el objeto y sabe abrirse a sí
// mismo cuando se le pide (open()). Toda la orquestación (cuándo
// aparece, cuándo viaja, cuándo se le pide que se abra) vive en
// candelaFinale.js.
// -----------------------------------------------------------------------
export function createEnvelopeMesh(cfg, onUpdate) {
  const group = new THREE.Group();
  group.visible = false;

  const paperColor = new THREE.Color(cfg.color);

  // -----------------------------------------------------------------------
  // DIAGNÓSTICO DEL "SOBRE GRIS" (iteración visual):
  //
  // El sobre usaba (y sigue usando) MeshStandardMaterial reaccionando
  // solo a las luces reales de la escena — correcto en principio, para
  // que conserve sombreado/volumen 3D. El problema NO estaba en el
  // color, roughness ni metalness del material (0xe8d3a6, 0.85, 0.02 —
  // sin cambios), ni en ningún cambio de material durante la animación
  // (setAppearance() solo toca opacity, nunca color/roughness/metalness
  // — comprobado, no hay ningún otro punto del código que reasigne
  // `.color`). El problema es de ILUMINACIÓN, y tiene dos causas que se
  // suman:
  //
  //   1) Ángulo de incidencia: la PointLight de la llama (flame.js)
  //      vive junto a la mecha. La cara del sobre que ve la cámara
  //      queda, según hacia dónde viaja el sobre, en un ángulo cada vez
  //      más rasante/negativo respecto a esa luz (N·L→0) — el mismo
  //      fenómeno, EXACTAMENTE, que ya está documentado en
  //      flame.config.js para la cara frontal del cuerpo de la vela
  //      ("una cara vertical... con una luz arriba-y-detrás recibe
  //      N·L prácticamente nulo").
  //   2) Sin luz directa, lo que queda es la luz ambiental/hemisférica
  //      global (CONFIG.scene.ambientColor/hemisphere en config.js),
  //      cuyo componente de "cielo" es un azul-gris frío
  //      (hemisphere.skyColor = 0x3a3f52). Un material cálido
  //      (0xe8d3a6) iluminado casi solo por un tono frío se ve
  //      apagado/gris — no es un "bug" de Three.js, es física de
  //      materiales correctamente simulada con una luz dominante del
  //      color equivocado para lo que se quiere transmitir aquí.
  //
  // Arreglo LOCAL (sin tocar CONFIG.scene ni flame.js ni ninguna luz
  // global): una PointLight cálida pequeña, hija de `group` (viaja con
  // el sobre a todas partes, ver fillLight más abajo) + un emissive
  // sutil como suelo de color (ver más abajo) — las dos cosas dejan
  // intacto el sombreado real (normales, sombras entre caras, brillos)
  // porque siguen siendo luces/reacción PBR de verdad, no un material
  // plano.
  // -----------------------------------------------------------------------

  // ---- Cuerpo: una caja fina (no un plano) para que tenga algo de
  // presencia/grosor real bajo la luz de la llama, sin llegar a ser una
  // geometría cara. ----
  const bodyDepth = cfg.depth;
  const bodyGeometry = new THREE.BoxGeometry(cfg.width, cfg.height, bodyDepth);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: paperColor,
    roughness: cfg.roughness,
    metalness: 0.02,
    transparent: true,
    opacity: 0,
    // Suelo de color cálido — ver diagnóstico arriba. Deliberadamente
    // bajo (cfg.emissiveIntensity) para que siga habiendo sombreado 3D
    // real por encima de este suelo, no un material plano.
    emissive: paperColor,
    emissiveIntensity: cfg.emissiveIntensity,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = false;
  body.receiveShadow = false;
  group.add(body);

  // -----------------------------------------------------------------------
  // ELIMINADO (iteración visual — "líneas negras"): aquí vivía "seam",
  // una THREE.Line decorativa (un rombo muy plano) que sugería el
  // pliegue inferior de un sobre real. Se ha quitado por completo, sin
  // sustituirla por ninguna otra línea — la apertura se entiende solo
  // por la geometría real de la solapa (flapPivot/flap más abajo), no
  // por ninguna línea dibujada encima. No queda ninguna geometría ni
  // material "seam"/"crease"/"fold" en este archivo.
  // -----------------------------------------------------------------------
  const halfW = cfg.width / 2;

  // ---- Solapa: plano triangular, pivote en el borde superior del
  // sobre (ver comentario de cabecera). ----
  const flapPivot = new THREE.Group();
  // El PIVOTE se queda exactamente en el borde real (bodyDepth / 2, el
  // mismo plano que la cara frontal del cuerpo) — es el eje de bisagra
  // real, no debe moverse o la apertura dejaría de rotar desde el borde
  // correcto (ver sección 10 del encargo).
  flapPivot.position.set(0, cfg.height / 2, bodyDepth / 2);
  group.add(flapPivot);

  const flapHeight = cfg.flapHeight;
  const flapGeometry = new THREE.BufferGeometry();
  // Vértices relativos al PIVOTE (0,0,0 = borde superior/centro del
  // sobre), no al centro de la solapa — así rotar flapPivot en X hace
  // que el vértice inferior (la punta de la solapa) barra un arco desde
  // el borde, exactamente como una solapa real abriéndose.
  const flapVerts = new Float32Array([
    -halfW, 0, 0,
    halfW, 0, 0,
    0, -flapHeight, 0,
  ]);
  flapGeometry.setAttribute("position", new THREE.BufferAttribute(flapVerts, 3));
  flapGeometry.setIndex([0, 1, 2]);
  flapGeometry.computeVertexNormals();

  // -----------------------------------------------------------------------
  // CORREGIDO (iteración visual — "textura bugueada" / "líneas negras"):
  // esta malla, con z=0 relativo al pivote, quedaba EXACTAMENTE
  // coincidente con la cara frontal del cuerpo (mismo plano, ver
  // flapPivot.position.z arriba) — dos superficies a idéntica
  // profundidad compitiendo por los mismos píxeles del depth buffer
  // (z-fighting), que es lo que se veía como un patrón de rayas/moiré
  // parpadeante justo en la zona con forma de solapa, y como una línea
  // oscura trazando su contorno.
  //
  // Arreglo, con DOS capas de seguridad (para que no dependa de un
  // único número frágil que pueda volver a fallar según la distancia a
  // cámara):
  //   1) un offset de posición minúsculo (imperceptible: 2mm sobre un
  //      sobre de ~27cm de ancho) que separa la malla VISUAL de la
  //      solapa del plano exacto del cuerpo;
  //   2) `polygonOffset` en el material, que empuja esta geometría
  //      hacia la cámara a nivel del propio test de profundidad de la
  //      GPU, con efecto consistente sea cual sea la distancia.
  // Ninguna de las dos cosas mueve `flapPivot` (el eje de bisagra real,
  // ver arriba) — la apertura sigue rotando desde el borde correcto.
  // -----------------------------------------------------------------------
  // -----------------------------------------------------------------------
  // CORREGIDO (iteración visual — "solapa naranja"): antes usaba
  // `edgeColor` (un tono más oscuro/saturado, pensado originalmente
  // como "borde" diferenciado) tanto en `color` como en `emissive` — de
  // ahí que se viera como una pieza de otro material, no como parte del
  // mismo sobre. Ahora usa exactamente `paperColor`, el mismo color y
  // el mismo emissive que el cuerpo (bodyMaterial más arriba) — cuerpo
  // y solapa quedan visualmente indistinguibles salvo por el
  // sombreado/luz real que reciba cada cara (que es lo que SÍ debe
  // variar, para conservar el volumen 3D).
  // -----------------------------------------------------------------------
  const flapMaterial = new THREE.MeshStandardMaterial({
    color: paperColor,
    roughness: cfg.roughness,
    metalness: 0.02,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    emissive: paperColor,
    emissiveIntensity: cfg.emissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const flap = new THREE.Mesh(flapGeometry, flapMaterial);
  flap.position.z = 0.002;
  flapPivot.add(flap);

  // -----------------------------------------------------------------------
  // GROSOR REAL DE LA SOLAPA (iteración "sobre demasiado plano"): hasta
  // ahora la solapa era un único triángulo sin espesor — desde un
  // ángulo rasante (que ocurre constantemente durante open(), dado el
  // barrido de la bisagra) se veía como una lámina infinitamente fina.
  // Esta es la misma geometría (`flapGeometry`, mismo `flapMaterial`,
  // mismo `paperColor` — nunca un color distinto) colocada ligeramente
  // DETRÁS de la cara frontal de la solapa, formando un "sandwich" muy
  // fino con un borde real y visible entre ambas caras — igual que un
  // trozo de papel tiene un canto perceptible visto de lado, por fino
  // que sea.
  //
  // Hija de `flapPivot` (como `flap`): gira exactamente con la solapa,
  // nunca se separa de ella.
  // -----------------------------------------------------------------------
  const flapThickness = 0.004;
  const flapBack = new THREE.Mesh(flapGeometry, flapMaterial);
  flapBack.position.z = flap.position.z - flapThickness;
  flapPivot.add(flapBack);

  // -----------------------------------------------------------------------
  // RELIEVE/PLIEGUE (ver sección "RELIEVE DEL PLIEGUE" del encargo).
  //
  // DIAGNÓSTICO de por qué la versión anterior apenas se veía: era una
  // caja casi plana (BoxGeometry) inclinada solo 7° — con esa altura
  // (0.0033 unidades) y ese ángulo, la protrusión REAL fuera del plano
  // era de apenas 0.0002 unidades (0.2mm), diez veces menos que el
  // propio offset de 2mm que ya usa `flap` para el z-fighting. No es
  // que fuera "sutil": era, a efectos prácticos, indistinguible de
  // plana — casi no había normal distinta que pudiera generar sombreado.
  //
  // Arreglo: en vez de una sola cara casi sin inclinar, esto es ahora
  // una CRESTA de DOS caras que se encuentran en una arista central —
  // como una tarjeta doblada por la mitad, visto de perfil:
  //
  //         arista (protrusión real hacia cámara)
  //           ▲
  //          ╱ ╲
  //         ╱   ╲
  //   ─────╱     ╲─────   (los extremos quedan a ras del plano normal)
  //
  // Dos caras con normales claramente distintas entre sí (y distintas
  // del resto del sobre) SIEMPRE producen un contraste de luz/sombra
  // visible sea cual sea la dirección de la luz — a diferencia de una
  // única cara casi vertical, cuyo cambio de sombreado depende
  // completamente del ángulo exacto de la luz en cada momento. Sigue
  // siendo geometría real (ninguna THREE.Line, ningún color distinto —
  // mismo `paperColor`/`emissiveIntensity` que el cuerpo), solo que
  // ahora con una forma que realmente representa un pliegue de papel.
  //
  // Todas las crestas son hijas de `group` (no de `flapPivot`): son
  // pliegues del propio cuerpo, permanecen fijos en su sitio tanto si
  // la solapa está cerrada como abierta — no rotan con `open()`.
  //
  // CORREGIDO (segunda iteración del relieve — "por qué apenas se
  // percibía"): la cresta de la bisagra vivía exactamente al nivel de
  // la cara frontal del cuerpo, en la franja que la propia solapa
  // CERRADA cubre por completo (la solapa cuelga desde esa misma línea
  // hacia abajo) — así que quedaba oculta DETRÁS de la solapa, no
  // delante. Ahora su arista sobresale claramente por delante de la
  // superficie de la solapa cerrada (no solo del cuerpo), para que siga
  // siendo visible aunque la solapa esté encima.
  // -----------------------------------------------------------------------

  // Constructor genérico de una cresta (dos caras que se encuentran en
  // una arista), reutilizado para la unión con la solapa y para los dos
  // pliegues diagonales de más abajo. topOffset/peakOffset/bottomOffset
  // son desplazamientos en Y respecto al punto de anclaje del objeto
  // (pueden ser asimétricos, ver la cresta de la bisagra); bump es la
  // protrusión en Z de la arista. Geometría NO indexada para que
  // computeVertexNormals() calcule una normal plana por cara, sin
  // suavizar la arista.
  function buildRidgeGeometry(length, topOffset, peakOffset, bottomOffset, bump) {
    const halfLen = length / 2;
    const verts = new Float32Array([
      -halfLen, topOffset, 0, halfLen, topOffset, 0, halfLen, peakOffset, bump,
      -halfLen, topOffset, 0, halfLen, peakOffset, bump, -halfLen, peakOffset, bump,
      -halfLen, peakOffset, bump, halfLen, peakOffset, bump, halfLen, bottomOffset, 0,
      -halfLen, peakOffset, bump, halfLen, bottomOffset, 0, -halfLen, bottomOffset, 0,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  // Un único material compartido por las tres crestas (misma
  // `paperColor`/`emissiveIntensity` que el cuerpo — nunca un color
  // distinto), así `setAppearance()` solo necesita tocar una opacidad
  // para las tres.
  const creaseMaterial = new THREE.MeshStandardMaterial({
    color: paperColor,
    roughness: cfg.roughness,
    metalness: 0.02,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    emissive: paperColor,
    emissiveIntensity: cfg.emissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  // ---- Cresta de la bisagra (unión solapa/cuerpo) ----
  // La superficie de la solapa CERRADA está en z = bodyDepth/2 + 0.002
  // (ver `flap.position.z` más abajo). Esta arista sobresale HASTA
  // bodyDepth/2 + 0.004 — 2mm por delante de esa superficie — para que
  // siga siendo visible con la solapa cerrada encima, en vez de quedar
  // tapada detrás de ella. Totalmente por debajo de la línea de unión
  // (topOffset=0), dentro de la franja que la solapa cerrada cubre, así
  // que no queda "flotando" en una zona vacía por encima del sobre.
  const hingeCreaseLength = cfg.width * 0.985;
  const hingeCreaseSpan = 0.006;
  const hingeCreaseBump = 0.004;
  const hingeCreaseGeometry = buildRidgeGeometry(
    hingeCreaseLength,
    0,
    -hingeCreaseSpan * 0.4,
    -hingeCreaseSpan,
    hingeCreaseBump
  );
  const hingeCrease = new THREE.Mesh(hingeCreaseGeometry, creaseMaterial);
  hingeCrease.position.set(0, cfg.height / 2, bodyDepth / 2);
  group.add(hingeCrease);

  // -----------------------------------------------------------------------
  // RELIEVES DE BORDE LATERAL (iteración "sobre demasiado plano"): dos
  // crestas verticales, una en cada lateral del cuerpo, sugiriendo la
  // costura/doble grosor de papel característica de una "bolsa" de
  // sobre — sin ella, los laterales del cuerpo son una superficie
  // completamente lisa de borde a borde, lo que refuerza la sensación
  // de "lámina plana" que queríamos corregir. Mismo `buildRidgeGeometry`
  // que la cresta de la bisagra, mismo `creaseMaterial` (mismo
  // `paperColor`, sin color distinto), solo girado 90° para que quede
  // vertical en vez de horizontal.
  //
  // Hijas de `group` (como `hingeCrease`): son un detalle fijo del
  // cuerpo, no de la solapa — no rotan con `open()`.
  // -----------------------------------------------------------------------
  const sideRimLength = cfg.height * 0.97;
  const sideRimHalfSpan = 0.003;
  const sideRimBump = 0.0025;

  function addSideRim(edgeX) {
    const geometry = buildRidgeGeometry(sideRimLength, sideRimHalfSpan, 0, -sideRimHalfSpan, sideRimBump);
    const mesh = new THREE.Mesh(geometry, creaseMaterial);
    mesh.position.set(edgeX, 0, bodyDepth / 2);
    mesh.rotation.z = Math.PI / 2;
    group.add(mesh);
    return mesh;
  }

  addSideRim(-halfW * 0.99);
  addSideRim(halfW * 0.99);

  // -----------------------------------------------------------------------
  // ELIMINADO (iteración de revisión de relieves — "hay demasiados
  // relieves"): aquí vivían dos crestas diagonales del CUERPO (desde el
  // punto donde toca la punta de la solapa cerrada hacia cada esquina
  // inferior), pensadas como el patrón clásico de pliegues laterales de
  // un sobre real. Analizadas las capturas: no corresponden a NINGÚN
  // pliegue físico real de esta construcción (el cuerpo es una simple
  // caja, sin solapas laterales que doblar) — categoría C del encargo,
  // "relieve artificial que sobra". Sin nada a lo que conectarse visual
  // ni estructuralmente, se leían exactamente como el propio encargo
  // advertía que había que evitar: "un 'V' flotando". Eliminadas por
  // completo, no sustituidas por nada — ver diagonalHalfSpan/
  // diagonalBump más abajo, que SÍ se conservan porque los sigue usando
  // el bisel de la solapa (categoría B, borde real de una pieza real).
  // -----------------------------------------------------------------------
  const diagonalHalfSpan = 0.0022;
  const diagonalBump = 0.003;

  // -----------------------------------------------------------------------
  // BISEL DE LA SOLAPA (causa real de "no se ve la solapa", ver rondas
  // anteriores): flapMaterial usa EXACTAMENTE el mismo color/emissive
  // que el cuerpo (corregido así hace unas rondas para dejar de verse
  // naranja) — pero eso significa que la solapa, cerrada, no tenía
  // NINGÚN relieve propio en sus dos bordes inclinados que la
  // distinguiera del cuerpo bajo sombreado normal; solo los 2mm de
  // `flap.position.z` (insuficientes por sí solos). Estos dos biseles
  // trazan los bordes inclinados de la propia solapa (mismos vértices
  // que `flapVerts`, ver flapGeometry más arriba) — mismo `paperColor`,
  // ninguna diferencia de color, solo relieve. Categoría B del
  // encargo: borde real de la propia pieza de la solapa — se conservan.
  //
  // Son hijos de `flapPivot` (NO de `group`): son un borde de la propia
  // pieza de la solapa, no un pliegue del cuerpo — deben girar CON ella
  // durante open().
  // -----------------------------------------------------------------------
  function addFlapEdgeCrease(cornerX) {
    const dx = 0 - cornerX;
    const dy = -flapHeight - 0;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const geometry = buildRidgeGeometry(length, diagonalHalfSpan, 0, -diagonalHalfSpan, diagonalBump);
    const mesh = new THREE.Mesh(geometry, creaseMaterial);
    mesh.position.set(cornerX / 2, -flapHeight / 2, flap.position.z);
    mesh.rotation.z = angle;
    flapPivot.add(mesh);
    return mesh;
  }

  addFlapEdgeCrease(-halfW);
  addFlapEdgeCrease(halfW);

  // ---- Luz de relleno local (ver diagnóstico "SOBRE GRIS" arriba) —
  // hija de `group`, así que se mueve/viaja exactamente con el sobre
  // sin necesitar actualizarla manualmente cada frame. offsetZ la sitúa
  // ligeramente por delante de la cara frontal (la que mira a cámara),
  // apuntando de vuelta hacia el propio sobre para garantizar N·L
  // positivo en esa cara pase lo que pase con la PointLight de la
  // llama. Intensidad/distancia deliberadamente pequeñas: solo debe
  // notarse en el propio sobre, no filtrarse como una luz nueva de la
  // habitación.
  const fillLight = new THREE.PointLight(cfg.fillLight.color, 0, cfg.fillLight.distance, cfg.fillLight.decay);
  fillLight.position.set(0, 0, cfg.fillLight.offsetZ);
  group.add(fillLight);

  // -----------------------------------------------------------------------
  // APARIENCIA (fade in/out): controlado desde fuera por
  // candelaFinale.js durante la fase MATERIALIZE (ver sección 8 del
  // encargo) — un único número 0..1 que gobierna la opacidad de TODAS
  // las piezas a la vez, para que aparezcan juntas, nunca por separado.
  // -----------------------------------------------------------------------
  function setAppearance(t) {
    const a = Math.max(0, Math.min(1, t));
    bodyMaterial.opacity = a;
    flapMaterial.opacity = a;
    creaseMaterial.opacity = a;
    // La luz de relleno se apaga/enciende junto con el resto — nunca se
    // ve "sola" antes de que el sobre sea visible, ni se queda
    // iluminando algo invisible.
    fillLight.intensity = cfg.fillLight.intensity * a;
    group.visible = a > 0.001;
  }

  // -----------------------------------------------------------------------
  // APERTURA (ver sección 10 del encargo). Máquina de estados mínima,
  // propia de este objeto — candelaFinale.js solo llama a open() una
  // vez y consulta isOpen()/isOpening(), no necesita saber nada de
  // easing ni de duración.
  // -----------------------------------------------------------------------
  let openState = "closed"; // "closed" | "opening" | "open"
  let openElapsed = 0;

  function open() {
    if (openState !== "closed") return;
    openState = "opening";
    openElapsed = 0;
  }

  function isOpen() {
    return openState === "open";
  }

  function isOpening() {
    return openState === "opening";
  }

  function reset() {
    openState = "closed";
    openElapsed = 0;
    flapPivot.rotation.x = 0;
    setAppearance(0);
  }

  function update(delta) {
    if (openState !== "opening") return;
    openElapsed += delta;
    const t = Math.min(1, openElapsed / cfg.open.duration);
    // easeOutCubic: desaceleración simple, SIN rebote/overshoot — la
    // solapa es una única pieza plana y rígida (ver flapGeometry más
    // arriba: 3 vértices estáticos, sin subdivisión ni deformación por
    // vértice en ningún punto de este archivo) que gira una sola vez
    // alrededor de `flapPivot`, sin pasarse de su ángulo final ni
    // volver.
    const eased = easeOutCubic(t);
    // -----------------------------------------------------------------------
    // ÁNGULO FINAL (revisado esta ronda — "la solapa gira demasiados
    // grados" / "parece que atraviesa el sobre" / "se abre desde
    // atrás"):
    //
    // La punta de la solapa está en (0, -flapHeight, 0) relativo al
    // pivote (ver flapVerts arriba) — EN REPOSO cuelga hacia -Y con
    // z=0. Bajo rotation.x=φ: y'=-flapHeight·cos(φ), z'=-flapHeight·sin(φ).
    // El signo POSITIVO barre la punta por Z NEGATIVO (alejándose de la
    // cámara, +Z es el lado que mira a cámara — ver fillLight.offsetZ),
    // sentido correcto, verificado y CONSERVADO sin cambios.
    //
    // Lo que sí cambia es el ÁNGULO FINAL. Con Three.js real
    // (flapPivot+flap reales, no fórmula a mano) medí, para varios
    // ángulos, la profundidad Z que alcanza la solapa durante el barrido
    // y su visibilidad real (|normal·forward| con la cámara real del
    // proyecto):
    //
    //   90°  → z tan atrás como -0.089 (¡14× el grosor del cuerpo,
    //          bodyDepth/2=0.006!) — inevitable de cruzar si el ángulo
    //          final supera 90°, es el pico de excursión de CUALQUIER
    //          bisagra que gire más allá de perpendicular.
    //   180° → visibilidad 0.955, pero z'=0 EXACTO: la solapa vuelve a
    //          quedar perfectamente plana/coplanar con el frente — un
    //          giro completo de 180° invertido, que es mucho más
    //          barrido del necesario para "abierta y reconocible".
    //   150° → visibilidad 0.874 (sigue siendo muy alta), pero se
    //          DETIENE apoyada hacia atrás (z'≈-0.043 en reposo) en vez
    //          de completar el giro entero — una pose de "solapa
    //          abierta reclinada", más parecida a un sobre real
    //          abierto que un volteo completo de 180°.
    //
    // 150° (5π/6) reduce el barrido total un 17% respecto a 180°, deja
    // la solapa claramente visible y con una pose final más natural, y
    // ya no se pasa de perpendicular tanto tiempo/tanto ángulo — sin
    // tocar el signo ni el eje, que ya estaban verificados como
    // correctos.
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // SIGNO (corregido esta ronda — comprobación visual del usuario: la
    // solapa se abría hacia ATRÁS, alejándose de cámara, cuando debía
    // abrirse HACIA DELANTE, hacia el espectador, como un sobre real
    // sobre una mesa). Verificado con Three.js real (no solo fórmula a
    // mano): con signo POSITIVO, la punta de la solapa barre hacia Z
    // NEGATIVO — y +Z es el lado que mira a cámara (ver
    // fillLight.offsetZ, "por delante de la cara frontal, la que mira a
    // cámara"), así que positivo = alejarse de cámara = exactamente el
    // problema descrito. Con signo NEGATIVO, la punta barre hacia +Z
    // (hacia cámara) — confirmado con la cámara real del proyecto.
    // Visibilidad final similar (0.780 con signo negativo a 150° frente
    // a 0.874 con el anterior), sigue siendo alta. Único cambio: el
    // signo. El ángulo final (150°) y todo lo demás permanece igual.
    // -----------------------------------------------------------------------
    flapPivot.rotation.x = -eased * (Math.PI * (5 / 6));
    if (t >= 1) openState = "open";
  }

  onUpdate(update);

  return {
    group,
    flapPivot,
    setAppearance,
    open,
    isOpen,
    isOpening,
    reset,
  };
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// Desaceleración simple, sin rebote — ver comentario junto a su uso en
// update() más arriba (apertura de la solapa como pieza rígida).
function easeOutCubic(t) {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}
