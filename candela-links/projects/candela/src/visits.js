// -----------------------------------------------------------------------
// VISITAS: registra en Supabase (vía /api/visit, mismo patrón que
// /api/message.js) UNA vez por entrada real a la experiencia — nunca por
// cargar el HTML, nunca por interacciones internas (páginas, vela,
// escritura...). Quien decide CUÁNDO se ha "entrado de verdad" es
// main.js: llama a recordVisit() dentro de los propios listeners de
// intro.onStart()/intro.onSkip() (el usuario pulsando un botón), nunca
// antes.
//
// El navegador nunca toca Supabase directamente ni conoce ninguna clave:
// esto solo hace un fetch a un endpoint propio del proyecto, igual que
// letterWriteControls.js ya hace contra /api/message.
// -----------------------------------------------------------------------

let recorded = false;

function getSlug() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("slug") || null;
  } catch (e) {
    return null;
  }
}

function createSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Un único id por carga de página — no se persiste en ningún sitio
// (no es el mismo concepto que "candela_visited_v1" de skipIntro.js,
// que vive en localStorage y sobrevive entre visitas: este es solo para
// poder distinguir eventos de visita entre sí si hiciera falta, y muere
// con la pestaña).
const sessionId = createSessionId();

// recordVisit(): protegida contra llamadas repetidas dentro de la misma
// carga de página — da igual si se llama desde onStart y desde onSkip,
// o si por lo que sea se llamara más de una vez: como mucho hace UNA
// petición real. Un fallo de red no debe bloquear ni romper la
// experiencia: si falla, simplemente esa visita no queda registrada esa
// vez.
export function recordVisit(endpoint = "/api/visit") {
  if (recorded) return;
  recorded = true;

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: getSlug(), session_id: sessionId }),
  }).catch((e) => {
    console.error("Candela: no se pudo registrar la visita", e);
  });
}