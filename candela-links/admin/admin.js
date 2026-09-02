// ============================================================
// CANDELA LINKS · panel de administración
// Habla directo con Supabase (con tu sesión autenticada) — no con /api.
// RLS en la base de datos garantiza que solo un admin puede leer/escribir.
// ============================================================

import { createClient } from '@supabase/supabase-js';

// Rellena estos dos valores con los tuyos (Supabase → Project Settings → API)
const SUPABASE_URL = 'PON_AQUI_TU_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'PON_AQUI_TU_SUPABASE_ANON_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

const newLinkForm = document.getElementById('new-link-form');
const newLinkLabel = document.getElementById('new-link-label');
const newLinkProject = document.getElementById('new-link-project');
const newLinkResult = document.getElementById('new-link-result');

const linksList = document.getElementById('links-list');
const linksSection = document.getElementById('links-section');
const messagesSection = document.getElementById('messages-section');
const messagesList = document.getElementById('messages-list');
const messagesTitle = document.getElementById('messages-title');
const closeMessagesBtn = document.getElementById('close-messages-btn');

function randomSlug(len = 8) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // sin caracteres ambiguos
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// -------------------- Auth --------------------

async function checkSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    showDashboard();
  } else {
    showLogin();
  }
}

function showLogin() {
  loginView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
}

async function showDashboard() {
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  await loadProjects();
  await loadLinks();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = 'Credenciales incorrectas.';
    return;
  }
  showDashboard();
});

logoutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut();
  showLogin();
});

// -------------------- Proyectos --------------------

async function loadProjects() {
  const { data, error } = await supabase.from('projects').select('id, name').order('name');
  if (error) {
    console.error(error);
    return;
  }
  newLinkProject.innerHTML = data
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');
}

// -------------------- Crear enlace --------------------

newLinkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const label = newLinkLabel.value.trim();
  const projectId = newLinkProject.value;
  const slug = randomSlug();

  const { error } = await supabase.from('links').insert({
    slug,
    label,
    project_id: projectId,
  });

  if (error) {
    newLinkResult.textContent = 'Error al crear el enlace.';
    console.error(error);
    return;
  }

  const url = `${window.location.origin}/${slug}`;
  newLinkResult.innerHTML = `Enlace creado: <code>${url}</code>`;
  newLinkLabel.value = '';
  loadLinks();
});

// -------------------- Listado de enlaces --------------------

async function loadLinks() {
  const { data, error } = await supabase
    .from('links_with_counts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    linksList.textContent = 'Error al cargar los enlaces.';
    return;
  }

  const { data: projects } = await supabase.from('projects').select('id, name');
  const projectOptions = (projects || [])
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');

  linksList.innerHTML = data
    .map(
      (link) => `
    <div class="link-row" data-slug="${link.slug}">
      <div>
        <div class="label">${link.label || '(sin nombre)'}</div>
        <div class="slug">${window.location.origin}/${link.slug}</div>
      </div>
      <select class="project-select" data-slug="${link.slug}">
        ${projectOptions}
      </select>
      <div class="count ${link.unread_count > 0 ? 'unread' : ''}">
        ${link.total_count} mensajes${link.unread_count > 0 ? ` (${link.unread_count} nuevos)` : ''}
      </div>
      <button class="view-btn" data-slug="${link.slug}" data-label="${link.label || link.slug}">Ver mensajes</button>
    </div>
  `
    )
    .join('');

  // fijar el proyecto actual seleccionado en cada <select>
  data.forEach((link) => {
    const select = linksList.querySelector(`.project-select[data-slug="${link.slug}"]`);
    if (select) select.value = link.project_id;
  });

  linksList.querySelectorAll('.project-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const slug = select.dataset.slug;
      const { error } = await supabase
        .from('links')
        .update({ project_id: select.value, updated_at: new Date().toISOString() })
        .eq('slug', slug);
      if (error) console.error(error);
      loadLinks();
    });
  });

  linksList.querySelectorAll('.view-btn').forEach((btn) => {
    btn.addEventListener('click', () => openMessages(btn.dataset.slug, btn.dataset.label));
  });
}

// -------------------- Mensajes de un enlace --------------------

async function openMessages(slug, label) {
  linksSection.classList.add('hidden');
  document.getElementById('new-link-section').classList.add('hidden');
  messagesSection.classList.remove('hidden');
  messagesTitle.textContent = `Mensajes de "${label}"`;

  const { data, error } = await supabase
    .from('messages')
    .select('id, content, created_at, read')
    .eq('link_slug', slug)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    messagesList.textContent = 'Error al cargar los mensajes.';
    return;
  }

  messagesList.innerHTML = data
    .map(
      (m) => `
    <div class="message-item ${m.read ? '' : 'unread'}">
      <div class="content">${escapeHtml(m.content)}</div>
      <div class="meta">${new Date(m.created_at).toLocaleString('es-ES')}</div>
    </div>
  `
    )
    .join('') || '<p style="opacity:0.6">Sin mensajes todavía.</p>';

  // marcar como leídos
  const unreadIds = data.filter((m) => !m.read).map((m) => m.id);
  if (unreadIds.length) {
    await supabase.from('messages').update({ read: true }).in('id', unreadIds);
  }
}

closeMessagesBtn.addEventListener('click', () => {
  messagesSection.classList.add('hidden');
  linksSection.classList.remove('hidden');
  document.getElementById('new-link-section').classList.remove('hidden');
  loadLinks();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

checkSession();
