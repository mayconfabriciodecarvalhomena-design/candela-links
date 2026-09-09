import * as THREE from "three";
import { CONFIG } from "./config.js";
import { initScene, onUpdate } from "./scene.js";
import { createMatchesController } from "./matchesController.js";
import { onFlameExtinguished } from "./flame.js";
import { onWickReady } from "./candle.js";
import { createCandleSequence } from "./candleSequence.js";
import { showNarrativeLine } from "./narrative.js";
import { createIntro } from "./intro.js";
import { CONTENT } from "../content.js";
import { music } from "./music.js";
import { sfx } from "./sfx.js";
import { createCatHoverLabel } from "./catHover.js";
import { createObjectInspection } from "./objectInspection.js";
import { createDoorInteraction } from "./doorInteraction.js";
import { createCandelaFinale } from "./candelaFinale.js";
import { createCameraPan } from "./cameraPan.js";
import { createLetterPageControls } from "./letterPageControls.js";
import { createLetterWriteControls } from "./letterWriteControls.js";
import { hasVisitedBefore, markVisited, skipToLetterReady, isNarrativeSuppressed } from "./skipIntro.js";
import { recordVisit, trackEvent } from "./visits.js";

// -----------------------------------------------------------------------
// ORDEN DE ARRANQUE: la intro se crea y se muestra de inmediato (es
// barata: solo DOM + CSS). La preparación PESADA de la escena 3D
// (initScene(): crea el renderer, carga candle.glb/cat.glb y arranca el
// render loop) se retrasa a propósito hasta que `intro.js` avisa de que
// la composición ha terminado de aparecer del todo
// (`onCompositionSettled`). Antes de eso, `initScene()` ni siquiera se
// llama: no existe ni renderer ni render loop todavía, así que no hay
// nada de Three.js compitiendo por el hilo principal con las
// animaciones CSS de la intro (marco, título, línea, respiración...).
//
// La señal de "composición asentada" es real (el propio `transitionend`
// del botón "cargar escena", el último elemento en aparecer — ver
// intro.js), no un tiempo inventado en el código.
// -----------------------------------------------------------------------
const intro = createIntro({ showSkip: hasVisitedBefore() });

// Se expone de inmediato para poder inspeccionar/forzar la intro desde
// la consola sin esperar a que arranque la escena; se completa con el
// resto de sistemas dentro de startScene().
window.candela = { intro };

intro.onStart(() => {
  // La visita se marca AQUÍ (no al cargar el HTML): es el momento real
  // en que la persona entra a la experiencia. Ver src/skipIntro.js
  // (localStorage, para saber si mostrar "SALTAR ANIMACIÓN" la próxima
  // vez) y src/visits.js (registro en Supabase vía /api/visit). Ambas
  // llamadas son baratas/no bloqueantes y no afectan al resto del flujo.
  markVisited();
  recordVisit();

  // La música arranca aquí a propósito: `onStart()` (intro.js) se
  // dispara de forma SÍNCRONA desde el propio listener de click del
  // botón "Cargar escena" (handleClick), así que llamar a music.play()
  // en este mismo punto sigue contando como gesto de usuario para el
  // navegador y evita el bloqueo de autoplay. Ver src/music.js.
  music.play();

  // El maullido del gato no se reproduce todavía aquí (lo dispara el
  // programador cuando el gato se revela/oculta, ver más abajo), pero
  // se prepara su elemento <audio> en este mismo click por coherencia
  // con music.play() — no reproduce nada, así que no hay riesgo de
  // autoplay bloqueado. Ver src/sfx.js.
  sfx.prepare();

  intro.fadeOutAndDestroy();
});

// "SALTAR ANIMACIÓN" (solo existe el botón, y por tanto este evento,
// cuando skipIntro.hasVisitedBefore() era true al crear la intro — ver
// arriba). Mismo arranque de música/sfx/fade que "CARGAR ESCENA" (este
// click es igualmente un gesto de usuario real): la diferencia de
// verdad — saltar la secuencia larga — se conecta más abajo, dentro de
// startScene(), en cuanto existen flame/candleSequence/flameWords/
// candelaFinale (ver el segundo intro.onSkip() al final de esta
// función).
intro.onSkip(() => {
  markVisited();
  recordVisit();
  music.play();
  sfx.prepare();
  intro.fadeOutAndDestroy();
});

