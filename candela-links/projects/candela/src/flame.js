import * as THREE from "three";
import { CONFIG, DEBUG } from "./config.js";
import { onUpdate } from "./scene.js";
import { onWickReady } from "./candle.js";
import {
  FLAME_VERTEX_SHADER,
  FLAME_FRAGMENT_SHADER,
  EMBER_VERTEX_SHADER,
  EMBER_FRAGMENT_SHADER,
} from "./flameShader.js";

// -----------------------------------------------------------------------
// FLAME: la llama de la vela, creada íntegramente con Three.js.
//
// Esta vez la llama NO es solo una nube de partículas: el cuerpo
// principal es una malla con un shader procedural (flameShader.js) que
// dibuja la silueta, el degradado de color y la turbulencia. Encima se
// añaden unas pocas partículas de "brasas" para detalle, un halo de luz
// (glow) y la PointLight de la escena.
//
// Todo lo que probablemente quieras tocar —tamaño, forma, colores,
// velocidad, intensidad de luz, duración del encendido/apagado— está en
// CONFIG.flame (config.js), organizado por secciones (shape, turbulence,
// colors, embers, glow, light...). Este archivo se encarga de construir
// esas piezas con Three.js y de actualizarlas cada frame.
//
// La llama empieza SIEMPRE apagada. Otro módulo (más adelante,
// matches.js) decidirá cuándo llamar a flame.ignite().
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// AÑADIDO (integración con el humo): mismo patrón que onWickReady() en
// candle.js — una lista de callbacks a nivel de módulo, no de instancia,
// porque createFlame() solo se llama una vez (igual que createCandle()).
// Se invoca exactamente en el frame en el que la llama termina de
// apagarse (visual pasa de visible a invisible por haberse llamado a
// extinguish() y llegar growth a 0), nunca durante ignite(). No cambia
// nada del comportamiento visual de la llama: solo añade un aviso.
// -----------------------------------------------------------------------
const extinguishedCallbacks = [];
export function onFlameExtinguished(callback) {
  extinguishedCallbacks.push(callback);
}

