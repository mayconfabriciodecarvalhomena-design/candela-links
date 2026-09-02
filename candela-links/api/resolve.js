// GET /api/resolve?slug=xxxxx
// Devuelve a qué proyecto apunta ese enlace. Usa la clave de servicio
// (SUPABASE_SERVICE_ROLE_KEY), que solo existe en el servidor: el navegador
// del visitante nunca la ve, así que nunca puede leer la tabla directamente.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const slug = String(req.query.slug || '').trim();
  if (!slug || !/^[a-zA-Z0-9_-]{3,64}$/.test(slug)) {
    return res.status(400).json({ error: 'invalid_slug' });
  }

  const { data, error } = await supabase
    .from('links')
    .select('project_id')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    console.error(error);
    return res.status(500).json({ error: 'server_error' });
  }

  if (!data) {
    return res.status(404).json({ error: 'not_found' });
  }

  return res.status(200).json({ project_id: data.project_id });
}
