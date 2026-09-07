-- ============================================================
-- CANDELA LINKS · Esquema de base de datos (Supabase / Postgres)
-- Pega este archivo completo en: Supabase → SQL Editor → New query → Run
-- ============================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- Catálogo de proyectos que un enlace puede mostrar
-- ---------------------------------------------------------
create table if not exists projects (
  id text primary key,           -- ej: 'candela', 'proyecto2'
  name text not null,
  created_at timestamptz default now()
);

insert into projects (id, name) values
  ('candela', 'Candela')
on conflict (id) do nothing;

-- ---------------------------------------------------------
-- Enlaces únicos y permanentes
-- ---------------------------------------------------------
create table if not exists links (
  slug text primary key,                       -- la parte /xxxxx de la URL
  label text,                                   -- nombre interno, solo tú lo ves ("Persona A")
  project_id text not null references projects(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------
-- Mensajes recibidos
-- ---------------------------------------------------------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  link_slug text not null references links(slug),
  content text not null,
  created_at timestamptz default now(),
  read boolean not null default false
);

-- ---------------------------------------------------------
-- Visitas a Candela (ver /api/visit.js y projects/candela/src/visits.js)
-- Una fila = una entrada real a la experiencia (pulsar "CARGAR ESCENA" o
-- "SALTAR ANIMACIÓN"), nunca una interacción interna. Sin datos
-- personales: solo el enlace usado (opcional, sin FK estricta a `links`
-- para que un registro nunca pueda bloquear el guardado de una visita
-- por un desajuste puntual de slug) y un identificador de sesión
-- efímero, generado en el navegador y no persistido en ningún otro
-- sitio, solo para poder distinguir eventos entre sí si hiciera falta.
-- ---------------------------------------------------------
create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  link_slug text,
  session_id text
);

-- device_id (añadido en la iteración de analítica — ver PARTE 1 del
-- encargo, y projects/candela/src/visits.js): identificador aleatorio
-- persistido en el navegador (localStorage, con una cookie como
-- respaldo), para poder agrupar varias visitas (session_id distintos)
-- del mismo navegador/dispositivo a lo largo del tiempo. Aproximado por
-- naturaleza: added `if not exists` para poder volver a ejecutar este
-- archivo sin romper nada si ya se había aplicado antes.
alter table visits add column if not exists device_id text;

-- ---------------------------------------------------------
-- Eventos de analítica (ver PARTE 1 del encargo, y
-- projects/candela/src/visits.js — único sitio del frontend que llama a
-- /api/event.js, que es quien inserta aquí). Una fila = UN evento real
-- dentro de una visita concreta (session_id): nunca se actualiza ni se
-- sobrescribe ninguna fila existente, así que el historial completo de
-- una visita (qué pasó y en qué orden) se reconstruye consultando todas
-- las filas de un mismo session_id ordenadas por created_at (o por
-- `seq`, un contador incremental generado en el propio navegador, útil
-- si dos eventos llegaran con el mismo timestamp de servidor).
--
-- event_type esperados en esta iteración (no es una lista cerrada a
-- nivel de base de datos, solo a nivel de convención):
--   'experience_started'    — al pulsar "Cargar escena"/"Saltar animación"
--   'candle_words_started'  — al empezar a aparecer la primera frase de la vela
--   'envelope_shown'        — al aparecer el sobre
--   'page_changed'          — cada cambio de página de la carta (from_page/to_page, 1-based)
--   'heartbeat'             — señal periódica/de salida para poder calcular
--                              "última actividad" y duración aproximada sin
--                              depender de beforeunload (ver visits.js)
--
-- Sin datos personales: mismo criterio que `visits` (solo enlace usado,
-- opcional, sin FK estricta a `links`; device_id/session_id son
-- identificadores efímeros/aproximados generados en el navegador).
-- ---------------------------------------------------------
create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  link_slug text,
  session_id text not null,
  device_id text,
  event_type text not null,
  from_page integer,
  to_page integer,
  seq integer,
  client_ts timestamptz,
  meta jsonb
);

create index if not exists analytics_events_session_idx on analytics_events (session_id);
create index if not exists analytics_events_device_idx on analytics_events (device_id);
create index if not exists analytics_events_type_idx on analytics_events (event_type);
create index if not exists analytics_events_created_idx on analytics_events (created_at);

-- ---------------------------------------------------------
-- Lista blanca de administradores (solo tú)
-- ---------------------------------------------------------
create table if not exists admins (
  email text primary key
);