export function createFlame(scene) {
  const cfg = CONFIG.flame;

  // Grupo raíz: posición de arranque (ver comentario de cfg.position en
  // flame.config.js) hasta que la mecha real esté lista, justo debajo.
  const group = new THREE.Group();
  group.position.set(...cfg.position);
  scene.add(group);

  // Anclaje real: en cuanto candle.js termina de cargar candle.glb y
  // mide la punta real de su mecha (no una posición hardcodeada
  // independiente), la llama se recoloca exactamente ahí, con un
  // pequeño ajuste fino (cfg.wickOffset) para controlar cuánto se hunde
  // visualmente en la mecha. Si candle.glb tardase en cargar, la llama
  // sigue en su posición de arranque hasta entonces — no es un problema
  // en la práctica porque "visual" empieza oculto (visible = false) y
  // solo se ve tras ignite(), momento en el que la mecha ya está lista.
  onWickReady((wickWorld) => {
    group.position.copy(wickWorld);
    group.position.x += cfg.wickOffset[0];
    group.position.y += cfg.wickOffset[1];
    group.position.z += cfg.wickOffset[2];
  });

  // "visual" agrupa todo lo que crece al encender y se encoge al apagar
  // (la malla de la llama, las brasas, el glow), separado del grupo raíz
  // para no mover la luz.
  const visual = new THREE.Group();
  visual.visible = false; // la llama empieza apagada
  group.add(visual);

  const emberTexture = createSoftCircleTexture();
  const glowTexture = createGlowTexture();

  const flameMesh = createFlameMesh(cfg);
  visual.add(flameMesh.group);

  const embers = createParticleLayer(cfg.embers, emberTexture, THREE.AdditiveBlending);
  visual.add(embers.points);

  const glow = createGlow(cfg.glow, glowTexture);
  visual.add(glow.sprite);

  // La luz vive en el grupo raíz (no en "visual") para que el balanceo
  // de la llama no arrastre las sombras de golpe; solo la movemos con un
  // temblor propio, muy sutil, más abajo.
  const flameLight = createFlameLight(cfg.light);
  group.add(flameLight);

  // Marcador técnico, solo para desarrollo. Nunca tiene aspecto de fuego
  // ni de halo: es una pequeña cruz de líneas + un puntito wireframe.
  // Requiere DEBUG (global, config.js) Y cfg.showDebugMarker (propio de
  // la llama, en false por defecto) — ver la explicación completa junto
  // a showDebugMarker en flame.config.js. Antes bastaba con DEBUG=true
  // para que apareciera, sin forma de aislarlo del resto del proyecto.
  if (DEBUG && cfg.showDebugMarker) {
    group.add(createDebugMarker(cfg.debugMarkerColor));
  }

  // Ruido suave para el parpadeo: en vez de un simple seno (que se
  // repite de forma predecible, tipo "sube-baja-sube-baja"), generamos
  // un valor que varía de forma continua pero irregular. Se usa tanto
  // para la intensidad de la luz como para el brillo del shader de la
  // llama (uFlicker), y con otras dos "semillas" para un ligerísimo
  // temblor de la posición de la luz.
  const flickerNoise = createSmoothNoise1D(11);
  const jitterNoiseX = createSmoothNoise1D(53);
  const jitterNoiseZ = createSmoothNoise1D(97);

  // ---- Estado de la llama ----
  let isLit = false;
  let elapsedTime = 0;

  // "growth" va de 0 (apagada) a 1 (encendida del todo) y se mueve solo,
  // acercándose a su objetivo cada frame. Con un único número
  // conseguimos tanto el encendido progresivo como el apagado, sin tener
  // que programar cada transición por separado.
  let growth = 0;
  // Recuerda si la llama era visible en el frame anterior, únicamente
  // para poder detectar el instante exacto en el que deja de serlo (ver
  // "wasVisible && !visible" en update()). No afecta a nada más.
  let wasVisible = false;

  // -----------------------------------------------------------------------
  // SURGE (añadido para el final de Candela): un empuje temporal de
  // intensidad/escala/turbulencia, gobernado desde fuera con setSurge(),
  // TOTALMENTE separado de "growth"/isLit de arriba. growth sigue
  // decidiendo si la llama está encendida o apagada exactamente igual
  // que siempre (ignite()/extinguish()/getLightProgress() no cambian de
  // comportamiento); surge es un multiplicador ADICIONAL, pensado para
  // que la llama ya encendida pueda "acumular energía" antes de que
  // nazcan las partículas del sobre, sin apagarla ni volver a encenderla.
  // Con surge=0 (su valor por defecto) el resultado de update() es
  // exactamente el mismo que antes de este añadido — ver los tres
  // puntos donde se usa más abajo, todos con la forma
  // "(1 + surge * cfg.surge.algo)".
  // -----------------------------------------------------------------------
  let surge = 0;

  // ITERACIÓN ("llama agresiva" — más pulsaciones + contracción final):
  // el rango admitido ahora baja hasta -1, no solo 0..1. Con surge=0 el
  // comportamiento es exactamente el mismo que siempre (sin cambios);
  // un valor NEGATIVO reduce `surgeScale`/la luz por DEBAJO de su nivel
  // normal (ver las tres fórmulas "(1 + surge * cfg.surge.algo)" más
  // abajo), que es precisamente lo que usa candelaFinale.js para la
  // pulsación final "pequeña" (ver cfg.flameSurge.dipDepth en
  // finale.config.js) — nunca se usa fuera de ese rango pequeño y
  // controlado, pero la función en sí admite hasta -1 por simetría con
  // el +1 ya existente.
  function setSurge(value) {
    surge = Math.max(-1, Math.min(1, value));
  }

  // -----------------------------------------------------------------------
  // SURGE DEFORM (añadido para el final de Candela — iteración visual:
  // "la llama debe reaccionar/desestabilizarse", no solo crecer de
  // tamaño). Un segundo estado, TOTALMENTE separado de `surge` de
  // arriba: `surge` controla intensidad/escala UNIFORME/parpadeo;
  // `surgeDeform` añade una pequeña inclinación (rotation.x/z) y una
  // variación de anchura/altura INDEPENDIENTE por eje, gobernadas desde
  // fuera con setSurgeDeform(). Con su valor por defecto (identidad —
  // sin inclinación, escala ×1 en cada eje) el resultado de update() es
  // exactamente el mismo que antes de este añadido.
  //
  // Se aplica sobre "visual" (el grupo que ya envuelve malla + brasas +
  // glow) rotando/escalando alrededor de su ORIGEN LOCAL, que coincide
  // con la base real de la llama sobre la mecha (ver el comentario junto
  // a "pivote en la base, no en el centro" en createFlameMesh() más
  // abajo) — por eso una rotación aquí mantiene la base anclada y hace
  // que la punta se mueva más cuanto más crece la llama, sin necesidad
  // de desplazar `visual.position` (que si moviera la base, ver el
  // comentario de más abajo sobre por qué el balanceo se dejó en manos
  // del shader en su momento).
  // -----------------------------------------------------------------------
  const surgeDeformIdentity = { tiltX: 0, tiltZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 };
  let surgeDeform = { ...surgeDeformIdentity };

  function setSurgeDeform(deform) {
    if (!deform) {
      surgeDeform = { ...surgeDeformIdentity };
      return;
    }
    surgeDeform = {
      tiltX: deform.tiltX ?? 0,
      tiltZ: deform.tiltZ ?? 0,
      scaleX: deform.scaleX ?? 1,
      scaleY: deform.scaleY ?? 1,
      scaleZ: deform.scaleZ ?? 1,
    };
  }

  function ignite() {
    if (isLit) return;
    isLit = true;
    // Reiniciamos las brasas para que el encendido se vea como una mecha
    // que acaba de prender, no partículas ya a medio recorrido.
    embers.reset();
  }

  function extinguish() {
    isLit = false;
  }

  function update(delta) {
    elapsedTime += delta;

    const target = isLit ? 1 : 0;
    const duration = isLit ? cfg.light.igniteDuration : cfg.light.extinguishDuration;
    // Acerca "growth" a "target" cada frame, de forma suave e
    // independiente de los FPS del navegador.
    const step = 1 - Math.pow(0.001, delta / duration);
    growth += (target - growth) * step;
    if (Math.abs(target - growth) < 0.0008) growth = target;

    const visible = growth > 0.001;

    // Justo el frame en el que la llama termina de apagarse (era visible,
    // ahora ya no). Con isLit=false en ese punto por construcción (solo
    // ocurre cuando growth persigue el objetivo 0, es decir, tras
    // extinguish()), así que nunca se dispara durante/tras ignite().
    if (wasVisible && !visible) {
      extinguishedCallbacks.forEach((callback) => callback());
    }
    wasVisible = visible;

    visual.visible = visible;

    if (!visible) {
      flameLight.intensity = 0;
      return;
    }

    // surgeScale: crecimiento EXTRA por encima del tamaño normal
    // (growth=1), gobernado por `surge` (ver setSurge() más arriba). Con
    // surge=0 esto es exactamente `growth`, igual que antes de este
    // añadido.
    const surgeScale = growth * (1 + surge * cfg.surge.scaleBoost);
    // surgeDeform: inclinación + variación de anchura/altura INDEPENDIENTE
    // por eje (ver bloque de comentarios "SURGE DEFORM" más arriba). Con
    // su valor por defecto (identidad) esto es exactamente
    // `visual.scale.setScalar(surgeScale)` y `visual.rotation` en (0,0,0),
    // igual que antes de este añadido — nunca se toca `visual.position`
    // (la base debe seguir exactamente sobre la mecha).
    visual.scale.set(
      surgeScale * surgeDeform.scaleX,
      surgeScale * surgeDeform.scaleY,
      surgeScale * surgeDeform.scaleZ
    );
    visual.rotation.set(surgeDeform.tiltX, 0, surgeDeform.tiltZ);

    // (El balanceo de la llama ahora lo aporta el propio shader —ver
    // flameShader.js—, curvando la malla de verdad y manteniendo la base
    // anclada a la mecha. Ya no desplazamos aquí el grupo entero, porque
    // eso movía también la base y la separaba de la mecha.)

    // Parpadeo orgánico compartido por la luz y el shader de la llama.
    const flickerRaw = flickerNoise(elapsedTime * cfg.light.flickerSpeed); // entre -1 y 1
    const flicker = flickerRaw * cfg.light.flickerStrength;

    // surgeFlicker: turbulencia/parpadeo EXTRA proporcional a `surge`
    // (ver setSurge() más arriba), que se SUMA al flicker normal, nunca
    // lo sustituye — con surge=0 llega exactamente el mismo valor que
    // antes de este añadido a flameMesh.update()/flameLight.
    const surgeFlicker = surge * cfg.surge.flickerBoost;

    flameMesh.update(elapsedTime, growth, 1 + flicker * 0.5 + surgeFlicker);
    embers.update(delta, elapsedTime);
    glow.update(growth);

    flameLight.intensity = Math.max(
      0,
      cfg.light.maxIntensity * growth * (1 + flicker) * (1 + surge * cfg.surge.lightBoost)
    );
    flameLight.position.set(
      jitterNoiseX(elapsedTime * 1.7) * cfg.light.positionJitter,
      cfg.light.height,
      // depthOffset desplaza la luz hacia delante (+Z, hacia cámara,
      // alejándola de la pared del fondo y de detrás de la vela) — ver
      // la explicación completa junto a "depthOffset" en
      // flame.config.js. Solo afecta a la LUZ: la malla de la llama y
      // el glow siguen exactamente anclados a la mecha, sin moverse.
      cfg.light.depthOffset + jitterNoiseZ(elapsedTime * 1.3) * cfg.light.positionJitter
    );
  }

  // Se engancha al render loop existente en scene.js, sin tocar ese
  // archivo ni el bucle de animación.
  onUpdate(update);

  // ---- API pública ----
  // getLightProgress() expone el MISMO "growth" (0..1) que ya gobierna
  // flameLight.intensity un poco más arriba — no es un valor nuevo ni
  // una copia recalculada, es una lectura directa de la variable
  // interna real. Añadido para que otros sistemas (cat.js) puedan
  // engancharse al estado REAL de iluminación de la vela, frame a
  // frame, en vez de reaccionar a eventos puntuales (ignite/extinguish)
  // con su propia animación independiente — eso es precisamente lo que
  // causaba el desfase de sincronía del gato (ver cat.js). No expone
  // `isLit` como progreso (eso sería un booleano, no la curva real) ni
  // el `flameLight.intensity` final (que incluye el flicker aleatorio
  // frame a frame; un consumidor externo mirando esa señal vería un
  // parpadeo constante en vez de la curva macro de encendido/apagado).
  // No modifica nada de la PointLight ni del shader: solo lectura.
  return {
    ignite,
    extinguish,
    isLit: () => isLit,
    getLightProgress: () => growth,
    // setSurge(0..1): ver el bloque de comentarios "SURGE" más arriba.
    // Añadido para el final de Candela (llama acumulando energía antes
    // de crear el sobre) — no afecta a ignite()/extinguish()/
    // getLightProgress(), y con surge=0 (estado por defecto) la llama
    // se comporta exactamente igual que antes de este añadido.
    setSurge,
    // setSurgeDeform({tiltX,tiltZ,scaleX,scaleY,scaleZ} | null): ver el
    // bloque de comentarios "SURGE DEFORM" más arriba. Añadido en la
    // iteración visual del final (llama reaccionando/desestabilizándose
    // antes del surge) — totalmente independiente de setSurge(); con
    // deform=null (o sin llamarlo nunca) el resultado es exactamente el
    // mismo que antes de este añadido.
    setSurgeDeform,
  };
}

