// POST /api/message   body: { slug, content }
// Inserta el mensaje asociado a ese enlace y te avisa por Telegram.
// El visitante nunca escribe directamente en la base de datos: todo pasa
// por aquí, con la clave de servicio guardada solo en el servidor.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_LEN = 2000;

// Límite muy simple en memoria para frenar envíos automáticos masivos.
// (se reinicia si la función "duerme"; suficiente para uso personal)
const lastSubmission = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { slug, content } = req.body || {};

  if (!slug || typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(slug)) {
    return res.status(400).json({ error: 'invalid_slug' });
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'empty_message' });
  }
  if (content.length > MAX_LEN) {
    return res.status(400).json({ error: 'message_too_long' });
  }

  const now = Date.now();
  const last = lastSubmission.get(slug) || 0;
  if (now - last < 3000) {
    return res.status(429).json({ error: 'too_fast' });
  }
  lastSubmission.set(slug, now);

  // Comprobar que el enlace existe de verdad antes de guardar nada
  const { data: link, error: linkError } = await supabase
    .from('links')
    .select('slug, label')
    .eq('slug', slug)
    .maybeSingle();

  if (linkError) {
    console.error(linkError);
    return res.status(500).json({ error: 'server_error' });
  }
  if (!link) {
    return res.status(404).json({ error: 'not_found' });
  }

  const { error: insertError } = await supabase
    .from('messages')
    .insert({ link_slug: slug, content: content.trim() });

  if (insertError) {
    console.error(insertError);
    return res.status(500).json({ error: 'server_error' });
  }

  // Notificación por Telegram (si está configurada). Si falla, no rompemos
  // la respuesta al visitante: el mensaje ya está guardado.
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (token && chatId) {
    try {
      const text =
        `📩 Nuevo mensaje\n` +
        `Enlace: ${link.label || link.slug}\n\n` +
        content.trim();
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    } catch (e) {
      console.error('telegram_notify_failed', e);
    }
  }

  return res.status(200).json({ ok: true });
}
