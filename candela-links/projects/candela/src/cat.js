import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CONFIG } from "./config.js";
import { onUpdate } from "./scene.js";

// -----------------------------------------------------------------------
// CAT: infraestructura del gato 3D. Prepara la carga del modelo, su
// colocación en la escena y un sistema de brillo que sigue, frame a
// frame, el estado REAL de iluminación de la vela (ver
// options.getLightProgress, inyectado desde scene.js como
// flame.getLightProgress — este módulo sigue sin importar flame.js
// directamente, ni conocer nada de su implementación interna, solo
// consume la función que le pasan). No hay ninguna animación propia
// del gato con su propia duración: si la vela cambia de curva o de
// duración, el gato la sigue automáticamente, sin tocar este archivo.
//
// MODELO: "Sleeping Cat" (ver atribución en PROJECT_STATE.md). A
// diferencia del modelo anterior ("Calico Cami"), este es una malla
// ESTÁTICA: no tiene esqueleto ni animaciones, y ya viene modelada en
// su pose definitiva de gato dormido/enroscado. Por eso este archivo ya
// NO contiene ninguna lógica de huesos/skinning/postura manual: cargar,
// escalar y apoyar en el suelo es suficiente, exactamente el mismo
// patrón que usa candle.js para la vela.
// -----------------------------------------------------------------------

