# Hodeum

<img src="assets/hodeum-icon.svg" width="64" alt="Hodeum" />

Hodeum is a Windows-first, local-first learning companion. A Hodian starts a **Hode** (a guided learning journey), and **Hodey** teaches inside the real app: it highlights the next control, waits for the learner to act, checks the result, corrects mistakes, and gives less help as the learner improves. It teaches; it doesn't take over.

## What works today (sub-projects 1 and 2)

**Learning modes** (pick one when you start a Hode; set the default in Settings; switch anytime from ⋯ or by saying "teach mode", "help mode" or "agent mode"). In every mode you do the clicking:
- **Teach** (default): you learn it for good. Each step starts as a question ("Which tab would you use to add something new?"), with no highlight. If you're stuck or ask for a hint, Hodey shows you, then demonstrates and explains why. Upcoming steps stay hidden until you ask for *All steps*.
- **Help:** you drive. Hodey watches quietly, verifies each step, and steps in only when you're stuck, make a mistake, or ask.
- **Agent:** Hodey walks you through every step, with instructions and highlights and the whole flow visible.

**Teaching loop**
- **Hode engine**: a pure, tested state machine covering the assistance ladder (demonstrate → independent), wrong-action correction, the stuck timer, hints, Explain, Let me try, pause/resume, and dropping stale results so the latest learner action wins.
- **Task packs**: Excel PivotTable and File Explorer Zip. They contain labels, success signals and common mistakes, and never coordinates (enforced by the schema).
- **Point & Ask** (beyond the PRD): press <kbd>Right Ctrl</kbd>+<kbd>P</kbd> or the ⌖ button. Drag a box, Shift-draw a circle, or click to mark part of the screen, then ask about it or choose *Focus here*. Focus returns to your app afterwards. Everything stays local.

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
- **Auto-hide** (default): Hodey tucks into a sliver at the screen edge when idle and slides back on hover or when a Hode needs you. <kbd>Right Ctrl</kbd>+<kbd>H</kbd> hides or shows it completely.
- **No covering**: during a Hode, a side sidebar reserves its width so maximized apps move over. At the top, the card shrinks to a slim bar whenever the highlighted control sits beneath it.
- **Never steals focus**: clicks outside Hodey pass straight through to your app.
- **Hodey has moods**: it sleeps when idle, listens as you type your goal, scans, thinks, nods while guiding, watches quietly when you work unaided, reacts to mistakes, and celebrates when you finish. All of it is animated and respects reduced-motion settings.

**Local vision (Qwen3-VL)**
- A local `llama-server` (llama.cpp, CUDA) runs Qwen3-VL-4B on the GPU. Hodeum starts it, watches it, restarts it if it crashes, and shows its status in the ⋯ menu.
- The deterministic task-pack planner answers first. The vision model is only asked when UI Automation can't find the step's control, or when you use Point & Ask. It then sees a screenshot of your app (kept in memory, 1280 px) plus the numbered list of controls, and must point at one of them. A box drawn from pixels alone only gets a broad highlight, never a precise arrow.
- If the model is slow or unavailable, Hodey falls back to the planner and the Hode carries on.
- The server listens only on 127.0.0.1, needs a fresh random key each launch, and won't start if another program already holds its port.

**Hodeum app**
- Open it from the notch's expand button, the tray, or <kbd>Right Ctrl</kbd>+<kbd>A</kbd>. It grows out of the notch, and the notch steps aside while the app is on screen (a copilot sidebar gives its space back too).
- It's a normal window: drag the title bar, double-click it or press <kbd>Win</kbd>+<kbd>Up</kbd> to maximize, snap it, resize it from any edge, minimize it. It remembers where you put it.
- **Back to notch** (title bar), the close button, <kbd>Alt</kbd>+<kbd>F4</kbd> or <kbd>Right Ctrl</kbd>+<kbd>A</kbd> again fold it back into the notch, and the notch returns exactly as you had it (position, sidebar, auto-hide or hidden). Minimizing it brings the notch back too. Starting a Hode from the app folds it away so the notch can guide you.
- Closing only hides it: Hodey, and any Hode in progress, keep running. Guidance highlights pause while you're in the app and come back when you switch to your own app.
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

