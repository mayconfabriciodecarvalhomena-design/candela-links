import * as THREE from "three";
import { CONFIG } from "./config.js";
import { onUpdate } from "./scene.js";
import { onWickReady } from "./candle.js";
import { onFlameExtinguished } from "./flame.js";
import { SMOKE_VERTEX_SHADER, SMOKE_FRAGMENT_SHADER } from "./smokeShader.js";

// -----------------------------------------------------------------------
// SMOKE: el hilo de humo sutil que queda un momento tras apagar la llama
// de la vela.
//
// Usa un shader propio (smokeShader.js), no el de las brasas de la
// llama: aunque el shader de brasas (Points + atributos por partícula)
// era técnicamente reutilizable, la textura de gradiente radial que usa
// es perfectamente circular y con una meseta central de opacidad casi
// constante — perfecta para una brasa puntual, pero es precisamente lo
// que hacía que el humo se percibiera como "círculos grises" en vez de
// una voluta continua. El shader de humo rompe esa simetría con ruido
// procedural y no tiene ninguna meseta en la caída de opacidad. El modo
// de mezcla (normal, no aditivo) ya era correcto y no ha cambiado: el
// humo no emite luz.
//
// Igual que antes, este módulo:
// - se ancla a la punta real de la mecha vía onWickReady() (candle.js);
// - se engancha al render loop existente vía onUpdate() (scene.js), sin
//   tocar scene.js más allá de instanciarlo;
// - se suscribe a onFlameExtinguished() (flame.js) para arrancar solo,
//   sin que nada externo tenga que orquestar la secuencia
//   EXTINGUISHING → OFF → SMOKE. Ese hook se sigue disparando en el
//   mismo frame en que la llama termina de apagarse (sin cambios en
//   flame.js en esta fase) — el retraso que se percibía NO estaba ahí,
//   estaba dentro de este módulo (ver más abajo).
//
// API pública, sin cambios (candela.smoke.start() / .stop() / .isActive()):
//   start()     — (re)lanza una nueva tanda de humo desde la mecha.
//                  Puede llamarse tantas veces como haga falta; no deja
//                  ningún estado que impida volver a llamarla. Garantiza
//                  que al menos una partícula nace en el frame 0, para
//                  que el primer indicio de humo sea inmediato.
//   stop()      — apaga el humo activo al instante.
//   isActive()  — true mientras quede alguna partícula de humo visible.
// -----------------------------------------------------------------------