export function createCat(scene, options = {}) {
  const cfg = CONFIG.cat;

  // ---- Dependencia: estado REAL de iluminación de la vela ----
  // getLightProgress debe ser una función que devuelva 0..1 — el mismo
  // "growth" que flame.js usa para flameLight.intensity (ver
  // flame.js/getLightProgress). Es una dependencia obligatoria, no
  // opcional: la premisa completa de este archivo es que el brillo del
  // gato sea una función del estado REAL de la luz, no de una
  // animación propia con su propia duración supuesta. Si faltara,
  // preferimos fallar alto y claro en vez de inventar silenciosamente
  // un valor fijo o una animación de reemplazo que reintroduciría
  // exactamente el bug que se está corrigiendo.
  const { getLightProgress } = options;
  if (typeof getLightProgress !== "function") {
    throw new Error(
      "[cat.js] createCat requiere options.getLightProgress (función 0..1) para saber cuánta luz real está recibiendo del entorno — ver scene.js, donde se pasa flame.getLightProgress."
    );
  }

  const group = new THREE.Group();
  group.position.set(...cfg.position);
  group.rotation.y = cfg.rotationY;
  scene.add(group);

  // Objeto que devolvemos ya mismo, aunque el modelo tarde en cargar.
  // Mismo criterio que candle.js: `model` empieza en null y se rellena
  // cuando/si termina la carga.
  const cat = {
    group,
    model: null,
    isPlaceholder: false,
  };

  // ---- Override manual (solo depuración) ----
  // Por defecto (null) el brillo sigue en vivo, cada frame, a
  // getLightProgress() — esa es la vía normal, automática, de
  // producción, y ya no hay ningún otro camino paralelo para ella. Los
  // tres métodos públicos de abajo (reveal/hide/setRevealProgress) NO
  // se usan ya en el flujo automático de main.js (que se limita a
  // llamar a flame.ignite()/extinguish() — el gato los sigue solo,
  // sin que nadie tenga que avisarle por separado); se conservan
  // únicamente como utilidad manual de consola, tal como ya documentaba
  // el comentario de window.candela en main.js (candela.cat.reveal() /
  // .hide() / .setRevealProgress(0.5)). Al usarlas se fija un valor
  // constante que IGNORA la luz real hasta que se recargue la página —
  // coherente con lo que ya hacían antes (tampoco había antes forma de
  // "soltar" un setRevealProgress manual).
  let manualProgress = null;

  function currentProgress() {
    return manualProgress !== null ? manualProgress : clamp01(getLightProgress());
  }

  // ---- Materiales rastreados ----
  // Se guarda una referencia a los materiales del modelo (o del
  // placeholder) para poder variar su opacidad/emisión cada frame sin
  // recorrer todo el grafo de nuevo en cada tick.
  let trackedMaterials = [];

  // ---- Respiración ----
  // El efecto de respiración NO se consigue moviendo `model.scale` (eso
  // escalaría TODA la malla, incluido el cojín, que está soldado al
  // gato en el mismo .glb — ver la nota larga en CAT_CONFIG.breathing).
  // `model.scale` se fija una única vez al cargar (más abajo) a partir
  // de `targetHeight` y ya no se vuelve a tocar nunca — la escala base
  // del gato queda exactamente fija.
  //
  // En su lugar, se inyecta un fragmento de vertex shader en el
  // material del modelo (ver `attachBreathingShader` más abajo) que
  // desplaza solo los vértices de la zona alta (el cuerpo) según
  // `CAT_CONFIG.breathing.bodyMask*`; cada material único que aparezca
  // en el modelo obtiene su propio uniform `uBreathAmount`, guardado
  // aquí en `breathingShaderUniforms` para poder actualizarlo cada
  // frame desde `update()`.
  //
  // `breathingElapsed` corre desde la creación del gato (no solo
  // cuando está revelado), para que la respiración esté "en marcha"
  // constantemente. El revelado (brillo, vía `trackedMaterials`) y la
  // respiración (shader) son mecanismos totalmente independientes que
  // no se pisan entre sí: uno toca `material.color`, el otro solo
  // `transformed.xy` dentro del vertex shader.
  let breathingElapsed = 0;
  let breathingShaderUniforms = [];

  // ---- (Sin luz propia) ----
  // Antes había aquí una PointLight de "relleno" propia del gato,
  // independiente de la de la llama (flame.js). Se ha retirado: el
  // material del gato es MeshBasicMaterial (KHR_materials_unlit) y NO
  // reacciona a ninguna luz, así que esa PointLight nunca iluminó al
  // gato en sí — solo añadía luz cálida duplicada alrededor suyo (suelo/
  // cojín), reproduciendo con un número/temporización propios el mismo
  // efecto que ya hace la PointLight REAL de la llama (flame.js) al
  // encenderse. Esa duplicación era, además, parte del bug: al arrancar
  // `progress` en 1 (ver initialProgress en cat.config.js), esta luz se
  // encendía a máxima intensidad desde la carga de la página, reforzando
  // la sensación de "vela encendida" sin que lo estuviera. La iluminación
  // cálida real de la escena la aporta ahora, en exclusiva, la PointLight
  // de flame.js — sin fuentes paralelas que mantener sincronizadas.

  // ---- Placeholder de desarrollo ----
  // Ver la nota extensa en cat.config.js: bloque autocontenido, pensado
  // para desaparecer sin rastro en cuanto exista el modelo real. Solo se
  // usa si la carga del modelo real falla y placeholder.enabled es true.
  // Se guarda una referencia directa al mesh (en vez de buscarlo luego
  // por tipo/color) para poder retirarlo de forma fiable.
  let placeholderMesh = null;

  function createPlaceholder() {
    const geometry = new THREE.SphereGeometry(cfg.placeholder.size, 12, 10);
    const material = new THREE.MeshStandardMaterial({
      color: cfg.placeholder.color,
      roughness: 0.9,
      transparent: false,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = cfg.placeholder.size;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    placeholderMesh = mesh;
    cat.isPlaceholder = true;
    trackedMaterials = [material];
  }

  // ---- Carga del modelo real ----
  const loader = new GLTFLoader();

  loader.load(
    cfg.modelPath,
    (gltf) => {
      const model = gltf.scene;

      // CORREGIDO (comisuras/"dientes" visibles alrededor del cojín):
      // ver la función `relaxDegenerateSeamVertices` más abajo para el
      // diagnóstico completo. En resumen, el .glb trae una tapa de
      // relleno tosca (pocos vértices, muy separados) en la base del
      // cojín, añadida automáticamente al exportar/decimar el modelo
      // en Sketchfab — no es un problema de textura, sombra ni
      // iluminación, es geometría real mal triangulada. Se corrige
      // aquí, en memoria, ANTES de medir el Box3 de más abajo, para
      // que el auto-escalado a `targetHeight` y el apoyo en el suelo
      // sigan funcionando exactamente igual que siempre pero ya sobre
      // la geometría corregida.
      const realMeshes = [];
      model.traverse((child) => {
        if (child.isMesh) realMeshes.push(child);
      });
      relaxDegenerateSeamVertices(realMeshes);

      // Mismo criterio que candle.js: se mide el modelo cargado y se
      // escala automáticamente para alcanzar targetHeight, sea cual sea
      // el tamaño original del archivo. El modelo ya está en su pose
      // final (dormido/enroscado), así que esta altura medida es
      // directamente la altura final visible en la escena — no una
      // referencia "de pie" como pasaba con el modelo anterior.
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);

      // Si el modelo viniera vacío o con tamaño 0 (poco probable, pero
      // más seguro que dividir por cero), se deja sin reescalar.
      if (size.y > 0) {
        const scaleFactor = cfg.targetHeight / size.y;
        model.scale.setScalar(scaleFactor);
      }

      // ---- Apoyo en el suelo ----
      // Malla estática sin esqueleto: a diferencia del modelo anterior,
      // aquí THREE.Box3().setFromObject() SÍ es válido para medir dónde
      // debe tocar el suelo (no hay deformación de skinning que tener
      // en cuenta). Mismo cálculo que usa candle.js.
      const scaledBox = new THREE.Box3().setFromObject(model);
      model.position.y -= scaledBox.min.y;

      const materials = [];
      const uniqueMaterials = new Set();

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          // Aseguramos que el material admita el sistema de revelado
          // sin asumir qué tipo de material trae el .glb. Este modelo
          // usa KHR_materials_unlit (iluminación horneada en la
          // textura), que GLTFLoader traduce a MeshBasicMaterial: no
          // tiene `emissiveIntensity`, así que el boost de emisión de
          // reveal() se ignora automáticamente para él (ver update()
          // más abajo) sin que haga falta ningún caso especial aquí.
          //
          // CORREGIDO (bug de "desvanecimiento"): opacity fija en 1 y
          // transparent en false — el gato es SIEMPRE sólido. El
          // apagado de iluminación ya no lo hace la opacidad ni un
          // tinte de color, lo hace un escalar de luminosidad neutro
          // (ver materialBrightnessFor / update() más abajo).
          const applyToMaterial = (mat) => {
            mat.transparent = false;
            mat.opacity = 1;
            if (mat.color) {
              mat.color.copy(materialBrightnessFor(currentProgress(), cfg));
            }

            // CORREGIDO (comisuras/líneas visibles alrededor del cojín):
            // el .glb de "Sleeping Cat" no trae un único mesh limpio de
            // gato+cojín, trae 3 primitivas (Object_0/1/2) troceadas de
            // forma arbitraria por el exportador de Sketchfab — sus
            // bounding boxes se solapan casi por completo, no es una
            // separación espacial gato/cojín. Analizando el binario del
            // .glb se confirmó que, en los vértices donde esas 3
            // primitivas coinciden EXACTAMENTE en posición (no hay
            // grieta/hueco geométrico real), hay dos inconsistencias:
            //   1) Normales: ~17% de esos vértices tienen normales que
            //      difieren >25° entre primitivas (algunas casi
            //      invertidas). Como el gato hace castShadow +
            //      receiveShadow bajo el PointLight de la vela (mismo
            //      light que ya causaba "shadow acne" en la vela, ver
            //      shadowBias/shadowNormalBias en flame.config.js), esto
            //      genera autosombreado errático justo en esas costuras.
            //   2) UVs: >50% de esos mismos vértices tienen coordenadas
            //      UV muy distintas en el atlas (la textura horneada de
            //      8192x8192 empaqueta el cojín en "islas" UV pegadas
            //      entre sí y al pelaje). Con mipmapping, la GPU mezcla
            //      texels de islas vecinas EN EL ATLAS (aunque no sean
            //      vecinas en el modelo), lo que produce el clásico
            //      "seam bleeding": líneas oscuras/borrosas justo en los
            //      bordes de esas islas — que caen alrededor del cojín.
            //
            // Ninguna de las dos causas es un hueco real en la geometría
            // (las posiciones sí coinciden), así que no hace falta tocar
            // el .glb ni la geometría: se corrigen con dos ajustes de
            // material/textura, sin tocar la PointLight global ni ningún
            // otro sistema.
            if (mat.map) {
              // (1) Sin mipmaps: elimina el "bleeding" entre islas UV
              // del atlas al minimizar la textura, que es la causa más
              // visible de las líneas alrededor del cojín. El coste es
              // algo de aliasing si el gato se viera muy pequeño en
              // pantalla, aceptable frente a la costura permanente.
              mat.map.generateMipmaps = false;
              mat.map.minFilter = THREE.LinearFilter;
              mat.map.magFilter = THREE.LinearFilter;
              mat.map.needsUpdate = true;
            }
            // (2) shadowSide en BackSide: técnica estándar de three.js
            // para eliminar "shadow acne" en mallas con normales
            // inconsistentes en sus costuras internas — el shadow map
            // se genera con las caras traseras en vez de las
            // delanteras, evitando el autosombreado errático descrito
            // arriba sin tocar la luz ni el material visible.
            mat.shadowSide = THREE.BackSide;

            materials.push(mat);
            uniqueMaterials.add(mat);
          };

          if (Array.isArray(child.material)) {
            child.material.forEach(applyToMaterial);
          } else if (child.material) {
            applyToMaterial(child.material);
          }
        }
      });

      // Las 3 mallas del .glb comparten un único material (mismo índice
      // de material en el archivo), así que en la práctica esto engancha
      // el shader una sola vez — pero se recorre como conjunto por si
      // algún día el modelo trajera más de un material. Si la
      // respiración estuviera desactivada en la configuración, ni
      // siquiera se engancha el shader (nada que actualizar en update()).
      if (cfg.breathing?.enabled !== false) {
        uniqueMaterials.forEach((mat) => {
          attachBreathingShader(mat, cfg.breathing, breathingShaderUniforms);
        });
      }

      trackedMaterials = materials;

      group.add(model);
      cat.model = model;

      // Si había un placeholder de desarrollo visible, se retira en
      // cuanto el modelo real está listo — no deben convivir los dos.
      removePlaceholderIfPresent();
    },
    undefined,
    (error) => {
      console.warn(`[cat.js] No se pudo cargar ${cfg.modelPath}:`, error);

      if (cfg.placeholder.enabled && !cat.model) {
        createPlaceholder();
      }
    }
  );

  function removePlaceholderIfPresent() {
    if (!placeholderMesh) return;
    group.remove(placeholderMesh);
    placeholderMesh.geometry.dispose();
    placeholderMesh.material.dispose();
    placeholderMesh = null;
    cat.isPlaceholder = false;
  }

  // ---- Animación por frame ----
  // Se registra en el render loop compartido (mismo mecanismo que ya
  // usan flame.js, matches.js y particlesBackground.js), sin que
  // scene.js necesite saber nada específico del gato.
  //
  // CORREGIDO (bug de fondo — el gato no reaccionaba a la MISMA luz):
  // antes había aquí una animación PROPIA e independiente (`progress`
  // acercándose a `progressTarget` con approachSmooth/currentDuration),
  // disparada por reveal()/hide() — y esas dos funciones solo las
  // llamaba main.js en dos eventos puntuales: cat.reveal() al confirmar
  // el contacto con la mecha, y cat.hide() dentro de
  // onFlameExtinguished(), que flame.js dispara únicamente cuando su
  // "growth" YA ha llegado a ~0 (ver flame.js) — es decir, cuando la
  // luz real ya lleva completo TODO su apagado (~0.9s). Aunque la
  // curva matemática del gato se hiciera coincidir con la de flame.js
  // (ronda anterior), el PUNTO DE PARTIDA en el tiempo seguía mal: el
  // gato no empezaba a oscurecerse hasta que la vela ya estaba
  // completamente apagada, ni empezaba a iluminarse hasta un evento
  // aparte de cuándo realmente arranca flame.ignite(). Ninguna curva,
  // por bien calculada que esté, puede parecer sincronizada si arranca
  // en el momento equivocado.
  //
  // La solución ya no anima nada por su cuenta: cada frame se lee
  // directamente `currentProgress()` (que a su vez lee
  // getLightProgress(), el "growth" REAL de flame.js, salvo que haya
  // un override manual de consola activo) y ese valor —ya suavizado
  // por flame.js internamente, no hace falta suavizarlo dos veces— se
  // usa tal cual para el brillo. No hay "progress"/"progressTarget"
  // propios del gato en absoluto: no hay nada que pueda desincronizarse,
  // porque no hay una segunda animación corriendo en paralelo a la real.
  function update(delta) {
    const progress = currentProgress();
    const brightness = materialBrightnessFor(progress, cfg);
    trackedMaterials.forEach((mat) => {
      if ("emissiveIntensity" in mat) {
        // Materiales que sí reaccionan a la luz (p.ej. el placeholder de
        // desarrollo, MeshStandardMaterial): el revelado se resuelve con
        // el pipeline de iluminación real (emissive), sin tocar su color
        // base — multiplicarlo por `brightness` le quitaría su color de
        // placeholder (aunque al ser neutro no cambiaría su matiz, este
        // material ya tiene su propia vía de revelado y no necesita la
        // otra).
        mat.emissiveIntensity = progress * cfg.reveal.emissiveBoost;
      } else if (mat.color) {
        // Material unlit (MeshBasicMaterial) del modelo real: el único
        // "apagado de luz" posible es este escalar de luminosidad
        // neutro (ver materialBrightnessFor) — preserva el matiz y la
        // saturación originales de la textura, solo varía su brillo.
        mat.color.copy(brightness);
      }
    });

    // ---- Respiración (ver la nota junto a `breathingElapsed`/
    // `breathingShaderUniforms` más arriba, y CAT_CONFIG.breathing) ----
    // Ya NO se toca `cat.model.scale` (eso volvía a mover también el
    // cojín): el pulso de respiración de este frame se manda como
    // uniform al vertex shader, que es quien decide, vértice a vértice,
    // cuánto le afecta según su altura (`bodyMaskLowZ/HighZ`). Con
    // amount=0 el modelo queda exactamente en su geometría original, así
    // que si el shader no llegara a engancharse por algún motivo (p. ej.
    // un fallo de compilación) el gato simplemente se ve estático, sin
    // ningún otro efecto secundario.
    if (cat.model && cfg.breathing?.enabled !== false && breathingShaderUniforms.length > 0) {
      breathingElapsed += delta;
      const breathingCfg = cfg.breathing;
      const cycle = Math.max(0.1, breathingCfg.cycleDuration);
      const envelope = breathingEnvelope(breathingElapsed / cycle, breathingCfg);
      const amount = breathingCfg.amplitude * envelope;
      breathingShaderUniforms.forEach((uniforms) => {
        uniforms.uBreathAmount.value = amount;
      });
    }
  }

  onUpdate(update);

  // ---- API pública ----
  // reveal()/hide()/setRevealProgress() ya NO forman parte del flujo
  // automático (ver el comentario largo en update()) — fijan
  // `manualProgress`, un override que congela el brillo del gato
  // ignorando la luz real, pensado solo para depuración manual desde
  // consola (candela.cat.reveal() / .hide() / .setRevealProgress(0.5),
  // ver el comentario de window.candela en main.js). getRevealProgress()
  // e isRevealed() siempre devuelven el valor EFECTIVO actual (el
  // override si lo hay; si no, la luz real), para que reflejen fielmente
  // lo que se está aplicando al material en cada momento.
  function reveal() {
    manualProgress = 1;
  }

  function hide() {
    manualProgress = 0;
  }

  function setRevealProgress(value) {
    manualProgress = clamp01(value);
  }

  function getRevealProgress() {
    return currentProgress();
  }

  function isRevealed() {
    return currentProgress() >= 0.999;
  }

  cat.reveal = reveal;
  cat.hide = hide;
  cat.setRevealProgress = setRevealProgress;
  cat.getRevealProgress = getRevealProgress;
  cat.isRevealed = isRevealed;

  return cat;
}

