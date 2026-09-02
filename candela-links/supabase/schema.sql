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

drop policy if exists "admin_all_projects" on projects;
create policy "admin_all_projects" on projects
  for all using (is_admin()) with check (is_admin());

drop policy if exists "admin_all_links" on links;
create policy "admin_all_links" on links
  for all using (is_admin()) with check (is_admin());

drop policy if exists "admin_all_messages" on messages;
create policy "admin_all_messages" on messages
  for all using (is_admin()) with check (is_admin());

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
