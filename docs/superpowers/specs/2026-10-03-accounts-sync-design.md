# Accounts, Sync and the Web Dashboard

**Date:** 2026-10-03 · **Follows:** notch + desktop app · **Backend:** Supabase (Auth with Google, Postgres, Realtime)

## Decisions

- Signed-out Hodeum is fully local. Signing in with Google turns sync on; the sign-in row says so and Settings has a pause switch (device-local).
- Synced: skills, Hodes and their events, chats and messages, the settings blob. Never synced: screenshots, audio, transcripts, `step_attempts`.
- Web → PC is a **cloud command channel** (`pc_commands`), never a socket into the PC. Commands only start or end a Hode; Teach Mode still has the learner do the work.
- Supabase keys come from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (`.env.local`). Without them the app boots normally and Account shows "not set up in this build".

## Desktop sign-in

The account and sync engine live in the **notch window** (always running, already owns the runtime). The app window talks to it over the bus: `account:status` (broadcast), `account:status-request`, `account:sign-in`, `account:sign-out`, `account:pause`.

Sign-in uses PKCE in the system browser:

1. Rust `auth_listen` binds `127.0.0.1:47615` and returns `http://127.0.0.1:47615/auth/callback`.
2. supabase-js builds the Google authorize URL (`skipBrowserRedirect`); Rust `open_url` opens it (https only).
3. The browser lands on the loopback; Rust answers with a "return to Hodeum" page and emits `account:callback { code | error }`.
4. supabase-js exchanges the code (the verifier never left the notch window's storage). Times out after 5 minutes.

## Sync engine

A pass is **pull → merge locally → push changed rows**, lit by the blue cloud dot. Triggered on sign-in, `data:changed` / `settings:changed` (debounced), and every 5 minutes. One pass in flight at a time; errors become a visible sync status and the local data is untouched.

| Data | Merge rule |
|---|---|
| skills | newer `last_seen_at` wins (ties keep local) |
| hodes, events, chats, messages | append-only: insert what's missing locally; events keyed by `(hode_id, seq)` |
| settings | three-way against the last synced blob: local edit wins, else remote edit applies; a fresh PC with default settings takes the remote |
| deletions | the app emits `sync:deleted`; the engine keeps a tombstone, skips that row on pull and deletes it remotely |

Rows are pushed only when their content changed since the last push in this session.

## Devices and commands

Each PC has a stable device id and upserts `devices` (name, `last_seen_at`, live Hode summary) on a 30 s heartbeat and on Hode changes. Online = seen in the last 75 s.

`pc_commands`: `start_hode { goal }` or `end_hode`, addressed to a device. The PC hears inserts over Realtime and also checks for pending ones each pass. It **claims** a command (`pending → started|ended|rejected|expired`, only if still pending), rejects stale (> 2 min), over-long (> 200 chars) or unknown ones, and hands valid ones to the existing `hode:start` / `hode:end` bus commands.

## Web dashboard (`web.html`)

Same React pages as the desktop app (Home, Your Hodes, Learning paths) over a Supabase-backed `LearningStore`, plus a PC picker. Its bus turns `hode:start` / `hode:end` into commands for the chosen PC and turns Realtime changes into `data:changed` / `hode:summary`. Signs in with Google by normal web redirect. Skill resets are PC-only.

## Testing

Pure merge rules, the engine (against a fake cloud and the real SQLite migrations), command validation/claiming, the web command bus, and Rust loopback request parsing.
