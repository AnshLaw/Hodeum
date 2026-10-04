# Accounts, sync and the web dashboard: setup

Hodeum runs fully local without any of this. Do these steps once to turn on Google sign-in, sync and the web dashboard.

## 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run [`supabase/migrations/20261003120000_hodeum_sync.sql`](../supabase/migrations/20261003120000_hodeum_sync.sql). (Or `supabase db push` with the Supabase CLI linked to the project.) It creates the tables, Row Level Security policies (every learner sees only their own rows) and the Realtime publication.
3. **Project Settings › API**: copy the project URL and the `anon` (publishable) key.

## 2. Google sign-in

1. In Google Cloud Console › APIs & Services › Credentials, create an **OAuth client ID** of type **Web application**.
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`
2. In Supabase › **Authentication › Sign In / Providers › Google**: enable it and paste the client ID and secret.
3. In Supabase › **Authentication › URL Configuration › Redirect URLs**, add:
   - `http://127.0.0.1:47615/auth/callback` (the desktop app's one-shot loopback)
   - `http://localhost:1420/web.html` (the dashboard in development)
   - your deployed dashboard URL, e.g. `https://hodeum.example.com/web.html`

## 3. Keys

Create `.env.local` in the repo root (git-ignored):

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

The anon key is public by design; Row Level Security protects the data. Never put the `service_role` key in this file.

Restart `npm run tauri:dev` (Vite reads env files at startup).

## 4. Use it

- **Desktop:** Hodeum › Settings › Account › **Sign in**. Your browser opens Google; when it says "You're signed in", go back to Hodeum. The rail now reads "Syncing to you@…". The **Sync this PC** switch pauses everything cloud-related on this PC (sync, presence and web commands) without signing out.
- **Web dashboard:** `npm run dev`, then open <http://localhost:1420/web.html>. Sign in with the same Google account. Pick your PC in the rail and **Start a Hode**: the PC claims the command within a second or two (Realtime), or within 30 s if Realtime is down, and Hodey starts guiding there.
- **Deploy the dashboard:** `npm run build` and serve `dist/` from any static host; open `/web.html`. Add that URL to the Supabase redirect list.

## What leaves the PC

Only after sign-in, and only while sync isn't paused: skills, Hodes and their steps, chats, the settings blob, and this PC's name with its current Hode's goal and step (so the dashboard can show "Continue your Hode"). Screenshots, audio and transcripts never do. The notch's blue dot lights while sync talks to Supabase.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Settings says "Accounts aren't set up in this build" | `.env.local` missing or Vite wasn't restarted |
| "Port 47615 is busy" | Another app holds the port; close it and sign in again |
| Browser shows a Supabase "redirect URL not allowed" error | Step 2.3: the redirect URL isn't listed |
| Dashboard: "<PC> didn't answer" | Hodeum isn't running there, isn't signed in, or sync is paused |
| "This PC's learning belongs to another Hodeum account" | The PC's local data was first synced by a different Google account. Sign in with that one; local data is never uploaded to another account |
| "Last sync failed: …" in Settings | Network or Supabase error; local data is untouched and the next pass retries |
