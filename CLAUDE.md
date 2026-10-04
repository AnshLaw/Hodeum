# Hodeum — Claude Build Instructions

## Mission

Build Hodeum for the hackathon: a Windows-first, local-first teaching companion that helps a learner complete real software tasks without taking control away from them.

The product vocabulary is intentional:

- **Hodeum**: the learning environment.
- **Hodian**: the learner.
- **Hode**: one guided learning journey.
- **Hodey**: the teaching companion.

Primary promise: **AI that teaches, not takes over.**

The full product requirements are in `c:\Users\anshr\Downloads\hodeum_final_prd_v6.md`. Treat the PRD as the product source of truth, but optimize implementation for a reliable hackathon demo rather than exhaustive platform coverage.

## How to work

### Execution bias

- Implement working vertical slices immediately. Do not spend turns producing plans that do not change the repository.
- Prefer a small, complete, testable path over broad placeholder architecture.
- After each meaningful change, run the narrowest useful validation command.
- Keep the demo path stable before adding bonus features or sponsor polish.
- Make reasonable defaults when the PRD is clear. Ask only when a decision materially changes the product or could make the implementation unsafe.
- Never hide failures behind silent fallbacks. Show a recoverable state in the UI and log the actual error.

### Required loop for every feature

1. Read the relevant existing code and PRD section.
2. Implement the smallest end-to-end slice.
3. Add or update types and tests where behavior is non-trivial.
4. Run formatting, type-checking, build, and targeted tests as applicable.
5. Fix failures before moving on.
6. Only then continue to the next slice.

### Definition of done

A feature is done only when:

- it works in the intended Windows/Tauri runtime or has an explicit, testable adapter boundary;
- it has a visible loading, success, and failure state where applicable;
- it does not break local/offline operation;
- it is typed and buildable;
- its behavior is covered by a focused test or a reproducible manual verification path;
- related documentation/configuration is updated.

## Product priorities

### P0 — protect these first

1. Tauri app boots on Windows.
2. Top-center dynamic notch renders, expands, collapses, and never steals focus during passive guidance.
3. Separate transparent, click-through guidance overlay exists and can highlight a real target.
4. Active-window capture and Windows UI Automation are behind native adapters.
5. Teach Mode is the default: the learner performs meaningful actions.
6. Step-by-step guidance, target highlighting, success verification, wrong-action correction, and stuck detection work.
7. Local provider path works without cloud credentials.
8. Provider failures fall back locally without ending the current Hode.
9. At least two reliable task packs exist; start with Excel Pivot Table and a Windows file task.
10. Skill progress is persisted in SQLite or a local adapter with an equivalent stable interface.

### P1/P2 — only after the full offline loop is reliable

- progressive hint reduction;
- bilingual English/Hindi/Hinglish behavior;
- iPhone capture;
- expanded skill graph/history UI;
- sensitive-app cloud denylist UI;
- Gemini, ElevenLabs, and Backboard sponsor paths;
- richer analytics, voice cloning, web lookup, and assistive action mode.

Do not implement the P1/P2 list at the expense of the core offline demo.

## Non-negotiable architecture

### Desktop stack

- Tauri 2
- React + TypeScript + Vite
- Tailwind only if it adds speed; do not introduce a design system unnecessarily
- Rust + `windows-rs` for Win32, UI Automation, window management, capture, and overlay behavior
- Separate Tauri windows:
  - `main_notch`: transparent, undecorated, topmost, skip taskbar, dynamically sized
  - `guidance_overlay`: transparent, full-monitor, non-focusable, click-through by default
  - `preferences`: optional normal settings window

Do not turn the whole app into one giant invisible full-screen webview.

### Provider boundaries

The Hode state machine must depend on interfaces, never directly on sponsor SDKs:

```ts
interface ReasoningProvider {
  reason(input: TeachingContext): Promise<TeachingAction>;
  healthCheck(): Promise<boolean>;
}

interface TTSProvider {
  speak(text: AsyncIterable<string>, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<boolean>;
}

interface MemoryProvider {
  getRelevantMemory(query: MemoryQuery): Promise<LearningMemory[]>;
  storeLearningSummary(summary: HodeLearningSummary): Promise<void>;
}
```

Provider order:

```text
Reasoning: Gemini -> local Qwen3-VL
TTS: ElevenLabs -> MagpieTTS -> Supertonic -> Windows TTS
Memory: Backboard -> SQLite
ASR: Nemotron -> faster-whisper
```

The arrows above mean “when explicitly enabled and healthy”; **Local is always the default**. Cloud is opt-in and must be skippable for sensitive apps, offline use, quota exhaustion, or network failure.

### Local-first behavior

