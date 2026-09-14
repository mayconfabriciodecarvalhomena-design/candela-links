// GET /api/resolve?slug=xxxxx
// Devuelve a qué proyecto apunta ese enlace. Usa la clave de servicio
// (SUPABASE_SERVICE_ROLE_KEY), que solo existe en el servidor: el navegador
// del visitante nunca la ve, así que nunca puede leer la tabla directamente.
//
// ---------------------------------------------------------------------
// Diagnóstico del fallo intermitente (ver informe adjunto):
//
// En producción se observó algún 500 con una duración de ejecución de
// ~5 segundos. La versión de @supabase/supabase-js que este proyecto
// resuelve hoy (no hay lockfile; "^2.45.0" resuelve a 2.116.0 en este
// entorno de prueba) incluye, dentro de @supabase/postgrest-js, un
// REINTENTO AUTOMÁTICO interno con backoff exponencial (1 s, 2 s, 4 s)
// para peticiones GET que fallan por un error de red. Esto es invisible
// desde este archivo: una sola llamada a `.maybeSingle()` puede estar
// reintentando por dentro durante varios segundos antes de devolver el
// error — lo que encaja con los ~5 s observados en Vercel y con que el
// fallo sea intermitente.
//
// Cambios en esta versión:
//  1. Límite de tiempo total (QUERY_TIMEOUT_MS) sobre la consulta,
//     mediante `.abortSignal()`. IMPORTANTE (verificado con pruebas
//     reales, no asumido): esto NO impide de forma limpia que la
//     librería intente una última llamada tras cumplirse el timeout —
//     el temporizador de espera interno del backoff se interrumpe en
//     cuanto se aborta, y la librería procede a un intento más. Ese
//     último intento, sin embargo, se hace con la señal ya abortada, y
//     un fetch real (o cualquier implementación conforme al estándar)
//     rechaza esa llamada de forma prácticamente instantánea, sin
//     actividad de red real. En la práctica esto mantiene el tiempo
//     total acotado a ~QUERY_TIMEOUT_MS + un margen pequeño (decenas de
//     milisegundos), no a QUERY_TIMEOUT_MS exacto. Ver informe para el
//     detalle de la prueba que lo confirma.
//  2. Si faltan las variables de entorno (SUPABASE_URL /
//     SUPABASE_SERVICE_ROLE_KEY) o son inválidas, la creación del
//     cliente está envuelta en try/catch: si createClient() lanza una
//     excepción síncrona, se captura y `supabase` queda en `null`, y el
//     handler responde 500 con nuestro contrato JSON de siempre en vez
//     de que el error tumbe el módulo con un error genérico de Vercel.
//     Nota: esto sigue ejecutándose en el momento en que se importa el
//     módulo (no es una inicialización diferida al handler) — lo que
//     evita el crash no es el "cuándo" se ejecuta, sino el try/catch
//     que lo envuelve. Mover esta misma lógica dentro del handler no
//     añadiría robustez adicional (las variables de entorno de Vercel
//     ya están resueltas antes de que el módulo se cargue, así que no
//     hay ningún valor que "aparezca más tarde"), y sí añadiría el
//     coste de reconstruir el cliente en cada petición en vez de
//     reutilizarlo entre invocaciones en caliente. Por eso se mantiene
//     a nivel de módulo.
//  3. Los logs de error nunca imprimen `error.message` (no se puede
//     garantizar que ninguna versión presente o futura de la librería
//     no incluya ahí algo sensible). Solo se registra: el tipo de
//     error, su código (si lo tiene) y si se debió a nuestro propio
//     timeout — este último dato se obtiene de `controller.signal.aborted`,
//     no del texto del error, así que es fiable independientemente de
//     cómo la librería formatee el mensaje.
//
// El contrato de respuesta (200/400/404/405/500 con los mismos cuerpos
// JSON) no cambia: sigue siendo exactamente el que espera app.js.
// ---------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Límite de tiempo total para la consulta a Supabase (incluye el
// intento inicial y cualquier reintento interno de la librería). Se
// eligió por debajo del timeout por intento que ya usa app.js (6 s),
// para que, si este límite salta, el navegador todavía tenga margen de
// sobra para recibir nuestra respuesta 500 (con su JSON normal) y
// reintentar él mismo, en vez de que sea el propio Vercel quien corte
// la función a mitad de un reintento interno de la librería.
const QUERY_TIMEOUT_MS = 4500;

let supabase = null;
try {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
} catch (e) {
  // Defensivo: createClient puede lanzar de forma síncrona si alguna
  // variable tiene un formato inválido (p. ej. una URL malformada).
  // Se captura para que el fallo se reporte de forma controlada en
  // cada petición (ver comprobación `if (!supabase)` más abajo), en vez
  // de tumbar el módulo entero al importarlo.
  console.error('resolve: supabase_client_init_failed', {
    error_type: e?.constructor?.name || 'Error',
  });
  supabase = null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const slug = String(req.query.slug || '').trim();
  if (!slug || !/^[a-zA-Z0-9_-]{3,64}$/.test(slug)) {
    return res.status(400).json({ error: 'invalid_slug' });
  }

  if (!supabase) {
    // Log seguro: nunca se imprime el valor de las variables, solo si
    // están presentes o ausentes.
    console.error('resolve: missing_or_invalid_supabase_config', {
      has_supabase_url: Boolean(SUPABASE_URL),
      has_supabase_service_role_key: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    });
    return res.status(500).json({ error: 'server_error' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase
      .from('links')
      .select('project_id')
      .eq('slug', slug)
      .abortSignal(controller.signal)
      .maybeSingle());
  } catch (e) {
    // Defensivo: no se ha observado que supabase-js lance excepciones
    // sin capturar (las convierte en `error`), pero se cubre igualmente
    // por si cambia en una versión futura de la librería.
    error = e;
  } finally {
    // Se limpia siempre, tanto si la consulta termina bien, como si
    // devuelve un `error`, como si lanza una excepción.
    clearTimeout(timeoutId);
  }

  if (error) {
    // No se registra error.message: no podemos garantizar que nunca
    // vaya a contener nada sensible en ninguna versión de la librería.
    // `timed_out` se calcula a partir de nuestro propio AbortController,
    // no del contenido del error, así que es fiable pase lo que pase.
    console.error('resolve: supabase_query_failed', {
      error_type: error?.name || error?.constructor?.name || 'unknown',
      error_code: error?.code || null,
      timed_out: controller.signal.aborted,
    });
    return res.status(500).json({ error: 'server_error' });
  }

  if (!data) {
    return res.status(404).json({ error: 'not_found' });
  }

  return res.status(200).json({ project_id: data.project_id });
}
