# Hodeum

<img src="assets/hodeum-icon.svg" width="64" alt="Hodeum" />

Hodeum is a Windows-first, local-first learning companion. A Hodian starts a **Hode** (a guided learning journey), and **Hodey** teaches inside the real app: it highlights the next control, waits for the learner to act, checks the result, corrects mistakes, and gives less help as the learner improves. It teaches; it doesn't take over.

## What works today (sub-projects 1 and 2)

**Teaching loop**
- **Hode engine**: a pure, tested state machine covering the assistance ladder (demonstrate → independent), wrong-action correction, the stuck timer, hints, Explain, Let me try, pause/resume, and dropping stale results so the latest learner action wins.
- **Task packs**: Excel PivotTable and File Explorer Zip. They contain labels, success signals and common mistakes, and never coordinates (enforced by the schema).
- **Point & Ask** (beyond the PRD): press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> or the ⌖ button. Drag a box, Shift-draw a circle, or click to mark part of the screen, then ask about it or choose *Focus here*. Focus returns to your app afterwards. Everything stays local.

**Seeing the real screen**
- **UI Automation** reads the app you're working in (never Hodeum itself): control names, roles, boxes, and selected or checked state. It skips spreadsheet cells and caps at 1,500 elements so Excel stays fast.
- **Learner actions**: a low-level hook notices clicks and Enter/Tab/Esc/Space presses (nothing you type is recorded), waits 350 ms for the UI to settle, then re-reads the screen.
- **Screenshots** of the active window are kept in memory only, downscaled to 1280 px, ready for the local vision model.
- **Overlay** highlights follow your app to whichever monitor it's on, with DPI-aware coordinates.

**Hodey, where you want it**
- **Notch, sidebar, or hidden**: Hodey sits at the top centre, or on the left or right as a sidebar. Drag it by its face to re-dock, or use the ⋯ menu or the tray icon.
- **Auto-hide** (default): Hodey tucks into a sliver at the screen edge when idle and slides back on hover or when a Hode needs you. <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> hides or shows it completely.
- **No covering**: during a Hode, a side sidebar reserves its width so maximized apps move over. At the top, the card shrinks to a slim bar whenever the highlighted control sits beneath it.
- **Never steals focus**: clicks outside Hodey pass straight through to your app.
- **Hodey has moods**: it sleeps when idle, listens as you type your goal, scans, thinks, nods while guiding, watches quietly when you work unaided, reacts to mistakes, and celebrates when you finish. All of it is animated and respects reduced-motion settings.

**Local by default**: a deterministic task-pack planner behind a fallback router (cloud providers plug in ahead of it later), Windows voices for speech, and SQLite for skill progress.

Next: Qwen3-VL and the OmniParser detector (sub-project 3), Nemotron and MagpieTTS voice (4), and the opt-in Gemini, ElevenLabs and Backboard providers (5).

## Run

Requirements: Node 20+, Rust stable (MSVC), WebView2.

```powershell
npm install
npm run dev          # practice stage at http://localhost:1420 (Excel + File Explorer mock apps)
npm test             # unit + end-to-end teaching-loop tests
npm run typecheck
npm run build
npm run tauri:dev    # native notch + overlay windows
```

```powershell
cd src-tauri; cargo test --lib   # Rust geometry, hit-test, dock, app-bar, perception helpers
```

### Practice stage walkthrough

1. Hover the notch and choose **Start a Hode**, then pick **Make a PivotTable**.
2. Click **Data** on purpose: Hodey corrects you and moves the highlight.
3. Follow the steps through Insert → PivotTable → OK → tick Region and Sales.
4. Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd>, drag over any control, and ask **What is this?**
5. Run the Hode again. Steps for skills you already practised get less help (no arrow, a shorter hint).
6. Open ⋯ and dock Hodey to the left or right; press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> to hide it and bring it back.

No cloud API keys are needed. Copy `.env.example` to `.env.local` only when you explicitly enable the optional providers.

## Layout

```text
src/lib/             types, coordinates, bus, copy, native-shell boundary
src/features/hode/   reducer (flow / learner / session), policy, signals, runtime
src/providers/       reasoning, perception, TTS, skill stores behind interfaces
src/task-packs/      JSON packs + schema + goal matching
src/features/dock/   dock + visibility preferences and rules
src/components/      notch + sidebar, Hodey's face, overlay (+ Point & Ask), shared UI
src/stage/           browser practice stage and scripted mock apps
src-tauri/src/       windows, hit-test, docking + app bar, tray, perception (UIA, input hook, capture), SQLite
```

See [`CLAUDE.md`](./CLAUDE.md) for priorities and architecture rules, and `docs/superpowers/` for the spec and plan.
