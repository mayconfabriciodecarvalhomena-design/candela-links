// -----------------------------------------------------------------------
// HELLO_KITTY_CONFIG: fuente de verdad de la configuración del pequeño
// detalle decorativo de Hello Kitty sobre la mesa (src/helloKitty.js).
// Mismo patrón de arquitectura que candle/cat/matches: este archivo es
// responsabilidad exclusiva de ese sistema, y src/config.js solo lo
// importa y lo expone como CONFIG.helloKitty, sin duplicar valores.
//
// MODELO: assets/models/hello_kitty.glb (Sketchfab, "Hello Kitty" por
// fukkacumy, CC-BY-4.0 — https://sketchfab.com/3d-models/hello-kitty-
// 5eae121ca573484fbc47cb2dff36d82b). Malla ESTÁTICA con materiales PBR
// normales (baseColorFactor/metallicFactor/roughnessFactor — NO usa
// KHR_materials_unlit ni iluminación horneada), así que GLTFLoader la
// carga como MeshStandardMaterial de verdad: reacciona a las luces reales
// de la escena exactamente igual que candle.glb. Por eso, a diferencia
// de cat.js, aquí NO hace falta ningún sistema de revelado por opacidad:
// con la vela apagada se ve oscura (solo con la luz ambiental/hemisferio
// tenues de CONFIG.scene) pero sólida y reconocible, y con la vela
// encendida la recibe de verdad la PointLight cálida de flame.js — sin
// fundidos artificiales, es iluminación real. Ver src/helloKitty.js.
//
// ORIENTACIÓN — medida por inspección directa de la geometría del GLB
// (bounding box y renders de comprobación desde varios ángulos, fuera
// del navegador): la "cara" reconocible de Hello Kitty (lazo, ojos,
// bigotes, nariz) queda sobre el eje LOCAL -X del modelo, no sobre +Z
// como sería más habitual — es simplemente cómo viene exportado este
// archivo concreto. `rotationY` de abajo ya tiene en cuenta ese eje
// real para que, aplicado tal cual, el modelo quede mirando hacia la
// cámara (ver el razonamiento completo en la entrega de esta tarea).
// -----------------------------------------------------------------------
export const HELLO_KITTY_CONFIG = {
  // Ruta del modelo, relativa a index.html (mismo criterio que
  // CONFIG.candle.modelPath / CAT_CONFIG.modelPath).
  modelPath: "assets/models/hello_kitty.glb",

  // Posición del grupo en la escena. Igual que candle/cat: Y es la
  // altura de la superficie sobre la que se apoya (1.0 = TABLE_TOP_Y en
  // room.config.js — valor independiente, no importado, mismo criterio
  // ya usado por CONFIG.candle.position/CAT_CONFIG.position: si
  // TABLE_TOP_Y cambiara alguna vez, esta Y también habría que
  // ajustarla a mano). helloKitty.js calcula el apoyo real sobre esa
  // superficie en tiempo de ejecución (Box3, igual que candle.js).
  //
  // X/Z — DISTRIBUCIÓN DE MESA (ajuste de solo posición, escala y
  // rotación sin cambios): Hello Kitty se sitúa en el LADO DERECHO
  // de la mesa, junto al grupo de la vela y las cerillas. El gato
  // queda aislado en el lado izquierdo. La cámara está orientada en
  // diagonal (CONFIG.camera), por lo que "derecha visual en pantalla"
  // requiere combinar X alto con Z más alto (más cerca de cámara):
  //
  //   Proyección real desde CONFIG.camera (1920x1080):
  //   - gato:      [-0.5, 1.0, -1.15]  → screen x=456  (IZQUIERDA)
  //   - vela:      [0.4, 1.0, -1.25]   → screen x=848  (centro-izq, FIJA)
  //   - Hello K.:  [0.95, 1.0, -0.88]  → screen x=1105 (DERECHA)
  //   - cerilla:   [0.8, 1.0, -1.02]   → screen x=1025 (DERECHA)
  //   - caja:      [0.65, 1.0, -1.15]  → screen x=952  (centro-derecha)
  //
  // Resultado visual: GATO(456) ──hueco── GRUPO(848..1105) con
  // Hello Kitty en el extremo derecho del grupo y la vela anclando
  // el extremo izquierdo del grupo. Separación gato-grupo: ~392px.
  // Hello Kitty (-0.88 en Z) queda ligeramente más al frente que el
  // resto del grupo, dando profundidad orgánica. Sigue dentro del
  // tablero real (x ∈ [-1.0, 2.4], z ∈ [-1.58, -0.68]).
  position: [1.64, 1.0, -0.92],

  // Rotación en Y (radianes). Con la cara real del modelo en el eje
  // local -X (ver nota de arriba), Math.PI/2 hace que esa cara quede
  // mirando hacia +Z — que es, aproximadamente, hacia donde está la
  // cámara desde esta zona de la mesa (CONFIG.camera en config.js) — es
  // la orientación frontal natural del propio modelo, no un giro forzado.
  rotationY: Math.PI / 2,

  // Altura deseada en la escena. Mismo mecanismo que candle.js/cat.js:
  // el modelo se mide con THREE.Box3 nada más cargar y se escala de
  // forma UNIFORME para alcanzar esta altura, sea cual sea el tamaño
  // original del archivo (2.24 x 4.24 x 4.24 en unidades brutas del
  // .glb — Y es su eje más largo, consistente con un personaje de pie).
  //
  // Deliberadamente menor que CONFIG.candle.targetHeight (0.62) y que
  // CAT_CONFIG.targetHeight (0.42): es un detalle secundario de mesa,
  // no debe competir en protagonismo con la vela ni con el gato.
  targetHeight: 0.3,
};
