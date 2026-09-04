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
//     fondo y la reinserta arriba. El resto de hojas NO se mueve (sus
//     huecos de profundidad son imperceptibles — `stackSpacing` — así
//     que no hace falta animarlas, solo reasignarles su nueva ranura al
//     terminar la transición).
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
// NAVEGACIÓN LINEAL (NO circular): a diferencia de la versión de
// Claude, la lectura respeta el orden normal 1 → 2 → 3 → 4 → 5 y su
// inverso, SIN carrusel infinito. `nextPage()` se bloquea cuando la
// hoja leída es la última del conjunto (order[0] === pages.length-1);
// `previousPage()` se bloquea cuando es la primera (order[0] === 0).
// El vuelo físico de la hoja (arco de Bézier + inclinación) es
// exactamente el sistema de pila de Claude — solo se añade el guardado
// de límites para que la hoja 1 y la hoja 5 no estén conectadas en
// bucle (ver letterPageControls.js, que oculta/desactiva las flechas
// en esos límites).
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
  group.visible = false;

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

    const { texture } = buildPageTexture(
      pageData,
      cfg.width,
      cfg.height,
      cfg.text.font,
      pageCfg.title,
      `#${paperColor.getHexString()}`
    );

    const geometry = new THREE.PlaneGeometry(cfg.width, cfg.height);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
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
    mesh.renderOrder = 0;
    anchor.add(mesh);

    return { anchor, mesh, material };
  });

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
      page.mesh.renderOrder = 0;
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
  // Actúa sobre la hoja que está arriba del todo (order[0]): opacidad
  // de su única malla (que ya contiene el texto desde su construcción
  // — nunca una animación de revelado aparte) y una ligerísima subida
  // decorativa sincronizada con la misma opacidad.
  // -----------------------------------------------------------------------
  function setAppearance(t) {
    const a = clamp01(t);
    const page = pages[order[0]];
    if (page) {
      page.material.opacity = a;
      page.anchor.position.y = -(1 - a) * cfg.text.riseDistance;
    }
    group.visible = a > 0.001;
  }

  // -----------------------------------------------------------------------
  // PASAR HOJA (ver "FLECHA DERECHA"/"FLECHA IZQUIERDA" y "API /
  // CONTROL" del encargo). API mínima y reutilizable: nextPage() /
  // previousPage() / getCurrentPage() — funciona igual con 1, 2, 5 o 10
  // hojas, sin ningún caso especial por cantidad.
  //
  // NAVEGACIÓN LINEAL (ver cabecera y NAVEGACIÓN en este módulo): al
  // ser una pila física, nextPage() saca la hoja de arriba (order[0]) y
  // la reinserta al fondo, revelando la siguiente; previousPage() saca
  // la hoja del fondo (order[pageCount-1]) y la reinserta arriba,
  // revelando la anterior. A diferencia de la versión circular de
  // Claude, aquí hay LÍMITES reales: no se pasa de la última a la
  // primera (ni viceversa) — en la hoja 5 `nextPage()` no hace nada y
  // en la hoja 1 `previousPage()` no hace nada.
  //
  // Ambas funciones devuelven `true` si han iniciado una transición y
  // `false` si no han hecho nada (ya hay una transición en curso, solo
  // hay una hoja, o se está en un límite) — así quien llama
  // (candelaFinale.js) puede saberlo sin necesitar consultar
  // isTurning() aparte.
  // -----------------------------------------------------------------------
  function nextPage() {
    if (turnState !== "idle") return false;
    if (pages.length <= 1) return false;
    if (order[0] >= pages.length - 1) return false; // límite: última hoja
    turnState = "forward";
    turnElapsed = 0;
    turningPageIndex = order[0];
    return true;
  }

  function previousPage() {
    if (turnState !== "idle") return false;
    if (pages.length <= 1) return false;
    if (order[0] <= 0) return false; // límite: primera hoja
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
  // reset(): re-arma la carta entera para un nuevo pase de la secuencia
  // (llamado desde candelaFinale.js → start()). Vuelve siempre al orden
  // original (hoja 0 arriba). Las hojas 2..N ya están "físicamente ahí"
  // desde el principio, completamente opacas — igual que en un
  // cuaderno real, donde las páginas por leer ya existen debajo de la
  // que se está leyendo — así que solo la primera necesita el fundido
  // de aparición.
  // -----------------------------------------------------------------------
  function reset() {
    group.scale.setScalar(1);

    turnState = "idle";
    turnElapsed = 0;
    turningPageIndex = -1;
    order.length = 0;
    pages.forEach((_, index) => order.push(index));

    pages.forEach((page, index) => {
      page.material.opacity = index === 0 ? 0 : 1;
    });
    applyRestLayout();

    setAppearance(0);
    group.visible = false;
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

    const pos = cubicBezier3(p0, p1, p2, p3, eased);
    page.anchor.position.set(pos.x, pos.y, pos.z);

    // Campana (0 en los extremos, máxima a mitad de vuelo) para la
    // inclinación y el balanceo — nunca queda torcida en reposo.
    const bell = Math.sin(Math.PI * eased);
    page.anchor.rotation.x = flight.tiltMax * bell * (turnState === "forward" ? 1 : -1);
    page.anchor.rotation.z = Math.sin(eased * Math.PI * 2) * flight.wobbleMax * bell;

    // Mientras vuela, siempre encima del resto en el z-buffer (ver
    // "renderOrder" sugerido en el encargo) — insurance visual, ya que
    // la elevación en Y evita el solape en la mayoría de los casos.
    page.mesh.renderOrder = 10;

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
  };
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

  // Fondo opaco: mismo color que el resto del papel de la carta
  // (`cfg.color`, ver createLetterMesh) para que la textura completa
  // se lea como papel con el texto encima, nunca como texto flotando
  // solo con huecos transparentes alrededor.
  ctx.fillStyle = pageColorHex;
  ctx.fillRect(0, 0, width, height);

  // ---- TÍTULO (opcional, centrado, con margen superior y separado
  // con claridad del cuerpo — ver "TEXTO DE CADA HOJA" del encargo). ----
  const hasTitle = typeof pageData.title === "string" && pageData.title.trim().length > 0;
  let bodyTop;
  if (hasTitle) {
    const tf = titleCfg.font;
    ctx.font = `${tf.weight} ${tf.sizePx}px ${tf.family}`;
    ctx.fillStyle = tf.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const titleY = height * titleCfg.marginTopFraction + tf.sizePx / 2;
    ctx.fillText(pageData.title, width / 2, titleY);
    let afterTitle = titleY + tf.sizePx / 2;

    // Separador decorativo opcional (ver mockup del encargo: una línea
    // fina bajo el título) — horneado en la misma textura, nunca un
    // elemento aparte.
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

    bodyTop = afterTitle + height * titleCfg.gapFraction;
  } else {
    // Sin título: el cuerpo empieza igualmente cerca de arriba (nunca
    // centrado en toda la hoja), con un margen superior propio.
    bodyTop = height * textFontCfg.topMarginFraction;
  }

  // ---- TEXTO (ajuste de línea automático, mismo algoritmo que ya
  // existía). ANCLADO ARRIBA (ver cabecera de la función): la primera
  // línea empieza justo en `bodyTop`, nunca centrado en el espacio
  // restante. ----
  ctx.font = `${textFontCfg.weight} ${textFontCfg.sizePx}px ${textFontCfg.family}`;
  ctx.fillStyle = textFontCfg.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = width * textFontCfg.maxWidthFraction;
  const paragraphs = String(pageData.text || "").split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(" ").filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }

  const lineHeight = textFontCfg.lineHeightPx;
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, bodyTop + lineHeight / 2 + i * lineHeight);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { texture, aspect: width / height };
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
