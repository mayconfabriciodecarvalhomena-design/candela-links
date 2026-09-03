// -----------------------------------------------------------------------
// DEBUG: cuando sea true, activa herramientas de desarrollo (luz de
// inspección extra + marcador técnico de la posición de la llama). Más
// adelante también servirá para saltar de fase, desbloquear frases,
// reiniciar, etc.
//
// Nota de integración: la versión "LLAMA" traía DEBUG en false y la
// versión "PARTÍCULAS" lo traía en true. No hay una implementación más
// reciente que la otra en este punto concreto (es solo un interruptor de
// desarrollo, no depende de qué sistema esté más evolucionado), así que
// se ha mantenido en true a propósito, que era el valor con el que se
// estaba trabajando activamente. Cámbialo a false para ver la
// experiencia "limpia", sin herramientas de desarrollo.
// -----------------------------------------------------------------------
export const DEBUG = false;

// -----------------------------------------------------------------------
// CONFIG.JS ES UN CONECTOR, NO EL LUGAR DONDE SE DESARROLLA CADA SISTEMA.
//
// A partir de ahora el proyecto se desarrolla en paralelo entre varias
// conversaciones, una por sistema (llama, partículas de fondo, cerillas,
// ...). Cada sistema tiene su propia configuración independiente en
// src/config/<sistema>.config.js, que es la fuente de verdad de sus
// parámetros. Este archivo solo IMPORTA esas configuraciones y las
// expone bajo CONFIG, manteniendo la misma interfaz que ya usaban los
// módulos (CONFIG.flame, CONFIG.backgroundParticles, CONFIG.matches...),
// para no romper nada.
//
//   - Llama       → src/config/flame.config.js     → CONFIG.flame
//   - Partículas  → src/config/particles.config.js → CONFIG.backgroundParticles
//   - Cerillas    → src/config/matches.config.js   → CONFIG.matches
//   - Gato        → src/config/cat.config.js       → CONFIG.cat
//   - Habitación  → src/config/room.config.js      → CONFIG.room
//
// Imports ya disponibles (llama, partículas de fondo, cerillas, gato y
// habitación, todos migrados):
import { FLAME_CONFIG } from "./config/flame.config.js";
import { PARTICLES_CONFIG } from "./config/particles.config.js";
import { MATCHES_CONFIG } from "./config/matches.config.js";
import { CAT_CONFIG } from "./config/cat.config.js";
import { HELLO_KITTY_CONFIG } from "./config/helloKitty.config.js";
import { HELLO_KITTY_INSPECTION_CONFIG } from "./config/helloKittyInspection.config.js";
import { ROOM_CONFIG } from "./config/room.config.js";
import { SMOKE_CONFIG } from "./config/smoke.config.js";
import { CANDLE_SEQUENCE_CONFIG } from "./config/candleSequence.config.js";
import { INTRO_PARTICLES_CONFIG } from "./config/introParticles.config.js";
import { MUSIC_CONFIG } from "./config/music.config.js";
import { SFX_CONFIG } from "./config/sfx.config.js";
import { FLAME_WORDS_CONFIG } from "./config/flameWords.config.js";
import { PICTURE_FRAME_CONFIG } from "./config/pictureFrame.config.js";
import { FINALE_CONFIG } from "./config/finale.config.js";

