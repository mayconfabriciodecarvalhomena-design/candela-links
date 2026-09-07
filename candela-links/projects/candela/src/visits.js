// -----------------------------------------------------------------------
// ANALÍTICA DE VISITAS (ver PARTE 1 del encargo de esta iteración).
//
// Este archivo sigue llamándose visits.js (mismo nombre e import que ya
// usaba main.js: `import { recordVisit } from "./visits.js"`) pero ahora
// hace dos cosas, ambas completamente secundarias y no bloqueantes —
// UN FALLO DE RED AQUÍ NUNCA DEBE ROMPER NI RALENTIZAR CANDELA:
//
//   1. recordVisit() — SIN CAMBIOS DE COMPORTAMIENTO respecto a antes:
//      sigue registrando en la tabla `visits` (vía /api/visit) UNA vez
//      por entrada real a la experiencia, exactamente igual que ya
//      hacía. Lo único añadido es que ahora también manda `device_id`
//      en ese mismo POST (columna nueva, opcional, ver supabase/schema.sql)
//      y dispara el nuevo sistema de eventos de abajo.
//
//   2. trackEvent(type, payload) — NUEVO. Manda un evento a la tabla
//      `analytics_events` (vía /api/event) con device_id + session_id +
//      slug + tipo + timestamp del navegador. Cada evento es una fila
//      nueva (nunca se sobrescribe nada), así que el historial completo
//      de una visita se reconstruye después consultando todas las filas
//      con el mismo session_id, ordenadas por fecha — ver README/
//      supabase/schema.sql para las consultas de ejemplo.
//
// DEVICE_ID vs SESSION_ID:
//   - session_id: UNA visita concreta. Nace en memoria al cargar este
//     módulo (igual que antes) y muere con la pestaña — nunca se
//     persiste. Cada carga de página = un session_id distinto.
//   - device_id: identificador aleatorio que SÍ se persiste (localStorage,
//     con una cookie como respaldo si localStorage no está disponible —
//     p. ej. navegación privada en algunos navegadores) para poder
//     agrupar varias visitas del mismo navegador/dispositivo a lo largo
//     del tiempo. Como cualquier identificador de este tipo, es solo
//     aproximado: borrar datos del navegador, cambiar de navegador/
//     dispositivo o usar modo privado puede hacer que aparezca como un
//     device_id distinto. No se usa ninguna técnica de fingerprinting
//     (huella de canvas/audio/fuentes, etc.), solo un id aleatorio
//     guardado por el propio navegador.
//
// DURACIÓN / ÚLTIMA ACTIVIDAD:
//   `beforeunload` no es fiable (sobre todo en móvil: cerrar la pestaña,
//   deslizar la app fuera o apagar la pantalla no siempre lo disparan).
//   En su lugar:
//     - Cada evento manda su propio timestamp (client_ts).
//     - Mientras la pestaña está visible, se manda un "heartbeat" cada
//       HEARTBEAT_INTERVAL_MS.
//     - Al ocultarse la pestaña (visibilitychange → "hidden", que SÍ es
//       fiable en móvil: cubre cambiar de app, bloquear pantalla o
//       cerrar la pestaña) y en "pagehide", se manda un heartbeat
//       inmediato de todas formas.
//   Así, "última actividad" ≈ el timestamp del último evento/heartbeat
//   recibido para ese session_id, y "duración aproximada" ≈ última
//   actividad − primer evento (experience_started), consultable después
//   directamente con SQL sobre `analytics_events` (ver schema.sql).
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

function createRandomId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// ---- device_id: localStorage como mecanismo principal, cookie como
// respaldo si localStorage lanza o no está disponible. Ninguno de los
// dos se trata como fuente de verdad absoluta: es best-effort, tal y
// como se pidió ("no identifica físicamente un dispositivo de forma
// absoluta"). ----
const DEVICE_ID_KEY = "candela_device_id_v1";

