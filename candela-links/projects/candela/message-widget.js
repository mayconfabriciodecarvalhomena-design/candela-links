// Widget de mensaje para Candela.
// Independiente de main.js: no importa ni toca nada del proyecto 3D.
// Lee el "slug" del enlace desde la URL (?slug=xxxxx) y lo manda a /api/message.

function getSlug() {
  const params = new URLSearchParams(window.location.search);
  return params.get('slug') || '';
}

function initMessageWidget(slug) {
  const box = document.getElementById('message-box');
  const toggle = document.getElementById('message-toggle');
  const panel = document.getElementById('message-panel');
  const textarea = document.getElementById('message-text');
  const sendBtn = document.getElementById('message-send');
  const status = document.getElementById('message-status');

  if (!box) return;
  box.classList.remove('hidden');

  toggle.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) textarea.focus();
  });

  sendBtn.addEventListener('click', async () => {
    const content = textarea.value.trim();
    if (!content) return;

    sendBtn.disabled = true;
    status.textContent = 'Enviando…';

    try {
      const res = await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, content }),
      });
      if (res.ok) {
        textarea.value = '';
        status.textContent = 'Enviado ✓';
        setTimeout(() => (status.textContent = ''), 2500);
      } else {
        status.textContent = 'No se pudo enviar. Inténtalo de nuevo.';
      }
    } catch (e) {
      status.textContent = 'No se pudo enviar. Inténtalo de nuevo.';
    } finally {
      sendBtn.disabled = false;
    }
  });
}

const slug = getSlug();
if (slug) initMessageWidget(slug);
