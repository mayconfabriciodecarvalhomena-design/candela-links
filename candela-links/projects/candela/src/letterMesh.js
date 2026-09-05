import * as THREE from "three";

// -----------------------------------------------------------------------
// LETTER MESH: representación física procedural de la carta (segunda
// parte del final de Candela). Mismo criterio que envelopeMesh.js:
// geometría sencilla + material mate cálido, sin asset externo.
//
// ITERACIÓN — SE ABANDONA POR COMPLETO EL DOBLADO (ver encargo: "no
// queremos que la hoja se doble, se despliegue ni se divida en dos
// partes... quiero simplificarlo al máximo"). Iteraciones anteriores
// habían llegado a un sistema de dos mitades por página (izquierda/
// derecha) con sus propios pivotes de pliegue, caras frontal/trasera
// distintas (`FrontSide`/`BackSide`) y un recorte UV para que ambas
// mitades compartieran una única textura sin costura. Todo ese sistema
// se elimina aquí: no se corrige, no se sustituye por otro mecanismo de
// plegado — deja de existir.
//
// Cada hoja es ahora, de nuevo, UNA ÚNICA malla completa (un solo
// plano, cfg.width × cfg.height) con el texto ya horneado en su propia
// textura desde el momento en que se construye — nunca una animación
// de apertura ni una geometría que cambie de forma. La única animación
// de la carta vive en candelaFinale.js: un desplazamiento de posición
// desde el sobre hasta su posición final (más un fundido de opacidad),
// con la hoja ya a su tamaño/forma definitivos en todo momento.
//
// ITERACIÓN — PILA DE HOJAS SUELTAS (se abandona el pivote de libro).
// El encargo es explícito: "no quiero que parezcan un libro… son hojas
// de papel sueltas apiladas". El sistema anterior giraba cada hoja
// -180° sobre un pivote (`hinge`) fijo en su borde izquierdo — un
// mecanismo de lomo encuadernado. Aquí se sustituye por completo:
//
//   - Cada hoja tiene una RANURA (slot) de profundidad fija dentro de
//     la pila (0 = arriba del todo/la que se lee, N-1 = la más al
//     fondo). El array `order` es la única fuente de verdad de qué
//     hoja física ocupa cada ranura — nunca se infiere de índices fijos.
//   - `nextPage()` saca la hoja de la ranura 0 y la reinserta al fondo
//     (ranura N-1); `previousPage()` hace lo inverso: saca la hoja del
//     fondo y la reinserta arriba — ACOTADO, sin bucle: se bloquea en
//     la primera/última hoja, la carta tiene un principio y un final
//     reales (ver nextPage()/previousPage() más abajo). El resto de
//     hojas NO se mueve (sus huecos de profundidad son imperceptibles
//     — `stackSpacing` — así que no hace falta animarlas, solo
//     reasignarles su nueva ranura al terminar la transición).
//   - La hoja que se mueve sigue una curva de Bézier cúbica en el
//     espacio (posición) más una inclinación temporal (rotación) — ver
//     `updatePageTurn()` más abajo — que la separa de la pila hacia la
//     cámara, la eleva por ENCIMA del borde superior de la carta y la
//     lleva por detrás de la posición final antes de posarla: en
//     ningún momento su trayectoria cruza el volumen de las demás
//     hojas. Nunca es una rotación sobre un eje fijo.
//
// La carta es un Group con:
//   - `pages` → un plano físico INDEPENDIENTE por cada entrada de
//     `cfg.pages` (nunca hardcodeado — ver finale.config.js), cada uno
//     dentro de su propio `anchor` (Group) que controla su posición y
//     rotación en la pila — mismo lenguaje que `flapPivot` en
//     envelopeMesh.js: se anima el grupo contenedor, nunca la
//     geometría.
//
// El texto de cada hoja NUNCA es HTML/DOM: se hornea directamente en
// una textura de canvas 2D oculto (mismo patrón que
// createSoftGlowTexture()/sampleWordPoints() en este proyecto), ver
// buildPageTexture() más abajo — una única textura por página, ya
// aplicada a la malla desde su construcción (nunca una segunda capa ni
// una animación de revelado aparte: el texto es simplemente parte de
// la textura de la hoja, visible desde el primer instante en que la
// hoja tiene opacidad > 0).
//
// Este módulo no sabe nada de la cámara, del sobre ni del resto de la
// secuencia del final: solo construye el objeto y sabe mostrar la
// carta (página actual, YA con su contenido) progresivamente
// (setAppearance()), y pasar de hoja (nextPage()/previousPage()/
// getCurrentPage()/getPageCount()/isTurning()). Toda la orquestación
// (cuándo aparece, hacia dónde se mueve, cuánto escala, cuándo se
// permite pasar página) vive en candelaFinale.js — mismo reparto de
// responsabilidades que envelopeMesh.js.
// -----------------------------------------------------------------------
export function createLetterMesh(cfg, onUpdate) {
  const group = new THREE.Group();
  // ITERACIÓN — CORRECCIÓN "TIRÓN DE FPS AL SALIR DEL SOBRE" (ver
  // cabecera del archivo): antes, `group.visible` pasaba de `false` a
  // `true` de golpe justo cuando `setAppearance()` recibía su primer
  // valor > 0 (el instante exacto en que la carta empieza a salir del
  // sobre). Mientras `group.visible === false`, three.js NO envía
  // ninguna de las 5 hojas a la GPU en absoluto — así que sus 5
  // texturas (canvas 2D con el texto ya horneado, ver
  // buildPageTexture()) no se suben a la GPU hasta ese primer frame
  // visible, y las 5 llegan A LA VEZ justo cuando más importa que el
  // frame vaya fluido. `group` se queda ahora SIEMPRE visible desde su
  // creación (mucho antes de que exista ninguna carta que mostrar: el
  // final ni siquiera se ha disparado todavía); lo que de verdad
  // decide si algo se ve es la opacidad de cada hoja (0 = invisible),
  // nunca esta propiedad. Así, la subida de las 5 texturas a la GPU
  // ocurre en uno de los primeros frames de la aplicación —cuando aún
  // no hay nada más compitiendo por el frame— en vez de coincidir con
  // el instante más exigente de toda la secuencia del final.
  group.visible = true;

  const paperColor = new THREE.Color(cfg.color);

  // -----------------------------------------------------------------------
  // SISTEMA DE HOJAS (ver "OBJETIVO 2 — SISTEMA REAL DE PASAR HOJAS" del
  // encargo original + ITERACIÓN "PILA DE HOJAS SUELTAS" en la cabecera
  // del archivo). Una hoja física independiente por cada entrada de
  // `cfg.pages` — el número de hojas NUNCA está hardcodeado, sale de
  // `cfg.pages.length`. Cada hoja se crea UNA vez aquí (nunca por frame
  // — ver "RENDIMIENTO" del encargo: sin geometrías/texturas nuevas por
  // frame, sin recrear hojas continuamente).
  //
  // Cada hoja es una ÚNICA malla completa (cfg.width × cfg.height, sin
  // divisiones ni pivotes de pliegue), envuelta en un `anchor` (Group)
  // que es lo único que se anima: posición (X/Y/Z) y rotación durante
  // el vuelo, nunca la geometría — ver updatePageTurn() más abajo.
  // -----------------------------------------------------------------------
  const pageContents = Array.isArray(cfg.pages) && cfg.pages.length > 0 ? cfg.pages : [{ text: "" }];
  const pageCfg = cfg.page;
  const pageCount = pageContents.length;

  // Profundidad Z de la ranura `slot` dentro de la pila (0 = arriba del
  // todo/la que se lee, pageCount-1 = la más al fondo). Separación
  // minúscula (`stackSpacing`) solo para evitar z-fighting entre planos
  // casi coplanares — nunca para cambiar el tamaño/posición general de
  // la carta. Se usa tanto para el reposo como para los extremos del
  // vuelo (ver updatePageTurn()).
  function slotDepth(slot) {
    return 0.0012 + (pageCount - 1 - slot) * pageCfg.stackSpacing;
  }

  const pages = pageContents.map((pageData) => {
    // Ancla física de la hoja dentro de la pila: sustituye por completo
    // al antiguo pivote de lomo (`hinge`) — ver cabecera del archivo.
    // La malla ya está centrada en su propio origen (PlaneGeometry sin
    // trasladar), así que el `anchor` coincide exactamente con el
    // centro de la hoja: mover/rotar el anchor mueve/rota la hoja
    // entera como un cuerpo rígido.
    const anchor = new THREE.Group();
    group.add(anchor);

    const built = buildPageTexture(
      pageData,
      cfg.width,
      cfg.height,
      cfg.text.font,
      pageCfg.title,
      `#${paperColor.getHexString()}`
    );

    const geometry = new THREE.PlaneGeometry(cfg.width, cfg.height);
    // ITERACIÓN — CORRECCIÓN "LA HOJA ATRAVIESA LA PILA" (ver cabecera
    // del archivo): mientras el material es `transparent:true` con
    // `depthWrite:false` (necesario SOLO durante el fundido inicial de
    // aparición — ver setAppearance()), el orden visual entre hojas lo
    // decide el ORDEN DE PINTADO (sort de transparencia de three.js /
    // renderOrder), NUNCA la profundidad real — por eso una hoja podía
    // "pasar por delante" de otra aunque su posición Z real ya estuviera
    // detrás: no es un problema de trayectoria, es un problema de qué
    // prueba de profundidad usa el material. En cuanto la hoja termina
    // de aparecer (opacidad 1 permanente, nunca se vuelve a animar) se
    // pasa a `transparent:false`/`depthWrite:true` — ver lockOpaque()
    // más abajo — para que el propio z-buffer de la GPU decida qué hoja
    // se ve delante de cuál, de forma real y consistente con su
    // posición 3D en cada instante (también durante el vuelo).
    const material = new THREE.MeshStandardMaterial({
      map: built.texture,
      roughness: cfg.roughness,
      metalness: 0.02,
      transparent: true,
      opacity: 0,
      // DoubleSide: durante el vuelo la hoja se inclina (ver
      // updatePageTurn()) y podría asomar brevemente su reverso —
      // con FrontSide se vería "agujereada" en ese instante.
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    anchor.add(mesh);

    // `pageData`/`canvas`/`ctx`/`bodyTop` se conservan además de la
    // textura (que vive en `material.map`) para que la ÚLTIMA hoja
    // pueda ser superficie de escritura (ver setWritableDraft()/
    // paintWritablePage() más abajo): repintar sobre el MISMO
    // canvas/contexto ya usado en la construcción, nunca uno nuevo por
    // pulsación de tecla — mismo criterio de "sin texturas/geometrías
    // nuevas por frame" que el resto del archivo. `writeScrollTop` es el
    // offset de scroll PERSISTENTE de esa hoja (índice de la primera
    // línea visible; ver paintWritablePage()): se inicializa a 0 en la
    // construcción y solo lo mueve la propia paintWritablePage() para
    // que la línea del carenciado entre siempre en la ventana visible.
    return { anchor, mesh, material, pageData, canvas: built.canvas, ctx: built.ctx, bodyTop: built.bodyTop, writeScrollTop: 0 };
  });

  // Ver comentario en la creación del material, arriba: una vez que una
  // hoja alcanza opacidad 1 (y no vuelve a cambiar nunca — solo hoja1 se
  // desvanece, el resto salta directamente a opaca, ver setAppearance())
  // se pasa a profundidad real de GPU. `appearanceLocked` evita repetir
  // este cambio (y el `needsUpdate` que conlleva) en cada frame.
  let appearanceLocked = false;
  function lockOpaque() {
    if (appearanceLocked) return;
    appearanceLocked = true;
    pages.forEach((page) => {
      page.material.opacity = 1;
      page.material.transparent = false;
      page.material.depthWrite = true;
      page.material.needsUpdate = true;
    });
  }

  // -----------------------------------------------------------------------
  // `order`: única fuente de verdad de qué hoja física ocupa cada
  // ranura de la pila. order[0] = la hoja que se está leyendo ahora
  // mismo (arriba del todo); order[pageCount-1] = la más al fondo. Los
  // índices de `pageContents`/`pages` NUNCA cambian (cada hoja conserva
  // siempre su propio texto/textura); lo que cambia es su posición
  // dentro de `order` al pasar de hoja.
  // -----------------------------------------------------------------------
  const order = pages.map((_, index) => index);

  // Coloca cada hoja en la posición de reposo de su ranura actual
  // (según `order`), sin animación — usado al inicializar y al cerrar
  // cada transición (el resto de hojas, que no han volado, solo
  // necesitan una reasignación de profundidad imperceptible).
  function applyRestLayout() {
    order.forEach((pageIndex, slot) => {
      const page = pages[pageIndex];
      page.anchor.position.set(0, 0, slotDepth(slot));
      page.anchor.rotation.set(0, 0, 0);
    });
  }

  // -----------------------------------------------------------------------
  // ESTADO DEL PASE DE HOJA (ver "REGLAS DE ANIMACIÓN" del encargo:
  // "no debe poder iniciarse otra transición mientras la actual está en
  // curso" + "el sistema debe saber cuál es la hoja actual").
  // `turnState`/`turnElapsed`/`turningPageIndex` describen la
  // transición en curso (si la hay); `turningPageIndex` es el índice
  // (en `pages`) de la hoja que está volando, no una ranura.
  // -----------------------------------------------------------------------
  let turnState = "idle"; // "idle" | "forward" | "backward"
  let turnElapsed = 0;
  let turningPageIndex = -1;

  // -----------------------------------------------------------------------
  // APARIENCIA (fade in, controlado desde fuera durante LETTER_RISE).
  //
  // ITERACIÓN — CORRECCIÓN "APARECE LA HOJA 2 ANTES DE LA HOJA 1" (ver
  // cabecera del archivo): la causa real NO era el orden de `order` ni
  // el momento de crear las texturas — era que las hojas 2..N ya
  // estaban con opacidad 1 (completamente opacas) DESDE EL PRIMER
  // FRAME, mientras que la hoja 1 iba de 0 a 1 con `transparent:true` +
  // `depthWrite:false`. Con ese material, three.js ordena el pintado
  // de atrás hacia delante por distancia a cámara y pinta la hoja 1 LA
  // ÚLTIMA (mezclando su color con alpha < 1 sobre lo ya pintado) — así
  // que mientras la hoja 1 apenas es visible (alpha bajo), lo que
  // realmente se ve en pantalla es la hoja 2 (ya pintada entera, detrás
  // pero totalmente opaca) asomando a través suyo. Solo cuando la hoja
  // 1 alcanza alpha≈1 termina por cubrirla del todo — de ahí el
  // "parpadeo": no es una hoja apareciendo y cambiando, es la hoja 2
  // transparentándose hasta quedar tapada.
  //
  // Arreglo: TODAS las hojas que no son la actual (order[0]) permanecen
  // a opacidad 0 (invisibles) mientras la hoja actual funde su propia
  // opacidad; solo saltan a opacidad 1 en el mismo instante en que la
  // hoja actual termina de aparecer (a >= 1) — momento en el que ya la
  // cubre por completo, así que ese salto es imperceptible. Ese mismo
  // instante es también cuando se llama a lockOpaque() (ver arriba)
  // para pasar todo el sistema a profundidad real de GPU.
  // -----------------------------------------------------------------------
  function setAppearance(t) {
    const a = clamp01(t);
    const topIndex = order[0];
    pages.forEach((page, index) => {
      if (index === topIndex) {
        page.material.opacity = a;
        page.anchor.position.y = -(1 - a) * cfg.text.riseDistance;
      } else if (!appearanceLocked) {
        page.material.opacity = a >= 1 ? 1 : 0;
      }
    });
    if (a >= 1) lockOpaque();
  }

  // -----------------------------------------------------------------------
  // PASAR HOJA (ver "FLECHA DERECHA"/"FLECHA IZQUIERDA" y "API /
  // CONTROL" del encargo). API mínima y reutilizable: nextPage() /
  // previousPage() / getCurrentPage() — funciona igual con 1, 2, 5 o 10
  // hojas, sin ningún caso especial por cantidad.
  //
  // Navegación ACOTADA, sin bucle (ver encargo, punto 10: "comprueba
  // los límites 1↔5 sin navegación circular"): la carta tiene un
  // principio (hoja 1) y un final (hoja N) reales, así que `nextPage()`
  // se bloquea en la última hoja y `previousPage()` en la primera —
  // igual que el sistema previo a la pila física. `order[0]` equivale
  // siempre al número de hoja lógico (0 = hoja 1, N-1 = hoja N) porque,
  // al no haber bucle, `order` nunca da una vuelta completa: es
  // simplemente la misma información que antes vivía en
  // `currentPageIndex`, ahora leída de `order` para no duplicar estado.
  //
  // `nextPage()` saca la hoja de arriba (order[0]) y la reinserta al
  // fondo; `previousPage()` saca la hoja del fondo (order[N-1]) y la
  // reinserta arriba — ver ejemplo de varias pasadas del encargo
  // original. Ambas devuelven `true` si han iniciado una transición y
  // `false` si no han hecho nada (límite alcanzado, o ya hay una
  // transición en curso) — así quien llama (candelaFinale.js) puede
  // saberlo sin necesitar consultar isTurning() aparte.
  // -----------------------------------------------------------------------
  function nextPage() {
    if (turnState !== "idle") return false;
    if (order[0] >= pages.length - 1) return false;
    turnState = "forward";
    turnElapsed = 0;
    turningPageIndex = order[0];
    return true;
  }

  function previousPage() {
    if (turnState !== "idle") return false;
    if (order[0] <= 0) return false;
    turnState = "backward";
    turnElapsed = 0;
    turningPageIndex = order[order.length - 1];
    return true;
  }

  function getCurrentPage() {
    return order[0];
  }

  function getPageCount() {
    return pages.length;
  }

  function isTurning() {
    return turnState !== "idle";
  }

  // -----------------------------------------------------------------------
  // ESCRITURA EN LA ÚLTIMA HOJA (ver encargo: "última página como
  // página de respuesta"). API mínima y aislada, mismo criterio que
  // nextPage()/previousPage(): este módulo solo sabe REPINTAR el
  // contenido de una hoja ya construida — decidir CUÁNDO está activo
  // el modo escritura (última hoja + carta legible), capturar el
  // teclado y enviar el mensaje son responsabilidad de quien llama
  // (ver src/letterWriteControls.js), nunca de este archivo.
  //
  // setWritableDraft(pageIndex, text, options): repinta la MISMA
  // textura ya usada por esa hoja (nunca crea canvas/textura nuevos)
  // con el título intacto (nunca se mueve ni se sustituye por el
  // borrador, ver paintWritablePage()) y el texto que se está
  // escribiendo. Puede llamarse tan a menudo como se quiera (cada
  // pulsación de tecla, cada parpadeo del cursor) — es solo un
  // fillText sobre un canvas ya existente.
  // -----------------------------------------------------------------------
  function setWritableDraft(pageIndex, text, options) {
    const page = pages[pageIndex];
    if (!page) return;
    paintWritablePage(page, cfg, text, options);
    // La hoja se ha repintado en su propio canvas 2D (ver
    // paintWritablePage()): hay que avisar a three.js de que vuelva a
    // subir ese canvas a la GPU (`needsUpdate`), o lo escrito se
    // quedaría en el canvas y nunca se vería sobre la hoja.
    page.material.map.needsUpdate = true;
  }

  // -----------------------------------------------------------------------
  // reset(): re-arma la carta entera para un nuevo pase de la secuencia
  // (llamado desde candelaFinale.js → start()). Vuelve siempre a la
  // hoja 1 arriba, en el orden original. Deshace también lockOpaque()
  // (ver arriba): cada pase de la secuencia debe volver a fundir la
  // hoja 1 desde opacidad 0, así que los materiales deben volver a
  // `transparent:true`/`depthWrite:false` hasta que ese fundido
  // termine otra vez.
  // -----------------------------------------------------------------------
  function reset() {
    group.scale.setScalar(1);

    turnState = "idle";
    turnElapsed = 0;
    turningPageIndex = -1;
    order.length = 0;
    pages.forEach((_, index) => order.push(index));

    appearanceLocked = false;
    pages.forEach((page) => {
      // Las dos (hoja 1 y el resto) arrancan invisibles: solo la hoja 1
      // se anima de 0→1 durante el fundido; el resto salta a 1 de golpe
      // en el instante en que ese fundido termina — ver setAppearance().
      page.material.opacity = 0;
      page.material.transparent = true;
      page.material.depthWrite = false;
      page.material.needsUpdate = true;
    });
    applyRestLayout();

    // Re-arma también la superficie de escritura (ver setWritableDraft()/
    // paintWritablePage() más abajo): si el final se repite
    // (candelaFinale.start() llamado de nuevo), la última hoja vuelve a
    // su estado inicial (vacía, con el placeholder) en vez de conservar
    // un borrador de una vuelta anterior.
    if (cfg.write && cfg.write.enabled && pages.length > 0) {
      const lastPage = pages[pages.length - 1];
      paintWritablePage(lastPage, cfg, "", { showCursor: false });
      lastPage.material.map.needsUpdate = true;
    }

    setAppearance(0);
  }
  reset();

  // -----------------------------------------------------------------------
  // updatePageTurn(delta): avanza la transición de pasar hoja en curso,
  // si la hay (ver "FLECHA DERECHA"/"FLECHA IZQUIERDA" del encargo).
  // candelaFinale.js solo permite llamar a nextPage()/previousPage()
  // una vez la carta ya está visible en su posición final, pero esta
  // función en sí no necesita saberlo: si no hay ninguna transición en
  // curso (`turnState === "idle"`), no hace nada.
  //
  // TRAYECTORIA (ver "MUY IMPORTANTE: NO QUIERO UNA PÁGINA DE LIBRO" del
  // encargo): la hoja que vuela sigue una curva de Bézier cúbica en el
  // espacio — nunca una rotación sobre un eje fijo — con 4 puntos:
  //   P0: ranura de origen (en reposo).
  //   P1: justo tras "coger" la hoja — separada hacia la cámara y
  //       empezando a elevarse.
  //   P2: justo antes de "soltarla" — todavía elevada, pero ya por
  //       detrás de la ranura de destino.
  //   P3: ranura de destino (en reposo).
  // Como P1/P2 están muy por encima del borde superior de la carta
  // (`liftHeightFraction`), la hoja pasa siempre POR ENCIMA de las
  // demás — nunca las atraviesa, sea cual sea su posición Z intermedia.
  // Una inclinación (rotation.x) y un balanceo sutil (rotation.z),
  // ambos en forma de campana (cero en los dos extremos), refuerzan la
  // sensación de papel físico en el aire.
  // -----------------------------------------------------------------------
  function updatePageTurn(delta) {
    if (turnState === "idle") return;
    turnElapsed += delta;
    const t = Math.min(1, turnElapsed / pageCfg.turnDuration);
    // easeInOutCubic: arranca y termina suave en ambos extremos — un
    // movimiento físico de recoger/posar una hoja, no un fundido ni un
    // rebote (ver "Quiero que el movimiento sea coherente en ambas
    // direcciones").
    const eased = easeInOutCubic(t);
    const page = pages[turningPageIndex];
    const flight = pageCfg.flight;

    const originSlot = turnState === "forward" ? 0 : pages.length - 1;
    const targetSlot = turnState === "forward" ? pages.length - 1 : 0;
    const startZ = slotDepth(originSlot);
    const endZ = slotDepth(targetSlot);

    const liftHeight = cfg.height * flight.liftHeightFraction;
    const popZ = cfg.width * flight.popFraction;
    const behindZ = cfg.width * flight.behindFraction;
    const driftX = cfg.width * flight.driftFraction * (turnState === "forward" ? 1 : -1);

    // Puntos de control de la curva (ver cabecera de la función). Con
    // P0.y = P3.y = 0 y P1.y = P2.y simétricos, el punto más alto real
    // de una cúbica de Bézier en t=0.5 es 0.75·controlY (coeficientes
    // De Casteljau b=c=0.375 en el punto medio) — no `liftHeight`
    // directamente. Se despeja `controlY` para que el pico de la curva
    // sea exactamente `liftHeight` por encima de la hoja, así
    // `liftHeightFraction` en finale.config.js sigue significando "lo
    // que se eleva por encima del borde superior de la carta" tal cual.
    const controlLift = liftHeight / 0.75;
    const p0 = { x: 0, y: 0, z: startZ };
    const p1 = { x: driftX * 0.5, y: controlLift, z: startZ + popZ };
    const p2 = { x: -driftX * 0.5, y: controlLift, z: endZ - behindZ };
    const p3 = { x: 0, y: 0, z: endZ };

    // ITERACIÓN — CORRECCIÓN "LA HOJA ATRAVIESA LA HOJA DE ABAJO" (ver
    // vídeo aportado: en la transición 3→4 y en la 5→4 se ve el título
    // de la hoja saliente superpuesto al de la hoja entrante durante un
    // instante — ambas siguen dentro de la misma franja vertical de la
    // pila en ese momento). Causa real, verificada con la geometría:
    // con `liftHeightFraction` antiguo (0.6), el CENTRO de la hoja subía
    // como mucho `0.6·height`, pero el borde INFERIOR de la propia hoja
    // está `0.5·height` por debajo de su centro — así que incluso en el
    // pico de la curva (t=0.5) el borde inferior de la hoja voladora
    // solo llegaba a `(0.6-0.5)·height = 0.1·height` por encima del
    // centro de la pila, muy por debajo del borde SUPERIOR de la pila en
    // reposo (`0.5·height`). La hoja nunca llegaba a salir por completo
    // de la franja vertical del resto de páginas: no es un problema de
    // orden de pintado (el z-buffer resolvía correctamente la profundidad
    // real en cada instante), es que la trayectoria nunca despejaba lo
    // suficiente en altura — de ahí el aspecto de "atravesar" al cruzar
    // de profundidad. Ver `liftHeightFraction` en finale.config.js
    // (ahora ≈1.3, pensado para que incluso el pico deje un margen claro
    // de separación por encima de la pila, no solo la coincidencia justa).
    //
    // Además — ver "ORDEN DE LA ANIMACIÓN" del encargo ("no quiero que
    // el movimiento de profundidad ocurra demasiado pronto") — el eje Z
    // ya NO comparte el mismo tiempo `eased` que X/Y: usa su propio
    // tiempo `depthEase(t)`, gateado a una ventana estrecha alrededor
    // del pico de elevación (ver función más abajo). Así el cruce real
    // de profundidad (pasar de delante a detrás, o al revés) queda
    // temporalmente encerrado dentro del tramo en el que la hoja ya está
    // muy por encima de la pila — nunca al principio ni al final del
    // vuelo, que es cuando la hoja está a la misma altura que el resto.
    const posXY = cubicBezier3(p0, p1, p2, p3, eased);
    const zT = depthEase(t);
    const posZ = cubicBezier3(
      { x: 0, y: 0, z: p0.z },
      { x: 0, y: 0, z: p1.z },
      { x: 0, y: 0, z: p2.z },
      { x: 0, y: 0, z: p3.z },
      zT
    );
    page.anchor.position.set(posXY.x, posXY.y, posZ.z);

    // Campana (0 en los extremos, máxima a mitad de vuelo) para la
    // inclinación y el balanceo — nunca queda torcida en reposo.
    const bell = Math.sin(Math.PI * eased);
    page.anchor.rotation.x = flight.tiltMax * bell * (turnState === "forward" ? 1 : -1);
    page.anchor.rotation.z = Math.sin(eased * Math.PI * 2) * flight.wobbleMax * bell;

    // ITERACIÓN — CORRECCIÓN "NO ARREGLAR CON renderOrder" (ver
    // cabecera del archivo y comentario en la creación del material):
    // esta función YA NO fuerza ningún `renderOrder` especial durante
    // el vuelo. Una vez fundida (lockOpaque(), ver arriba), esta hoja y
    // el resto de la pila son opacas con `depthWrite:true` — es decir,
    // el propio z-buffer de la GPU decide qué se ve delante de qué,
    // usando la posición 3D real de cada instante (`pos.z` de la curva
    // de arriba). Si la trayectoria es correcta (la hoja pasa realmente
    // por detrás cuando toca, y por delante cuando toca), el resultado
    // visual es correcto SIN ningún truco de orden de pintado.

    if (t >= 1) {
      // Transición completa: la hoja pasa a ocupar la ranura de
      // destino en `order`; el resto de hojas se reasignan a su nueva
      // ranura (desplazamiento de profundidad imperceptible, sin
      // animación — ver applyRestLayout()).
      if (turnState === "forward") {
        order.shift();
        order.push(turningPageIndex);
      } else {
        order.pop();
        order.unshift(turningPageIndex);
      }
      applyRestLayout();
      turnState = "idle";
      turningPageIndex = -1;
    }
  }

  function update(delta) {
    updatePageTurn(delta);
  }

  onUpdate(update);

  return {
    group,
    setAppearance,
    reset,
    nextPage,
    previousPage,
    getCurrentPage,
    getPageCount,
    isTurning,
    setWritableDraft,
  };
}

// -----------------------------------------------------------------------
// depthEase: tiempo INDEPENDIENTE para el eje Z de `updatePageTurn()`
// (ver comentario junto a su uso, más arriba — corrección "LA HOJA
// ATRAVIESA LA HOJA DE ABAJO"). En vez de usar el mismo `eased` que
// X/Y (que reparte el cambio de profundidad a lo largo de todo el
// vuelo), esta función lo comprime en una ventana estrecha centrada en
// t=0.5 — el instante en el que la elevación (Y) está en su pico. Fuera
// de esa ventana devuelve 0 o 1 (Z se queda quieto en su extremo:
// origen mientras la hoja apenas se ha separado/todavía no ha bajado
// del todo). Dentro de la ventana, se re-aplica `easeInOutCubic` sobre
// el tiempo local para que el propio cruce también arranque y termine
// suave, no de golpe.
//
// El resultado: el cruce real de profundidad (pasar de delante a
// detrás o de detrás a delante) solo ocurre cuando la hoja ya está muy
// por encima del borde superior de la pila (ver `liftHeightFraction` en
// finale.config.js) — nunca mientras todavía está a la misma altura que
// el resto de hojas, que es precisamente lo que producía la sensación
// de atravesarlas.
// -----------------------------------------------------------------------
function depthEase(t) {
  const windowStart = 0.4;
  const windowEnd = 0.6;
  const local = clamp01((t - windowStart) / (windowEnd - windowStart));
  return easeInOutCubic(local);
}

// -----------------------------------------------------------------------
// cubicBezier3: evalúa una curva de Bézier cúbica en 3D en t ∈ [0,1] a
// partir de 4 puntos de control {x,y,z} — usada por updatePageTurn()
// para la trayectoria de la hoja que vuela (ver cabecera de esa
// función). Fórmula estándar de De Casteljau expandida, sin
// dependencias externas.
// -----------------------------------------------------------------------
function cubicBezier3(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  };
}

// -----------------------------------------------------------------------
// buildPageTexture: dibuja el TÍTULO (opcional, centrado arriba con
// margen) y el TEXTO (ajuste de línea automático + saltos de línea
// manuales vía "\n") de una hoja en un canvas 2D oculto, y devuelve una
// CanvasTexture + el aspect ratio real del canvas usado. Mismo patrón
// que createSoftGlowTexture() (candelaFinale.js) y sampleWordPoints()
// (flameWords.js): el canvas nunca se muestra, solo se usa para generar
// el resultado final — aquí, la textura que se aplica directamente
// sobre la propia hoja física (ver `pages` más arriba), nunca un
// elemento HTML/DOM aparte y nunca flotando fuera de la hoja.
//
// El canvas se dimensiona con el MISMO aspect ratio que la hoja final
// (letterWidth/letterHeight), así el texto nunca sale deformado sea
// cual sea el tamaño real configurado. Se rellena primero con el color
// de la propia hoja (`pageColorHex`) para que el fondo sea opaco
// (si no, las zonas sin texto quedarían transparentes) — la hoja se ve
// como papel con el texto encima, nunca como texto flotando solo.
//
// ITERACIÓN — REDISEÑO DE LA COMPOSICIÓN (ver encargo: "el texto se ve
// demasiado grande y empieza prácticamente desde el centro de la
// hoja... quiero una carta bien diseñada"). Dos cambios de fondo:
//
// 1. El título ya NO es más pequeño que el cuerpo (antes: título 40px,
//    cuerpo 46px — al revés de lo esperado). Ahora el título es
//    claramente mayor (ver `titleCfg.font.sizePx` en finale.config.js)
//    y lleva un separador decorativo opcional debajo (`titleCfg.separator`)
//    para marcar visualmente la frontera con el cuerpo.
//
// 2. El cuerpo ya NO se centra verticalmente en el hueco disponible
//    (eso es lo que hacía que, sin título, "Te quiero" apareciera a
//    mitad de la hoja): ahora se ANCLA ARRIBA, justo debajo del título
//    (o del margen superior general, `textFontCfg.topMarginFraction`,
//    si la página no tiene título) y fluye hacia abajo línea a línea,
//    como una carta real — dejando el resto de la hoja en blanco por
//    debajo, no repartido simétricamente arriba y abajo.
// -----------------------------------------------------------------------
function buildPageTexture(pageData, letterWidth, letterHeight, textFontCfg, titleCfg, pageColorHex) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const height = textFontCfg.canvasHeightPx;
  const width = Math.max(8, Math.round(height * (letterWidth / letterHeight)));
  canvas.width = width;
  canvas.height = height;

  paintPageBackground(ctx, width, height, pageColorHex);

  // ---- TÍTULO (opcional, centrado, con margen superior y separado
  // con claridad del cuerpo — ver "TEXTO DE CADA HOJA" del encargo).
  // paintTitle() dibuja el título (o devuelve `null` si no hay) y el
  // `bodyTop` resultante: el punto donde empieza el cuerpo. ----
  let bodyTop = paintTitle(ctx, pageData.title, width, height, titleCfg);
  if (bodyTop == null) {
    // Sin título: el cuerpo empieza igualmente cerca de arriba (nunca
    // centrado en toda la hoja), con un margen superior propio.
    bodyTop = height * textFontCfg.topMarginFraction;
  }

  // ---- TEXTO (ajuste de línea automático, mismo algoritmo que ya
  // existía). ANCLADO ARRIBA (ver cabecera de la función): la primera
  // línea empieza justo en `bodyTop`, nunca centrado en el espacio
  // restante. ----
  const maxWidth = width * textFontCfg.maxWidthFraction;
  const font = `${textFontCfg.weight} ${textFontCfg.sizePx}px ${textFontCfg.family}`;
  const lines = wrapLines(ctx, pageData.text, maxWidth, font);
  paintBodyLines(ctx, lines, width, bodyTop, textFontCfg);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  // `canvas`/`ctx`/`bodyTop` se devuelven además de la textura para que
  // la ÚLTIMA hoja pueda repintarse en directo mientras el usuario
  // escribe (ver setWritableDraft()/paintWritablePage() más abajo) —
  // repintar SIEMPRE sobre este mismo canvas, nunca crear uno nuevo.
  return { texture, canvas, ctx, bodyTop, aspect: width / height };
}

