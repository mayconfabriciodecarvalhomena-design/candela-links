import * as THREE from "three";
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
import { createHelloKittyInspection } from "./helloKittyInspection.js";
import { createCandelaFinale } from "./candelaFinale.js";

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
const intro = createIntro();

// Se expone de inmediato para poder inspeccionar/forzar la intro desde
// la consola sin esperar a que arranque la escena; se completa con el
// resto de sistemas dentro de startScene().
window.candela = { intro };

intro.onStart(() => {
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

intro.onCompositionSettled(startScene);

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

  THREE.DefaultLoadingManager.onError = (url) => {
    console.error("Candela: error cargando", url);
  };

  const {
    scene,
    camera,
    renderer,
    room,
    flame,
    smoke,
    backgroundParticles,
    matchVisual,
    cat,
    helloKitty,
    flameWords,
  } = initScene();

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
    if (scenePrepared || !wickReady || !catModelReady || !helloKittyReady) return;
    scenePrepared = true;
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
  const matchesController = createMatchesController(scene, camera, renderer, matchVisual);

  // Etiqueta "Chloe" al pasar el cursor sobre el gato: sistema aparte,
  // con su propio raycaster y su propio listener de puntero (no toca
  // matchesController ni su cursor — ver la nota completa en
  // src/catHover.js).
  const catHoverLabel = createCatHoverLabel(camera, renderer, cat);

  // Click/tap sobre la Hello Kitty de la mesa: acerca la cámara con una
  // transición suave para inspeccionarla de cerca; click/tap fuera
  // vuelve a la vista anterior. Sistema aparte, con su propio
  // raycaster y su propio listener de puntero (mismo criterio que
  // catHoverLabel/matchesController — ver src/helloKittyInspection.js).
  const helloKittyInspection = createHelloKittyInspection(scene, camera, renderer, helloKitty);

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
  candleSequence.on("narrative", ({ key }) => {
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
  //   candela.helloKittyInspection.state — estado actual de la
  //     interacción de inspección ("IDLE" / "TRANSITION_IN" /
  //     "KITTY_INSPECTION" / "TRANSITION_OUT")
  //   candela.helloKittyInspection.enter() / .exit() — forzar la
  //     entrada/salida de la inspección sin necesidad de hacer click
  //     sobre la Kitty (útil para probar la transición desde consola)
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
  // Todos ya se crean y se añaden a la escena automáticamente desde
  // scene.js; aquí solo se exponen para inspección manual.
  Object.assign(window.candela, {
    room,
    flame,
    smoke,
    backgroundParticles,
    matchVisual,
    matches: matchesController.matches,
    cat,
    catHoverLabel,
    helloKitty,
    helloKittyInspection,
    candleSequence,
    music,
    sfx,
    flameWords,
    candelaFinale,
  });
}