export function createSmoke(scene) {
  const cfg = CONFIG.smoke;
  const count = cfg.count;

  // Grupo raíz: misma idea que en flame.js — posición de arranque
  // razonable hasta que candle.js mida la punta real de la mecha, y
  // reposicionado exactamente ahí (con un pequeño ajuste, originOffset)
  // en cuanto esté lista.
  const group = new THREE.Group();
  scene.add(group);

  onWickReady((wickWorld) => {
    group.position.copy(wickWorld);
    group.position.x += cfg.originOffset[0];
    group.position.y += cfg.originOffset[1];
    group.position.z += cfg.originOffset[2];
  });

  const positions = new Float32Array(count * 3);
  const particleColors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const alphas = new Float32Array(count);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Fijo por partícula (no cambia entre tandas): solo se usa para que
    // el ruido del shader sea distinto en cada punto, no necesita
    // reasignarse en cada start().
    seeds[i] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("particleColor", new THREE.BufferAttribute(particleColors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      pixelHeight: { value: window.innerHeight },
    },
    vertexShader: SMOKE_VERTEX_SHADER,
    fragmentShader: SMOKE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    // Normal, no aditivo: el humo no emite luz, solo se superpone de
    // forma translúcida a lo que haya detrás (a diferencia de las
    // brasas/llama, que sí brillan). Esto ya era así antes de esta
    // fase y no ha cambiado.
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);
  group.add(points);

  const colorNear = new THREE.Color(cfg.colorNear);
  const colorFar = new THREE.Color(cfg.colorFar);
  const tmpColor = new THREE.Color();

  // Estado por partícula. "born" indica si ya le tocó nacer dentro de la
  // tanda actual; mientras no nace, permanece con alpha 0 (invisible)
  // pero ya reservada en el BufferGeometry — no se crea geometría nueva
  // en ningún momento, solo se reutilizan estos mismos arrays.
  const state = [];
  for (let i = 0; i < count; i++) {
    state.push({
      born: false,
      finished: true,
      delay: 0,
      life: 0,
      maxLife: 1,
      baseAngle: 0,
      baseRadius: 0,
      driftFreqX: 1,
      driftFreqZ: 1,
      driftPhaseX: 0,
      driftPhaseZ: 0,
      sizeFactor: 1,
      opacityFactor: 1,
      speed: cfg.riseSpeed,
    });
  }

  let cycleTime = 0;
  let cycleActive = false;

  function start() {
    cycleTime = 0;
    cycleActive = true;
    for (let i = 0; i < count; i++) {
      const p = state[i];
      p.born = false;
      p.finished = false;
      p.life = 0;
      // Reparte los nacimientos a lo largo de emissionWindow, no todas a
      // la vez, para que el hilo de humo "brote" poco a poco. La
      // partícula 0 se fuerza SIEMPRE a delay 0: así el primer indicio
      // de humo aparece en el mismo frame en que se llama a start(), en
      // vez de depender del azar (antes el primer nacimiento tardaba,
      // en promedio, un rato en llegar, y eso se sumaba al retraso
      // percibido).
      p.delay = i === 0 ? 0 : Math.random() * cfg.emissionWindow;
      p.maxLife =
        cfg.lifetime.min + Math.random() * (cfg.lifetime.max - cfg.lifetime.min);

      // Nace prácticamente en la mecha (radio muy pequeño), con un
      // ángulo aleatorio solo para que las partículas no se apilen
      // exactamente en el mismo punto.
      p.baseAngle = Math.random() * Math.PI * 2;
      p.baseRadius = Math.random() * 0.004;

      // Dos ondas (lenta + rápida) por eje, con fase y frecuencia
      // propias, para una desviación lateral orgánica en vez de una
      // línea recta o una espiral perfecta.
      p.driftFreqX =
        cfg.driftFrequency.min +
        Math.random() * (cfg.driftFrequency.max - cfg.driftFrequency.min);
      p.driftFreqZ =
        cfg.driftFrequency.min +
        Math.random() * (cfg.driftFrequency.max - cfg.driftFrequency.min);
      p.driftPhaseX = Math.random() * Math.PI * 2;
      p.driftPhaseZ = Math.random() * Math.PI * 2;

      p.sizeFactor = 1 - cfg.sizeVariation / 2 + Math.random() * cfg.sizeVariation;
      p.opacityFactor =
        1 - cfg.opacityVariation / 2 + Math.random() * cfg.opacityVariation;
      p.speed =
        cfg.riseSpeed *
        (1 - cfg.riseSpeedVariation / 2 + Math.random() * cfg.riseSpeedVariation);

      // Oculta hasta que le toque nacer.
      alphas[i] = 0;
    }
    geometry.attributes.alpha.needsUpdate = true;
  }

  function stop() {
    cycleActive = false;
    for (let i = 0; i < count; i++) {
      state[i].born = false;
      state[i].finished = true;
      alphas[i] = 0;
    }
    geometry.attributes.alpha.needsUpdate = true;
  }

  function isActive() {
    return cycleActive;
  }

  function update(delta) {
    if (!cycleActive) return;

    cycleTime += delta;

    const positionAttr = geometry.attributes.position;
    const colorAttr = geometry.attributes.particleColor;
    const sizeAttr = geometry.attributes.size;
    const alphaAttr = geometry.attributes.alpha;

    let anyAlive = false;

    for (let i = 0; i < count; i++) {
      const p = state[i];
      if (p.finished) continue;

      if (!p.born) {
        if (cycleTime < p.delay) {
          anyAlive = true; // todavía pendiente de nacer dentro de esta tanda
          continue;
        }
        p.born = true;
        p.life = 0;
      }

      p.life += delta;
      if (p.life >= p.maxLife) {
        p.finished = true;
        p.born = false;
        alphaAttr.setX(i, 0);
        continue;
      }

      anyAlive = true;
      const t = p.life / p.maxLife; // 0 → nace, 1 → desaparece

      // Ascenso lento y continuo.
      const y = p.speed * p.life;

      // Desviación lateral: combinación de dos ondas por eje, con
      // amplitud que NO empieza a crecer hasta driftOnset (fracción de
      // vida) — así la base del hilo, justo saliendo de la mecha, se
      // mantiene compacta y solapada con sus vecinas (más "hilo único"
      // y menos "partículas sueltas" cerca del origen), y solo se
      // dispersa lateralmente una vez que ya lleva un rato ascendiendo.
      const driftT = Math.max(0, (t - cfg.driftOnset) / (1 - cfg.driftOnset));
      const spread = cfg.driftAmount * driftT;
      const driftX =
        Math.sin(p.life * p.driftFreqX + p.driftPhaseX) * spread +
        Math.cos(p.life * p.driftFreqX * 0.5 + p.driftPhaseZ) * spread * 0.4;
      const driftZ =
        Math.cos(p.life * p.driftFreqZ + p.driftPhaseZ) * spread +
        Math.sin(p.life * p.driftFreqZ * 0.5 + p.driftPhaseX) * spread * 0.4;

      const x = Math.cos(p.baseAngle) * p.baseRadius + driftX;
      const z = Math.sin(p.baseAngle) * p.baseRadius + driftZ;

      positionAttr.setXYZ(i, x, y, z);

      tmpColor.copy(colorNear).lerp(colorFar, t);
      colorAttr.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);

      const size = (cfg.startSize + (cfg.endSize - cfg.startSize) * t) * p.sizeFactor;
      sizeAttr.setX(i, size);

      // Aparece progresivamente, pero en un tiempo ABSOLUTO corto y fijo
      // (fadeInSeconds), no como fracción de la vida de la partícula —
      // antes tardaba 18% de una vida de 2.4-3.4s (~0.4-0.6s reales) en
      // alcanzar su opacidad máxima, y esa era la causa real del
      // retraso percibido de ~1s tras extinguish(). Ahora tarda siempre
      // lo mismo (fadeInSeconds), sin importar cuánto dure la partícula.
      const fadeIn = Math.min(p.life / cfg.fadeInSeconds, 1);
      const fadeOut = 1 - Math.pow(Math.max(0, (t - 0.55) / 0.45), 2);
      const alpha =
        cfg.maxOpacity * p.opacityFactor * Math.max(0, Math.min(fadeIn, fadeOut));
      alphaAttr.setX(i, alpha);
    }

    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;

    material.uniforms.pixelHeight.value = window.innerHeight;

    // Cuando ya no queda ninguna partícula pendiente de nacer ni viva,
    // la tanda termina sola: no queda ningún estado interno que impida
    // volver a llamar a start() más adelante.
    if (!anyAlive) {
      cycleActive = false;
    }
  }

  onUpdate(update);

  // El humo empieza inactivo: solo arranca cuando la llama termina de
  // apagarse de verdad (nunca durante ignite(), ver el comentario junto
  // a onFlameExtinguished en flame.js).
  onFlameExtinguished(() => start());

  return { start, stop, isActive };
}