// ---- Reintento tras un fallo de carga (ver setLoadError()/onRetry() en
// intro.js, y failScene() más abajo en esta misma función) ----
//
// Deliberadamente una recarga completa de página (`window.location.reload()`),
// no un reintento "en caliente" que reconstruya la escena por dentro.
// Motivo (ver el propio encargo de esta iteración — "si reconstruir de
// forma segura es complejo, es preferible un estado de reintento claro
// antes que una reconstrucción incompleta"): la escena involucra 7+
// sistemas interdependientes (matchesController, objectInspection,
// doorInteraction, candelaFinale, letterPageControls,
// letterWriteControls, cameraPan), varios con sus propios listeners
// sobre `renderer.domElement`, además del propio render loop de
// scene.js y `THREE.DefaultLoadingManager` (singleton global). Intentar
// desmontar y reconstruir todo eso en caliente es exactamente el tipo
// de superficie donde podrían colarse los bugs que el encargo pide
// evitar explícitamente (listeners duplicados, objetos Three.js
// duplicados, audio duplicado, analítica duplicada). Una recarga
// completa los evita TODOS por construcción, sin necesitar ninguna
// lógica de limpieza nueva:
//   - session_id (src/visits.js): ya nace en memoria en cada carga de
//     página POR DISEÑO ("cada carga de página = un session_id
//     distinto", ver la cabecera de ese archivo) — un reintento generará
//     un session_id nuevo, que es exactamente su comportamiento normal
//     documentado, no un caso especial introducido aquí.
//   - device_id (src/visits.js): persiste en localStorage/cookie, así
//     que sobrevive intacto a la recarga.
//   - "experience_started"/recordVisit(): solo llegan a dispararse
//     cuando el usuario pulsa "CARGAR ESCENA" real (intro.onStart(),
//     arriba) — un fallo durante la carga automática de fondo ocurre
//     ANTES de que el usuario pueda pulsar ese botón (sigue
//     deshabilitado hasta que la escena esté lista), así que en el caso
//     más común (fallo durante la carga inicial) estos eventos ni
//     siquiera han llegado a mandarse todavía cuando se recarga: no hay
//     nada que duplicar. Si el fallo ocurre más tarde (p. ej. pérdida de
//     contexto WebGL en pleno uso, ver scene.js), la recarga sí generará
//     un "experience_started" nuevo bajo el session_id nuevo — pero eso
//     es, de nuevo, el comportamiento normal ya documentado del sistema
//     para "una visita nueva", no una duplicación artificial.
intro.onRetry(() => {
  window.location.reload();
});

intro.onCompositionSettled(startScene);

// -----------------------------------------------------------------------
// RECUPERACIÓN DE CARGA (ver el encargo de esta iteración — FASE 2/3/4):
// `failScene()` es el ÚNICO punto de entrada para cualquier fallo
// irrecuperable durante la preparación de la escena — venga de un GLB
// que nunca termina de cargar (loaders, más abajo), de un timeout, de
// una excepción síncrona durante `initScene()`/el resto de
// `startScene()` (try/catch, más abajo) o de una pérdida de contexto
// WebGL (scene.js). Así solo hay UN sitio que decide qué hacer cuando
// algo falla — no un sistema paralelo distinto por cada tipo de fallo.
//
// `sceneFailed` evita que un segundo fallo (p. ej. el timeout
// disparándose justo después de que un loader ya haya fallado) pise el
// estado de error ya mostrado o lo procese dos veces.
// -----------------------------------------------------------------------
let sceneFailed = false;
let sceneReadyTimeoutId = null;

// Tiempo máximo de gracia, desde que `initScene()` termina (loaders ya
// en marcha) hasta que la escena debe estar realmente lista
// (maybeMarkSceneReady(), ver más abajo), antes de considerarlo un
// fallo. 45s es deliberadamente generoso: candle.glb + cat.glb +
// hello_kitty.glb suman ~26MB en disco (más la decodificación de
// texturas y la precompilación de shaders vía renderer.compile), un
// peor caso realista en datos móviles lentos puede llevar bastante más
// de 15-20s sin que eso signifique que algo esté realmente colgado —
// este timeout es solo para el caso "de verdad nunca va a terminar"
// (loader que nunca dispara ni onLoad ni onError, p. ej. una conexión
// que se queda a medias sin llegar a fallar formalmente), no para
// conexiones simplemente lentas.
const SCENE_READY_TIMEOUT_MS = 45000;

function clearSceneReadyTimeout() {
  if (sceneReadyTimeoutId !== null) {
    window.clearTimeout(sceneReadyTimeoutId);
    sceneReadyTimeoutId = null;
  }
}

function failScene(detail) {
  if (sceneFailed) return;
  sceneFailed = true;
  clearSceneReadyTimeout();

  // Diagnóstico estructurado (ver el encargo: tipo, recurso, fase,
  // mensaje, stack, si WebGL estaba perdido) — sin datos personales,
  // solo información técnica del propio fallo.
  console.error("[Candela] Fallo al preparar la escena", {
    phase: detail.phase,
    resource: detail.resource ?? null,
    message: detail.message ?? (detail.error && detail.error.message) ?? null,
    stack: detail.error && detail.error.stack ? detail.error.stack : null,
    contextLost: Boolean(detail.contextLost),
  });

  intro.setLoadError(CONTENT.intro?.loadErrorMessage);
}

