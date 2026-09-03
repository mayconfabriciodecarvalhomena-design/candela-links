import * as THREE from "three";
import { CONFIG } from "./config.js";
import { onUpdate } from "./scene.js";

// -----------------------------------------------------------------------
// BACKGROUND PARTICLES: motas de polvo/luz ambientales que dan
// profundidad al fondo de la escena. Sistema completamente independiente
// de la vela (candle.js) y de la llama (flame.js): no los importa ni
// depende de ellos en ningún momento. Solo conoce la posición aproximada
// de la luz (CONFIG.backgroundParticles.lightInfluence.center) para dar
// la sensación de que algunas motas están "alcanzadas" por ella.
//
// Se construye con TRES capas superpuestas (tiny / medium / large,
// definidas en CONFIG.backgroundParticles.layers), igual que la llama se
// construye con tres capas en flame.js. Cada capa tiene su propio
// tamaño, opacidad, velocidad y duración de vida, para conseguir
// variedad real en vez de un tamaño único repetido muchas veces.
//
// Todo lo ajustable vive en CONFIG.backgroundParticles (config.js).
//
// API pública que devuelve createBackgroundParticles():
//   - setIntensity(value)  → 0 a 1. Controla la visibilidad general del
//                             sistema con una transición suave. Pensado
//                             para que las fases narrativas puedan
//                             atenuarlo o realzarlo más adelante.
//   - dispose()            → limpia geometría, materiales, texturas y
//                             los listeners de puntero.
// -----------------------------------------------------------------------

