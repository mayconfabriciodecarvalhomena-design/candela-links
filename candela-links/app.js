// ============================================================
// CANDELA LINKS · público
// Lee el slug de la URL, pregunta a /api/resolve qué proyecto le toca,
// lo "monta" en pantalla, y activa el widget de mensajes.
// ============================================================

const appEl = document.getElementById('app');

function getSlugFromPath() {
  // "/xxxxx" -> "xxxxx"   (también soporta "/xxxxx/" o rutas anidadas futuras)
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  return path.split('/')[0] || '';
}

// -----------------------------------------------------------
// Registro de proyectos disponibles.
// Hoy solo existe un placeholder para 'candela'; cuando integremos
// el proyecto real de Three.js, esta es la única línea que cambia:
// añadir 'candela': () => import('./projects/candela/main.js')
// -----------------------------------------------------------
const PROJECT_LOADERS = {
  candela: mountCandelaPlaceholder,
};

function mountCandelaPlaceholder() {
  appEl.innerHTML = `
    <div class="placeholder">
      <h1>Candela</h1>
      <p>Aquí se cargará la experiencia. (Integración pendiente — de momento
      esto confirma que tu enlace funciona y que puedes escribir un mensaje.)</p>
    </div>
  `;
}

function mountNotFound() {
  appEl.innerHTML = `<div class="not-found">Este enlace no existe.</div>`;
}

async function init() {
  const slug = getSlugFromPath();

  if (!slug) {
    mountNotFound();
    return;
  }

  let projectId = null;
  try {
    const res = await fetch(`/api/resolve?slug=${encodeURIComponent(slug)}`);
    if (res.ok) {
      const data = await res.json();
      projectId = data.project_id;
    }
  } catch (e) {
    console.error(e);
  }

  if (!projectId || !PROJECT_LOADERS[projectId]) {
    mountNotFound();
    return;
  }

  await PROJECT_LOADERS[projectId]();
  initMessageWidget(slug);
}

function initMessageWidget(slug) {
  const box = document.getElementById('message-box');
  const toggle = document.getElementById('message-toggle');
  const panel = document.getElementById('message-panel');
  const textarea = document.getElementById('message-text');
  const sendBtn = document.getElementById('message-send');
  const status = document.getElementById('message-status');

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

init();
