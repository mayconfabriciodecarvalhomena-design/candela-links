// POST /api/visit   body: { slug, session_id }
// Registra UNA visita real a Candela (una entrada/carga de la
// experiencia — ver src/visits.js dentro de projects/candela, que es el
// único sitio que llama a este endpoint, y solo una vez por carga de
// página). El visitante nunca escribe directamente en Supabase: todo
// pasa por aquí, con la clave de servicio guardada solo en el servidor
// — mismo patrón que /api/message.js.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { slug, session_id } = req.body || {};

  // slug es opcional (p. ej. pruebas locales sin enlace de por medio):
  // si viene, debe tener el mismo formato que ya valida /api/resolve.js.
  if (slug !== undefined && slug !== null) {
    if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(slug)) {
      return res.status(400).json({ error: 'invalid_slug' });
    }
  }
  if (session_id !== undefined && session_id !== null) {
    if (typeof session_id !== 'string' || session_id.length > 128) {
      return res.status(400).json({ error: 'invalid_session_id' });
    }
  }

  const { error } = await supabase
    .from('visits')
    .insert({ link_slug: slug || null, session_id: session_id || null });

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'server_error' });
  }

  return res.status(200).json({ ok: true });
}