-- Función que comprueba si quien hace la petición es admin.
-- SECURITY DEFINER: puede leer la tabla admins aunque el que llama no tenga permiso directo.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from admins where email = (auth.jwt() ->> 'email')
  );
$$;

-- ---------------------------------------------------------
-- Row Level Security: nadie sin ser admin puede leer/escribir
-- nada directamente. Los visitantes solo pasan por /api/*.
-- ---------------------------------------------------------
alter table projects enable row level security;
alter table links enable row level security;
alter table messages enable row level security;
alter table admins enable row level security;
alter table visits enable row level security;
alter table analytics_events enable row level security;

drop policy if exists "admin_all_projects" on projects;
create policy "admin_all_projects" on projects
  for all using (is_admin()) with check (is_admin());

drop policy if exists "admin_all_links" on links;
create policy "admin_all_links" on links
  for all using (is_admin()) with check (is_admin());

drop policy if exists "admin_all_messages" on messages;
create policy "admin_all_messages" on messages
  for all using (is_admin()) with check (is_admin());

-- visits / analytics_events: mismo criterio que "admins" — nadie puede
-- leer/escribir desde el cliente (ni siquiera un admin autenticado);
-- solo el servidor (clave de servicio, que salta RLS por diseño de
-- Supabase) inserta desde /api/visit.js y /api/event.js. Si algún día
-- quieres consultarlas desde el panel de admin, añade aquí una política
-- de solo lectura para is_admin() — de momento no hace falta ninguna
-- (mientras tanto, se consultan a mano desde el SQL Editor de Supabase,
-- donde sí tienes acceso completo independientemente de RLS).

-- admins: nadie puede leer/escribir esta tabla desde el cliente,
-- ni siquiera un admin autenticado (se gestiona a mano desde el SQL editor).
-- (sin políticas = bloqueada por defecto con RLS activado)

-- ---------------------------------------------------------
-- Vista con el recuento de mensajes por enlace, para el panel
-- ---------------------------------------------------------
create or replace view links_with_counts as
select
  l.slug,
  l.label,
  l.project_id,
  l.created_at,
  l.updated_at,
  count(m.id) filter (where m.read = false) as unread_count,
  count(m.id) as total_count
from links l
left join messages m on m.link_slug = l.slug
group by l.slug, l.label, l.project_id, l.created_at, l.updated_at;

alter view links_with_counts set (security_invoker = true);

-- ---------------------------------------------------------
-- Resumen por visita (session_id), para consultar desde el SQL Editor
-- de Supabase (ver PARTE 1 del encargo — "cuántas visitas", "hasta
-- dónde llegó cada una", "cuánto tiempo estuvo", etc.). No es la fuente
-- de verdad (esa es siempre `analytics_events`, fila a fila): es solo
-- una agregación de conveniencia sobre esa misma tabla.
--
-- Ejemplos de uso, una vez desplegado:
--
--   -- Todas las visitas, más recientes primero:
--   select * from analytics_sessions order by started_at desc;
--
--   -- Visitas de un mismo dispositivo:
--   select * from analytics_sessions where device_id = 'xxxx' order by started_at;
--
--   -- Cuántos dispositivos distintos aproximadamente:
--   select count(distinct device_id) from analytics_sessions;
--
--   -- Historial completo (evento a evento) de una visita concreta:
--   select event_type, from_page, to_page, created_at
--   from analytics_events
--   where session_id = 'xxxx'
--   order by created_at, seq;
-- ---------------------------------------------------------
create or replace view analytics_sessions as
select
  session_id,
  max(device_id) as device_id,
  max(link_slug) as link_slug,
  min(created_at) as started_at,
  max(created_at) as last_activity_at,
  max(created_at) - min(created_at) as duration,
  bool_or(event_type = 'experience_started') as started_experience,
  bool_or(event_type = 'candle_words_started') as reached_candle_words,
  bool_or(event_type = 'envelope_shown') as reached_envelope,
  count(*) filter (where event_type = 'page_changed') as page_changes,
  max(to_page) filter (where event_type = 'page_changed') as furthest_page_reached,
  -- Recorrido completo de páginas, en el orden real en que ocurrió
  -- (from→to de cada page_changed, ordenado por tiempo/seq) — no solo
  -- la última página, tal y como se pidió.
  array_agg(to_page order by created_at, seq) filter (where event_type = 'page_changed') as page_path,
  count(*) as total_events
from analytics_events
group by session_id;

alter view analytics_sessions set (security_invoker = true);
