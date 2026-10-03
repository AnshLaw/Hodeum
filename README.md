# Hodeum

Hodeum is a Windows-first, local-first learning companion. A Hodian starts a **Hode** (a guided learning journey), and **Hodey** teaches inside the real app: it highlights the next control, waits for the learner to act, checks the result, corrects mistakes, and gives less help as the learner improves. It teaches; it doesn't take over.

## What works today (sub-project 1: shell + teaching loop)

- **Dynamic notch**: a top-centre pill (idle → status → guidance → success) that never takes focus while it's guiding you. The window is fixed-size, and a native cursor hit-test makes everything outside the pill click-through.
- **Guidance overlay**: a separate full-monitor, click-through window that draws a spotlight, highlight, arrow and label. Coordinates go through a DPI-aware conversion. Low-confidence targets get a broader highlight or no overlay at all.
- **Hode engine**: a pure, tested state machine covering the assistance ladder (demonstrate → independent), wrong-action correction, the stuck timer, hints, Explain, Let me try, pause/resume, and dropping stale results so the latest learner action wins.
- **Task packs**: Excel PivotTable and File Explorer Zip. They contain labels, success signals and common mistakes, and never coordinates (enforced by the schema).
- **Point & Ask** (beyond the PRD): press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> or the ⌖ button. Drag a box, Shift-draw a circle, or click to mark part of the screen, then ask about it or choose *Focus here* so later guidance prefers that area. Everything stays local.
- **Local providers**: a deterministic task-pack planner with a fallback router (cloud providers plug in ahead of it later), Windows voices for speech, and SQLite for skill progress.

Not yet connected: real UI Automation and screen capture (sub-project 2), Qwen3-VL and OmniParser (3), Nemotron/MagpieTTS voice (4), and the opt-in Gemini/ElevenLabs/Backboard providers (5). Until sub-project 2 lands, the desktop app shows a clear "screen reading isn't connected yet" state. The full loop runs in the practice stage.

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
cd src-tauri; cargo test --lib   # Rust geometry/hit-test tests
```

### Practice stage walkthrough

1. Hover the notch and choose **Start a Hode**, then pick **Make a PivotTable**.
2. Click **Data** on purpose: Hodey corrects you and moves the highlight.
3. Follow the steps through Insert → PivotTable → OK → tick Region and Sales.
4. Press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd>, drag over any control, and ask **What is this?**
5. Run the Hode again. Steps for skills you already practised get less help (no arrow, a shorter hint).

No cloud API keys are needed. Copy `.env.example` to `.env.local` only when you explicitly enable the optional providers.

## Layout

```text
src/lib/             types, coordinates, bus, copy, native-shell boundary
src/features/hode/   reducer (flow / learner / session), policy, signals, runtime
src/providers/       reasoning, perception, TTS, skill stores behind interfaces
src/task-packs/      JSON packs + schema + goal matching
src/components/      notch, overlay (+ Point & Ask), shared UI
src/stage/           browser practice stage and scripted mock apps
src-tauri/src/       windows, WS_EX_NOACTIVATE, hit-test thread, commands, SQLite migrations
```

See [`CLAUDE.md`](./CLAUDE.md) for priorities and architecture rules, and `docs/superpowers/` for the spec and plan.
