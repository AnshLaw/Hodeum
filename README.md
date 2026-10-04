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
- **Notch, sidebar, or hidden**: Hodey sits at the top centre, or on the left or right as a sidebar. Drag it by its face to re-dock, or use the ⋯ menu, the tray icon, or Settings.
- **Dynamic island**: the top notch changes shape with what Hodey is doing. It's a pill when idle and shrinks to an orb around Hodey's face while it looks or thinks; the orb shows a sweeping ring and the green dot while it reads the screen. When the next step is ready it springs open into a card.
- **The right app**: starting a Hode brings its app forward (a task pack's app, or one an open goal names, like "…in Word"), so Hodey reads and highlights there and not in whatever had focus. If you're in another app, Hodey asks you to open or switch to it, points at nothing meanwhile, and picks up when you act there.
- **Copilot sidebar** (default for side docks): a real side panel. Windows reserves its width and any normal windows overlapping it slide over; they move back when the panel closes, unless you've moved them since. Choose *Floating* to have the panel hover over your windows instead.
- **Auto-hide** (default): Hodey tucks into a sliver at the screen edge when idle and slides back on hover or when a Hode needs you. <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> hides or shows it completely.
- **No covering**: during a Hode, a side sidebar reserves its width so maximized apps move over. At the top, the card shrinks to a slim bar whenever the highlighted control sits beneath it.
- **Never steals focus**: clicks outside Hodey pass straight through to your app.
- **Hodey has moods**: it sleeps when idle, listens as you type your goal, scans, thinks, nods while guiding, watches quietly when you work unaided, reacts to mistakes, and celebrates when you finish. All of it is animated and respects reduced-motion settings.

**Local vision (Qwen3-VL)**
- A local `llama-server` (llama.cpp, CUDA) runs Qwen3-VL-4B on the GPU. Hodeum starts it, watches it, restarts it if it crashes, and shows its status in the ⋯ menu.
- The deterministic task-pack planner answers first. The vision model is only asked when UI Automation can't find the step's control, or when you use Point & Ask. It then sees a screenshot of your app (kept in memory, 1280 px) plus the numbered list of controls, and must point at one of them. A box drawn from pixels alone only gets a broad highlight, never a precise arrow.
- If the model is slow or unavailable, Hodey falls back to the planner and the Hode carries on.
- The server listens only on 127.0.0.1, needs a fresh random key each launch, and won't start if another program already holds its port.

**Hodeum app**
- Open it from the notch's expand button, the tray, or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>J</kbd>. It grows out of the notch and folds back into it when closed. Closing only hides it; Hodey keeps running.
- **Home**: start a Hode, continue the live one, and see streak, skills mastered, minutes learning, recent Hodes and what to practise next.
- **Your Hodes**: every Hode as a timeline of steps, corrections, hints and questions.
- **Learning paths**: task packs and every skill's mastery. Change how much help a skill gets, or reset it.
- **Web search** (off by default; turn it on with the globe in Ask Hodey or in Settings):
  - On this PC, Hodey decides whether a question needs the web and writes a short, generic query from what you typed. The screen, window titles and earlier replies are never used for it, so nothing on screen or on a web page can steer what gets sent.
  - Rust then removes emails, links, file paths and names, long numbers and your Windows user name, so only that query is sent.
  - Your screen, chat and files never leave the PC.
  - The blue privacy dot shows while it searches, and each answer shows the exact query and its sources.
  - Without a key, results come from Stack Exchange (Super User) and Microsoft Learn, which welcome programs; general search engines block them. Set the `HODEUM_BRAVE_API_KEY` environment variable to use Brave Search for full web results.
- **Ask Hodey**: chat with the local Qwen3-VL. It attaches the app you were last in (or any window you pick), streams the answer, and can turn a question into a Hode. The screenshot stays in memory; the notch's green dot shows while it's taken.
- **Settings**:
  - **Hodey**: choose an on-device voice and preview it (online voices aren't offered, since they'd send Hodey's words to the cloud), set the speaking speed, how long Hodey waits before helping, and the help preset for new skills.
  - **Look & feel**: system, dark or light theme; an accent colour; Hodey's colour; and an accessory (glasses, headphones, beanie). A live preview cycles through Hodey's moods.
  - **Hodey on screen**: position, sidebar style and idle behaviour.
  - Everything applies to the notch and overlay right away.

**Local by default**: no cloud keys needed. Windows voices handle speech for now. SQLite (`hodeum.db` in the app config folder) stores skills, Hode history, chats and settings, never screenshots or audio. The local model server runs inside a Windows job object, so it stops with Hodeum even after a crash.

Next: the OmniParser detector and open-ended goals (rest of sub-project 3), Nemotron and MagpieTTS voice (4), and the opt-in Gemini, ElevenLabs and Backboard providers (5).

## Run

Requirements: Node 20+, Rust stable (MSVC), WebView2.

```powershell
npm install
powershell -File scripts/setup-local-ai.ps1   # once: ~4 GB of model + llama.cpp CUDA into models/ and runtime/
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
src/app/             desktop app: pages, services boundary, unfold transition
src/data/            learning history, stats, settings, SQLite + memory stores
src/stage/           browser practice stage and scripted mock apps
src-tauri/src/       windows, hit-test, docking + app bar, tray, perception (UIA, input hook, capture), app window, chat context, SQLite
src-tauri/migrations/ SQLite schema, shared with the TypeScript store tests
```

See [`CLAUDE.md`](./CLAUDE.md) for priorities and architecture rules, and `docs/superpowers/` for the spec and plan.