- Never require `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, or `BACKBOARD_API_KEY` to boot or run the core demo.
- Never upload screenshots, audio, or transcripts. Learner data (skills, Hode history, settings, chat text) syncs to Supabase only after the learner signs in with Google; signing in turns sync on, the sign-in screen says so, and Settings can pause it. Signed-out use is fully local.
- Never persist raw screenshots by default.
- Keep API secrets out of source control; use `.env.local` for development and an OS-backed secret store for distribution.
- Show `● Local` or `☁ Enhanced` in the notch whenever provider state is visible.

### Perception and performance

Use the cheapest reliable signal first:

1. Windows UI Automation.
2. Lightweight state/event comparison.
3. OmniParser detector on demand.
4. Qwen3-VL only when semantic reasoning is needed.

Observation is event-driven, not 30 FPS AI vision. Trigger on clicks, keyboard actions, UIA events, window changes, completed speech, stuck timers, or explicit “look again”.

Keep the RTX 3060 primarily for the quantized local VLM. Run speech CPU-first unless measurement proves otherwise. Cancel stale VLM/TTS work when a newer learner action arrives.

### Coordinates

Always convert:

```text
source coordinates -> physical monitor coordinates -> DPI scale -> overlay coordinates
```

Recalculate after monitor, DPI, resolution, or target-window changes. If confidence is below the project threshold, hide the precise arrow and re-observe instead of drawing a confidently wrong overlay.

Suggested confidence policy:

- `>= 0.85`: direct target overlay;
- `0.65–0.84`: broader highlight plus UIA verification;
- `< 0.65`: re-capture or ask a short clarification.

## Teaching behavior

Teach Mode is the default and the demo differentiator. Hodey explains, highlights, asks the learner to act, verifies the result, and adapts help. It does not automatically click through the task.

Assistance ladder:

1. Demonstrate conceptually.
2. Guide with a target.
3. Hint.
4. Observe and intervene only on error/hesitation.
5. Verify independently with minimal help.

Every teaching step should have:

- one objective;
- one expected success condition;
- one likely recovery path;
- a skill ID;
- an abort/cancel path.

Use short spoken responses. Support barge-in: local VAD remains authoritative, TTS stops immediately, stale reasoning is cancelled, and the new learner utterance gets priority.

## UI language

Use the PRD vocabulary and these copy strings:

- `Start a Hode`
- `Continue your Hode`
- `Ask Hodey`
- `Hodey is listening…`
- `Hodey is looking at this screen…`
- `Need a hint?`
- `Hode complete`
- `Skill learned ✓`
- `Your Hodes`
- `Hodian Profile`

Keep branding secondary to clarity. Avoid calling Hodey an autonomous agent or implying that it completed the learner’s work.

## Task packs

Task packs improve demo reliability without hard-coded pixel coordinates. They may define:

- goal;
- prerequisites;
- robust UI labels;
- expected state signals;
- common mistakes;
- success indicators;
- skill IDs.

They must not define fixed screen coordinates. Runtime UIA/visual grounding must locate targets.

## Suggested repository layout

```text
src/
  components/       React notch and lesson UI
  features/hode/    state machine, planner, teaching actions
  providers/        local/cloud adapters behind interfaces
  task-packs/       reliable demo workflows
  lib/              shared types and utilities
src-tauri/
  src/              Rust commands and Windows adapters
  capabilities/     Tauri permissions
  tauri.conf.json
```

Keep native integrations behind commands/adapters so the web UI can be developed and tested with deterministic mocks.

## Commands

Expected commands once dependencies are installed:

```powershell
npm install
npm run dev
npm run typecheck
npm run build
npm run tauri:dev
npm run tauri:build
npm test                         # vitest: unit + end-to-end teaching loop
cd src-tauri; cargo test --lib   # Rust geometry / hit-test
```

`npm run dev` serves the browser practice stage (`index.html`): real notch, overlay and runtime driving scripted Excel / File Explorer mocks. Use it to rehearse Gate 6 without native perception. Its iPhone tab rehearses the Dark Mode phone Hode; real iPhone mirroring setup is in `docs/iphone-mirroring.md`.

## Validation gates

Before calling the core demo complete, verify:

1. notch resize is smooth enough and does not steal focus;
2. overlay alignment error is under 10 px on common Windows controls;
3. one active-window screenshot can be reasoned about without GPU OOM;
4. local ASR handles a short English command;
5. local TTS starts and stops on interruption;
6. spoken goal -> target guidance -> learner action -> success verification works;
7. deliberate wrong action -> correction works;
8. repeated skill receives less assistance;
9. complete flow works with cloud providers disabled;
10. cloud outage returns to the local path without killing the Hode.

Protect Gate 6. Do not destabilize it for optional sponsor features.

## Git and safety

- Never commit secrets, model weights, raw screenshots, transcripts, local databases, or generated binaries.
- Update `.gitignore` as soon as any local runtime artifact is introduced.
- Keep changes focused and easy to review.
- Do not rewrite unrelated user changes.
- Use clear commit messages when asked to commit.
- Prefer explicit errors and recoverable UI states over broad catches or silent defaults.

## Fast decision rule

If a choice is unclear during the hackathon:

1. choose the smallest implementation that preserves the teaching loop;
2. keep the interface stable so the implementation can be swapped;
3. prefer local/offline and deterministic behavior;
4. add a visible failure state;
5. measure before optimizing;
6. defer anything that does not help the next live demo.