function readDeviceIdCookie() {
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${DEVICE_ID_KEY}=([^;]*)`)
    );
    return match ? decodeURIComponent(match[1]) : null;
  } catch (e) {
    return null;
  }
}

function writeDeviceIdCookie(value) {
  try {
    const twoYearsInSeconds = 60 * 60 * 24 * 365 * 2;
    document.cookie = `${DEVICE_ID_KEY}=${encodeURIComponent(value)}; max-age=${twoYearsInSeconds}; path=/; SameSite=Lax`;
  } catch (e) {
    // La cookie es solo el respaldo del respaldo: si tampoco se puede
    // escribir, seguimos adelante con el id en memoria para esta visita.
  }
}

function getOrCreateDeviceId() {
  let id = null;
  try {
    id = window.localStorage.getItem(DEVICE_ID_KEY);
  } catch (e) {
    id = null; // localStorage bloqueado/no disponible (p. ej. privado)
  }
  if (!id) id = readDeviceIdCookie();
  if (!id) id = createRandomId("d");

  try {
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  } catch (e) {
    // Si localStorage falla al escribir, seguimos adelante: la cookie
    // de abajo puede bastar para persistirlo igualmente.
  }
  writeDeviceIdCookie(id);
  return id;
}

// Un id por carga de página (nace en memoria, muere con la pestaña —
// mismo comportamiento que antes de esta iteración, ver cabecera).
const sessionId = createRandomId("s");
const deviceId = getOrCreateDeviceId();

// -----------------------------------------------------------------------
// ENVÍO NO BLOQUEANTE: sendBeacon cuando está disponible (sobrevive a
// que la pestaña se cierre justo después, que es exactamente el caso
// que más nos importa aquí — heartbeat de "hidden"/"pagehide"), con
// fetch(keepalive) como respaldo en navegadores sin sendBeacon. Nunca
// lanza ni bloquea: cualquier error se traga en silencio, tal y como se
// pidió ("la analítica debe ser completamente secundaria").
// -----------------------------------------------------------------------
function sendPayload(endpoint, data) {
  try {
    const body = JSON.stringify(data);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      const queued = navigator.sendBeacon(endpoint, blob);
      if (queued) return;
    }
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch (e) {
    // Ver cabecera del archivo: un fallo aquí nunca debe afectar a
    // Candela, así que no se relanza ni se muestra al usuario.
  }
}

// Contador local para poder ordenar eventos con total seguridad aunque
// dos lleguen con el mismo timestamp de servidor (p. ej. dos heartbeats
// muy seguidos) — se manda como `seq`, puramente informativo.
let seq = 0;

// trackEvent(type, payload?): envía UN evento nuevo (nunca sobrescribe
// nada existente) a /api/event. `payload` puede incluir from_page/
// to_page (page_changed) u otros datos puntuales — ver los puntos de
// llamada reales en main.js/candelaFinale.js/flameWords.js.
export function trackEvent(eventType, payload = {}) {
  seq += 1;
  sendPayload("/api/event", {
    slug: getSlug(),
    session_id: sessionId,
    device_id: deviceId,
    event_type: eventType,
    seq,
    client_ts: new Date().toISOString(),
    ...payload,
  });
}

// ---- Heartbeat: ver "DURACIÓN / ÚLTIMA ACTIVIDAD" en la cabecera del
// archivo. Se arranca UNA vez, desde recordVisit() (el mismo momento en
// que ya sabemos que ha habido una entrada real a la experiencia). ----
const HEARTBEAT_INTERVAL_MS = 20000;
let heartbeatStarted = false;

function startHeartbeat() {
  if (heartbeatStarted) return;
  heartbeatStarted = true;

  window.setInterval(() => {
    if (document.visibilityState === "visible") trackEvent("heartbeat");
  }, HEARTBEAT_INTERVAL_MS);

  // "hidden" cubre, de forma fiable también en móvil, cambiar de app,
  // bloquear la pantalla o cerrar la pestaña — a diferencia de
  // beforeunload/unload, que no siempre se disparan ahí.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") trackEvent("heartbeat");
  });
  // Respaldo adicional para el caso de navegación fuera de la página
  // (p. ej. seguir un enlace) sin pasar antes por "hidden".
  window.addEventListener("pagehide", () => trackEvent("heartbeat"));
}

// recordVisit(): SIN CAMBIOS de comportamiento respecto a la versión
// anterior de este archivo — protegida contra llamadas repetidas dentro
// de la misma carga de página (da igual si se llama desde onStart y
// desde onSkip), sigue mandando como mucho UNA petición real a
// /api/visit con el mismo `session_id` de siempre. Lo único nuevo:
// también manda `device_id`, y además dispara el evento
// "experience_started" + el heartbeat del nuevo sistema de arriba.
export function recordVisit(endpoint = "/api/visit") {
  if (recorded) return;
  recorded = true;

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: getSlug(), session_id: sessionId, device_id: deviceId }),
  }).catch((e) => {
    console.error("Candela: no se pudo registrar la visita", e);
  });

  trackEvent("experience_started");
  startHeartbeat();
}