// -----------------------------------------------------------------------
// Cuerpo principal de la llama: varias "hojas" planas, cruzadas alrededor
// del eje vertical. Antes TODAS compartían un único material (mismo
// patrón de ruido, solo rotado en el espacio): vista de frente, la llama
// era literalmente la misma silueta repetida. Ahora cada hoja tiene su
// PROPIO material (mismas fórmulas de flameShader.js, clonado desde una
// plantilla) con su propia semilla de ruido (uPlaneSeed): al superponer
// patrones distintos con blending aditivo se consigue sensación de
// volumen, no una forma plana repetida.
// -----------------------------------------------------------------------
function createFlameMesh(cfg) {
  const shape = cfg.shape;
  const turb = cfg.turbulence;
  const colors = cfg.colors;

  // Ancho físico de cada "hoja": algo mayor que la anchura máxima de la
  // llama, para dejar margen a la turbulencia sin recortar la silueta.
  const planeWidth = shape.bodyWidth * 2.6;
  const planeHeight = shape.height;

  const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 1, 48);
  geometry.translate(0, planeHeight / 2, 0); // pivote en la base, no en el centro

  const templateMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGrowth: { value: 0 },
      uFlicker: { value: 1 },
      uPlaneWidth: { value: planeWidth },
      uBaseWidth: { value: shape.baseWidth },
      uBodyWidth: { value: shape.bodyWidth },
      uBulgeHeight: { value: shape.bulgeHeight },
      uTipSharpness: { value: shape.tipSharpness },
      uTipSplitStrength: { value: shape.tipSplitStrength },
      uTipSplitScale: { value: shape.tipSplitScale },
      uStretchSpeed: { value: shape.stretchSpeed },
      uStretchStrength: { value: shape.stretchStrength },
      uTwistScale: { value: shape.twistScale },
      uTwistSpeed: { value: shape.twistSpeed },
      uTwistStrength: { value: shape.twistStrength },
      uSlowScale: { value: turb.slowScale },
      uSlowSpeed: { value: turb.slowSpeed },
      uSlowStrength: { value: turb.slowStrength },
      uFastScale: { value: turb.fastScale },
      uFastSpeed: { value: turb.fastSpeed },
      uFastStrength: { value: turb.fastStrength },
      uTipMultiplier: { value: turb.tipMultiplier },
      uTipChaos: { value: turb.tipChaos },
      uMidScale: { value: turb.midScale },
      uMidSpeed: { value: turb.midSpeed },
      uMidStrength: { value: turb.midStrength },
      uEdgeScale: { value: turb.edgeScale },
      uEdgeSpeed: { value: turb.edgeSpeed },
      uEdgeStrength: { value: turb.edgeStrength },
      uFieldScaleX: { value: turb.fieldScaleX },
      uFieldScaleY: { value: turb.fieldScaleY },
      uFieldSpeed: { value: turb.fieldSpeed },
      uFieldWarpScale: { value: turb.fieldWarpScale },
      uFieldWarpSpeed: { value: turb.fieldWarpSpeed },
      uFieldWarpStrength: { value: turb.fieldWarpStrength },
      uFieldStrength: { value: turb.fieldStrength },
      uHotspotDrift: { value: turb.hotspotDrift },
      uHotspotSpeed: { value: turb.hotspotSpeed },
      uHeatTurbulence: { value: turb.heatTurbulence },
      uHeatRiseStart: { value: turb.heatRiseStart },
      uHeatRiseEnd: { value: turb.heatRiseEnd },
      uHeatFallStart: { value: turb.heatFallStart },
      uHeatFallEnd: { value: turb.heatFallEnd },
      uOuterStart: { value: colors.outerStart },
      uOuterAlpha: { value: colors.outerAlpha },
      // Corrección de sobreexposición aditiva — ver comentario extenso
      // junto a "coreLayerNormalize" en flame.config.js y su aplicación
      // (dependiente del calor, no un multiplicador plano) en
      // flameShader.js.
      uCoreLayerNormalize: { value: colors.coreLayerNormalize ?? 0.3 },
      uBlueHeight: { value: colors.blueHeight },
      uBlueRadius: { value: colors.blueRadius },
      uBlueStrength: { value: colors.blueStrength },
      uBlueHeatSuppress: { value: colors.blueHeatSuppress },
      uBlueBrightness: { value: colors.blueBrightness ?? 1.6 },
      uPlaneSeed: { value: 0 },
      uColorCore: { value: new THREE.Color(colors.core) },
      uColorYellow: { value: new THREE.Color(colors.yellow) },
      uColorOrange: { value: new THREE.Color(colors.orange) },
      uColorEdge: { value: new THREE.Color(colors.edge) },
      uColorBlue: { value: new THREE.Color(colors.blue) },
    },
    vertexShader: FLAME_VERTEX_SHADER,
    fragmentShader: FLAME_FRAGMENT_SHADER,
    transparent: true,
    // depthTest:true (revisado esta iteración, dejado explícito aunque
    // coincide con el valor por defecto): la llama SÍ debe respetar el
    // depth buffer que ya escribió la mecha (objeto opaco, se dibuja
    // antes). Así, allí donde la mecha esté físicamente más cerca de la
    // cámara que un fragmento de la llama, la mecha gana y se ve — y allí
    // donde la llama (que envuelve la mecha en 3D, no es un plano
    // delante) esté más cerca o a la misma profundidad, se dibuja encima
    // mezclándose de forma aditiva. Es la integración real: NO ocultar
    // la mecha poniendo la llama delante a la fuerza (eso sería
    // desactivar el depth test o forzar el orden de dibujado), sino
    // dejar que la propia geometría 3D decida, píxel a píxel, quién se
    // ve en cada punto.
    depthTest: true,
    // depthWrite:false: los fragmentos de la llama NO escriben en el
    // depth buffer. Si lo hicieran, la primera "hoja" cruzada dibujada
    // taparía a las demás (y a las brasas, y al glow) por delante,
    // aunque todas sean semitransparentes — con blending aditivo varias
    // capas deben poder sumarse todas entre sí sin taparse unas a otras.
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  // 6 hojas cruzadas (antes 4): más ángulos de cruce y, sobre todo, más
  // patrones de ruido distintos superpuestos (ver más abajo), para una
  // silueta con más presencia y profundidad aparente.
  const planeCount = 6;
  const group = new THREE.Group();
  const materials = [];
  for (let i = 0; i < planeCount; i++) {
    // clone() copia también los uniforms (colores, forma...), así que
    // cada hoja parte de los mismos valores de CONFIG.flame; solo
    // uPlaneSeed cambia por hoja, para desincronizar su ruido del resto.
    const material = i === 0 ? templateMaterial : templateMaterial.clone();
    material.uniforms.uPlaneSeed.value = i * 7.13 + 1.0;
    materials.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = (Math.PI / planeCount) * i;
    group.add(mesh);
  }

  function update(elapsedTime, growth, flicker) {
    for (let i = 0; i < materials.length; i++) {
      const uniforms = materials[i].uniforms;
      uniforms.uTime.value = elapsedTime;
      uniforms.uGrowth.value = growth;
      uniforms.uFlicker.value = flicker;
    }
  }

  return { group, materials, update };
}

