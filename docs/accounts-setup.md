# Accounts, sync and the web dashboard: setup

Hodeum runs fully local without any of this. This is how the hosted pieces are set up (all on free tiers) and how to recreate them.

## What exists

| Piece | Where | Notes |
|---|---|---|
| Supabase project `hodeum` | org "Hodeum" (free), `us-east-1`, ref `gnjbnjrcbammgjvtnbxo` | Own org so its free quotas are separate from other projects |
| Google Cloud project "Hodeum" | `fast-drake-510602-d3` | Google Auth Platform: External, In production |
| Google OAuth client (Web) | `338229660922-5iik45pn7gllqmj3slqpip20jf5ii6me…` | JS origins: `https://hodeum.vercel.app`, `http://localhost:1420`; one secret, stored only in Supabase |
| Public site | `https://hodeum.vercel.app` (Vercel project `hodeum`) | Home, privacy policy, dashboard (`/web.html`), desktop sign-in page (`/signin.html`) |
| Search Console | URL-prefix property `https://hodeum.vercel.app/` | Verified by the meta tag in `site/public/index.html`; keep it |

## How sign-in works

Google's "Sign in with Google" button runs on Hodeum's own site, so Google's screen names `hodeum.vercel.app` (and, once branding is verified, shows "Hodeum" and its logo) instead of the Supabase project domain. The Google ID token goes to Supabase with `signInWithIdToken`; a nonce inside the token stops replay.

- **Web dashboard:** the button is on `/web.html`.
- **Desktop:** the app starts a one-shot listener on `127.0.0.1:47615`, opens `/signin.html?redirect=…&nonce=<hash>&state=…` in the browser, and the page sends the ID token back only to that loopback. The app checks the state, then signs in with the raw nonce.

## Keys

`.env.local` in the repo root (git-ignored):

```dotenv
VITE_SUPABASE_URL=https://gnjbnjrcbammgjvtnbxo.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key from Supabase › Settings › API Keys>
```

Both are public by design; Row Level Security protects the data. Never put the `service_role` key here. The site URL and Google client ID default to the values above (`src/features/account/config.ts`); override with `VITE_HODEUM_SITE_URL` / `VITE_GOOGLE_CLIENT_ID`.

## Deploy the site

```powershell
npm run deploy:site   # builds dist-site (site/public + web.html + signin.html) and deploys to the linked Vercel project
```

The build reads `.env.local`. The Vercel link lives in `.vercel/` (git-ignored); recreate it with `vercel link --project hodeum`.

The Vercel project is also connected to GitHub, so **every push to `main` deploys to production**. The root `vercel.json` makes that build the site (`npm run build:site` → `dist-site`), not the desktop app. A build on Vercel needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under Settings › Environment Variables (both are public). Without them the build fails on purpose, and the live site stays as it was.

## Recreate from scratch

1. **Supabase:** new project; run `supabase/migrations/20261003120000_hodeum_sync.sql` in the SQL editor; enable Authentication › Providers › Google with the client ID and secret.
2. **Google Cloud:** Google Auth Platform › Branding (name, logo, home page, privacy policy, authorized domain `hodeum.vercel.app`), Audience (External, publish), Clients › Web application with the JS origins above.
3. **Search Console:** add the URL-prefix property, verify with the HTML tag.
4. **Brand verification:** Branding › Verify branding. Google needs about 24 hours after the Search Console verification before it will pass.

## What leaves the PC

Only after sign-in, and only while sync isn't paused: skills, Hodes and their steps, chats, the settings blob, and this PC's name with its current Hode's goal and step. Screenshots, audio and transcripts never do. The notch's blue dot lights while sync talks to Supabase.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Settings says "Accounts aren't set up in this build" | `.env.local` missing or Vite wasn't restarted |
| "Port 47615 is busy" | Another app holds the port; close it and sign in again |
| No Google button on the site | The page's origin isn't in the OAuth client's JS origins (changes can take a few minutes) |
| "The sign-in that came back didn't match this one" | A stale or forged sign-in page; start again from Hodeum |
| "This PC's learning belongs to another Hodeum account" | The PC's local data was first synced by a different Google account |
| Dashboard: "No PC is linked to <email> yet" | Hodeum on the PC never finished signing in with that Google account, or sync is paused there. A PC appears only after the app itself is signed in (Settings › Account shows "Signed in" and "Synced …"); the browser tab saying "Almost done" isn't enough |
| Settings: "Sign-in didn't finish: …" (rail: "Sign-in didn't finish") | The browser came back but Supabase refused the Google token, or the wait was cancelled; sign in again |
| Settings: "The web dashboard can't see this PC: …" | The `devices` heartbeat upsert failed (network, expired session, or missing table/policy); fix it and press Try again |
| Dashboard: "<PC> didn't answer" | Hodeum isn't running there, isn't signed in, or sync is paused |
| "Last sync failed: …" in Settings | Network or Supabase error; local data is untouched and the next pass retries |
