import { CONTENT } from "../content.js";
import { createIntroParticles } from "./introParticles.js";

// -----------------------------------------------------------------------
// INTRO: pantalla negra minimalista de entrada a Candela.
//
// Módulo autocontenido de DOM/CSS, sin Three.js y sin conocer nada de
// la vela, las cerillas, la secuencia de encendido ni el gato — solo
// sabe mostrar unos textos (desde content.js), decorarse a sí mismo
// (marco, pregunta introductoria, subrayado, grano, respiración,
// partículas de colores con su propio corazón ocasional — ver
// introParticles.js — todo resuelto en CSS/Canvas 2D, sin Three.js) y
// avisar a quien lo use de dos momentos:
//   - `onCompositionSettled`: la composición ha terminado de aparecer
//     del todo (útil para que main.js sepa que ya puede empezar el
//     trabajo pesado de Three.js sin competir con las animaciones CSS
//     de la intro — ver más abajo).
//   - `onStart`: el usuario ha pulsado "cargar escena".
//
// IMPORTANTE sobre la carga: este módulo NO decide cuándo está lista la
// escena de verdad ni cuánto ha progresado — eso lo sabe main.js, que es
// quien orquesta candle.js/cat.js/etc. Este módulo solo expone
// `setLoadingProgress(0-100)` (actualiza la etiqueta "CARGANDO ESCENA
// X%") y `setReady(bool)` (la sustituye por "CARGAR ESCENA" y habilita
// el botón). No hay ningún temporizador ni contador artificial aquí
// dentro: los números que se muestran son siempre los que main.js le
// pasa.
// -----------------------------------------------------------------------