// -----------------------------------------------------------------------
// paintPageBackground/paintTitle/wrapLines/paintBodyLines: piezas
// reutilizables extraídas de buildPageTexture() (sin cambio de
// comportamiento) para que la ÚLTIMA hoja pueda repintarse en directo
// mientras el usuario escribe (ver paintWritablePage() más abajo) con
// EXACTAMENTE el mismo título/fondo/ajuste de línea que ya usan las
// demás hojas — nunca una segunda implementación paralela que pudiera
// desincronizarse en tamaño, color o tipografía.
// -----------------------------------------------------------------------
function paintPageBackground(ctx, width, height, pageColorHex) {
  // Fondo opaco: mismo color que el resto del papel de la carta
  // (`cfg.color`, ver createLetterMesh) para que la textura completa
  // se lea como papel con el texto encima, nunca como texto flotando
  // solo con huecos transparentes alrededor.
  ctx.fillStyle = pageColorHex;
  ctx.fillRect(0, 0, width, height);
}

// Pinta el título (si lo hay) y devuelve el `bodyTop` resultante — o
// `null` si la página no tiene título (el llamante decide entonces el
// margen superior general, ver `textFontCfg.topMarginFraction`).
//
// ITERACIÓN — WRAPPING DEL TÍTULO (ver encargo: "Ahora escribe tú..."
// quedaba parcialmente cortado). Antes era un único fillText() sin
// comprobar el ancho disponible; ahora reutiliza wrapLines() —el
// MISMO ajuste de línea que ya usa el cuerpo del texto, nunca una
// segunda implementación aparte— respetando `titleCfg.maxWidthFraction`
// (ver finale.config.js) y pudiendo ocupar 2 (o más) líneas, con
// `titleCfg.font.lineHeightPx` como interlineado. Nunca se corta una
// palabra a mitad: si no cabe en la línea actual pasa completa a la
// siguiente.
function paintTitle(ctx, title, width, height, titleCfg) {
  const hasTitle = typeof title === "string" && title.trim().length > 0;
  if (!hasTitle) return null;

  const tf = titleCfg.font;
  const font = `${tf.weight} ${tf.sizePx}px ${tf.family}`;
  const maxWidth = width * (titleCfg.maxWidthFraction != null ? titleCfg.maxWidthFraction : 0.86);
  const titleLines = wrapLines(ctx, title, maxWidth, font);
  const titleLineHeight = tf.lineHeightPx || Math.round(tf.sizePx * 1.18);

  ctx.font = font;
  ctx.fillStyle = tf.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const firstLineY = height * titleCfg.marginTopFraction + tf.sizePx / 2;
  titleLines.forEach((line, i) => {
    ctx.fillText(line, width / 2, firstLineY + i * titleLineHeight);
  });
  let afterTitle = firstLineY + (titleLines.length - 1) * titleLineHeight + tf.sizePx / 2;

  // Separador decorativo opcional (ver mockup del encargo: una línea
  // fina bajo el título) — horneado en la misma textura, nunca un
  // elemento aparte. Se coloca siempre tras la ÚLTIMA línea del
  // título, sea cual sea el número de líneas que haya ocupado.
  const sep = titleCfg.separator;
  if (sep && sep.enabled) {
    const sepY = afterTitle + height * sep.gapAboveFraction;
    const sepHalfWidth = (width * sep.widthFraction) / 2;
    ctx.strokeStyle = sep.color;
    ctx.lineWidth = sep.thicknessPx;
    ctx.beginPath();
    ctx.moveTo(width / 2 - sepHalfWidth, sepY);
    ctx.lineTo(width / 2 + sepHalfWidth, sepY);
    ctx.stroke();
    afterTitle = sepY;
  }

  return afterTitle + height * titleCfg.gapFraction;
}

