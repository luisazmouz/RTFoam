# RTFoam — publish guide

Files, all human-editable:

- **index.html** — page structure + the owner CONFIG block (proxy URL, Supabase).
- **styles.css** — ALL styling and animations.
- **app.js** — app behavior (views, AI calls, saving). Fetches `/knowledge/` fresh before every generation.
- **plan-lib.js** — geometry/rendering math ONLY. Contains no aircraft design bands.
- **worker.js** — a tiny free server (Cloudflare Worker) that keeps your AI key secret. Forwards prompts only — no design rules live here.
- **knowledge/** — the design source of truth. See `knowledge/README.md`. **If any file in this folder is deleted or renamed, aircraft generation refuses to run** (by design — there is no hardcoded fallback).

## 1. Connect the AI (required, keeps your key hidden)

1. Go to dash.cloudflare.com → Workers & Pages → Create Worker.
2. Paste the contents of `worker.js`, deploy.
3. In the worker's Settings → Variables, add a **secret** named `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`).
4. Copy the worker URL into `CONFIG.API_PROXY_URL` at the top of `index.html`.

Visitors never see the key — it lives only on the worker.

## 2. Shared cloud gallery via Supabase (optional)

1. Create a free project at supabase.com.
2. SQL Editor → run:

       create table slipstream_hangar (id text primary key, data jsonb, updated_at timestamptz default now());
       alter table slipstream_hangar enable row level security;
       create policy "read all" on slipstream_hangar for select using (true);
       create policy "insert"   on slipstream_hangar for insert with check (true);

3. Project Settings → API → copy the URL and the **anon public** key into `CONFIG.SUPABASE_URL` / `CONFIG.SUPABASE_ANON_KEY` in `index.html`.

## 3. Editing how aircraft are designed

Edit the files in `knowledge/` directly — numeric bands in `aircraft-types.json`,
control configurations in `design-rules.json`, hard bounds in `validation.json`,
motor/material options in `motors.json` / `materials.json`, and the prose
reference in `report.md`. No redeploy needed — the site fetches these fresh
on every page load and before every generation. Delete any of these files
and Generate will refuse to run rather than silently falling back to
built-in defaults.

## 4. Publish

Upload `index.html`, `styles.css`, `app.js`, `plan-lib.js`, and the whole
`knowledge/` folder to any static host or FTP (`worker.js` is NOT uploaded
— it lives on Cloudflare). Done.