// -----------------------------------------------------------------------
// CORRECCIÓN DE GEOMETRÍA: "dientes"/comisuras visibles alrededor del
// cojín en el .glb de "Sleeping Cat".
//
// DIAGNÓSTICO (repetido desde cero tras confirmar que el parche anterior
// de mipmaps/shadowSide no arreglaba nada visible):
//
// El .glb no trae un mesh de gato+cojín separados, trae 3 primitivas
// (Object_0/1/2) troceadas de forma arbitraria por el exportador de
// Sketchfab, con buffers de vértices independientes que solo coinciden
// en posición en los puntos de corte. Analizando el binario del .glb
// (posiciones, índices y normales) y soldando esos vértices coincidentes
// entre las 3 primitivas se comprobó que:
//   - La malla resultante es perfectamente cerrada (0 aristas realmente
//     abiertas) — no hay ningún hueco ni grieta real en la geometría.
//   - Pero hay ~236 vértices con una "picosidad" anómala (su distancia
//     al centroide de sus propios vecinos en la malla es 5-30 veces
//     mayor que la de cualquier vértice normal del pelaje), y la
//     inmensa mayoría comparten EXACTAMENTE la misma coordenada en el
//     eje vertical del modelo (grupos de vértices con la misma altura
//     hasta el último decimal) — la firma típica de una tapa de
//     relleno tosca, con pocos vértices muy separados, añadida
//     automáticamente al decimar/exportar el modelo para taponar la
//     base del cojín (que el escaneo original nunca capturó, al estar
//     apoyada sobre la mesa). Esos vértices se concentran casi todos
//     justo en el borde inferior del cojín — la misma zona donde se ven
//     los "dientes" en la escena.
//
// Es decir: NO es un problema de textura, UV, sombra ni iluminación (de
// ahí que el parche anterior de mipmaps/shadowSide no tuviera ningún
// efecto visible) — es geometría real, mal triangulada, en un puñado de
// vértices concretos.
//
// SOLUCIÓN: en vez de tocar el .glb (se evita salvo necesidad absoluta,
// y aquí no hace falta), se relajan SOLO esos vértices anómalos en
// tiempo de ejecución, justo tras cargar el modelo: se sueldan por
// posición las 3 primitivas para reconstruir la conectividad real de la
// malla, se detecta automáticamente qué vértices tienen una picosidad
// muy por encima de lo normal (comparado con la longitud de arista media
// del propio modelo, no con un número mágico fijo) y se relajan hacia el
// centroide de sus vecinos durante unas pocas iteraciones (suavizado
// laplaciano clásico), dejando el resto de la malla —el pelaje, la forma
// del gato, el resto del cojín— completamente intacto. El resultado se
// escribe de vuelta en las 3 primitivas para no introducir grietas
// nuevas, y se recalculan normales solo donde se ha tocado.
function relaxDegenerateSeamVertices(meshes) {
  const geometries = meshes
    .map((m) => m.geometry)
    .filter((g) => g && g.getAttribute("position") && g.getIndex());

  if (geometries.length === 0) return;

  const positionAttrs = geometries.map((g) => g.getAttribute("position"));
  const indexAttrs = geometries.map((g) => g.getIndex());

  const vertexCounts = positionAttrs.map((p) => p.count);
  const offsets = [0];
  for (let i = 0; i < vertexCounts.length; i++) {
    offsets.push(offsets[i] + vertexCounts[i]);
  }
  const totalVerts = offsets[offsets.length - 1];
  if (totalVerts === 0) return;

  // ---- 1) Soldadura por posición ----
  // Tolerancia fija en unidades LOCALES del .glb (antes de cualquier
  // escalado de escena): suficientemente fina para no fundir vértices
  // que son legítimamente distintos, suficientemente ancha para
  // absorber el ruido de precisión float habitual entre copias
  // exportadas del mismo punto.
  const QUANT = 1e4;
  const weldMap = new Map();
  const weldId = new Int32Array(totalVerts);
  const repSumX = [];
  const repSumY = [];
  const repSumZ = [];
  const repCount = [];

  let nextId = 0;
  for (let g = 0; g < positionAttrs.length; g++) {
    const attr = positionAttrs[g];
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i);
      const y = attr.getY(i);
      const z = attr.getZ(i);
      const key =
        Math.round(x * QUANT) + "_" + Math.round(y * QUANT) + "_" + Math.round(z * QUANT);
      let id = weldMap.get(key);
      if (id === undefined) {
        id = nextId++;
        weldMap.set(key, id);
        repSumX.push(0);
        repSumY.push(0);
        repSumZ.push(0);
        repCount.push(0);
      }
      const globalIdx = offsets[g] + i;
      weldId[globalIdx] = id;
      repSumX[id] += x;
      repSumY[id] += y;
      repSumZ[id] += z;
      repCount[id] += 1;
    }
  }

  const n = nextId;
  const repPos = new Float64Array(n * 3);
  for (let id = 0; id < n; id++) {
    repPos[id * 3 + 0] = repSumX[id] / repCount[id];
    repPos[id * 3 + 1] = repSumY[id] / repCount[id];
    repPos[id * 3 + 2] = repSumZ[id] / repCount[id];
  }

  // ---- 2) Adyacencia real de la malla (vecinos por arista) ----
  const neighborSets = new Array(n);
  for (let i = 0; i < n; i++) neighborSets[i] = new Set();

  let edgeLenSum = 0;
  let edgeCount = 0;

  const addEdge = (a, b) => {
    if (a === b) return;
    neighborSets[a].add(b);
    neighborSets[b].add(a);
    const dx = repPos[a * 3] - repPos[b * 3];
    const dy = repPos[a * 3 + 1] - repPos[b * 3 + 1];
    const dz = repPos[a * 3 + 2] - repPos[b * 3 + 2];
    edgeLenSum += Math.sqrt(dx * dx + dy * dy + dz * dz);
    edgeCount += 1;
  };

  for (let g = 0; g < indexAttrs.length; g++) {
    const idx = indexAttrs[g];
    const base = offsets[g];
    for (let t = 0; t + 2 < idx.count; t += 3) {
      const a = weldId[base + idx.getX(t)];
      const b = weldId[base + idx.getX(t + 1)];
      const c = weldId[base + idx.getX(t + 2)];
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);
    }
  }

  if (edgeCount === 0) return;
  const meanEdgeLen = edgeLenSum / edgeCount;

  // ---- 3) Detección de vértices "pico" ----
  // Umbral relativo a la longitud de arista media del propio modelo
  // (no un valor fijo): en el análisis offline, el umbral que aísla
  // limpiamente la tapa de relleno tosca del ruido normal del pelaje
  // resultó ser ~1.15x la arista media.
  const centroidOf = (v) => {
    const nbrs = neighborSets[v];
    let cx = 0;
    let cy = 0;
    let cz = 0;
    nbrs.forEach((nb) => {
      cx += repPos[nb * 3];
      cy += repPos[nb * 3 + 1];
      cz += repPos[nb * 3 + 2];
    });
    const cnt = nbrs.size;
    return [cx / cnt, cy / cnt, cz / cnt];
  };

  const SPIKE_THRESHOLD = meanEdgeLen * 1.15;
  const flagged = [];
  for (let v = 0; v < n; v++) {
    if (neighborSets[v].size < 3) continue;
    const [cx, cy, cz] = centroidOf(v);
    const dx = repPos[v * 3] - cx;
    const dy = repPos[v * 3 + 1] - cy;
    const dz = repPos[v * 3 + 2] - cz;
    const spike = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (spike > SPIKE_THRESHOLD) flagged.push(v);
  }

  if (flagged.length === 0) return;

  // ---- 4) Relajación laplaciana, SOLO de los vértices marcados ----
  // 40 iteraciones: en la simulación offline sobre los datos reales del
  // .glb, con menos iteraciones (p.ej. 12) el pico residual medio queda
  // en ~0.6 unidades (todavía por encima del ruido normal del pelaje);
  // con 40 converge a ~0.04, ya por debajo de la picosidad típica de un
  // vértice normal (~0.02-0.05). Con solo ~200 vértices marcados, el
  // coste de estas iteraciones extra es insignificante.
  const ALPHA = 0.5;
  const ITERATIONS = 40;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const newPos = new Float64Array(flagged.length * 3);
    for (let fi = 0; fi < flagged.length; fi++) {
      const v = flagged[fi];
      const [cx, cy, cz] = centroidOf(v);
      newPos[fi * 3 + 0] = repPos[v * 3 + 0] * (1 - ALPHA) + cx * ALPHA;
      newPos[fi * 3 + 1] = repPos[v * 3 + 1] * (1 - ALPHA) + cy * ALPHA;
      newPos[fi * 3 + 2] = repPos[v * 3 + 2] * (1 - ALPHA) + cz * ALPHA;
    }
    for (let fi = 0; fi < flagged.length; fi++) {
      const v = flagged[fi];
      repPos[v * 3 + 0] = newPos[fi * 3 + 0];
      repPos[v * 3 + 1] = newPos[fi * 3 + 1];
      repPos[v * 3 + 2] = newPos[fi * 3 + 2];
    }
  }

  // ---- 5) Escritura de vuelta en las 3 primitivas originales ----
  // Se escribe en TODAS las copias de cada vértice soldado marcado,
  // para que las primitivas sigan coincidiendo exactamente en los
  // cortes (sin introducir grietas nuevas).
  const flaggedSet = new Set(flagged);
  for (let g = 0; g < positionAttrs.length; g++) {
    const attr = positionAttrs[g];
    let touched = false;
    for (let i = 0; i < attr.count; i++) {
      const id = weldId[offsets[g] + i];
      if (flaggedSet.has(id)) {
        attr.setXYZ(i, repPos[id * 3], repPos[id * 3 + 1], repPos[id * 3 + 2]);
        touched = true;
      }
    }
    if (touched) {
      attr.needsUpdate = true;
      geometries[g].computeVertexNormals();
      geometries[g].computeBoundingBox();
      geometries[g].computeBoundingSphere();
    }
  }

  console.info(
    `[cat.js] Corrección de geometría: ${flagged.length} vértices anómalos relajados (de ${n} soldados) en la base del cojín.`
  );
}