// -----------------------------------------------------------------------
// wrapLinesWithOffsets: ajuste de línea automático (word-wrap) + saltos
// manuales vía "\n" — MISMO algoritmo/resultado visual que ya existía
// (nunca se corta una palabra a la mitad), pero ahora cada línea
// conserva también el rango [start, end) de índices de caracteres del
// texto ORIGINAL que representa. Necesario para el cursor real (ver
// "TEXTO LARGO: SCROLL Y CURSOR REAL" del encargo): sin este mapeo no
// hay forma de saber en qué línea envuelta cae la posición del cursor
// del <textarea> real.
//
// `wrapLines()` (usada por paintTitle()/buildPageTexture() para texto
// estático que no necesita cursor) es ahora un envoltorio fino sobre
// esta función — mismo resultado exacto que antes, sin duplicar el
// algoritmo de ajuste de línea.
// -----------------------------------------------------------------------
function wrapLinesWithOffsets(ctx, text, maxWidth, font) {
  ctx.font = font;
  const raw = String(text || "");
  const lines = [];
  let paragraphStart = 0;

  const paragraphs = raw.split("\n");
  paragraphs.forEach((paragraph) => {
    // Tokeniza la línea en palabras con sus índices [start, end) DENTRO
    // del párrafo (los espacios que las separan no pertenecen a
    // ninguna palabra, igual que el `.filter(Boolean)` de la versión
    // anterior los descartaba).
    const words = [];
    let i = 0;
    while (i < paragraph.length) {
      while (i < paragraph.length && paragraph[i] === " ") i++;
      if (i >= paragraph.length) break;
      const start = i;
      while (i < paragraph.length && paragraph[i] !== " ") i++;
      words.push({ text: paragraph.slice(start, i), start, end: i });
    }

    if (words.length === 0) {
      lines.push({ text: "", start: paragraphStart, end: paragraphStart });
    } else {
      let current = "";
      let curStart = words[0].start;
      let curEnd = curStart;
      for (const word of words) {
        const candidate = current ? `${current} ${word.text}` : word.text;
        if (current && ctx.measureText(candidate).width > maxWidth) {
          lines.push({ text: current, start: paragraphStart + curStart, end: paragraphStart + curEnd });
          current = word.text;
          curStart = word.start;
          curEnd = word.end;
        } else {
          current = candidate;
          curEnd = word.end;
        }
      }
      lines.push({ text: current, start: paragraphStart + curStart, end: paragraphStart + curEnd });
    }

    // +1 por el propio "\n" que `split("\n")` consumió y que no forma
    // parte de ningún párrafo resultante.
    paragraphStart += paragraph.length + 1;
  });

  return lines;
}

