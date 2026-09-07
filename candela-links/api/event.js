// POST /api/event   body: { slug?, session_id, device_id?, event_type,
//                            from_page?, to_page?, seq?, client_ts?, meta? }
// Registra UN evento dentro de una visita ya existente (ver
// projects/candela/src/visits.js, único sitio que llama a este endpoint:
// experience_started, candle_words_started, envelope_shown, page_changed,
// heartbeat). Mismo patrón que /api/visit.js y /api/message.js: el
// visitante nunca toca Supabase directamente, todo pasa por aquí con la
// clave de servicio guardada solo en el servidor.
//
// Cada llamada inserta una fila NUEVA (nunca actualiza ni sobrescribe
// nada existente), así que el historial completo de una visita se
// reconstruye después consultando todas las filas con el mismo
// session_id, ordenadas por created_at/seq — ver supabase/schema.sql.
//
// Se llama también vía navigator.sendBeacon() (para los heartbeats de
// "pestaña oculta"/"pagehide", que necesitan sobrevivir al cierre de la
// pestaña) — sendBeacon manda el cuerpo como application/json igual que
// un POST normal, así que este handler no necesita distinguir el origen.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Tipos de evento conocidos por esta iteración (ver PARTE 1 del
// encargo). No se usa como lista cerrada estricta (algo como "heartbeat"
// ya está aquí, y podría añadirse alguno más en el futuro sin tocar este
// archivo) — solo se valida el FORMATO (minúsculas/números/guion bajo),
// nunca el valor exacto, para no tener que desplegar de nuevo el backend
// cada vez que se añada un evento nuevo en el frontend.
const EVENT_TYPE_RE = /^[a-z0-9_-]{1,64}$/;
const MAX_META_JSON_LENGTH = 2000;

function isValidOptionalString(value, maxLength) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= maxLength);
}

function isValidOptionalInt(value) {
  return value === undefined || value === null || Number.isInteger(value);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const {
    slug,
    session_id,
    device_id,
    event_type,
    from_page,
    to_page,
    seq,
    client_ts,
    meta,
  } = req.body || {};

  if (slug !== undefined && slug !== null) {
    if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(slug)) {
      return res.status(400).json({ error: 'invalid_slug' });
    }
  }
  if (typeof session_id !== 'string' || !session_id || session_id.length > 128) {
    return res.status(400).json({ error: 'invalid_session_id' });
  }
  if (!isValidOptionalString(device_id, 128)) {
    return res.status(400).json({ error: 'invalid_device_id' });
  }
  if (typeof event_type !== 'string' || !EVENT_TYPE_RE.test(event_type)) {
    return res.status(400).json({ error: 'invalid_event_type' });
  }
  if (!isValidOptionalInt(from_page) || !isValidOptionalInt(to_page) || !isValidOptionalInt(seq)) {
    return res.status(400).json({ error: 'invalid_page_or_seq' });
  }

  let clientTsValue = null;
  if (client_ts !== undefined && client_ts !== null) {
    const parsed = new Date(client_ts);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'invalid_client_ts' });
    }
    clientTsValue = parsed.toISOString();
  }

  let metaValue = null;
  if (meta !== undefined && meta !== null) {
    if (typeof meta !== 'object' || Array.isArray(meta)) {
      return res.status(400).json({ error: 'invalid_meta' });
    }
    // Límite defensivo de tamaño: esto es analítica de comportamiento,
    // nunca un sitio para volcar datos personales o payloads grandes.
    if (JSON.stringify(meta).length > MAX_META_JSON_LENGTH) {
      return res.status(400).json({ error: 'meta_too_large' });
    }
    metaValue = meta;
  }

  const { error } = await supabase.from('analytics_events').insert({
    link_slug: slug || null,
    session_id,
    device_id: device_id || null,
    event_type,
    from_page: from_page ?? null,
    to_page: to_page ?? null,
    seq: seq ?? null,
    client_ts: clientTsValue,
    meta: metaValue,
  });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'server_error' });
  }

  return res.status(200).json({ ok: true });
}
