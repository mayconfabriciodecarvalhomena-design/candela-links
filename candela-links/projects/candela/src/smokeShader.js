// -----------------------------------------------------------------------
// Shader dedicado para el humo. Antes reutilizaba EMBER_VERTEX_SHADER /
// EMBER_FRAGMENT_SHADER (flameShader.js), pensado para brasas: puntos
// pequeños, brillantes, con una textura de gradiente radial PERFECTAMENTE
// simétrica. Eso es exactamente lo que hace que una brasa se lea como un
// punto de luz — y también, sin querer, lo que hacía que el humo se
// leyera como "círculos grises": un gradiente radial perfecto, por muy
// suave que sea su caída, sigue teniendo una silueta perfectamente
// circular, y al estar aislado (pocas partículas, separadas) el ojo lo
// identifica como una forma geométrica, no como una voluta de humo.
//
// Este shader es solo para humo, no se usa en la llama ni en las brasas
// (que siguen intactas en flameShader.js, sin tocar):
//
// - Sin textura/canvas: la silueta se calcula por completo en el
//   fragment shader (más barato, y evita depender de los stops fijos de
//   un CanvasTexture).
// - La caída de opacidad es completamente suave, sin ningún tramo plano
//   (a diferencia del gradiente anterior, que tenía una meseta de
//   opacidad casi constante hasta el 35% del radio).
// - Se rompe la simetría circular con ruido procedural de baja
//   frecuencia (con semilla propia por partícula), así cada mancha tiene
//   un contorno ligeramente irregular, orgánico, en vez de un disco
//   perfecto.
// - Sigue sin emitir luz (blending normal, no aditivo) — eso ya era
//   correcto y no cambia.
// -----------------------------------------------------------------------
export const SMOKE_VERTEX_SHADER = `
  attribute float size;
  attribute vec3 particleColor;
  attribute float alpha;
  attribute float seed;

  uniform float pixelHeight;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vColor = particleColor;
    vAlpha = alpha;
    vSeed = seed;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (pixelHeight * 0.5) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const SMOKE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSeed;

  // Hash/ruido de valor barato (suficiente para romper la simetría
  // circular sin coste real; no necesita ser un ruido de calidad de
  // producción, solo dejar de parecer un círculo perfecto).
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  void main() {
    vec2 centered = gl_PointCoord - vec2(0.5);
    float dist = length(centered) * 2.0; // 0 en el centro, 1 en el borde del sprite

    // Caída completamente suave y continua desde el centro, sin ninguna
    // meseta: en el radio exterior del sprite el alpha ya es 0, así que
    // nunca hay un borde definido que leer como "círculo".
    float falloff = 1.0 - smoothstep(0.0, 1.0, dist);
    falloff = pow(falloff, 1.7);

    // Ruido de baja frecuencia (semilla por partícula, así cada una es
    // distinta) que modula esa caída: rompe la simetría perfecta y le da
    // un contorno irregular, más parecido a una voluta de humo que a un
    // punto geométrico.
    float n = valueNoise(gl_PointCoord * 2.6 + vec2(vSeed * 17.0, vSeed * 9.0));
    float shape = falloff * (0.6 + 0.4 * n);

    float finalAlpha = shape * vAlpha;
    if (finalAlpha < 0.003) discard;

    gl_FragColor = vec4(vColor, finalAlpha);
  }
`;