// -----------------------------------------------------------------------
// Respiración localizada por shader (ver la nota larga en
// CAT_CONFIG.breathing y en el bloque "---- Respiración ----" de
// createCat): el .glb tiene el gato y el cojín soldados en la misma
// malla, así que la única forma de mover solo el cuerpo es a nivel de
// vértice, no de objeto. Se engancha vía `material.onBeforeCompile`,
// que Three.js llama automáticamente la primera vez que compila ese
// material — aquí solo se le añaden un puñado de líneas al vertex
// shader estándar, justo después de `#include <begin_vertex>` (el punto
// donde el shader ya tiene `transformed = vec3(position)`, en el
// espacio LOCAL del propio archivo .glb, sin ninguna transformación de
// escena aplicada todavía).
//
// La función devuelve enseguida si el material ya tuviera este shader
// enganchado (evita duplicar el hook si createCat() se llamara más de
// una vez sobre el mismo material, aunque hoy no ocurre).
function attachBreathingShader(material, breathingCfg, uniformsSink) {
  if (material.userData.breathingShaderAttached) return;
  material.userData.breathingShaderAttached = true;

  const [centerX, centerY] = breathingCfg.bodyMaskCenterXY;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBreathAmount = { value: 0 };
    shader.uniforms.uBreathLowZ = { value: breathingCfg.bodyMaskLowZ };
    shader.uniforms.uBreathHighZ = { value: breathingCfg.bodyMaskHighZ };
    shader.uniforms.uBreathCenter = { value: new THREE.Vector2(centerX, centerY) };

    shader.vertexShader = shader.vertexShader
      .replace(
        "void main() {",
        `uniform float uBreathAmount;
        uniform float uBreathLowZ;
        uniform float uBreathHighZ;
        uniform vec2 uBreathCenter;
        void main() {`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          // Peso 0→1 según la altura LOCAL del vértice (eje "Z" del
          // archivo .glb — ver la nota en CAT_CONFIG.breathing sobre
          // por qué es Z y no Y): 0 en el cojín, 1 en el cuerpo del
          // gato, con una transición suave entre ambos.
          float breathWeight = smoothstep(uBreathLowZ, uBreathHighZ, transformed.z);
          float breathPulse = 1.0 + uBreathAmount * breathWeight;
          // Se "hincha" horizontalmente (plano local X/Y) alrededor del
          // centro real del cuerpo del gato, sin tocar Z (altura): así
          // no hay ningún efecto de ascensor, solo el pulso lateral de
          // la respiración.
          transformed.x = uBreathCenter.x + (transformed.x - uBreathCenter.x) * breathPulse;
          transformed.y = uBreathCenter.y + (transformed.y - uBreathCenter.y) * breathPulse;
        }`
      );

    uniformsSink.push(shader.uniforms);
  };
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

// Interpola el ESCALAR de luminosidad entre minBrightness y
// maxBrightness según el progreso actual (0 = oculto/oscuro, 1 =
// revelado/iluminado), y lo devuelve como un THREE.Color NEUTRO
// (mismo valor en R, G y B). Un gris neutro multiplicado sobre la
// textura escala los tres canales por igual: no cambia el matiz (hue)
// ni la saturación del pelaje original, solo su luminosidad (Value en
// HSV) — a diferencia del anterior materialColorFor, que interpolaba
// hacia un color HEX con canales R/G/B distintos entre sí y por tanto
// SÍ cambiaba el matiz (el bug del "tinte marrón"). Un único sitio
// para no repetir la fórmula en varios lugares (carga del modelo,
// update por frame).
const _brightnessColorCache = new THREE.Color();
function materialBrightnessFor(progress, cfg) {
  const { minBrightness, maxBrightness } = cfg.reveal;
  const k = minBrightness + (maxBrightness - minBrightness) * clamp01(progress);
  return _brightnessColorCache.setScalar(k);
}

// Interpolación suave con derivada nula en ambos extremos (0 y 1): se
// usa para que la respiración entre/salga de cada tramo sin ningún
// "salto" de velocidad perceptible, en vez de un movimiento lineal o
// una sinusoide pura (que resultaría más mecánica/regular).
function smoothstep01(x) {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

// Envolvente de respiración (0 = reposo, 1 = pico de inhalación) para
// un ciclo completo normalizado a [0, 1). Cuatro tramos, en este orden:
//   inhalación (smoothstep 0→1) → pausa breve arriba (fijo en 1) →
//   exhalación (smoothstep 1→0) → pausa en reposo (fijo en 0, el resto
//   del ciclo) → vuelve a empezar.
// Todos los tramos empiezan/terminan con derivada 0, así que el empalme
// entre "moviéndose" y "en pausa" es perfectamente continuo — no hay
// paradas visibles ni tirones, solo la sensación de una pausa natural
// en los extremos de cada respiración.
function breathingEnvelope(tNormalized, cfg) {
  const t = tNormalized - Math.floor(tNormalized);
  const inhaleEnd = cfg.inhaleFraction;
  const holdInEnd = inhaleEnd + cfg.holdInFraction;
  const exhaleEnd = holdInEnd + cfg.exhaleFraction;

  if (t < inhaleEnd) {
    return smoothstep01(t / inhaleEnd);
  }
  if (t < holdInEnd) {
    return 1;
  }
  if (t < exhaleEnd) {
    return 1 - smoothstep01((t - holdInEnd) / cfg.exhaleFraction);
  }
  return 0;
}