function wrapLines(ctx, text, maxWidth, font) {
  return wrapLinesWithOffsets(ctx, text, maxWidth, font).map((line) => line.text);
}

// Encuentra en qué línea envuelta (y en qué columna dentro de ella)
// cae un índice de carácter del texto ORIGINAL (ver wrapLinesWithOffsets
// más arriba) — usado para dibujar el cursor real y decidir el scroll
// (ver paintWritablePage() más abajo).
function locateCaret(linesWithOffsets, caretIndex) {
  for (let i = 0; i < linesWithOffsets.length; i++) {
    const line = linesWithOffsets[i];
    if (caretIndex <= line.end) {
      const col = Math.max(0, Math.min(caretIndex - line.start, line.text.length));
      return { lineIndex: i, col };
    }
  }
  const last = linesWithOffsets[linesWithOffsets.length - 1];
  return { lineIndex: linesWithOffsets.length - 1, col: last ? last.text.length : 0 };
}

function paintBodyLines(ctx, lines, width, bodyTop, textFontCfg) {
  ctx.font = `${textFontCfg.weight} ${textFontCfg.sizePx}px ${textFontCfg.family}`;
  ctx.fillStyle = textFontCfg.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineHeight = textFontCfg.lineHeightPx;
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, bodyTop + lineHeight / 2 + i * lineHeight);
  });
}

