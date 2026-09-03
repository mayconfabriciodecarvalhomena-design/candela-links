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
// Cada loader devuelve `true` si ya gestiona su propio widget de mensaje
// (como Candela, que lo trae incrustado dentro de su iframe), o `false`/nada
// si queremos que initMessageWidget() se encargue desde aquí.
// -----------------------------------------------------------
const PROJECT_LOADERS = {
  candela: mountCandela,
};

function mountCandela(slug) {
  appEl.innerHTML = '';
  appEl.style.cssText = 'width:100%; height:100%; padding:0;';
  const iframe = document.createElement('iframe');
  iframe.src = `/projects/candela/index.html?slug=${encodeURIComponent(slug)}`;
  iframe.style.cssText = 'width:100%; height:100%; border:none; display:block;';
  iframe.allow = 'autoplay';
  appEl.appendChild(iframe);
  return true; // Candela ya trae su propio widget de mensaje dentro del iframe
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

  const handlesOwnWidget = await PROJECT_LOADERS[projectId](slug);
  if (!handlesOwnWidget) initMessageWidget(slug);
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