export function createBackgroundParticles(scene, camera) {
  const cfg = CONFIG.backgroundParticles;

  const group = new THREE.Group();
  scene.add(group);

  const colorShadow = new THREE.Color(cfg.color.shadow);
  const colorLit = new THREE.Color(cfg.color.lit);
  const fogColor = new THREE.Color(CONFIG.scene.backgroundColor);
  const lightCenter = new THREE.Vector3(...cfg.lightInfluence.center);
  const tmpColor = new THREE.Color();

  // Dos texturas: una más definida (motas pequeñas/medianas) y otra
  // mucho más difusa, sin núcleo brillante, para las motas grandes — así
  // aunque sean grandes nunca se leen como un disco sólido, sino como
  // una mancha de luz muy suave, típica del polvo en suspensión.
  const fineTexture = createDustTexture({ core: 0.95, mid: 0.35, midAlpha: 0.5 });
  const hazeTexture = createDustTexture({ core: 0.55, mid: 0.5, midAlpha: 0.22 }, 96);

  // ---- Puntero compartido por todas las capas (ratón, lápiz o dedo:
  // Pointer Events unifica los tres, así que ya queda preparado para
  // touch sin lógica extra) ----
  const pointerNDC = new THREE.Vector2(2, 2); // fuera de pantalla al empezar: sin interacción
  let pointerActive = false;

  const raycaster = new THREE.Raycaster();
  // Plano invisible orientado hacia la cámara, situado a la altura
  // definida en cfg.interaction.planeHeight. El puntero se proyecta
  // sobre este plano para obtener una posición 3D aproximada; como la
  // distancia partícula-puntero se calcula en 3D real, las motas más
  // lejanas de esa profundidad ya reaccionan menos por sí solas.
  const pointerPlane = new THREE.Plane();
  const pointerWorld = new THREE.Vector3();
  updatePointerPlane();

  function updatePointerPlane() {
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    pointerPlane.setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(0, cfg.interaction.planeHeight, 0)
    );
  }

  function handlePointerMove(event) {
    pointerNDC.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(event.clientY / window.innerHeight) * 2 + 1;
    pointerActive = true;
  }

  function handlePointerLeave() {
    pointerActive = false;
  }

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerleave", handlePointerLeave);
  window.addEventListener("blur", handlePointerLeave);

  // ---- Intensidad general (para control futuro por fases) ----
  let currentIntensity = 0;
  let targetIntensity = 1; // visible por defecto; setIntensity() lo puede cambiar en cualquier momento

  function setIntensity(value) {
    targetIntensity = THREE.MathUtils.clamp(value, 0, 1);
  }

  // ---- Las tres capas ----
  const tiny = createLayer(cfg.layers.tiny, fineTexture);
  const medium = createLayer(cfg.layers.medium, fineTexture);
  const large = createLayer(cfg.layers.large, hazeTexture);
  const layers = [tiny, medium, large];

  let elapsedTime = 0;

  function update(delta) {
    elapsedTime += delta;

    // Transición suave de intensidad, independiente de los FPS (misma
    // técnica que el encendido/apagado de la llama).
    const intensityStep = 1 - Math.pow(0.001, delta / cfg.fadeDuration);
    currentIntensity += (targetIntensity - currentIntensity) * intensityStep;

    if (pointerActive) {
      raycaster.setFromCamera(pointerNDC, camera);
      const hit = raycaster.ray.intersectPlane(pointerPlane, pointerWorld);
      if (!hit) pointerActive = false;
    }

    for (const layer of layers) {
      layer.update(delta, elapsedTime, currentIntensity);
    }
  }

  onUpdate(update);

  function dispose() {
    for (const layer of layers) layer.dispose();
    scene.remove(group);
    fineTexture.dispose();
    hazeTexture.dispose();
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerleave", handlePointerLeave);
    window.removeEventListener("blur", handlePointerLeave);
  }

  return { setIntensity, dispose };

  // -----------------------------------------------------------------
  // Fábrica de una capa de partículas (tiny / medium / large). Las tres
  // comparten la misma lógica de vida, deriva, corriente de aire e
  // influencia de la luz; lo que cambia es la configuración que reciben
  // (tamaño, opacidad, velocidad, duración de ciclo) y la textura.
  // -----------------------------------------------------------------
  function createLayer(layerCfg, texture) {
    const count = layerCfg.count;

    const positions = new Float32Array(count * 3);
    const particleColors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("particleColor", new THREE.BufferAttribute(particleColors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));

    const material = createParticleMaterial(texture);
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false; // el volumen es grande y rodea la cámara; evita popping en los bordes
    group.add(points);

    // ---- Estado individual de cada partícula ----
    // "anchor" es el punto alrededor del cual flota la partícula; el
    // movimiento real es ese anclaje más una oscilación suave (drift),
    // una corriente de aire compartida (flow) y, si el cursor está
    // cerca, un pequeño desplazamiento de repulsión.
    const state = [];

    function resetParticle(i, randomizeAge) {
      // Distribución en dos modos (ver CONFIG.backgroundParticles.distribution):
      // una parte de las motas nace en una "nube" concentrada alrededor
      // de la luz de la vela, y el resto en cualquier punto del volumen,
      // para que el espacio siga lleno de profundidad incluso en las
      // zonas más oscuras.
      let x, y, z;
      if (Math.random() < cfg.distribution.nearFieldFraction) {
        const r = cfg.distribution.nearFieldRadius;
        x = THREE.MathUtils.clamp(lightCenter.x + randRange(-r, r), -cfg.area.x, cfg.area.x);
        y = THREE.MathUtils.clamp(
          lightCenter.y + randRange(-r * 0.7, r * 1.4),
          cfg.area.yMin,
          cfg.area.yMax
        );
        z = THREE.MathUtils.clamp(lightCenter.z + randRange(-r, r), cfg.area.zFar, cfg.area.zNear);
      } else {
        x = randRange(-cfg.area.x, cfg.area.x);
        y = randRange(cfg.area.yMin, cfg.area.yMax);
        z = randRange(cfg.area.zFar, cfg.area.zNear);
      }

      const cycleDuration = randRange(layerCfg.cycle.minDuration, layerCfg.cycle.maxDuration);

      state[i] = {
        anchor: new THREE.Vector3(x, y, z),
        size: randRange(layerCfg.size.min, layerCfg.size.max),
        baseOpacity: randRange(layerCfg.opacity.min, layerCfg.opacity.max),

        driftFreqX: randRange(layerCfg.drift.frequencyMin, layerCfg.drift.frequencyMax),
        driftFreqY: randRange(layerCfg.drift.frequencyMin, layerCfg.drift.frequencyMax) * 0.6,
        driftFreqZ: randRange(layerCfg.drift.frequencyMin, layerCfg.drift.frequencyMax),
        driftPhaseX: Math.random() * Math.PI * 2,
        driftPhaseY: Math.random() * Math.PI * 2,
        driftPhaseZ: Math.random() * Math.PI * 2,
        driftAmpX: layerCfg.drift.amount * (0.6 + Math.random() * 0.8),
        driftAmpY: layerCfg.drift.amount * 0.3 * (0.6 + Math.random() * 0.8),
        driftAmpZ: layerCfg.drift.amount * (0.6 + Math.random() * 0.8),

        // Velocidad de ascenso lento (como polvo arrastrado por una
        // suave corriente de aire cálido). En la capa "large" este
        // rango está casi a 0 en CONFIG, así que esas motas quedan
        // prácticamente suspendidas en el aire.
        riseSpeed: randRange(layerCfg.speed.min, layerCfg.speed.max),

        flowPhase: Math.random() * Math.PI * 2,

        // Si randomizeAge es true (solo en la creación inicial),
        // repartimos la edad de cada partícula por todo el ciclo para
        // que el sistema no empiece con todas apareciendo a la vez.
        age: randomizeAge ? Math.random() * cycleDuration : 0,
        cycleDuration,

        displacementX: 0,
        displacementZ: 0,
      };
    }

    for (let i = 0; i < count; i++) resetParticle(i, true);

    function update(delta, elapsedTime, currentIntensity) {
      const positionAttr = geometry.attributes.position;
      const colorAttr = geometry.attributes.particleColor;
      const sizeAttr = geometry.attributes.size;
      const alphaAttr = geometry.attributes.alpha;

      const interactionEnabled = cfg.interaction.enabled;
      const displacementLerp = 1 - Math.pow(0.001, delta * cfg.interaction.recovery);
      const flow = cfg.flow;

      for (let i = 0; i < count; i++) {
        const p = state[i];

        p.age += delta;
        if (p.age >= p.cycleDuration) {
          resetParticle(i, false);
        }

        p.anchor.y += p.riseSpeed * delta;

        const driftX = Math.sin(elapsedTime * p.driftFreqX + p.driftPhaseX) * p.driftAmpX;
        const driftY = Math.sin(elapsedTime * p.driftFreqY + p.driftPhaseY) * p.driftAmpY;
        const driftZ = Math.cos(elapsedTime * p.driftFreqZ + p.driftPhaseZ) * p.driftAmpZ;

        // Corriente de aire compartida: un campo de movimiento basado en
        // la posición del anclaje y en el tiempo (no solo aleatorio por
        // partícula), para que varias motas cercanas entre sí se
        // desplacen de forma coherente, como arrastradas por la misma
        // corriente lateral, en vez de moverse cada una por su cuenta.
        const flowX =
          Math.sin(p.anchor.x * flow.scale + elapsedTime * flow.speed + p.flowPhase) *
          Math.cos(p.anchor.z * flow.scale * 0.7 - elapsedTime * flow.speed * 0.6) *
          flow.strength;
        const flowZ =
          Math.cos(p.anchor.z * flow.scale + elapsedTime * flow.speed * 0.8 + p.flowPhase) *
          Math.sin(p.anchor.x * flow.scale * 0.6 + elapsedTime * flow.speed) *
          flow.strength;

        // Repulsión sutil del puntero: se calcula un desplazamiento
        // "deseado" según la cercanía real en 3D, y la partícula se
        // acerca a él suavemente (y se aleja igual de suave cuando el
        // puntero ya no influye), en vez de saltar de golpe.
        let desiredX = 0;
        let desiredZ = 0;

        if (interactionEnabled && pointerActive) {
          const px = p.anchor.x + driftX + flowX;
          const py = p.anchor.y + driftY;
          const pz = p.anchor.z + driftZ + flowZ;

          const dx = px - pointerWorld.x;
          const dy = py - pointerWorld.y;
          const dz = pz - pointerWorld.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < cfg.interaction.radius && dist > 0.0001) {
            const force = (1 - dist / cfg.interaction.radius) * cfg.interaction.strength;
            desiredX = (dx / dist) * force;
            desiredZ = (dz / dist) * force;
          }
        }

        p.displacementX += (desiredX - p.displacementX) * displacementLerp;
        p.displacementZ += (desiredZ - p.displacementZ) * displacementLerp;

        const finalX = p.anchor.x + driftX + flowX + p.displacementX;
        const finalY = p.anchor.y + driftY;
        const finalZ = p.anchor.z + driftZ + flowZ + p.displacementZ;

        positionAttr.setXYZ(i, finalX, finalY, finalZ);

        // Vida de la partícula: aparece y desaparece suavemente dentro
        // de su ciclo, en vez de encenderse/apagarse de golpe.
        const lifeT = p.age / p.cycleDuration;
        const fadeIn = Math.min(lifeT / layerCfg.cycle.fadeInFraction, 1);
        const fadeOut =
          1 -
          Math.max(0, (lifeT - (1 - layerCfg.cycle.fadeOutFraction)) / layerCfg.cycle.fadeOutFraction);
        const lifeAlpha = Math.max(0, Math.min(fadeIn, fadeOut));

        // Influencia de la luz de la vela: caída con contraste (no
        // lineal) para que se note con claridad qué motas están dentro
        // del resplandor y cuáles se quedan en la penumbra.
        const lightDist = lightCenter.distanceTo(tmpVec3(finalX, finalY, finalZ));
        const lightT = Math.pow(
          Math.max(0, 1 - lightDist / cfg.lightInfluence.radius),
          cfg.lightInfluence.contrast
        );

        // Niebla de profundidad: además de que la perspectiva ya encoge
        // las motas lejanas en pantalla, esto reduce un poco más su
        // presencia y las funde con el color de fondo, mientras que las
        // cercanas ganan algo de peso visual.
        const depth01 = THREE.MathUtils.clamp(
          (finalZ - cfg.area.zNear) / (cfg.area.zFar - cfg.area.zNear),
          0,
          1
        );
        const depthOpacityMul = THREE.MathUtils.lerp(
          cfg.depthFade.nearOpacityMul,
          cfg.depthFade.farOpacityMul,
          depth01
        );
        const depthSizeMul = THREE.MathUtils.lerp(
          cfg.depthFade.nearSizeMul,
          cfg.depthFade.farSizeMul,
          depth01
        );

        tmpColor.copy(colorShadow).lerp(colorLit, lightT);
        tmpColor.lerp(fogColor, depth01 * cfg.depthFade.fogAmount);
        colorAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);

        sizeAttr.setX(i, p.size * depthSizeMul);

        const alpha =
          p.baseOpacity *
          lifeAlpha *
          currentIntensity *
          depthOpacityMul *
          (1 + lightT * cfg.lightInfluence.opacityBoost);
        alphaAttr.setX(i, alpha);
      }

      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;
      alphaAttr.needsUpdate = true;

      material.uniforms.pixelHeight.value = window.innerHeight;
    }

    function dispose() {
      group.remove(points);
      geometry.dispose();
      material.dispose();
    }

    return { update, dispose };
  }
}