**Keys**: one Hodey key, <kbd>Right Ctrl</kbd> (or <kbd>Right Alt</kbd>, in Settings), which apps rarely use on its own:
- **Hold it:** talk to Hodey; let go to send.
- **Hodey key + P:** Point & Ask.
- **Hodey key + H:** show or hide Hodey.
- **Hodey key + A:** open the Hodeum app, or fold it back into the notch if you're in it.

Hodey swallows these letter presses, so the app underneath never sees them, and other Right Ctrl shortcuts (copy, paste) work as usual.

**Voice, on this PC** (CPU, so the GPU stays free for vision):
- **Talking to Hodey:** hold <kbd>Right Ctrl</kbd> and talk, then let go (or tap the mic for one sentence). NVIDIA Nemotron speech recognition, with Silero voice detection, turns it into text, and the notch shows the words as Hodey hears them.
- **What you can say:**
  - when idle, a goal ("teach me how to make a pivot table") starts a Hode, and a what/where question asks about the screen;
  - during a Hode, "hint", "explain", "repeat", "I did it", "pause", "continue" and "stop" are controls, and anything else is a question.
- **Conversation:** once you talk to Hodey, it's a back-and-forth.
  - Like a voice chat, the mic stays open while Hodey answers: talk over it any time and it stops to listen. Its own voice through your speakers is filtered out. Say "that's all" or stay quiet for a few seconds to end it.
  - Hands-free works the same way: "Hey Hodey" stops Hodey mid-sentence.
  - Hodey acknowledges a question right away ("Let me look.") and answers in a sentence or two.
  - The notch shows your question above Hodey's answer, so you can read along.
  - You can turn this off in Settings → Voice.
- **Tap-to-talk:** listening stops after one sentence, so room noise can't steer Hodey. Tapping also interrupts Hodey mid-sentence. If Hodey hears its own voice coming back through the speakers, it ignores it.
- **Hodey's voice:** Kokoro-82M, the most natural local voice. Pick from 12 English voices in Settings, American and British, female and male; "Heart" is the default. Supertonic's 10 voices are a second option. Both run on the CPU, about three times faster than real time, and Hodey says one sentence while it prepares the next. Windows voices are used only if no natural voice is installed. (NVIDIA's MagpieTTS was considered, but it can't run in real time on the CPU, and the GPU is busy with the vision model.) Hodey's first words come from a short first phrase, and quick acknowledgements are prepared ahead, so replies start in well under a second.
- **Understanding you:** NVIDIA Nemotron 3.5 streaming speech recognition, with Windows echo cancellation during conversations so Hodey doesn't hear itself. If Nemotron is missing or stops returning text, Whisper (base, int8, on the CPU) takes over. It has no live partial text, and the status names the engine in use.
- **Hindi and Hinglish:** Settings > Voice > Language is **Auto** by default: Hodey answers in whatever you speak, English, Hindi (हिन्दी) or Hinglish, and switches when you do. You can also fix one language.
  - Hinglish is written the way people type it ("ऊपर Insert tab पर click कीजिए"); Hindi is all Devanagari. Lessons, quick replies and the vision model's answers follow the language.
  - "Hindi written as" shows Hindi words in English letters if you prefer ("Upar Insert tab par click kijiye"). Speech is the same either way.
  - Spoken by one of Kokoro's four Hindi voices; English words inside Hindi sentences are respelled so the voice says them naturally.
  - Goals and spoken controls work in all three: "पिवट टेबल बनाना सिखाओ", "हिंट दो", "hint do", "phir se bolo", "ruko", "bas".
  - The speech model has no Indian-English option; if Auto or English US mishears your accent, try English UK.
- **Hands-free (opt-in):** Settings > Voice > Hands-free lets you say "Hey Hodey, give me a hint" with no key. The mic stays on (orange dot). Speech is checked on this PC, and anything that doesn't open with a wake word is dropped as soon as its first word is known. Nothing is recorded or sent.
- **Wake words:** while you hold the Hodey key, you can start with "Hey Hodey" (or a common mishearing of it) and Hodey drops it before acting; add your own names, like "Hey Hodes", in Settings > Voice.
- **Privacy:** the orange dot shows while the mic is on. Audio and transcripts are never saved.
- **Setup:** `scripts/setup-local-ai.ps1` downloads the voice models (about 950 MB) into `models/voice`.

