# Candela Links

Sistema de enlaces únicos + mensajes, separado del proyecto Candela.

## Cómo funciona

```
Visitante entra a tudominio.com/xxxxx
        │
        ▼
  GET /api/resolve?slug=xxxxx  ──► Supabase (tabla `links`)
        │
        ▼
  Se carga el proyecto asignado a "xxxxx" (hoy: placeholder de Candela)
        │
        ▼
  Visitante escribe y pulsa enviar
        │
        ▼
  POST /api/message  { slug, content }  ──► guarda en Supabase + te avisa por Telegram
        │
        ▼
  Tú entras a tudominio.com/admin, inicias sesión, y ves el mensaje
  ligado exactamente al enlace "xxxxx"
```

- El slug es **permanente**: cambiar qué proyecto ve esa persona es solo
  cambiar un campo en la base de datos (`links.project_id`), sin tocar el
  enlace que ya tiene.
- El visitante **nunca** toca la base de datos directamente: solo habla con
  `/api/resolve` y `/api/message`, que usan una clave secreta que solo existe
  en el servidor. Así nadie puede leer mensajes de otro enlace ni listar tus
  enlaces.
- El panel `/admin` sí habla directo con Supabase, pero con Row Level
  Security: solo funciona si has iniciado sesión con tu cuenta de admin.

---

## PASOS QUE TIENES QUE HACER TÚ (en orden)

### 1. Crear el proyecto en Supabase

1. Ve a **https://supabase.com** → **Start your project** → regístrate (con
   GitHub es lo más rápido).
2. **New project**. Elige un nombre (ej. `candela-links`), una contraseña
   para la base de datos (guárdala en un gestor de contraseñas) y una región
   cercana (ej. `West EU (Ireland)`). Pulsa **Create new project** y espera
   ~2 minutos a que se aprovisione.
3. En el menú lateral, ve a **SQL Editor** → **New query**.
4. Copia y pega **todo** el contenido del archivo `supabase/schema.sql` que
   te he generado, y pulsa **Run**. Esto crea las tablas, la seguridad y la
   vista de contadores.
5. Ve a **Project Settings** (icono de engranaje) → **API**. Ahí verás:
   - **Project URL** → esto es tu `SUPABASE_URL`.
   - **anon public** key → esto es tu `SUPABASE_ANON_KEY`.
   - **service_role** key (pulsa "Reveal") → esto es tu
     `SUPABASE_SERVICE_ROLE_KEY`. **Nunca la pongas en el frontend ni la
     compartas.**
   Guarda los tres valores, los necesitas ahora.

### 2. Crear tu usuario de administrador

1. En Supabase, ve a **Authentication** → **Users** → **Add user** →
   **Create new user**.
2. Pon tu email y una contraseña. Marca **Auto Confirm User**. Crear.
3. Ve a **Authentication** → **Providers** → **Email**, y **desactiva**
   "Allow new users to sign up" (así nadie más puede crearse una cuenta).
4. Vuelve a **SQL Editor** → **New query** y ejecuta (cambia el email por el
   tuyo, el mismo que usaste en el paso 2):
   ```sql
   insert into admins (email) values ('tu-email@ejemplo.com');
   ```

### 3. Crear el bot de Telegram (para las notificaciones)

1. En Telegram, busca el usuario **@BotFather** y escríbele `/newbot`.
2. Dale un nombre y un @usuario (debe terminar en "bot", ej.
   `candela_avisos_bot`).
3. BotFather te da un **token** (algo como `123456:ABC-...`). Guárdalo: es tu
   `TELEGRAM_BOT_TOKEN`.
4. Ahora busca tu bot en Telegram por su @usuario y pulsa **Iniciar** (o
   escríbele cualquier cosa, ej. "hola").
5. Abre esta URL en el navegador, sustituyendo `<TOKEN>` por tu token:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   Verás un JSON. Busca `"chat":{"id":NUMERO,...}` — ese NUMERO es tu
   `TELEGRAM_CHAT_ID`.

### 4. Rellenar la clave del admin en el código

1. Abre `admin/admin.js` (te lo adjunto).
2. Sustituye:
   ```js
   const SUPABASE_URL = 'PON_AQUI_TU_SUPABASE_URL';
   const SUPABASE_ANON_KEY = 'PON_AQUI_TU_SUPABASE_ANON_KEY';
   ```
   por tus valores reales del paso 1.5 (URL y **anon** key — la service_role
   NO va aquí).

### 5. Subir el proyecto a GitHub

1. Ve a **https://github.com** → **New repository** → nómbralo
   `candela-links` → **Create repository**.
2. Sigue las instrucciones de GitHub para "push an existing repository":
   ```
   git init
   git add .
   git commit -m "candela links"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/candela-links.git
   git push -u origin main
   ```
   (te doy la carpeta lista para esto en cuanto la descargues)

### 6. Desplegar en Vercel

1. Ve a **https://vercel.com** → regístrate con GitHub.
2. **Add New** → **Project** → importa el repositorio `candela-links`.
3. En **Environment Variables**, añade estas 4 (con tus valores reales de
   los pasos 1 y 3):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
4. Pulsa **Deploy**. En ~1 minuto tendrás una URL tipo
   `candela-links.vercel.app`.

### 7. (Opcional) Conectar tu propio dominio

En Vercel → tu proyecto → **Settings** → **Domains** → añade tu dominio y
sigue las instrucciones para apuntar el DNS. Cuando esté listo,
`tudominio.com/xxxxx` funcionará igual que `candela-links.vercel.app/xxxxx`.

---

## Cómo lo usas después de desplegado

- Entra a `tudominio.com/admin`, inicia sesión con tu email/contraseña.
- **Crear enlace**: le pones un nombre interno (solo tú lo ves) y eliges
  proyecto → te da la URL para enviarle a la persona.
- **Cambiar proyecto** de un enlace ya enviado: usa el desplegable junto a
  ese enlace en el panel. El enlace de la persona no cambia.
- **Ver mensajes**: pulsa "Ver mensajes" en cualquier enlace.
- Cuando alguien escribe, te llega un aviso al bot de Telegram al instante.

## Qué falta para integrar Candela de verdad

Ahora mismo, cualquier enlace con proyecto "Candela" muestra un placeholder
(un texto simple), a propósito, para no tocar tu proyecto Three.js todavía.
El punto exacto de integración es un único archivo:
`app.js`, objeto `PROJECT_LOADERS` — cuando quieras, copiamos los archivos de
Candela dentro de este proyecto y cambiamos esa línea para que cargue tu
`main.js` real en vez del placeholder. Todo lo demás (enlaces, mensajes,
seguridad, panel) no cambia.