// -----------------------------------------------------------------------
// Pequeña ayuda para no crear un THREE.Vector3 nuevo en cada iteración
// del bucle (evita presión innecesaria sobre el recolector de basura).
// -----------------------------------------------------------------------
const _reusableVec3 = new THREE.Vector3();
function tmpVec3(x, y, z) {
  _reusableVec3.set(x, y, z);
  return _reusableVec3;
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

// -----------------------------------------------------------------------
// Material de las partículas: mismo enfoque que flame.js (ShaderMaterial
// con tamaño y opacidad por partícula vía atributos, ya que PointsMaterial
// solo admite un tamaño único para todas). Es una copia local pequeña, no
// una dependencia de flame.js, para que ambos sistemas sigan siendo
// completamente independientes.
// -----------------------------------------------------------------------
function createParticleMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      pixelHeight: { value: window.innerHeight },
    },
    vertexShader: `
      attribute float size;
      attribute vec3 particleColor;
      attribute float alpha;
      uniform float pixelHeight;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vColor = particleColor;
        vAlpha = alpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        // El tamaño en pantalla depende de la distancia a la cámara, así
        // que las motas cercanas se ven algo mayores y las lejanas más
        // pequeñas, sin necesidad de calcularlo aparte por partícula.
        gl_PointSize = size * (pixelHeight * 0.5) / -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec4 tex = texture2D(map, gl_PointCoord);
        gl_FragColor = vec4(vColor, tex.a * vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

// -----------------------------------------------------------------------
// Textura procedural para las motas: una mancha de luz suave y difusa,
// generada con Canvas (sin imágenes externas). "core" es la opacidad en
// el centro, "mid"/"midAlpha" definen un punto intermedio del degradado
// (cuanto menor "mid", antes empieza a desvanecerse: así se generan
// texturas más o menos difusas reutilizando la misma función).
// -----------------------------------------------------------------------
function createDustTexture({ core = 0.9, mid = 0.35, midAlpha = 0.45 } = {}, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, `rgba(255,255,255,${core})`);
  gradient.addColorStop(mid, `rgba(255,255,255,${midAlpha})`);
  gradient.addColorStop(1, "rgba(255,255,255,0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}