**Local by default**: no cloud keys needed. SQLite (`hodeum.db` in the app config folder) stores skills, Hode history, chats and settings, never screenshots or audio. The local model server runs inside a Windows job object, so it stops with Hodeum even after a crash.

**iPhone (Dark Mode Hode):** mirror the iPhone into the notch (⋯ → Show iPhone) through iPhone Mirroring, a capture card, or AirPlay via UxPlay. Hodey reads the mirror with Windows OCR and highlights on it. Setup is in [docs/iphone-mirroring.md](docs/iphone-mirroring.md). The on-device iPhone test app is in `ios/`, built by GitHub Actions; see [docs/ios-sideload.md](docs/ios-sideload.md).

**Accounts (optional):** Google sign-in syncs skills, Hode history, settings and chat text to Supabase, and the web dashboard can start Hodes on your PC. Screenshots, audio and transcripts never sync. Signed-out use is fully local.

**Cloud (optional, off by default):** each cloud provider is opt-in and needs its own key. Keys are stored in Windows Credential Manager, and the app only learns whether one is saved.
- A provider runs only when it's turned on, its key is saved, and the app in front isn't on the sensitive list (password managers and banking by default). A provider that fails is skipped for a minute, and that same request is answered locally.
- The notch shows **● Local** when no cloud provider can receive anything, and **☁ Enhanced** when one can.
- **Gemini (reasoning):** gets text only: the lesson step, the skill level and the app's interface labels. Content such as file names, list rows and typed text is hidden, and labels are scrubbed of emails, links, paths and numbers. No screenshots, no goal or question words. Learner questions and open-ended goals stay with the local model. Model: picked in Settings → Cloud from the models your key can use (default `gemini-3.8-flash`); dev builds can override it with `GEMINI_MODEL`.
- **ElevenLabs (voice):** speaks only lesson lines and Hodey's fixed phrases. Answers about your screen stay in the local voice. Talking over Hodey cuts it off as usual. Model and voice: picked in Settings → Cloud from your account (default Flash v2.5 and the stock voice Sarah), with a ▶ Preview that speaks one fixed sentence; dev builds can override them with `ELEVENLABS_MODEL` / `ELEVENLABS_VOICE_ID`.
- **Backboard (memory):** gets a compact end-of-Hode summary (lesson, skills, steps that needed help, next help level), never a transcript. *Read-only* recalls without writing. Local SQLite memory is always on and is updated first.
- Set keys and switches in **Settings → Cloud**. Each provider links to its official key page (Gemini: aistudio.google.com/app/apikey, ElevenLabs: elevenlabs.io/app/settings/api-keys, Backboard: app.backboard.io → Settings → API Keys). Model and voice lists are fetched in Rust with the saved key; only ids and names reach the window.

Live checks of the validation gates are in [docs/validation-gates.md](docs/validation-gates.md).

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
4. Press <kbd>Right Ctrl</kbd>+<kbd>P</kbd>, drag over any control, and ask **What is this?**
5. Run the Hode again. Steps for skills you already practised get less help (no arrow, a shorter hint).
6. Open ⋯ and dock Hodey to the left or right; press <kbd>Right Ctrl</kbd>+<kbd>H</kbd> to hide it and bring it back.

No cloud API keys are needed. Copy `.env.example` to `.env.local` only when you explicitly enable the optional providers.

### Accounts, sync and the web dashboard (optional)

Sign in with Google (Settings › Account) to sync skills, Hodes, settings and chats to Supabase, then use the web dashboard (`/web.html`) to see your progress and start a Hode on your PC. Signed out, everything stays local. Setup: [`docs/accounts-setup.md`](./docs/accounts-setup.md).

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
src/features/account/ Google sign-in (notch-owned), account status over the bus
src/features/sync/   sync engine (pull/merge/push), web command channel, Supabase adapter
src/web/             web dashboard (web.html): desktop pages over the account + PC picker
supabase/migrations/ Postgres schema, RLS and Realtime for accounts
src/stage/           browser practice stage and scripted mock apps
src-tauri/src/       windows, hit-test, docking + app bar, tray, perception (UIA, input hook, capture), app window, chat context, SQLite
src-tauri/migrations/ SQLite schema, shared with the TypeScript store tests
```

See [`CLAUDE.md`](./CLAUDE.md) for priorities and architecture rules, and `docs/superpowers/` for the spec and plan.
