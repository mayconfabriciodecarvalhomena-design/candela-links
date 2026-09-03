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
// La carta es un Group con:
//   - `pages` → un plano físico INDEPENDIENTE por cada entrada de
//     `cfg.pages` (nunca hardcodeado — ver finale.config.js), cada uno
//     con un pivote vertical en el borde izquierdo (`hinge`) para
//     pasar de página (nextPage()/previousPage() más abajo) — mismo
//     lenguaje que `flapPivot` en envelopeMesh.js: rotar el pivote,
//     nunca la geometría. El sistema de pasar página NO ha cambiado en
//     esta iteración (el encargo pedía eliminar el doblado, no el paso
//     de página, que es un mecanismo distinto: gira la hoja entera
//     alrededor de su lomo, no la divide en dos).
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
  const halfW = cfg.width / 2;

  // -----------------------------------------------------------------------
  // SISTEMA DE HOJAS (ver "OBJETIVO 2 — SISTEMA REAL DE PASAR HOJAS" del
  // encargo original). Una hoja física independiente por cada entrada
  // de `cfg.pages` — el número de hojas NUNCA está hardcodeado, sale de
  // `cfg.pages.length`. Cada hoja se crea UNA vez aquí (nunca por frame
  // — ver "RENDIMIENTO" del encargo: sin geometrías/texturas nuevas por
  // frame, sin recrear hojas continuamente).
  //
  // Cada hoja es una ÚNICA malla completa (cfg.width × cfg.height, sin
  // divisiones ni pivotes de pliegue — ver cabecera del archivo).
  // Apiladas con una separación en Z minúscula (`cfg.page.stackSpacing`,
  // solo para evitar z-fighting entre páginas distintas — NO cambia el
  // tamaño ni la posición general de la carta): la primera hoja
  // (índice 0) queda la más "delante" (más cerca de cámara), las
  // siguientes progresivamente detrás — igual que en un cuaderno real.
  // -----------------------------------------------------------------------
  const pageContents = Array.isArray(cfg.pages) && cfg.pages.length > 0 ? cfg.pages : [{ text: "" }];
  const pageCfg = cfg.page;

  const pages = pageContents.map((pageData, index) => {
    // Pivote de PASAR PÁGINA (borde izquierdo, eje Y) — ver
    // nextPage()/previousPage() más abajo. Sin cambios respecto a
    // iteraciones anteriores: es un mecanismo totalmente independiente
    // del (ya eliminado) doblado.
    const hinge = new THREE.Group();
    hinge.position.set(-halfW, 0, 0.0012 + (pageContents.length - 1 - index) * pageCfg.stackSpacing);
    group.add(hinge);

    // Marco de la página dentro de su propio pivote de pasar página:
    // centrado en (halfW, 0, 0) — el centro real de la hoja, ya que el
    // pivote de pasar página vive en su borde izquierdo (x=0 del
    // pivote = borde izquierdo de la hoja, x=width = borde derecho).
    // Se conserva como grupo propio (en vez de aplicar la malla
    // directamente sobre `hinge`) únicamente para poder desplazarla
    // ligeramente durante el fundido de aparición — ver
    // setAppearance() más abajo.
    const pageFrame = new THREE.Group();
    pageFrame.position.set(halfW, 0, 0);
    hinge.add(pageFrame);

    const { texture } = buildPageTexture(
      pageData,
      cfg.width,
      cfg.height,
      cfg.text.font,
      pageCfg.title,
      `#${paperColor.getHexString()}`
    );

    // Malla ÚNICA y completa: ya centrada en el origen de `pageFrame`
    // por defecto (PlaneGeometry sin trasladar), así que coincide
    // exactamente con el centro de la hoja — sin necesidad de ningún
    // `translate()` adicional.
    const geometry = new THREE.PlaneGeometry(cfg.width, cfg.height);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: cfg.roughness,
      metalness: 0.02,
      transparent: true,
      opacity: 0,
      // DoubleSide: la hoja puede girar hasta 180° al pasar de página
      // (ver nextPage()/previousPage() más abajo) — con una sola cara
      // (FrontSide) desaparecería a mitad de ese giro en vez de
      // mostrar su reverso.
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    pageFrame.add(mesh);

    return { hinge, pageFrame, material };
  });

  // -----------------------------------------------------------------------
  // ESTADO DEL PASE DE PÁGINA (ver "REGLAS DE ANIMACIÓN" del encargo:
  // "no debe poder iniciarse otra transición incompatible
  // simultáneamente" + "el sistema debe saber cuál es la página
  // actual"). `currentPageIndex` es la única fuente de verdad de qué
  // hoja se está leyendo; `turnState`/`turnElapsed`/`turningIndex`
  // describen la transición en curso (si la hay).
  // -----------------------------------------------------------------------
  let currentPageIndex = 0;
  let turnState = "idle"; // "idle" | "forward" | "backward"
  let turnElapsed = 0;
  let turningIndex = -1;

  // -----------------------------------------------------------------------
  // APARIENCIA (fade in, controlado desde fuera durante LETTER_RISE).
  // Actúa sobre la página actual: opacidad de su única malla (que ya
  // contiene el texto desde su construcción — nunca una animación de
  // revelado aparte) y una ligerísima subida decorativa sincronizada
  // con la misma opacidad.
  // -----------------------------------------------------------------------
  function setAppearance(t) {
    const a = clamp01(t);
    const page = pages[currentPageIndex];
    if (page) {
      page.material.opacity = a;
      page.pageFrame.position.y = -(1 - a) * cfg.text.riseDistance;
    }
    group.visible = a > 0.001;
  }

  // -----------------------------------------------------------------------
  // PASAR PÁGINA (ver "ANIMACIÓN HACIA DELANTE"/"HACIA ATRÁS" y "API /
  // CONTROL" del encargo). API mínima y reutilizable: nextPage() /
  // previousPage() / getCurrentPage() — funciona igual con 1, 2, 5 o 10
  // hojas, sin ningún caso especial por cantidad (ver
  // "NÚMERO DE HOJAS" del encargo). Sin cambios en esta iteración.
  //
  // Ambas funciones devuelven `true` si han iniciado una transición y
  // `false` si no han hecho nada (ya en el límite, o ya hay una
  // transición en curso) — así quien llama (candelaFinale.js) puede
  // saberlo sin necesitar consultar isTurning() aparte.
  // -----------------------------------------------------------------------
  function nextPage() {
    if (turnState !== "idle") return false;
    if (currentPageIndex >= pages.length - 1) return false;
    turnState = "forward";
    turnElapsed = 0;
    turningIndex = currentPageIndex;
    return true;
  }

  function previousPage() {
    if (turnState !== "idle") return false;
    if (currentPageIndex <= 0) return false;
    turnState = "backward";
    turnElapsed = 0;
    turningIndex = currentPageIndex - 1;
    return true;
  }

  function getCurrentPage() {
    return currentPageIndex;
  }

  function getPageCount() {
    return pages.length;
  }

  function isTurning() {
    return turnState !== "idle";
  }

  // -----------------------------------------------------------------------
  // reset(): re-arma la carta entera para un nuevo pase de la secuencia
  // (llamado desde candelaFinale.js → start()). Vuelve siempre a la
  // PRIMERA hoja. Las hojas 2..N ya están "físicamente ahí" desde el
  // principio, completamente opacas — igual que en un cuaderno real,
  // donde las páginas por leer ya existen debajo de la que se está
  // leyendo — así que solo la primera necesita el fundido de aparición.
  // -----------------------------------------------------------------------
  function reset() {
    group.scale.setScalar(1);

    currentPageIndex = 0;
    turnState = "idle";
    turnElapsed = 0;
    turningIndex = -1;
    pages.forEach((page, index) => {
      page.hinge.rotation.y = 0;
      page.pageFrame.position.y = 0;
      page.material.opacity = index === 0 ? 0 : 1;
    });

    setAppearance(0);
    group.visible = false;
  }
  reset();

  // -----------------------------------------------------------------------
  // updatePageTurn(delta): avanza la transición de pasar página en
  // curso, si la hay (ver "ANIMACIÓN HACIA DELANTE"/"HACIA ATRÁS" del
  // encargo). Sin cambios en esta iteración — completamente
  // independiente del (ya eliminado) doblado: candelaFinale.js solo
  // permite llamar a nextPage()/previousPage() una vez la carta ya está
  // visible en su posición final, pero esta función en sí no necesita
  // saberlo: si no hay ninguna transición en curso
  // (`turnState === "idle"`), no hace nada.
  // -----------------------------------------------------------------------
  function updatePageTurn(delta) {
    if (turnState === "idle") return;
    turnElapsed += delta;
    const t = Math.min(1, turnElapsed / pageCfg.turnDuration);
    // easeInOutCubic: arranca y termina suave en ambos extremos — un
    // giro físico de página, no un fundido ni un rebote (ver "Quiero
    // que el movimiento sea coherente en ambas direcciones").
    const eased = easeInOutCubic(t);
    const page = pages[turningIndex];

    if (turnState === "forward") {
      // La hoja actual gira hacia el final del conjunto (0° → -180°).
      page.hinge.rotation.y = -Math.PI * eased;
      if (t >= 1) {
        page.hinge.rotation.y = -Math.PI;
        currentPageIndex = turningIndex + 1;
        turnState = "idle";
        turningIndex = -1;
      }
    } else {
      // La hoja anterior (que estaba al final) vuelve hacia delante
      // (-180° → 0°).
      page.hinge.rotation.y = -Math.PI * (1 - eased);
      if (t >= 1) {
        page.hinge.rotation.y = 0;
        currentPageIndex = turningIndex;
        turnState = "idle";
        turningIndex = -1;
      }
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
