# Sub-project 1 — Shell + Teaching Loop (with Point & Ask)

**Date:** 2026-10-03 · **Branch:** `feat/shell-teaching-loop` · **Source of truth:** PRD v6, `CLAUDE.md`

## 1. Goal

A Windows Tauri app with a real top-center notch window and a separate click-through guidance overlay, driven by a tested Hode state machine. The complete teaching loop — goal → target highlight → learner action → verification → wrong-action correction → stuck escalation → success → less help next time — runs end-to-end against a deterministic perception adapter and task packs, fully offline. The learner can mark a region of the screen ("Point & Ask") and ask Hodey about it.

Out of scope here (later sub-projects): real UI Automation and screen capture (SP2), Qwen3-VL / OmniParser (SP3), voice (SP4), cloud providers (SP5). Every one of them plugs into an interface defined here.

## 2. Context decisions (already approved)

- Perception hierarchy for the whole product: UIA → OmniParser V2 detector (ONNX, CPU) → Qwen3-VL-4B-Instruct Q4_K_M via llama-server CUDA. Local is always default; cloud is opt-in.
- Hardware: i7-12700H, RTX 3060 Laptop 6 GB, 32 GB RAM.

## 3. Windows and processes

| Window | Entry | Properties |
|---|---|---|
| `main_notch` | `notch.html` | transparent, undecorated, always-on-top, skip taskbar, top-center of primary monitor, `WS_EX_NOACTIVATE` by default |
| `guidance_overlay` | `overlay.html` | transparent, undecorated, always-on-top, skip taskbar, covers the notch's monitor, ignores cursor events by default, never focused except during annotation |

Rust commands (`src-tauri/src/`):

- `set_notch_hit_rect(rect)` — the pill's box; a Rust thread polls the cursor (~30 Hz) and makes the fixed-size notch window click-through outside it, emitting `notch:hover`.
- `set_notch_activatable(bool)` — toggles `WS_EX_NOACTIVATE`. On only while a text field in the notch has focus, so clicking Hint/Pause never steals focus from the learner's app.
- `set_overlay_interactive(bool)` — toggles `set_ignore_cursor_events` and focus for annotation mode.
- `monitor_info()` — returns `{ id, x, y, width, height, scale }` for the overlay's monitor.
- Global shortcut `Ctrl+Alt+H` (via `tauri-plugin-global-shortcut`) emits `annotate:start`.

Notch sizing (revised during implementation): the notch window is a fixed 600×340 logical px at the top-centre; the pill animates inside it with CSS, and the cursor hit-test makes the rest click-through. This removes window resizing entirely.

## 4. Message bus

Windows talk through a typed `Bus` interface:

```ts
interface Bus {
  emit<K extends keyof BusEvents>(name: K, payload: BusEvents[K]): void;
  on<K extends keyof BusEvents>(name: K, handler: (p: BusEvents[K]) => void): () => void;
}
```

Implementations: `TauriBus` (Tauri events) and `LocalBus` (in-page, used by tests and the browser dev stage). Events: `overlay:render` (list of overlay primitives in physical screen px), `overlay:clear`, `annotate:start`, `annotate:cancel`, `annotation:submitted`.

## 5. Core types (`src/lib/types.ts`)

```ts
type AssistanceLevel = "demonstrate" | "guide" | "hint" | "observe" | "independent";
type Rect = { x: number; y: number; width: number; height: number }; // physical screen px
type Point = { x: number; y: number };

interface UiElement {
  id: string; name: string; role: string; bounds: Rect;
  source: "uia" | "detector" | "vlm" | "mock"; confidence: number;
  selected?: boolean;
}
interface ScreenObservation { app: string; windowTitle: string; elements: UiElement[]; at: number; }

type StateSignal =
  | { kind: "element_visible"; name: string }
  | { kind: "element_absent"; name: string }
  | { kind: "element_selected"; name: string }
  | { kind: "window_title_contains"; text: string };

interface TeachingAction {
  kind: "guide" | "correct" | "answer" | "clarify" | "celebrate";
  speech: string;
  target?: { elementId: string; bounds: Rect; confidence: number; label: string };
  expectedState?: StateSignal;
  skill: string;
  assistanceLevel: AssistanceLevel;
}

interface LearnerAnnotation {
  id: string;
  shape: { kind: "rect"; bounds: Rect } | { kind: "stroke"; points: Point[]; bounds: Rect } | { kind: "point"; at: Point; bounds: Rect };
  intent: "ask" | "focus";
  question?: string;
  createdAt: number;
}

interface TeachingContext {
  goal: string; pack?: TaskPack; step?: TaskStep; observation: ScreenObservation;
  assistanceLevel: AssistanceLevel; utterance?: string; focusRegion?: LearnerAnnotation;
  recentMistakes: number;
}
```

