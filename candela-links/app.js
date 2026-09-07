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

function mountRetriableError(onRetry) {
  appEl.innerHTML = `
    <div class="not-found">
      No se ha podido cargar.<br />Comprueba tu conexión.
      <br /><button type="button" class="retry-button">Reintentar</button>
    </div>
  `;
  appEl.querySelector('.retry-button').addEventListener('click', onRetry);
}

// -----------------------------------------------------------------
// resolveSlug(slug): llama a /api/resolve con reintentos + timeout.
//
// ANTES: una única llamada `fetch` sin reintento ni timeout. Un fallo
// de red PUNTUAL (muy plausible en el móvil real donde vive este
// enlace: datos móviles, cambio de celda, cold start del propio
// endpoint serverless en Vercel...) hacía que `projectId` se quedara
// en `null` y se mostrara PERMANENTEMENTE "Este enlace no existe.",
// aunque el enlace fuera perfectamente válido y el fallo fuera
// transitorio — esto es lo que se percibía como "a veces no carga la
// experiencia" (ver el informe de esta iteración).
//
// AHORA: se reintenta unas pocas veces con una pequeña espera
// creciente entre intentos, y cada intento tiene un timeout propio
// (AbortController) para no quedarse colgado indefinidamente si la
// respuesta nunca llega. Solo tras agotar los reintentos se considera
// un fallo real: `res.status === 404` es la única respuesta que se
// trata como "el enlace no existe" de verdad (ver api/resolve.js);
// cualquier otro fallo (red, timeout, 500...) se trata como
// error transitorio y ofrece un botón "Reintentar" en vez del mensaje
// definitivo de enlace inexistente.
// -----------------------------------------------------------------
async function resolveSlug(slug) {
  const MAX_ATTEMPTS = 3;
  const TIMEOUT_MS = 6000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`/api/resolve?slug=${encodeURIComponent(slug)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 404) {
        return { status: 'not_found' };
      }
      if (res.ok) {
        const data = await res.json();
        return { status: 'ok', projectId: data.project_id };
      }
      // Otro código (500, etc.): tratado como fallo transitorio, sigue
      // reintentando abajo salvo que ya sea el último intento.
    } catch (e) {
      clearTimeout(timeoutId);
      console.error(e);
      // Fallo de red o timeout: sigue reintentando abajo salvo que ya
      // sea el último intento.
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }

  return { status: 'error' };
}

async function init() {
  const slug = getSlugFromPath();

  if (!slug) {
    mountNotFound();
    return;
  }

  const result = await resolveSlug(slug);

  if (result.status === 'error') {
    mountRetriableError(init);
    return;
  }

  const projectId = result.status === 'ok' ? result.projectId : null;
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