// Versión con alpha de un color hexadecimal ("#3d2a17" -> "rgba(...)")
// — usada solo para el placeholder de la hoja de escritura (ver
// paintWritablePage()), atenuado respecto al color real del texto de
// la carta, nunca un color inventado aparte.
function withAlpha(hexColor, alpha) {
  const c = new THREE.Color(hexColor);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}

// Dibuja la barra vertical del cursor en un punto concreto del canvas
// — misma pieza reutilizada tanto si la hoja está vacía (cursor en la
// primera línea, columna 0) como si ya tiene texto (cursor en la
// posición real de `caretIndex`, ver paintWritablePage() más abajo).
// Nunca depende de ningún temporizador: quien decide si se dibuja o no
// es siempre `showCursor`, que ahora es estable (ver letterWriteControls.js
// — "showCursor: isFocused", sin parpadeo).
function drawCaretBar(ctx, x, y, lineHeight, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, lineHeight * 0.045);
  ctx.beginPath();
  ctx.moveTo(x, y - lineHeight * 0.38);
  ctx.lineTo(x, y + lineHeight * 0.38);
  ctx.stroke();
}

// -----------------------------------------------------------------------
// paintPlaceholder: texto fantasma que invita a escribir mientras la
// hoja está vacía (ver "PLACEHOLDER" del encargo). Reutiliza el MISMO
// wrapLines() que el cuerpo del texto — nunca se corta ni sale de la
// hoja, puede ocupar varias líneas — y se recorta (sin scroll propio,
// no lo necesita: siempre está anclado arriba) a las líneas que caben
// en el hueco disponible, igual criterio que el cuerpo real.
//
// ITERACIÓN — DESACOPLADO DEL CURSOR (ver "DIFERENCIAR PLACEHOLDER Y
// CURSOR" del encargo: "el parpadeo actual puede estar relacionado con
// el placeholder"). Antes esta función ni existía como pieza aparte:
// el placeholder se pintaba solo cuando `showCursor` era falso, y como
// `showCursor` parpadeaba (ver iteración anterior de
// letterWriteControls.js), el placeholder aparecía y desaparecía con
// él. Ahora se pinta SIEMPRE que el texto esté vacío,
// independientemente del foco o del cursor — se decide en
// paintWritablePage() únicamente en función de `trimmed.length === 0`.
// -----------------------------------------------------------------------
function paintPlaceholder(ctx, placeholder, width, height, bodyTop, textFontCfg, writeCfg) {
  const maxWidth = width * textFontCfg.maxWidthFraction;
  const font = `italic ${textFontCfg.weight} ${textFontCfg.sizePx}px ${textFontCfg.family}`;
  const lines = wrapLines(ctx, placeholder, maxWidth, font);

  const lineHeight = textFontCfg.lineHeightPx;
  const bottomMargin = height * (writeCfg.bottomMarginFraction != null ? writeCfg.bottomMarginFraction : 0.08);
  const availableHeight = Math.max(lineHeight, height - bodyTop - bottomMargin);
  const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
  const visible = lines.slice(0, maxLines);

  ctx.font = font;
  ctx.fillStyle = withAlpha(textFontCfg.color, 0.45);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  visible.forEach((line, i) => {
    ctx.fillText(line, width / 2, bodyTop + lineHeight / 2 + i * lineHeight);
  });
}