// -----------------------------------------------------------------------
// Perfil de anchura auxiliar usado por las brasas, para que se muevan
// dentro de una silueta parecida a la de la llama principal (estrecha en
// la base, algo más ancha a media altura, y se cierra hacia la punta).
// -----------------------------------------------------------------------
function flameRadiusProfile(t) {
  if (t < 0.3) {
    return 0.1 + (t / 0.3) * 0.9;
  }
  const shrink = (t - 0.3) / 0.7;
  return Math.max(0, Math.pow(1 - shrink, 1.3));
}

// -----------------------------------------------------------------------
// Partículas de brasas/detalle. La misma lógica de siempre: cada
// partícula nace cerca de la mecha, sube, se desvanece, y vuelve a nacer,
// con su propia velocidad, tamaño y fase de balanceo.
// -----------------------------------------------------------------------
function createParticleLayer(cfg, texture, blending) {
  const count = cfg.count;

  const positions = new Float32Array(count * 3);
  const particleColors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);

  const state = [];

  function resetParticle(i) {
    const speed =
      cfg.riseSpeed * (1 - cfg.speedVariation + Math.random() * 2 * cfg.speedVariation);

    state[i] = {
      angle: Math.random() * Math.PI * 2,
      radiusFactor: 0.3 + Math.random() * 0.7,
      sizeFactor: cfg.minSizeFactor + Math.random() * (cfg.maxSizeFactor - cfg.minSizeFactor),
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSpeed: 1.5 + Math.random() * 2.5,
      speed,
      life: 0,
      maxLife: cfg.height / speed,
    };
  }

  function reset() {
    for (let i = 0; i < count; i++) resetParticle(i);
  }
  reset();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("particleColor", new THREE.BufferAttribute(particleColors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      pixelHeight: { value: window.innerHeight },
    },
    vertexShader: EMBER_VERTEX_SHADER,
    fragmentShader: EMBER_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending,
  });

  const points = new THREE.Points(geometry, material);

  const colorNear = new THREE.Color(cfg.colorNear);
  const colorFar = new THREE.Color(cfg.colorFar);
  const tmpColor = new THREE.Color();

  function update(delta, elapsedTime) {
    const positionAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.particleColor;
    const sizeAttr = geometry.attributes.size;
    const alphaAttr = geometry.attributes.alpha;

    for (let i = 0; i < count; i++) {
      const p = state[i];
      p.life += delta;
      if (p.life >= p.maxLife) resetParticle(i);

      const t = state[i].life / state[i].maxLife;

      const envelope = flameRadiusProfile(t) * cfg.maxRadius * state[i].radiusFactor;
      const wobble =
        Math.sin(elapsedTime * state[i].wobbleSpeed + state[i].wobblePhase) *
        cfg.wobbleAmount *
        t;

      const x = Math.cos(state[i].angle) * envelope + wobble;
      const z = Math.sin(state[i].angle) * envelope + wobble * 0.6;
      const y = t * cfg.height;
      positionAttr.setXYZ(i, x, y, z);

      tmpColor.copy(colorNear).lerp(colorFar, t);
      colorAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);

      sizeAttr.setX(i, cfg.particleSize * state[i].sizeFactor * (0.7 + 0.3 * (1 - t)));

      const fadeIn = Math.min(t / 0.08, 1);
      const fadeOut = 1 - Math.pow(Math.max(0, (t - 0.6) / 0.4), 2);
      alphaAttr.setX(i, cfg.opacity * Math.max(0, Math.min(fadeIn, fadeOut)));
    }

    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;

    material.uniforms.pixelHeight.value = window.innerHeight;
  }

  return { points, update, reset };
}