Provider interfaces exactly as in `CLAUDE.md` (`ReasoningProvider`, `TTSProvider`, `MemoryProvider`) plus:

```ts
interface PerceptionAdapter {
  observe(region?: Rect): Promise<ScreenObservation>;
  onLearnerAction(handler: (o: ScreenObservation) => void): () => void;
}
interface SkillStore {
  get(skillId: string): Promise<SkillRecord | null>;
  recordOutcome(skillId: string, outcome: StepOutcome): Promise<SkillRecord>;
}
```

`SkillRecord` follows PRD §6 (`skill_id`, `status`, `confidence`, `success_count`, `failure_count`, `last_assistance_level`, `last_seen_at`).

## 6. Task packs (`src/task-packs/`)

JSON validated at load with `zod`. No coordinates, ever.

```ts
interface TaskPack { id: string; title: string; app: string; goalPhrases: string[]; steps: TaskStep[]; }
interface TaskStep {
  id: string; objective: string; skill: string;
  target: { names: string[]; role?: string };
  speech: Record<AssistanceLevel, string>;   // "independent" may be ""
  explain: string;
  success: StateSignal;
  mistakes: { signal: StateSignal; correction: string }[];
}
```

Packs shipped: `excel-pivot.json` (select data → Insert tab → PivotTable → confirm dialog → drag field) and `windows-zip.json` (select files → right-click → Compress to ZIP → name archive). Goal matching: normalized keyword overlap against `goalPhrases`; no match → "clarify" action.

## 7. Hode engine (`src/features/hode/`)

Pure reducer: `step(state, event) → { state, effects }`. A runtime executes effects against adapters; the reducer never touches I/O.

**States:** `idle`, `goal_entry`, `observing`, `reasoning`, `guiding`, `answering`, `annotating`, `recovering`, `success`, `paused`. (Verification is synchronous inside `LEARNER_ACTED`, so there is no separate `verifying` state.)

**Events:** `START_HODE`, `GOAL_SUBMITTED`, `OBSERVED`, `ACTION_READY`, `LEARNER_ACTED`, `STUCK_TIMEOUT`, `HINT_REQUESTED`, `EXPLAIN_REQUESTED`, `LET_ME_TRY`, `ANNOTATION_SUBMITTED`, `PAUSE`, `RESUME`, `END_HODE`, `PROVIDER_FAILED`.

**Effects:** `observe(region?)`, `reason(context)`, `renderOverlay(action)`, `clearOverlay`, `say(text)`, `startStuckTimer(ms)`, `cancelStuckTimer`, `recordOutcome(skill, outcome)`.

Rules:

- Every `reason` carries a monotonically increasing request id; results for stale ids are dropped (latest learner action wins).
- Verification evaluates `StateSignal` against the new observation: match → advance step; matches a known mistake → `correct` with that correction and escalate one level; otherwise keep waiting.
- Stuck: `STUCK_MS = 12000` without progress, or `MAX_WRONG_ACTIONS = 2` on a step → escalate one assistance level and re-guide.
- `PAUSE` clears the overlay immediately and cancels timers; `END_HODE` returns to `idle`.
- `PROVIDER_FAILED` falls back to the local planner and keeps the Hode alive; the notch shows a recoverable note.

**Local reasoner:** `TaskPackReasoningProvider` implements `ReasoningProvider` deterministically: finds the step's target in `observation.elements` by name/role, attaches confidence, chooses speech for the current assistance level. For annotations it answers from the element(s) inside the region (name, role, pack `explain` text if it matches a step target). SP3 adds a VLM provider behind the same interface.

## 8. Assistance ladder and confidence policy (`src/features/hode/policy.ts`)