// La vela sigue con su configuración definida directamente aquí abajo,
// dentro de CONFIG, porque todavía no se ha hecho su separación a
// src/config/*.config.js — esa migración le corresponde a la
// conversación responsable de ese sistema.
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// CONFIG: valores que probablemente queramos ajustar a mano.
// Todo lo relacionado con posiciones, colores e intensidades vive aquí,
// para no tener que buscarlo dentro de la lógica de Three.js.
// -----------------------------------------------------------------------
export const CONFIG = {
  scene: {
    backgroundColor: 0x050403,
    ambientColor: 0x2a2118,
    ambientIntensity: 4.2,
    hemisphere: { skyColor: 0x3a3f52, groundColor: 0x1f1712, intensity: 3.3 },
  },

  // Perspectiva de una persona SENTADA delante de la mesa, algo más
  // atrás que la silla — nunca frontal-lejana, nunca completamente
  // lateral. Cámara a una altura de ojos sentado (bastante por encima
  // de TABLE_TOP_Y = 1.0) y en diagonal respecto a la mesa, para que en
  // un mismo encuadre quepan: mesa en primer plano, gato, vela,
  // cerillas, espejo (colgado sobre la mesa) y la puerta a la derecha
  // de la mesa — sin que la mesa ocupe toda la pantalla.
  //
  // REVISADO — layout nuevo de la habitación (mesa+puerta en la misma
  // pared del fondo, mesa con hueco para piernas, espejo reubicado
  // sobre la mesa): cámara y lookAt recalculados para esa composición.
  camera: {
    fov: 56,
    near: 0.1,
    far: 100,
    position: [-0.05, 1.55, 1.3],
    lookAt: [0.7, 1.3, -1.25],
  },

  renderer: {
    toneMappingExposure: 1.0,
  },

  // Luz de inspección, solo para desarrollo. Únicamente se añade a la
  // escena cuando DEBUG === true (ver src/debug.js). No afecta a la
  // experiencia final.
  debugLight: {
    color: 0xffffff,
    intensity: 1.2,
  },

  // -----------------------------------------------------------------------
  // CANDLE: todo lo relacionado con la vela vive aquí. La vela es el
  // modelo 3D real (candle.glb), no geometría de Three.js.
  // -----------------------------------------------------------------------
  candle: {
    // Ruta del modelo, relativa a index.html.
    modelPath: "assets/models/candle.glb",

    // Posición del conjunto vela en la escena (el modelo se apoya
    // automáticamente sobre esta posición, con la base tocando la
    // superficie en Y=position[1]).
    //
    // ACTUALIZADO: la vela ahora vive sobre la mesa de noche (ver
    // room.config.js), no en el suelo. Y = TABLE_TOP_Y (1.0, la
    // constante que exporta room.config.js) para que la base se apoye
    // justo en la superficie del tablero; X/Z la sitúan aproximadamente
    // en el centro de la mesa, con espacio libre alrededor (ver
    // PROJECT_STATE.md para el resto de posiciones del plano — gato,
    // cerillas — coordinadas con esta).
    //
    // REVISADO (2ª pasada) — inversión horizontal de la composición: X
    // negado (-0.4→0.4) en consonancia con el nuevo centro de la mesa
    // (room.config.js, table.top.position, -0.7→0.7). Y/Z sin tocar —
    // esto es solo un dato de posición (coordenada), no un cambio de
    // geometría/escala/comportamiento de la vela: candle.js, su lógica
    // de carga/escalado/detección de mecha y flame.js/flame.config.js
    // no se han tocado.
    position: [0.4, 1.0, -1.25],

    // Rotación en el eje Y, en radianes, por si el modelo necesita girarse
    // para quedar orientado "de cara" a la cámara.
    rotationY: 0,

    // Altura deseada de la vela en la escena. El modelo se escala
    // automáticamente (de forma uniforme) para alcanzar esta altura,
    // sea cual sea el tamaño original del archivo .glb.
    //
    // REVISADO — 1.1 hacía que la vela dominara la mesa (casi tan alta
    // como la propia mesa es larga en profundidad, fuera de proporción
    // real). Bajada a una altura de vela de mesa normal. La llama sigue
    // el wick real medido sobre el modelo ya escalado (ver
    // candle.js/onWickReady), así que este cambio no requiere tocar
    // nada de flame.js/flame.config.js — solo el punto de contacto
    // INDEPENDIENTE que usan las cerillas para detectar que han tocado
    // la mecha (ver nota "ACTUALIZADO" en matches.config.js/interaction,
    // ajustado en este mismo cambio).
    targetHeight: 0.62,
  },

  // -----------------------------------------------------------------------
  // FLAME: configuración completa en src/config/flame.config.js (fuente
  // de verdad de este sistema). Aquí solo se conecta bajo el nombre que
  // ya usa flame.js.
  // -----------------------------------------------------------------------
  flame: FLAME_CONFIG,

  // -----------------------------------------------------------------------
  // BACKGROUND PARTICLES: motas de polvo/luz que dan profundidad al
  // fondo (src/particlesBackground.js). Sistema independiente de la
  // vela y de la llama.
  //
  // La configuración completa vive en src/config/particles.config.js
  // (fuente de verdad de este sistema). Aquí solo se conecta bajo el
  // nombre que ya usa particlesBackground.js.
  // -----------------------------------------------------------------------
  backgroundParticles: PARTICLES_CONFIG,

  // -----------------------------------------------------------------------
  // MATCHES: configuración del sistema de cerillas (matches.js +
  // matchVisual.js). Fuente de verdad real: src/config/matches.config.js
  // (responsabilidad de la conversación de cerillas). Aquí solo se
  // importa y se expone.
  // -----------------------------------------------------------------------
  matches: MATCHES_CONFIG,

  // -----------------------------------------------------------------------
  // CAT: configuración del sistema del gato (src/cat.js). Fuente de
  // verdad real: src/config/cat.config.js (responsabilidad exclusiva de
  // ese sistema). Aquí solo se importa y se expone, sin duplicar
  // valores — mismo criterio que llama, partículas y cerillas.
  // -----------------------------------------------------------------------
  cat: CAT_CONFIG,

  // -----------------------------------------------------------------------
  // HELLO KITTY: pequeño detalle decorativo de mesa (src/helloKitty.js).
  // Fuente de verdad real: src/config/helloKitty.config.js. Aquí solo se
  // importa y se expone, mismo criterio que el resto de sistemas.
  // -----------------------------------------------------------------------
  helloKitty: HELLO_KITTY_CONFIG,

  // -----------------------------------------------------------------------
  // HELLO KITTY INSPECTION: interacción de click/tap sobre la Hello
  // Kitty para acercar la cámara y observarla de cerca
  // (src/helloKittyInspection.js). Fuente de verdad real:
  // src/config/helloKittyInspection.config.js. Aquí solo se importa y
  // se expone, mismo criterio que el resto de sistemas.
  // -----------------------------------------------------------------------
  helloKittyInspection: HELLO_KITTY_INSPECTION_CONFIG,

  // -----------------------------------------------------------------------
  // ROOM: configuración del plano de habitación (src/room.js) — suelo,
  // paredes, mesa, espejo y puerta. Fuente de verdad real:
  // src/config/room.config.js (responsabilidad exclusiva de ese
  // sistema, incluida la constante TABLE_TOP_Y que usan el resto de
  // sistemas para apoyarse en la mesa). Aquí solo se importa y se
  // expone, sin duplicar valores.
  // -----------------------------------------------------------------------
  room: ROOM_CONFIG,

  // -----------------------------------------------------------------------
  // SMOKE: configuración del hilo de humo que queda tras apagar la llama
  // de la vela (src/smoke.js). Fuente de verdad real:
  // src/config/smoke.config.js. Aquí solo se importa y se expone, mismo
  // criterio que el resto de sistemas.
  // -----------------------------------------------------------------------
  smoke: SMOKE_CONFIG,

  // -----------------------------------------------------------------------
  // CANDLE SEQUENCE: tiempos de la secuencia narrativa de encendido de
  // la vela (primer/segundo encendido con apagado automático, tercer
  // encendido definitivo). Fuente de verdad real:
  // src/config/candleSequence.config.js. Aquí solo se importa y se
  // expone, mismo criterio que el resto de sistemas.
  // -----------------------------------------------------------------------
  candleSequence: CANDLE_SEQUENCE_CONFIG,

  // -----------------------------------------------------------------------
  // INTRO PARTICLES: partículas decorativas de la pantalla de entrada
  // (movimiento ambiental + evento especial del corazón). Sistema 2D
  // con Canvas puro, independiente de Three.js. Fuente de verdad real:
  // src/config/introParticles.config.js. Aquí solo se importa y se
  // expone, mismo criterio que el resto de sistemas.
  // -----------------------------------------------------------------------
  introParticles: INTRO_PARTICLES_CONFIG,

  // -----------------------------------------------------------------------
  // MUSIC: música ambiental que suena en bucle durante la experiencia.
  // Fuente de verdad real: src/config/music.config.js. Aquí solo se
  // importa y se expone, mismo criterio que el resto de sistemas.
  // -----------------------------------------------------------------------
  music: MUSIC_CONFIG,

  // -----------------------------------------------------------------------
  // SFX: maullido ocasional del gato. Sistema independiente de
  // MUSIC_CONFIG/music.js — cada uno usa sus propios elementos <audio>.
  // Fuente de verdad real: src/config/sfx.config.js. Aquí solo se
  // importa y se expone, mismo criterio que el resto de sistemas.
  // -----------------------------------------------------------------------
  sfx: SFX_CONFIG,

  // -----------------------------------------------------------------------
  // FLAME WORDS (v0 experimental): partículas que parecen desprenderse
  // de la llama y organizarse en una palabra corta legible. Fuente de
  // verdad real: src/config/flameWords.config.js. Aquí solo se importa
  // y se expone, mismo criterio que el resto de sistemas. Ver el propio
  // archivo de configuración para el estado/alcance de esta v0.
  // -----------------------------------------------------------------------
  flameWords: FLAME_WORDS_CONFIG,

  // -----------------------------------------------------------------------
  // PICTURE FRAME: cuadro decorativo colgado en la pared del fondo,
  // encima de la vela (src/pictureFrame.js). Elemento nuevo e
  // independiente — no toca room.js ni ningún otro sistema. Fuente de
  // verdad real: src/config/pictureFrame.config.js. Aquí solo se
  // importa y se expone, mismo criterio que el resto de sistemas.
  // -----------------------------------------------------------------------
  pictureFrame: PICTURE_FRAME_CONFIG,

  // -----------------------------------------------------------------------
  // FINALE: primera parte del final de Candela (transición desde la
  // última frase de FlameWords hasta el sobre abierto). Fuente de
  // verdad real: src/config/finale.config.js. Aquí solo se importa y se
  // expone, mismo criterio que el resto de sistemas.
  // -----------------------------------------------------------------------
  finale: FINALE_CONFIG,
};