export function createIntro() {
  const content = CONTENT.intro ?? {};

  const overlay = document.createElement("div");
  overlay.className = "intro-overlay";

  // ---- Marco decorativo ----
  // Puramente visual: NO es un rectángulo completo, sino 6 segmentos
  // independientes (línea superior, línea inferior, y un "stub"
  // vertical corto en cada una de las 4 esquinas) — así el marco tiene
  // huecos/interrupciones en el centro de los lados, como un marco
  // decorativo y no como un borde de interfaz. Cada segmento nace con
  // `transform: scale*(0)` (invisible de verdad, no solo con opacidad)
  // y se "dibuja" por CSS con su propio transition-delay, empezando
  // por las esquinas (ver styles.css). No es interactivo ni forma
  // parte de la composición central, así que vive fuera de `content`
  // (no participa de la respiración) y lleva `aria-hidden` +
  // `pointer-events: none`.
  const frame = document.createElement("div");
  frame.className = "intro-frame";
  frame.setAttribute("aria-hidden", "true");
  frame.innerHTML = [
    '<span class="intro-frame-line intro-frame-top"></span>',
    '<span class="intro-frame-line intro-frame-bottom"></span>',
    '<span class="intro-frame-line intro-frame-stub intro-frame-stub-tl"></span>',
    '<span class="intro-frame-line intro-frame-stub intro-frame-stub-tr"></span>',
    '<span class="intro-frame-line intro-frame-stub intro-frame-stub-bl"></span>',
    '<span class="intro-frame-line intro-frame-stub intro-frame-stub-br"></span>',
  ].join("");

  // ---- Pregunta introductoria ----
  // Aparece ANTES del título, sola, se mantiene unos segundos y se
  // desvanece para siempre — nunca vuelve a mostrarse. Vive posicionada
  // de forma independiente (position: absolute, centrada sobre el
  // mismo punto que la composición central) en vez de dentro de
  // `contentEl`: así, cuando desaparece, no deja ningún hueco ni
  // desplaza al título/línea/significado/botón, que siguen centrados
  // exactamente donde ya estaban.
  //
  // Toda su animación (aparece → se mantiene → se desvanece) es un
  // único `@keyframes` en CSS disparado por la misma clase
  // "is-visible" que arranca el resto de la secuencia (ver más abajo):
  // no hay ningún `setTimeout` ni lógica de temporización en JS.
  const question = document.createElement("p");
  question.className = "intro-question";
  question.textContent = content.question ?? "¿Qué significa Candela?";

  // ---- Composición central ----
  // Título, línea, significado y botón viven dentro de un único
  // contenedor (`contentEl`) para poder aplicarle la "respiración" (un
  // movimiento vertical de 1-2px, ver .intro-content en styles.css) al
  // bloque completo una vez ya ha aparecido entero, sin afectar al
  // marco (que permanece estático).
  const contentEl = document.createElement("div");
  contentEl.className = "intro-content";

  // El título y su línea van juntos en un envoltorio propio
  // (`intro-title-wrap`) en vez de sueltos: así la línea toma
  // automáticamente el mismo ancho que el título renderizado (más un
  // pequeño margen negativo para sobresalir un poco), sin necesidad de
  // medir nada por JS — es un truco puramente de CSS (inline-flex +
  // align-items: stretch), ver styles.css.
  const titleWrap = document.createElement("div");
  titleWrap.className = "intro-title-wrap";

  const title = document.createElement("h1");
  title.className = "intro-title";
  title.textContent = content.title ?? "CANDELA";

  // Línea bajo el título: puramente decorativa (aria-hidden), crece
  // desde el centro hacia ambos lados por CSS después de que el título
  // haya aparecido (ver los transition-delay en styles.css).
  const titleLine = document.createElement("div");
  titleLine.className = "intro-title-line";
  titleLine.setAttribute("aria-hidden", "true");

  titleWrap.append(title, titleLine);

  const meaning = document.createElement("p");
  meaning.className = "intro-meaning";
  meaning.textContent = content.meaning ?? "";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "intro-button";
  button.disabled = true; // hasta que setReady(true) — ver más abajo

  // La etiqueta va en su propio <span> (no directamente como
  // textContent del botón) para poder hacer un fundido corto cuando el
  // texto cambia de "CARGANDO ESCENA X%" a "CARGAR ESCENA" — ver
  // setReady() más abajo.
  const buttonLabel = document.createElement("span");
  buttonLabel.className = "intro-button-label";
  button.appendChild(buttonLabel);

  contentEl.append(titleWrap, meaning, button);
  overlay.append(frame, question, contentEl);
  document.body.appendChild(overlay);

  // ---- Partículas decorativas ----
  // Capa puramente visual e independiente de toda la lógica narrativa
  // de arriba: no sabe nada de ready/progreso/composición asentada, ni
  // al revés. Vive y muere junto con la intro — se crea aquí, en cuanto
  // el overlay ya está en el DOM (introParticles.js la inserta como
  // primer hijo, así queda siempre detrás del marco/pregunta/
  // composición), y se destruye en fadeOutAndDestroy() cuando la intro
  // desaparece del todo, para no dejar ningún requestAnimationFrame ni
  // listener corriendo de fondo. Ver introParticles.js para el porqué
  // de que sea Canvas 2D y no Three.js.
  const introParticles = createIntroParticles(overlay);

  let ready = false;
  let started = false;
  let loadingProgress = 0;
  const startListeners = new Set();

  // ---- Etiqueta del botón: "CARGANDO ESCENA X%" mientras se prepara
  // la escena, "CARGAR ESCENA" en cuanto está lista de verdad. Nunca se
  // llama sola: la actualizan `setLoadingProgress()` y `setReady()`. ----
  function renderButtonLabel() {
    if (ready) {
      buttonLabel.textContent = content.buttonLabel ?? "CARGAR ESCENA";
      return;
    }
    const loadingText = content.loadingLabel ?? "CARGANDO ESCENA";
    buttonLabel.textContent = `${loadingText} ${loadingProgress}%`;
  }

  renderButtonLabel();

  function onStart(callback) {
    startListeners.add(callback);
    return () => startListeners.delete(callback);
  }

  function handleClick() {
    if (!ready || started) return;
    started = true;
    startListeners.forEach((callback) => callback());
  }

  button.addEventListener("click", handleClick);

  // ---- "Composición asentada" ----
  // El botón es, por diseño, el último elemento en aparecer (ver el
  // orden de transition-delay/@keyframes en styles.css). En cuanto su propia
  // transición CSS de entrada termina de verdad (evento real del
  // navegador, no un tiempo inventado en JS), se considera que la
  // intro ha "terminado de aparecer" y se avisa a quien esté
  // escuchando — típicamente main.js, para no arrancar el trabajo
  // pesado de Three.js (creación del renderer, carga de modelos,
  // render loop) hasta que las animaciones CSS de la intro ya no estén
  // compitiendo por el hilo principal.
  const settledListeners = new Set();
  let settled = false;

  function onCompositionSettled(callback) {
    if (settled) {
      callback();
      return () => {};
    }
    settledListeners.add(callback);
    return () => settledListeners.delete(callback);
  }

  button.addEventListener(
    "transitionend",
    () => {
      if (settled) return;
      settled = true;
      settledListeners.forEach((callback) => callback());
      settledListeners.clear();
    },
    { once: true }
  );

  // La clase que dispara toda la aparición escalonada (marco →
  // pregunta → título → línea → significado → botón, ver los
  // transition-delay/@keyframes en styles.css) se añade en el frame
  // siguiente, no en el mismo frame de creación: así el navegador
  // aplica primero el estado inicial (transform de escala 0 / opacity:
  // 0) y la transición CSS se dispara de verdad al pasar a
  // "is-visible", en vez de arrancar ya en su estado final.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add("is-visible");
    });
  });

  // Llamar con un número 0-100 cada vez que cambie el progreso REAL de
  // carga de la escena (ver main.js: viene de THREE.DefaultLoadingManager,
  // nunca de un contador artificial). Mientras `ready` sea `true` no
  // hace nada: una vez terminada la carga, el texto ya es "CARGAR
  // ESCENA" y no debe volver a mostrar un porcentaje.
  //
  // Solo se actualiza si el nuevo valor es MAYOR que el actual: el
  // `itemsTotal` de THREE.LoadingManager puede crecer dinámicamente
  // según se van descubriendo recursos (p. ej. al terminar candle.glb
  // y empezar cat.glb), lo que en algún caso puntual podría hacer que
  // el cálculo baje momentáneamente aunque la carga siga avanzando de
  // verdad. Ignorar los retrocesos evita ese parpadeo sin dejar de
  // reflejar progreso real en ningún momento.
  function setLoadingProgress(percent) {
    if (ready) return;
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (clamped <= loadingProgress) return;
    loadingProgress = clamped;
    renderButtonLabel();
  }

  // Llamar con `true` cuando la escena 3D esté realmente preparada
  // (modelos cargados, shaders precompilados...). El botón sigue
  // siendo visible desde antes (forma parte de la aparición narrativa),
  // pero no se puede pulsar hasta entonces. El cambio de "CARGANDO
  // ESCENA 100%" a "CARGAR ESCENA" se hace con un fundido corto del
  // propio texto (no del botón entero), para que la transición se
  // sienta cuidada en vez de un simple salto de texto.
  function setReady(isReady) {
    const becomingReady = Boolean(isReady) && !ready;
    ready = Boolean(isReady);
    button.disabled = !ready;
    button.classList.toggle("is-ready", ready);

    if (becomingReady) {
      buttonLabel.classList.add("is-swapping");
      window.setTimeout(() => {
        renderButtonLabel();
        buttonLabel.classList.remove("is-swapping");
      }, 220);
    } else {
      renderButtonLabel();
    }
  }

  // Fade-out cinematográfico de toda la intro. `onComplete` se llama
  // justo cuando termina la transición (para encadenar lo que
  // corresponda después, sin que la escena aparezca de golpe a mitad
  // del fundido). Las partículas siguen animándose durante el propio
  // fundido (se desvanecen junto con todo lo demás vía la opacity del
  // overlay) y se destruyen del todo justo aquí, cuando la intro ya ha
  // desaparecido por completo — así no queda ningún
  // requestAnimationFrame, temporizador ni listener de las partículas
  // corriendo de fondo una vez se entra en la escena 3D.
  function fadeOutAndDestroy(onComplete) {
    overlay.classList.add("is-leaving");
    overlay.addEventListener(
      "transitionend",
      () => {
        introParticles.destroy();
        overlay.remove();
        if (onComplete) onComplete();
      },
      { once: true }
    );
  }

  return { setReady, setLoadingProgress, onStart, onCompositionSettled, fadeOutAndDestroy };
}