function startScene() {
  // -----------------------------------------------------------------------
  // PROGRESO DE CARGA REAL: `candle.js`, `cat.js` y `helloKitty.js` crean
  // su GLTFLoader sin pasarle un manager explícito (`new GLTFLoader()`),
  // así que los tres usan automáticamente `THREE.DefaultLoadingManager`
  // — no hay ningún otro `new ...Loader()` con manager propio en `src/`.
  // Enganchándonos a ese manager compartido obtenemos el progreso real de
  // las tres cargas (candle.glb + cat.glb + hello_kitty.glb, incluyendo
  // sus texturas embebidas) sin tocar ninguno de esos tres archivos y SIN
  // crear ningún loader adicional que duplicase la descarga — es la
  // misma carga, solo estamos escuchándola.
  //
  // Se engancha ANTES de llamar a `initScene()` (justo debajo) para no
  // perder ningún evento de progreso temprano.
  // -----------------------------------------------------------------------
  THREE.DefaultLoadingManager.onProgress = (_url, itemsLoaded, itemsTotal) => {
    const percent = itemsTotal > 0 ? (itemsLoaded / itemsTotal) * 100 : 0;
    intro.setLoadingProgress(percent);
  };

  // FASE 2 — vía real de fallo hacia arriba (ver el encargo: "que exista
  // una vía real para comunicar el fallo al nivel superior"). Antes esto
  // solo hacía console.error; se mantiene exactamente igual y además
  // ahora también llama a failScene(). Deliberadamente NO se toca
  // candle.js/cat.js/helloKitty.js para esto: `manager.onError(url)` ya
  // recibe TODOS sus fallos de carga (network o parseo — GLTFLoader
  // enruta ambos hacia el manager compartido, ver el comentario de
  // arriba), así que este único punto ya existente cubre los tres
  // loaders sin crear ningún sistema paralelo. Limitación conocida: la
  // API de LoadingManager solo entrega la URL, no el objeto Error
  // original — por eso este fallo concreto no lleva stack (ver
  // "Riesgos restantes" en la respuesta).
  THREE.DefaultLoadingManager.onError = (url) => {
    console.error("Candela: error cargando", url);
    failScene({ phase: "asset-load", resource: url, message: `No se pudo cargar: ${url}` });
  };

  let sceneRefs;
  try {
    sceneRefs = initScene({
      onContextLost: () => {
        failScene({ phase: "webgl-context-lost", contextLost: true, message: "Contexto WebGL perdido" });
      },
      onContextRestored: () => {
        // Solo diagnóstico — ver el comentario junto a `contextLost` en
        // scene.js: no se intenta reanudar/reconstruir nada aquí.
        console.warn("[Candela] Contexto WebGL restaurado (sin reconstrucción automática).");
      },
    });
  } catch (error) {
    // FASE 4 — excepción síncrona durante la propia `initScene()`
    // (creación del renderer, de la escena, de room/candle/flame/cat/
    // hello_kitty/flameWords...). Se identifica explícitamente como fase
    // "initScene" (no un catch genérico que oculte dónde falló, ver el
    // encargo) y se aborta aquí: no tiene sentido seguir ejecutando el
    // resto de `startScene()` sin una escena válida que devolver.
    failScene({ phase: "initScene", message: error?.message, error });
    return;
  }

  const {
    scene,
    camera,
    renderer,
    room,
    pictureFrame,
    flame,
    smoke,
    backgroundParticles,
    matchVisual,
    cat,
    helloKitty,
    flameWords,
  } = sceneRefs;

  // FASE 2 — timeout de preparación (ver SCENE_READY_TIMEOUT_MS arriba).
  // Arranca AQUÍ, justo cuando sabemos que `initScene()` no ha fallado
  // de forma síncrona y los tres GLTFLoader ya están realmente en marcha
  // (se disparan de forma síncrona dentro de la propia `initScene()`) —
  // es decir, cuando la carga de verdad empieza, tal y como pedía el
  // encargo. Se limpia en dos sitios: dentro de `maybeMarkSceneReady()`
  // en cuanto la escena queda realmente lista (carga normal, el caso de
  // siempre), y dentro de `failScene()` (cualquier fallo, para no
  // dejarlo disparándose de más sobre una escena que ya se dio por
  // fallida por otro motivo).
  sceneReadyTimeoutId = window.setTimeout(() => {
    failScene({
      phase: "scene-ready-timeout",
      message: `La escena no terminó de prepararse en ${SCENE_READY_TIMEOUT_MS / 1000}s`,
    });
  }, SCENE_READY_TIMEOUT_MS);

  // -----------------------------------------------------------------------
  // PRECARGA REAL: el botón ya es visible desde antes (forma parte de
  // la aparición narrativa de la intro), y mientras tanto muestra el
  // progreso real de carga ("CARGANDO ESCENA X%", ver el
  // DefaultLoadingManager de arriba). Solo se habilita para pulsarlo
  // cuando hay señales REALES de que lo importante ya está listo: la
  // mecha real de la vela medida (onWickReady, ya expuesto por
  // candle.js) y el modelo del gato cargado (cat.model, ya expuesto por
  // cat.js). No hay ningún temporizador falso aquí: si la carga tardara
  // más de lo esperado, el botón simplemente seguiría mostrando el
  // porcentaje hasta que de verdad esté listo.
  //
  // Una vez listas ambas señales, se precompilan los shaders de todo lo
  // que ya hay en la escena (`renderer.compile`) para que, al
  // revelarla, no haya un tirón la primera vez que algo se renderiza de
  // verdad (p. ej. el glow de la llama o el humo, que hasta entonces
  // nunca se habían dibujado) — así se evita en la medida de lo posible
  // que el usuario vea "aparecer" los modelos uno a uno.
  // -----------------------------------------------------------------------
  let wickReady = false;
  let catModelReady = false;
  let helloKittyReady = false;
  let scenePrepared = false;

  function maybeMarkSceneReady() {
    if (scenePrepared || sceneFailed || !wickReady || !catModelReady || !helloKittyReady) return;
    scenePrepared = true;
    clearSceneReadyTimeout();
    renderer.compile(scene, camera);

    // La carga ha terminado de verdad: forzamos el 100% explícito (por
    // si el redondeo del manager se hubiera quedado corto, p. ej. por
    // algún recurso interno no contabilizado) y de inmediato el cambio
    // a "CARGAR ESCENA".
    intro.setLoadingProgress(100);
    intro.setReady(true);

    // THREE.DefaultLoadingManager es un singleton global: lo dejamos
    // exactamente como estaba antes de engancharnos (`undefined` es la
    // forma que usa el propio three.js para decir "sin callback", ver
    // LoadingManager) para no dejar colgado un callback que ya no
    // necesita seguir informando a esta intro (que además va a
    // destruirse en cuanto el usuario pulse el botón).
    THREE.DefaultLoadingManager.onProgress = undefined;
    THREE.DefaultLoadingManager.onError = undefined;
  }

  onWickReady(() => {
    wickReady = true;
    maybeMarkSceneReady();
  });

  onUpdate(() => {
    if (catModelReady || !cat.model) return;
    catModelReady = true;
    maybeMarkSceneReady();
  });

  onUpdate(() => {
    if (helloKittyReady || !helloKitty.model) return;
    helloKittyReady = true;
    maybeMarkSceneReady();
  });

  // El sistema de cerillas conecta la mecánica (matches.js) con la
  // representación 3D (matchVisual, ya creada por scene.js) y con la
  // interacción real (click para raspar y encender, arrastre para
  // acercarla a la vela). No llama a `flame.ignite()` en ningún sitio:
  // solo expone `onReadyToLightCandle` para cuando exista esa fase.
  // FASE 4 — el resto de `startScene()` (creación/inicialización de
  // todos los demás sistemas: cerillas, inspección de objetos, puerta,
  // finale, carta, cameraPan, y todo su cableado) queda envuelto en su
  // propio try/catch, distinto del de `initScene()` de arriba, para no
  // ocultar en qué fase concreta ha fallado algo (ver el encargo: "no
  // hagas un try/catch gigante que oculte qué función falló"). En este
  // punto la escena YA es visualmente válida y el render loop ya está
  // en marcha (initScene() ya tuvo éxito) — una excepción aquí no deja
  // la aplicación bloqueada de forma silenciosa: se reporta igual que
  // cualquier otro fallo, mostrando el mismo estado de reintento.
  try {
  const matchesController = createMatchesController(scene, camera, renderer, matchVisual, {
    // Fuente de verdad para "la vela está encendida" — ambas piezas ya
    // públicas en flame.js, sin ningún estado nuevo:
    //   - flame.isLit(): estado lógico al instante. Cubre tanto el
    //     encendido por cerilla como el de skipIntro.js durante "SALTAR
    //     ANIMACIÓN" (llama a flame.ignite() directamente) — este
    //     archivo no necesita saber nada de ese camino.
    //   - flame.getLightProgress() > 0: mantiene el bloqueo mientras la
    //     llama todavía se esté apagando visualmente después de
    //     extinguish() (isLit ya es false en ese instante, pero la
    //     llama sigue encendida a ojos del usuario unos instantes más
    //     — ver flame.js, mismo umbral 0.001 que usa internamente para
    //     decidir su propia visibilidad). Así el bloqueo cubre "todo el
    //     periodo en que la vela se considera encendida, incluyendo la
    //     animación de apagado", sin inventar un segundo temporizador.
    isCandleLit: () => flame.isLit() || flame.getLightProgress() > 0.001,
  });

  // Etiqueta "Chloe" al pasar el cursor sobre el gato: sistema aparte,
  // con su propio raycaster y su propio listener de puntero (no toca
  // matchesController ni su cursor — ver la nota completa en
  // src/catHover.js).
  const catHoverLabel = createCatHoverLabel(camera, renderer, cat);

  // Click/tap sobre la Hello Kitty de la mesa O sobre el cuadro de la
  // pared: acerca la cámara con una transición suave para verlos de
  // cerca; click/tap fuera vuelve a la vista anterior. Mismo sistema
  // para los dos (no hay dos animaciones de cámara distintas — ver la
  // nota completa en src/objectInspection.js, antes específico de la
  // Kitty y ahora generalizado a una lista de objetivos). El cuadro se
  // registra con la MISMA configuración que la Kitty
  // (CONFIG.helloKittyInspection): mismo estilo/duración/suavidad, tal
  // como se pidió — solo cambia su geometría real (pictureFrame.group)
  // y su propia normal de cara (misma fórmula que ya usa
  // pictureFrame.js para "hacia dónde mira la pared").
  const objectInspectionYAxis = new THREE.Vector3(0, 1, 0);
  const objectInspection = createObjectInspection(scene, camera, renderer, [
    {
      key: "kitty",
      getObject3D: () => helloKitty.model,
      computeFaceDirection: (out) =>
        out.set(-1, 0, 0).applyAxisAngle(objectInspectionYAxis, helloKitty.group.rotation.y),
      cfg: CONFIG.helloKittyInspection,
    },
    {
      key: "pictureFrame",
      getObject3D: () => pictureFrame.group,
      computeFaceDirection: (out) => {
        const rotationY = CONFIG.pictureFrame.rotationY ?? 0;
        out.set(Math.sin(rotationY), 0, Math.cos(rotationY));
      },
      cfg: CONFIG.helloKittyInspection,
    },
  ]);

  // Click sobre la puerta de la habitación: no se abre (no tiene, ni va
  // a tener, ninguna animación de apertura) — solo muestra un aviso
  // reutilizando el mismo sistema de texto narrativo que ya usa el
  // resto de la experiencia (showNarrativeLine, ver src/narrative.js).
  // Sistema aparte, con su propio listener de puntero (mismo criterio
  // que catHoverLabel/objectInspection/matchesController) — ver la nota
  // completa en src/doorInteraction.js.
  const doorInteraction = createDoorInteraction(camera, renderer, room.door);

  // -----------------------------------------------------------------------
  // FINAL DE CANDELA (primera parte): transición desde la última frase
  // de FlameWords hasta el sobre abierto (ver src/candelaFinale.js). Se
  // crea aquí (necesita scene/camera/flame, ya disponibles) y se
  // dispara SOLO cuando flameWords avisa de que su secuencia automática
  // ha terminado del todo (evento "sequence-completed", añadido de
  // forma aditiva en flameWords.js) — nunca en modo manual
  // (candela.flameWords.show("...") suelto no dispara el final).
  // -----------------------------------------------------------------------
  const candelaFinale = createCandelaFinale({ scene, camera, flame });
  flameWords.on("sequence-completed", () => {
    candelaFinale.start();
  });

  // ITERACIÓN — ANALÍTICA (PARTE 1 del encargo): "candle_words_started"
  // se dispara en el punto real donde empieza a aparecer la primera
  // frase de la vela (ver "sequence-started" en flameWords.js, emitido
  // dentro de updateAutoSequence() exactamente cuando se llama a
  // show() por primera vez) — nunca en modo manual (candela.flameWords.
  // show("...") suelto no dispara este evento, igual que ya pasa con
  // "sequence-completed").
  flameWords.on("sequence-started", () => {
    trackEvent("candle_words_started");
  });

  // "envelope_shown": se dispara en el punto real donde el sobre pasa a
  // estar visible (ver "envelope-shown" en candelaFinale.js, emitido al
  // entrar en la fase MATERIALIZE, justo cuando el objeto físico del
  // sobre se coloca y empieza a aparecer).
  candelaFinale.on("envelope-shown", () => {
    trackEvent("envelope_shown");
  });

  // "page_changed": cada cambio de página de la carta (en cualquier
  // dirección — ver "page-changed" en candelaFinale.js, emitido tanto
  // desde nextPage() como desde previousPage()). Los índices de
  // candelaFinale son 0-based (misma convención que getCurrentPage());
  // aquí se convierten a 1-based solo de cara a la analítica, para que
  // "página 1" sea la primera hoja tal y como la vería la persona.
  candelaFinale.on("page-changed", ({ from, to }) => {
    trackEvent("page_changed", { from_page: from + 1, to_page: to + 1 });
  });

  // -----------------------------------------------------------------------
  // FLECHAS PARA PASAR PÁGINA DE LA CARTA (ver src/letterPageControls.js):
  // overlay HTML aparte, con su propio listener de click sobre sus
  // propios elementos — nunca toca renderer.domElement ni ningún
  // raycaster existente (mismo criterio de aislamiento que
  // catHoverLabel/objectInspection/matchesController, cada uno con
  // su propia interacción independiente sobre la misma escena). Se
  // conecta directamente a candelaFinale.nextPage()/previousPage()/
  // isTurning()/getCurrentPage()/getPageCount() — no crea ningún
  // sistema de páginas paralelo.
  // -----------------------------------------------------------------------
  const letterPageControls = createLetterPageControls(camera, renderer, candelaFinale);

  // -----------------------------------------------------------------------
  // ESCRITURA EN LA ÚLTIMA PÁGINA DE LA CARTA (ver src/letterWriteControls.js):
  // overlay DOM propio (textarea invisible + botón "Enviar" + estado),
  // mismo criterio de aislamiento que letterPageControls justo arriba —
  // nunca toca renderer.domElement ni ningún raycaster existente. Se
  // conecta directamente a candelaFinale (getPageCount()/getCurrentPage()/
  // isLetterReadable()/isTurning()/setPageDraft()), no crea ningún
  // sistema paralelo.
  // -----------------------------------------------------------------------
  const letterWriteControls = createLetterWriteControls(camera, renderer, candelaFinale);

  // -----------------------------------------------------------------------
  // PANEO LATERAL DE CÁMARA (exploración táctil puerta ↔ centro ↔
  // espejo/cuadro — ver src/cameraPan.js). Se crea aquí, y no antes,
  // porque `isSuspended` necesita referencias reales a `objectInspection`
  // y `candelaFinale` (ambas ya creadas más arriba en esta función):
  //   - objectInspection.state !== "IDLE": suspendido mientras se entra,
  //     se está, o se sale de la inspección de la Kitty/el cuadro (esos
  //     sistemas ya mueven la cámara por su cuenta durante ese tiempo).
  //   - candelaFinale.getPhase() !== "idle": suspendido durante TODO el
  //     final (desde el primer aviso hasta "done", el reposo con la
  //     carta legible) — cubre explícitamente "un swipe sobre la carta
  //     no debe mover la cámara".
  // Mismo patrón exacto que `isCandleLit` en matchesController.js: una
  // función que este módulo consulta cada frame, sin acoplarse a cómo
  // cada sistema decide internamente su propio estado.
  // -----------------------------------------------------------------------
  const cameraPan = createCameraPan(camera, renderer, {
    isSuspended: () => objectInspection.state !== "IDLE" || candelaFinale.getPhase() !== "idle",
  });

  // -----------------------------------------------------------------------
  // SECUENCIA NARRATIVA DE LA VELA: la vela necesita encenderse tres veces
  // (siempre con una cerilla) antes de quedarse encendida para siempre.
  // Las dos primeras veces se apaga sola al cabo de unos segundos y
  // aparece una frase (ver content.js / candleSequence.config.js). La
  // máquina de estados vive en candleSequence.js (lógica pura, sin
  // Three.js); aquí solo se conecta con flame.js y con el texto.
  // -----------------------------------------------------------------------
  const candleSequence = createCandleSequence();

  // El temporizador de la secuencia nunca apaga la llama directamente:
  // solo pide el apagado. Quien de verdad controla la llama sigue siendo
  // flame.js, igual que en cualquier apagado manual.
  candleSequence.on("auto-extinguish-request", () => {
    flame.extinguish();
  });

  // Cada frase de la secuencia vive en content.js, nunca hardcodeada aquí.
  // (isNarrativeSuppressed() solo es true mientras skipToLetterReady()
  // está encadenando notifyIgnited()/notifyExtinguished() de golpe — ver
  // src/skipIntro.js; en el flujo normal permanece siempre false y este
  // listener se comporta exactamente igual que antes.)
  candleSequence.on("narrative", ({ key }) => {
    if (isNarrativeSuppressed()) return;
    const line = CONTENT.candleSequence?.[key];
    if (line) showNarrativeLine(line);
  });

  // Arranca la secuencia automática de flameWords (ver flameWords.js/
  // flameWords.config.js) en el momento real en que la vela queda
  // encendida de forma DEFINITIVA: "completed" solo se emite al pasar a
  // FINAL_LIGHT (tercer encendido, sin apagado automático programado —
  // ver candleSequence.js), que es el único estado de la máquina de
  // candleSequence que representa "la llama ya está estable" en el
  // sentido narrativo del proyecto. No sirve "state-change" con
  // FIRST_LIGHT/SECOND_LIGHT: esos SÍ tienen un apagado automático
  // pendiente (la vela todavía no se ha quedado encendida de verdad).
  // Este evento se emite como mucho una vez por sesión (candleSequence
  // nunca vuelve a IDLE salvo con reset() manual desde consola, que no
  // ocurre en el flujo normal), así que startAutoSequence() no puede
  // dispararse dos veces desde aquí.
  candleSequence.on("completed", () => {
    flameWords.startAutoSequence();
  });

  // Integración: cuando la cerilla encendida toca la mecha, la vela se
  // enciende. Se avisa a la secuencia narrativa de que ha habido un
  // encendido real (ella decide sola si corresponde a la 1ª, 2ª o 3ª
  // vez, y si debe programar un apagado automático).
  //
  // CORREGIDO: antes había aquí un `cat.reveal()`, y más abajo un
  // `cat.hide()` dentro de onFlameExtinguished(). Se han retirado los
  // dos: el gato ya no necesita que nadie le avise de estos eventos
  // puntuales — ahora lee el brillo real de la llama (flame.
  // getLightProgress()) cada frame por sí mismo (ver cat.js/scene.js),
  // así que sigue la subida y la caída de luz en directo, sin depender
  // de en qué momento exacto se disparen estos callbacks. Llamar aquí a
  // cat.reveal()/cat.hide() ahora activaría además el override manual
  // de depuración de cat.js (pensado solo para consola), fijando su
  // brillo a un valor constante que dejaría de seguir a la vela — así
  // que quitarlos no es solo una limpieza, es necesario para que el
  // seguimiento en vivo funcione. Los maullidos (sfx) SÍ siguen ligados
  // a estos eventos de encendido/apagado de la vela (cuando el gato se
  // ilumina/oscurece de verdad), tal y como funcionaba antes.
  matchesController.onReadyToLightCandle(() => {
    flame.ignite();
    // El gato se ilumina al encenderse la vela (sigue a la llama) y, a
    // partir de entonces, puede maullar de vez en cuando (nunca de
    // inmediato, ver sfx.js). Si ya hubiera un maullido programado
    // (p. ej. llamadas consecutivas) no se duplica.
    sfx.startCatSounds();
    candleSequence.notifyIgnited();
  });

  onFlameExtinguished(() => {
    // El gato se oscurece al apagarse la vela (sigue a la llama, p. ej.
    // apagado automático entre el 1º y 2º encendido de la secuencia):
    // se cancela cualquier maullido programado hasta que vuelva a
    // encenderse la vela.
    sfx.stopCatSounds();
    candleSequence.notifyExtinguished();
  });

  // -----------------------------------------------------------------------
  // "SALTAR ANIMACIÓN" — conexión real (ver src/skipIntro.js).
  // Se registra aquí, al final de startScene(), y no junto al primer
  // intro.onSkip() de arriba, porque necesita referencias reales a
  // flame/candleSequence/flameWords/candelaFinale, que solo existen a
  // partir de este punto. intro.js ya garantiza que este callback no
  // puede dispararse antes de que la escena esté realmente lista: el
  // botón "SALTAR ANIMACIÓN" permanece deshabilitado hasta
  // intro.setReady(true), exactamente igual que "CARGAR ESCENA" (ver
  // maybeMarkSceneReady() más arriba). skipToLetterReady() no reimplementa
  // nada de la secuencia: reutiliza estas mismas funciones reales y las
  // avanza con fastForward() (ver scene.js) hasta que candelaFinale llega
  // solo a "done".
  // -----------------------------------------------------------------------
  intro.onSkip(() => {
    skipToLetterReady({ flame, candleSequence, flameWords, candelaFinale });
  });

  // Completamos window.candela (ver arriba) con todo lo que solo existe
  // a partir de aquí, una vez ha arrancado la escena. Se usa
  // exclusivamente para poder probarlo a mano desde la consola:
  //   candela.flame.ignite() / candela.flame.extinguish()
  //   candela.smoke.start() / candela.smoke.stop() / candela.smoke.isActive()
  //     (el humo ya se dispara solo al apagar la llama; esto es solo para
  //     probarlo a mano o forzarlo)
  //   candela.backgroundParticles.setIntensity(0.2)
  //   candela.matches.attemptStrike() / candela.matches.matchesRemaining()
  //   candela.matchVisual.object / candela.matchVisual.resetPose()
  //   candela.cat.reveal() / candela.cat.hide() / candela.cat.setRevealProgress(0.5)
  //   candela.helloKitty.model / candela.helloKitty.group
  //     (inspeccionar el modelo/posición cargados; no tiene reveal/hide,
  //     es un objeto decorativo estático iluminado por la vela)
  //   candela.objectInspection.state — estado actual de la interacción
  //     de inspección ("IDLE" / "TRANSITION_IN" / "INSPECTING" /
  //     "TRANSITION_OUT"), compartido por la Kitty y el cuadro (una
  //     sola cámara, una sola inspección posible a la vez — ver
  //     src/objectInspection.js, generalización de lo que antes era
  //     helloKittyInspection.js).
  //   candela.objectInspection.activeTargetKey — "kitty" / "pictureFrame"
  //     / null: cuál de los dos se está inspeccionando ahora mismo.
  //   candela.objectInspection.enter("kitty") / .enter("pictureFrame")
  //     / .exit() — forzar la entrada/salida de la inspección sin
  //     necesidad de hacer click (útil para probar la transición desde
  //     consola).
  //   candela.candleSequence.getState() / candela.candleSequence.reset()
  //     (inspeccionar o reiniciar la secuencia de encendido de la vela)
  //   candela.intro.setReady(true) — forzar el botón "cargar escena" a
  //     habilitarse manualmente, por si se quiere probar la intro sin
  //     esperar a que candle.glb/cat.glb terminen de cargar
  //   candela.intro.setLoadingProgress(50) — forzar manualmente el
  //     texto "CARGANDO ESCENA 50%" (solo tiene efecto mientras el
  //     botón no esté ya en modo "ready")
  //   candela.music.play() / candela.music.pause() / candela.music.stop()
  //   candela.music.next() / candela.music.setVolume(0.5)
  //   candela.sfx.startCatSounds() / candela.sfx.stopCatSounds()
  //     (forzar/parar la programación de maullidos sin esperar a que
  //     el gato se revele/oculte de verdad)
  //   candela.flameWords.show("mira") — dispara a mano una palabra de
  //     prueba que se forma con partículas de la propia llama y luego
  //     se disuelve. Se puede llamar otra vez de inmediato (sin esperar
  //     a que termine) para iterar rápido.
  //   candela.flameWords.hide() — corta la palabra actual y pasa
  //     directamente a la fase de disolución.
  //   candela.flameWords.isActive() — true mientras hay una palabra en
  //     curso (formándose, leyéndose o disolviéndose).
  //   candela.flameWords.startAutoSequence() — reproduce de nuevo la
  //     lista completa de frases (CONFIG.flameWords.autoSequence.words)
  //     una detrás de otra. Ya se dispara sola en cuanto la vela queda
  //     encendida de forma definitiva (ver candleSequence.on("completed"),
  //     arriba); esto es solo para forzar una repetición manual desde
  //     consola.
  //   candela.flameWords.stopAutoSequence() — corta la secuencia
  //     automática; no interrumpe la frase que esté visible en ese
  //     momento, solo evita que aparezca la siguiente.
  //   candela.candelaFinale.start() — dispara a mano la primera parte
  //     del final (pausa → llama creciendo → partículas → sobre →
  //     viaje al centro → apertura), sin esperar a que termine de
  //     verdad la secuencia automática de FlameWords. Útil para probar
  //     la transición de forma aislada. Si ya está en marcha no hace
  //     nada; si ya terminó (sobre abierto), se puede volver a llamar
  //     para repetirla desde el principio.
  //   candela.candelaFinale.getPhase() — fase actual de la máquina de
  //     estados ("idle" / "pause" / "flame-surge" / "birth" / "rise" /
  //     "converge" / "materialize" / "travel" / "settle" / "open" /
  //     "done").
  //   candela.candelaFinale.isActive() — true mientras el final está en
  //     marcha (desde start() hasta llegar a "done").
  //   candela.candelaFinale.nextPage() / .previousPage() — pasan de
  //     página en la carta (una vez ya está en su posición final,
  //     "final-hold"/"done" — ver isLetterReadable() en
  //     candelaFinale.js); no hacen nada si ya hay una transición en
  //     curso o si no hay página siguiente/anterior.
  //   candela.candelaFinale.getCurrentPage() / .getPageCount() /
  //     .isTurning() — estado del sistema de páginas.
  //   candela.cameraPan.yaw / .yawDegrees — paneo lateral de cámara
  //     actualmente aplicado (radianes / grados; positivo = hacia la
  //     puerta, negativo = hacia el espejo/cuadro — ver
  //     src/cameraPan.js). Solo lectura: se controla arrastrando con el
  //     dedo sobre el canvas, no hay setter manual expuesto.
  // Todos ya se crean y se añaden a la escena automáticamente desde
  // scene.js; aquí solo se exponen para inspección manual.
  Object.assign(window.candela, {
    room,
    pictureFrame,
    flame,
    smoke,
    backgroundParticles,
    matchVisual,
    matches: matchesController.matches,
    cat,
    catHoverLabel,
    helloKitty,
    objectInspection,
    doorInteraction,
    cameraPan,
    candleSequence,
    music,
    sfx,
    flameWords,
    candelaFinale,
    letterPageControls,
    letterWriteControls,
  });
  } catch (error) {
    failScene({ phase: "sceneSystemsInit", message: error?.message, error });
  }
}