// -----------------------------------------------------------------------
// Texturas procedurales (generadas por Canvas, sin imágenes externas):
// una mancha pequeña y bastante definida para las brasas, y un halo
// mucho más grande y difuso (muchos más pasos de degradado) para el
// glow, para que no se note ningún borde de círculo.
// -----------------------------------------------------------------------
function createSoftCircleTexture(size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createGlowTexture(size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.2, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.22)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.06)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// -----------------------------------------------------------------------
// Halo de luz muy sutil alrededor de la llama (un único sprite). Al usar
// una textura con una caída de opacidad muy larga (createGlowTexture) no
// se percibe ningún borde de círculo, solo un resplandor que se pierde
// gradualmente.
// -----------------------------------------------------------------------
function createGlow(cfg, texture) {
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: cfg.color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.set(0, cfg.height, 0);
  sprite.scale.set(cfg.size, cfg.size, 1);

  function update(growth) {
    material.opacity = cfg.opacity * growth;
    const scale = cfg.size * (0.75 + 0.25 * growth);
    sprite.scale.set(scale, scale, 1);
  }

  return { sprite, update };
}

// -----------------------------------------------------------------------
// Luz cálida de la llama.
// -----------------------------------------------------------------------
function createFlameLight(cfg) {
  // decay como 4º argumento explícito (antes no se pasaba, así que
  // usaba el valor por defecto de Three.js, 2 — físicamente correcto
  // pero deja el suelo/zonas lejanas casi sin luz por cercana que esté
  // la pared; ver la explicación completa junto a "decay" en
  // flame.config.js).
  const light = new THREE.PointLight(cfg.color, 0, cfg.distance, cfg.decay);
  light.position.set(0, cfg.height, 0);
  light.castShadow = true;
  light.shadow.radius = 4; // sombras suaves
  light.shadow.mapSize.set(1024, 1024);
  // Corrige el acné de sombra (línea de corte dura en superficies
  // curvas que se hacen sombra a sí mismas, como el cuerpo de la vela)
  // — ver la explicación completa junto a "shadowBias"/"shadowNormalBias"
  // en flame.config.js.
  light.shadow.bias = cfg.shadowBias;
  light.shadow.normalBias = cfg.shadowNormalBias;
  return light;
}