// -----------------------------------------------------------------------
// paintWritablePage: repinta la textura de la ÚLTIMA hoja mientras el
// usuario escribe (ver setWritableDraft() más arriba). Reutiliza
// EXACTAMENTE las mismas piezas que buildPageTexture() (fondo, título,
// ajuste de línea, tipografía) — así el texto que se escribe se ve
// indistinguible del resto de la carta, nunca un campo de formulario
// aparte.
//
// El TÍTULO se repinta en su posición original en cada llamada (nunca
// se mueve ni se convierte en placeholder del campo — ver "EL TÍTULO
// DE LA ÚLTIMA PÁGINA" del encargo): usa el `pageData.title` que ya
// tenía la hoja desde su construcción, la MISMA fuente de verdad que
// `cfg.letter.pages` en finale.config.js.
//
// `options.caretIndex`: posición REAL del cursor dentro del texto
// (índice de carácter, ver letterWriteControls.js —
// input.selectionStart del <textarea> invisible). `options.showCursor`
// indica simplemente si el campo tiene el foco (ver
// letterWriteControls.js: "showCursor: isFocused", SIN ningún
// parpadeo desde esta iteración — ver "CURSOR DE ESCRITURA: NO QUIERO
// QUE PARPADEE" del encargo) — nunca controla la POSICIÓN, que
// siempre determina `caretIndex`.
//
// PLACEHOLDER (ver "DIFERENCIAR PLACEHOLDER Y CURSOR"/"PLACEHOLDER"
// del encargo): se pinta (con su propio word-wrap, ver
// paintPlaceholder() arriba) siempre que el texto esté vacío, sea
// cual sea el estado del foco/cursor — desaparece en cuanto hay UN
// solo carácter escrito, nunca antes ni depende de ningún temporizador.
// El cursor, en ese mismo caso de hoja vacía, se dibuja aparte (si
// `showCursor` está activo) en la primera línea/columna 0 — ambos
// coexisten sin relación entre sí.
//
// SCROLL (ver "TEXTO LARGO: SCROLL Y CURSOR REAL" del encargo): en vez
// de recortar siempre las líneas más antiguas (comportamiento anterior,
// solo válido para "seguir escribiendo al final"), ahora se mantiene un
// `page.writeScrollTop` persistente (índice de la primera línea
// visible) que solo se mueve lo IMPRESCINDIBLE para que la línea del
// cursor quede dentro de la ventana visible — igual que un editor de
// texto real: escribir al final sigue empujando la vista hacia abajo
// (el caret sale por debajo → scrollTop sube), pero mover el cursor
// hacia arriba con ↑/Home hace que la vista suba también, mostrando
// líneas anteriores, nunca solo "las últimas escritas".
// -----------------------------------------------------------------------
function paintWritablePage(page, cfg, text, options) {
  const { canvas, ctx, bodyTop, pageData } = page;
  const width = canvas.width;
  const height = canvas.height;
  const writeCfg = cfg.write || {};
  const textFontCfg = cfg.text.font;
  const showCursor = Boolean(options && options.showCursor);
  const cursorEnabled = Boolean(writeCfg.cursor && writeCfg.cursor.enabled);

  const paperColorHex = `#${new THREE.Color(cfg.color).getHexString()}`;
  paintPageBackground(ctx, width, height, paperColorHex);

  // Título: repintado en la MISMA posición que en la construcción
  // original (mismo `pageData.title`, nunca sustituido por el
  // borrador) — ver cabecera de la función.
  paintTitle(ctx, pageData.title, width, height, cfg.page.title);

  const trimmed = String(text || "");
  const caretIndex = Math.max(0, Math.min(options && typeof options.caretIndex === "number" ? options.caretIndex : trimmed.length, trimmed.length));

  if (!trimmed) {
    // Hoja vacía: placeholder (si lo hay) SIEMPRE visible, cursor
    // (si corresponde) dibujado aparte en la primera línea — ver
    // cabecera de la función, "PLACEHOLDER" más arriba.
    if (writeCfg.placeholder) {
      paintPlaceholder(ctx, writeCfg.placeholder, width, height, bodyTop, textFontCfg, writeCfg);
    }
    if (showCursor && cursorEnabled) {
      const lineHeight = textFontCfg.lineHeightPx;
      drawCaretBar(ctx, width / 2, bodyTop + lineHeight / 2, lineHeight, textFontCfg.color);
    }
    page.writeScrollTop = 0;
    return;
  }

  const maxWidth = width * textFontCfg.maxWidthFraction;
  const font = `${textFontCfg.weight} ${textFontCfg.sizePx}px ${textFontCfg.family}`;
  const lines = wrapLinesWithOffsets(ctx, trimmed, maxWidth, font);

  const lineHeight = textFontCfg.lineHeightPx;
  const bottomMargin = height * (writeCfg.bottomMarginFraction != null ? writeCfg.bottomMarginFraction : 0.08);
  const availableHeight = Math.max(lineHeight, height - bodyTop - bottomMargin);
  const maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));

  const { lineIndex: caretLine, col: caretCol } = locateCaret(lines, caretIndex);

  // Scroll persistente por hoja (ver cabecera de la función): solo se
  // ajusta lo justo para que `caretLine` vuelva a estar dentro de la
  // ventana [scrollTop, scrollTop + maxLines - 1] — nunca se recentra
  // en cada repintado.
  let scrollTop = page.writeScrollTop || 0;
  if (caretLine < scrollTop) {
    scrollTop = caretLine;
  } else if (caretLine > scrollTop + maxLines - 1) {
    scrollTop = caretLine - maxLines + 1;
  }
  const maxScrollTop = Math.max(0, lines.length - maxLines);
  scrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
  page.writeScrollTop = scrollTop;

  const visibleLines = lines.slice(scrollTop, scrollTop + maxLines);
  paintBodyLines(
    ctx,
    visibleLines.map((line) => line.text),
    width,
    bodyTop,
    textFontCfg
  );

  // ---- Cursor real (ver cabecera de la función): una barra vertical
  // dibujada en la posición EXACTA de `caretIndex`, nunca al final del
  // texto salvo que el cursor esté de verdad ahí. Solo se dibuja si
  // está dentro de la ventana visible actual (si no, el scroll de
  // arriba ya se ha encargado de traerla a la vista). ----
  if (showCursor && cursorEnabled) {
    const visibleCaretLine = caretLine - scrollTop;
    if (visibleCaretLine >= 0 && visibleCaretLine < visibleLines.length) {
      const caretLineText = lines[caretLine].text;
      const before = caretLineText.slice(0, caretCol);

      ctx.font = font;
      ctx.textAlign = "left";
      const fullLineWidth = ctx.measureText(caretLineText).width;
      const beforeWidth = ctx.measureText(before).width;
      const lineLeftX = width / 2 - fullLineWidth / 2;
      const caretX = lineLeftX + beforeWidth;
      const caretY = bodyTop + lineHeight / 2 + visibleCaretLine * lineHeight;

      drawCaretBar(ctx, caretX, caretY, lineHeight, textFontCfg.color);
    }
  }
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

// Suave en ambos extremos (arranca y termina despacio) — usado solo
// para el giro físico de pasar página (ver updatePageTurn() más
// arriba). Sin cambios en esta iteración.
function easeInOutCubic(t) {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
