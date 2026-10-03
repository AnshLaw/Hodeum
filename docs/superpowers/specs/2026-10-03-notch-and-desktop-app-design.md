# Notch Upgrade + Hodeum Desktop App

**Date:** 2026-10-03 · **Follows:** sub-projects 1–3 · **Next:** accounts + sync + web app (Supabase), iPhone mirroring

## Decisions (from the user)

- Backend later: **Supabase** (Google sign-in, Postgres, Realtime). Sync is **automatic once signed in**; the sign-in screen says so plainly and Settings has a pause switch. Screenshots and audio never sync.
- Web → PC: **cloud command channel only** (later phase).
- Build order: **notch upgrade + desktop app first**, on local data.

## 1. Notch upgrade

**Privacy dots** (like iPhone's Dynamic Island), always visible in the notch bar and on the auto-hide sliver:

| Dot | Meaning | Source |
|---|---|---|
| green | Hodey is reading your screen (UI Automation or a screenshot) | `ActivityTracker` around `observe` / `capture` |
| orange | microphone is on | `SpeechInput` state |
| blue | a cloud service is receiving data | provider router (none today) |

`ActivityTracker` keeps a count per channel and a short linger (`ACTIVITY_LINGER_MS = 600`) so brief reads are still visible. Dots have accessible labels and a tooltip.

**Mic button.** `SpeechInput` interface (`start`, `stop`, `status`, transcript events). Until local ASR lands (sub-project 4), the button shows that local speech isn't installed rather than silently doing nothing; the browser's cloud speech API is not used (local-first).

**New controls** (PRD §29): Repeat, Look again (explicit re-observe → `LOOK_AGAIN` event), Open Hodeum app. Existing: Hint, Explain, Let me try, Point & Ask, Pause/Resume, End, Mute, Settings.

**Animation polish:** content cross-fades with a slight blur and lift; height follows content with a spring; listening shows a live waveform; thinking shows a moving shimmer under the title; success bursts briefly.

## 2. Hodeum desktop app (third window `hodeum_app`)

Frameless, resizable (1120×740 default, min 860×560), custom title bar, hidden until opened from the notch, tray, or `Ctrl+Alt+J`.

**Notch → app transition:** the notch pill grows toward the app's size, then the app window appears exactly where the pill was and unfolds (clip-path from the pill's rect to full size). Closing reverses it. Reduced-motion: plain fade.

**Sections** (left rail):

- **Home** — "Continue your Hode" if one is running, stats (Hodes completed, skills mastered, streak), recent Hodes, suggested next skills.
- **Your Hodes** — history with outcome; a Hode's detail page shows its steps, mistakes, hints, and time.
- **Learning paths** — skills grouped by app and area with mastery bars; adjust a skill (reset, set help level); start a practice Hode for a pack.
- **Ask Hodey (chat)** — chat with Hodey about what's on screen. Context chip shows the auto-grabbed window (the last app you were in) with a thumbnail; a picker lets you choose another open window. Answers come from local Qwen3-VL; "Start a Hode for this" hands the goal to the notch.
- **Settings** — Hodey (voice on/off, speech rate, default help level Beginner/Guided/Confident), notch (dock, visibility, privacy dots), local AI status, data (export JSON, delete all), account (placeholder until the Supabase phase).

## 3. Data (SQLite, migration v2)

`hodes` (id, goal, pack_id, open, started_at, ended_at, outcome), `step_attempts` gains `hode_id` and `step_id`, `chats`, `chat_messages`, `settings` (key/value JSON). A `HodeRecorder` subscribes to runtime transitions (start, step done, mistake, hint, end) and writes through a `HodeLog` interface, so the reducer stays pure. Writes emit `data:changed` on the bus.

## 4. Cross-window wiring

The runtime stays in the notch window (single source of truth). The app sends commands over the Tauri bus (`hode:start`, `hode:end`, `app:open`, `app:close`) and receives `hode:summary` broadcasts for live status. Chat uses a `ChatProvider` (streaming from llama-server). Rust adds `list_windows` and `capture_window(hwnd)`.

## Testing

Pure logic (activity tracker, recorder, stats/view models, settings schema, window list mapping) under vitest; Rust window listing helpers under cargo test; the app is checked in the browser stage (with in-memory stores) and natively.