- Starting level for a step = skill's `last_assistance_level`, defaulting to `demonstrate` for new skills.
- Step completed with no escalation → next level toward `independent`. Any mistake or stuck escalation → one level toward `demonstrate`.
- Overlay per level: demonstrate = spotlight + arrow + label; guide = highlight + label; hint = none until the learner asks or is stuck; observe/independent = none.
- Confidence: `≥ 0.85` precise highlight/arrow; `0.65–0.84` broader highlight (target padded by `BROAD_PADDING_PX = 24`, no arrow); `< 0.65` no overlay, re-observe once, then `clarify`.

## 9. Coordinates (`src/lib/coords.ts`)

`toOverlay(rect, monitor) = { x: (rect.x - monitor.x) / monitor.scale, … }` and the inverse for annotations. Pure and unit-tested at scale 1.0, 1.25, 1.5 and with a non-zero monitor origin.

## 10. Point & Ask

1. Trigger: `Ctrl+Alt+H` or the ⌖ button in the notch. Engine pauses its stuck timer; overlay becomes interactive; screen dims 12%; crosshair cursor.
2. Tools: drag = rectangle (default); hold `Shift` and draw = freehand circle (bounds of the stroke); single click = point (bounds = 48 px square around it). `Esc` cancels and restores click-through.
3. An inline composer anchors beside the mark (flips to stay on-screen): text field + chips "What is this?", "How do I use this?", "Focus here". `Enter` submits.
4. On submit the overlay returns to click-through, the mark persists as a faint pin, the notch shows "Hodey is looking at this screen…", then the answer. If the answer targets an element inside the region, it is highlighted.
5. `intent: "focus"` keeps the region as `focusRegion` for the rest of the Hode; reasoning prefers targets inside it.
6. Privacy: annotation data stays local; SP5 cloud providers must receive only the cropped region and only when Enhanced is on.

## 11. Notch UI

States and sizes per PRD §8.2 (idle ≈ 190×34, listening/thinking ≈ 280×44, guidance ≈ 420×96, lesson ≈ 520×260, success transient). Visual system:

- Pure black surface, flush to the screen top (square top corners, 18 px bottom radius); spring motion on size (CSS `linear()` spring easing, ~320 ms).
- Typography: `Segoe UI Variable`, fallback system-ui. Body 13 px, labels 11 px.
- One guidance color: amber `#FFB224` with a 2 px `#1A1A1A` outer stroke so overlays read on light and dark apps. `● Local` dot `#3DD68C`.
- No gradients, glows, emoji glyphs, or marketing copy. Copy strings exactly as in `CLAUDE.md`.
- Controls visible in guidance: Hint, Explain, Let me try, ⌖ Point & Ask, Pause, End. Keyboard reachable, visible focus ring.
- Visible loading (thinking), success, and failure (recoverable message + Retry) states.

## 12. Persistence

`tauri-plugin-sql` (SQLite) with a migration creating `skills` and `step_attempts` (`hodes` deferred until Hode history is built). `SqliteSkillStore` implements `SkillStore`; `MemorySkillStore` for tests/dev. No screenshots stored.

## 13. Dev stage

`npm run dev` serves `stage.html`: a browser-only harness rendering the notch, overlay, and a mock app surface (mock Excel ribbon / Explorer list) on one page via `LocalBus` and `MockPerception`. Clicking mock controls produces learner-action observations. It exists for development and for Gate 6 rehearsal; it is never shipped in the Tauri windows.

## 14. Testing

Vitest. Unit tests for: coords, policy (ladder + confidence), task-pack validation and goal matching, `TaskPackReasoningProvider`, reducer transitions including stale-result dropping, wrong-action correction, stuck escalation, pause, annotation flow, provider failure fallback. One scripted integration test runs the full Excel pack through the runtime with `MockPerception` + `MemorySkillStore`, then runs it again and asserts reduced assistance.

Validation commands: `npm run typecheck`, `npm test`, `npm run build`, `cargo check` in `src-tauri`, manual `npm run tauri:dev` checklist (notch top-center, no focus steal, overlay click-through, Ctrl+Alt+H annotate + Esc).

## 15. Error handling

No silent catches. Provider/adapter errors become `PROVIDER_FAILED` events with the message logged via `console.error` and shown as a recoverable notch state. Task-pack validation errors fail loudly at load with the zod message.