// -----------------------------------------------------------------------
// Ruido suave en 1D, para el parpadeo. En vez de números aleatorios "a
// saco" (que darían saltos bruscos) o un seno puro (que se repite de
// forma predecible), generamos valores aleatorios a intervalos fijos y
// los interpolamos suavemente entre sí. El resultado varía de forma
// continua e irregular, como el parpadeo real de una llama.
// -----------------------------------------------------------------------
function createSmoothNoise1D(seed) {
  let seedValue = seed;

  function random() {
    // Generador de números pseudoaleatorios sencillo y determinista
    // (para que el comportamiento sea reproducible, no un caos distinto
    // cada vez que se recarga la página).
    seedValue = (seedValue * 9301 + 49297) % 233280;
    return seedValue / 233280;
  }

  const step = 1; // cada cuántos "segundos de tiempo" cambia el valor objetivo
  let previous = random() * 2 - 1;
  let next = random() * 2 - 1;
  let lastIndex = 0;

  return function sample(t) {
    const index = Math.floor(t / step);
    if (index !== lastIndex) {
      previous = next;
      next = random() * 2 - 1;
      lastIndex = index;
    }
    const localT = t / step - index;
    const smooth = localT * localT * (3 - 2 * localT); // suaviza la transición
    return previous + (next - previous) * smooth;
  };
}

// -----------------------------------------------------------------------
// Marcador de desarrollo: una pequeña cruz de líneas + un puntito
// wireframe, deliberadamente técnico (nunca naranja, nunca relleno, no
// emite luz). Solo se crea si DEBUG === true Y cfg.showDebugMarker
// === true (ver flame.config.js).
// -----------------------------------------------------------------------
function createDebugMarker(color) {
  const group = new THREE.Group();
  const lineMaterial = new THREE.LineBasicMaterial({ color });

  const armLength = 0.025;
  const axes = [
    [new THREE.Vector3(-armLength, 0, 0), new THREE.Vector3(armLength, 0, 0)],
    [new THREE.Vector3(0, 0, -armLength), new THREE.Vector3(0, 0, armLength)],
    [new THREE.Vector3(0, -armLength * 0.4, 0), new THREE.Vector3(0, armLength * 0.4, 0)],
  ];

  axes.forEach(([from, to]) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    group.add(new THREE.Line(geometry, lineMaterial));
  });

  const dotGeometry = new THREE.SphereGeometry(0.004, 6, 6);
  const dotMaterial = new THREE.MeshBasicMaterial({ color, wireframe: true });
  group.add(new THREE.Mesh(dotGeometry, dotMaterial));

  return group;
}