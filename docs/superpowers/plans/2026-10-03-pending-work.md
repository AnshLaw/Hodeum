# Pending Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap left after consolidation (2026-10-03 audit): opt-in cloud providers (Gemini, ElevenLabs, Backboard) behind the existing interfaces, the `● Local` / `☁ Enhanced` badge, a sensitive-app cloud gate, local learning memory, richer stuck detection, a second ASR engine, then P1/P2.

**Architecture:** Cloud calls run in Rust, so API keys stay in Windows Credential Manager and never enter the webview. Each cloud provider is a thin TS adapter over a Tauri command, implementing the interface in `src/providers/interfaces.ts`. A single TS `CloudPolicy` reads settings, key presence and the active app, and decides per request whether a cloud provider may run. It also drives the badge. Local is always the default and always the last fallback.

**Tech Stack:** Tauri 2, React + TS + Vite, vitest, Rust (`reqwest`, `keyring`, `tokio-tungstenite`, `rodio`, `sherpa-onnx`), zod.

**Spec:** `c:\Users\anshr\Downloads\hodeum_final_prd_v6.md` §4.4, §7, §10.1, §13 (ASR fallback), §14.1, §18.1; `CLAUDE.md` (provider order, local-first rules, gates).

## Global Constraints

- Local is the default. The app never requires `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` or `BACKBOARD_API_KEY` to boot or to run a Hode.
- Never upload screenshots, audio or transcripts (CLAUDE.md). Gemini receives text context only: goal, step, expected state, UIA labels and rects, skill level. It gets no images and no learner utterance text.
- ElevenLabs receives only Hodey's own spoken text. Backboard receives only the compact `HodeLearningSummary` (PRD §18.1). It never gets a transcript.
- Every cloud provider is skipped when its toggle is off, its key is missing, the active app is on the sensitive list, or it failed within the cooldown. A skip or failure always falls through to the local chain within the same request; the Hode never ends because of a cloud problem.
- Keys: the Windows Credential Manager entry `Hodeum/<provider>` comes first. In dev builds only, an env var (`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `BACKBOARD_API_KEY`) is the fallback. Keys never travel to JS; JS only sees `{ provider, present: boolean }`.
- Model IDs are configurable: Gemini defaults to `gemini-3.7-flash` (`GEMINI_MODEL`), ElevenLabs to `eleven_flash_v2_5`.
- Badge copy is exactly `● Local` / `☁ Enhanced`. Enhanced means at least one cloud provider is currently allowed to receive context.
- Functions stay under 40 lines, constants are named, and errors are never swallowed: log them and show a recoverable state.
- Hindi copy is gender-neutral (see `src/lib/spoken.ts`). New spoken lines go into `SpokenCopy` for en/hi/hinglish.
- Each workstream lands on its own branch off `main` and is merged with `--no-ff` after `npm run typecheck && npm test && npm run build` and `cargo test --lib` pass.

## Review Focus

1. **Cloud key present, network down** (common at demos): the first request fails fast, under the timeout, and the same request is answered locally. The policy then skips that provider for the cooldown, so every later step doesn't pay the timeout again. Test: `cloud-policy.test.ts` "cools down a failed provider". Owner: Task 0.2.
2. **Sensitive app in front** (banking, password manager): no cloud provider is called, even with everything enabled, and the badge shows `● Local`. Test: `cloud-policy.test.ts` "keeps cloud off for sensitive apps". Owner: Task 0.2.
3. **Barge-in while ElevenLabs is streaming:** stop is immediate, with no tail audio after `stop()`. Test: `elevenlabs-tts.test.ts` "stop aborts the stream". Owner: Task 2.2.
4. **Gemini returns valid JSON that points at a target that isn't on screen:** the action is rejected, the same as an invalid Qwen box, and the request falls back. Test: `gemini-reasoner.test.ts` "rejects targets not in the observation". Owner: Task 1.2.
5. **Memory recall pushes the assistance level outside the ladder or past the learner's skill record:** recall only nudges the level by one step, and it never overrides a mastered skill record. Test: `memory.test.ts` "nudges the start level by at most one step". Owner: Task 3.2.

---

## Wave 1: P0 gaps

Task 0 runs first, because it defines the contracts. Workstreams 1–6 then run in parallel on separate branches. Each one wires itself in `src/entries/notch.tsx`, and the merge resolves those small wiring conflicts.

### Task 0: Cloud foundation (settings, key store, policy, badge)

**Files:**
- Modify: `src/data/settings.ts`: add the `cloud` block.
- Create: `src/providers/cloud/policy.ts`, `src/providers/cloud/policy.test.ts`, `src/providers/cloud/keys.ts`
- Create: `src-tauri/src/cloud/mod.rs`, `src-tauri/src/cloud/keys.rs`. Register the commands in `src-tauri/src/lib.rs`.
- Modify: `src-tauri/Cargo.toml`: add `keyring` with `windows-native`.
- Modify: `src/components/notch/Notch.tsx` and `notch.css`: the badge.

**Interfaces (produced, used by every later task):**
```ts
// src/data/settings.ts
export const CLOUD_PROVIDERS = ["gemini", "elevenlabs", "backboard"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export const MEMORY_MODES = ["off", "auto", "readonly"] as const;
cloud: {
  reasoning: boolean;            // Gemini, default false
  voice: boolean;                // ElevenLabs, default false
  memory: "off" | "auto" | "readonly"; // Backboard, default "off"
  sensitiveApps: string[];       // default DEFAULT_SENSITIVE_APPS
}
// src/providers/cloud/policy.ts
export class CloudPolicy {
  constructor(deps: { settings: () => Settings["cloud"]; keys: () => Record<CloudProvider, boolean>; activeApp: () => string | undefined; now?: () => number });
  allowed(provider: CloudProvider): boolean;      // toggle on, key present, app not sensitive, not cooling down
  reportFailure(provider: CloudProvider): void;   // starts COOLDOWN_MS
  reportSuccess(provider: CloudProvider): void;
  enhanced(): boolean;                            // any provider allowed
  subscribe(listener: () => void): () => void;
}
// Tauri commands (Rust): cloud_key_status() -> { gemini: bool, elevenlabs: bool, backboard: bool }
//                        cloud_key_set(provider, key) -> (); cloud_key_clear(provider) -> ()
// Rust helper for later tasks: cloud::keys::read(provider: &str) -> Option<String>
```

- [ ] Write `policy.test.ts`. Cases: all off gives `enhanced() === false`. A toggle on with no key is not allowed. Toggle and key both present is allowed. A sensitive app (case-insensitive substring of the process or app name) blocks every provider. `reportFailure` followed by time inside the cooldown is not allowed, and it is allowed again after the cooldown. `memory: "readonly"` counts as allowed for backboard.
- [ ] Run vitest and confirm the tests fail.
- [ ] Implement the settings block (zod with `.catch` defaults and `parseSettings` updated) and `CloudPolicy`.
- [ ] Rust: write a `keys.rs` unit test for env fallback and provider-name validation (only the three names are accepted). Then implement it with `keyring::Entry::new("Hodeum", provider)` and register the commands.
- [ ] Badge: `Notch` takes `cloud?: { enhanced(): boolean; subscribe(...) }` and renders `● Local` / `☁ Enhanced` beside the privacy dots whenever the notch is expanded. Add a test in `notch-view.test.ts`.
- [ ] Run `npm run typecheck && npm test && npm run build` and `cargo test --lib`, then commit with `feat: cloud provider foundation — opt-in settings, Windows credential store, policy and Local/Enhanced badge`.

### Workstream 1: Gemini reasoning (PRD §10.1)

**Files:** `src-tauri/src/cloud/gemini.rs`, `src/providers/cloud/gemini-reasoner.ts` (+ test), `src/providers/cloud/gated.ts` (+ test), and the wiring in `src/entries/notch.tsx`.

**Interfaces:**
```ts
// Gated wrapper used by W1 and reusable later:
export class GatedReasoner implements ReasoningProvider { constructor(inner: ReasoningProvider, provider: CloudProvider, policy: CloudPolicy) }
// throws CloudSkipped (not logged as failure) when !policy.allowed; reports success/failure to policy.
export class GeminiReasoningProvider implements ReasoningProvider { readonly id = "gemini"; constructor(bridge: { invoke }) }
// Rust: gemini_reason(request: GeminiRequest) -> serde_json::Value  (structured-output JSON, schema = teaching action)
```
- [ ] Write tests first. The request built from a `TeachingContext` holds no image, no utterance and no question text. A valid response maps to a `TeachingAction`. Malformed JSON throws. A target whose element id or bounds aren't in the observation throws. `GatedReasoner` skips when the policy disallows it and reports the failure on a throw.
- [ ] Rust: POST to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with `responseMimeType: application/json` and a `responseSchema`, a 6 s timeout, and the key from `cloud::keys::read("gemini")`. Unit-test the request body builder and the response extraction against fixture JSON.
- [ ] Wiring: `reasoners: [new GatedReasoner(new GeminiReasoningProvider(...), "gemini", policy), local]`. Local stays last.
- [ ] Run validation and commit with `feat: opt-in Gemini reasoning behind the cloud policy, text context only, local fallback`.

### Workstream 2: ElevenLabs voice (PRD §14.1)

**Files:** `src-tauri/src/cloud/elevenlabs.rs`, `src/providers/cloud/elevenlabs-tts.ts` (+ test), and the TTS routing in `src/providers/speech/native-voice.ts` / `local-voice.ts`.

- [ ] Write tests first. The adapter sends the text chunks in order. `stop()` invokes `elevenlabs_stop`, and after the abort signal no further chunk is sent. A failure, or the policy disallowing the provider, falls through to the existing local `RoutedTTS` for the same utterance. The Devanagari path skips ElevenLabs unless the voice is multilingual; Flash v2.5 is, so Hindi is allowed.
- [ ] Rust: a WebSocket `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_24000`. Decode the base64 PCM into a `rodio` sink on the same output path Hodey's local voice uses, so the existing barge-in `stop` cuts it. Add `tokio-tungstenite` with `rustls`. Unit-test the message framing builders.
- [ ] Run validation and commit with `feat: opt-in ElevenLabs Flash voice streamed through Rust, cut by barge-in, local voice fallback`.

### Workstream 3: Learning memory (PRD §18.1)

**Files:** `src/features/memory/summary.ts` (+ test), `src/providers/memory/sqlite-memory.ts` (+ test), `src/providers/memory/backboard-memory.ts` (+ test), `src-tauri/src/cloud/backboard.rs`, a SQLite migration in `src/data/sqlite-stores.ts`, and the wiring in `notch.tsx` / `runtime.ts`.

- [ ] Write tests first. `summarize(events, prev, final)` builds a `HodeLearningSummary` from the Hode's state and log, with `needed_help_with` taken from the steps that had a hint, a stuck or a correction. `SqliteMemoryProvider` stores the summary and recalls by skill overlap. Start-of-Hode recall nudges the starting level by at most one step and never past a mastered skill record. Backboard runs only when `policy.allowed("backboard")`; in readonly mode it never writes. A Backboard failure never blocks completion, because the SQLite write happens first.
- [ ] Rust: Backboard REST, with one assistant per Hodian (id saved in the settings store) and one thread per Hode. Unit-test the request builders.
- [ ] Run validation and commit with `feat: local learning memory with end-of-Hode summaries; opt-in Backboard sync`.

### Workstream 4: Stuck detection signals (PRD §7)

**Files:** `src/features/hode/stuck.ts` (+ `stuck.test.ts`), `src/features/hode/learner.ts`, `src/features/voice/route.ts` (+ tests), and `src/lib/spoken.ts`.

- [ ] Write tests first. A third click on the same wrong control escalates. Open, close, open of the same wrong menu escalates. Two undo/back actions in a row escalate. An unexpected dialog (UIA `Dialog`/`Window` role not named in the step) gets a recovery line. "where?", "I don't see it", "कहाँ है", "dikh nahi raha" become `STUCK_TIMEOUT`-equivalent escalation, not PAUSE. "wait" stays PAUSE. The escalation follows the PRD ladder.
- [ ] Implement it as a pure `detectStuck(history, observation, step)` that returns a signal or `undefined`, called from `learner.ts`.
- [ ] Run validation and commit with `feat: richer stuck detection — repeated wrong clicks, menu loops, undo loops, surprise dialogs and 'I don't see it'`.

### Workstream 5: Cloud settings UI

**Files:** `src/app/pages/settings/CloudSettings.tsx`, `src/app/pages/SettingsPage.tsx`, `src/app/tauri-services.ts`, `src/app/services.ts`.

- [ ] Build a "Cloud (optional)" section. It has three toggles, disabled until a key is saved. Each key gets a password input with Save and Clear; the value is sent to `cloud_key_set` and never shown back. A per-provider health line comes from `healthCheck()`. It also has the sensitive-apps list editor, a Backboard memory-mode select, and the copy "Local is always on. Cloud only receives the current step, never your screen or voice."
- [ ] Add tests for the view-model (`cloud-settings.test.ts`).
- [ ] Run validation and commit with `feat: Cloud settings — keys in Windows Credential Manager, per-provider toggles, sensitive apps`.

### Workstream 6: Second ASR engine (PRD §13 ASR fallback)

**Files:** `src-tauri/src/voice/*` (a Whisper recognizer through `sherpa-onnx` offline Whisper, multilingual base int8), `scripts/setup-local-ai.ps1` (fetch the model), `src-tauri/src/voice/models.rs`.

- [x] Write a test first: `models.rs` finds the Whisper files. When Nemotron fails to load or errors at runtime, the engine switches to Whisper and the status `detail` names it.
- [x] Run `cargo test --lib`, then commit with `feat: Whisper (sherpa-onnx, int8, CPU) as the second speech engine when Nemotron is unavailable`.

Done in `src-tauri/src/voice/asr.rs`. Deviation from PRD §13: the PRD names faster-whisper (Python, CTranslate2). Hodeum uses the same Whisper weights exported to int8 ONNX and run through sherpa-onnx, which is already linked for Nemotron, so no Python runtime is needed. The size is `WHISPER_SIZE = "base"` in `models.rs`; switch it to `small` if latency allows on the demo laptop. Whisper doesn't stream, so it shows no live partial text: each utterance is transcribed when the pause ends it. Base int8 transcribed a 7 s sample in about 1.2 s on the dev PC (`cargo test --lib -- --ignored whisper_backup --nocapture`).

### Workstream 7: Docs

- [ ] Fix the README's stale "Next:" line. Add a provider table (local default, cloud opt-in). Add a `docs/validation-gates.md` checklist with a manual procedure for each gate and space for measured results (Gates 1–5, 10, and 6 on real Excel).

## Wave 2: P1 (after Wave 1 merges green)

- Skill graph in the expanded notch: a compact list of skills by mastery with the next skill, reusing `LearningPage` stats.
- Progressive hint reduction check across Hodes, using memory from W3. Verify Gate 8 end to end.
- iOS app: HodeEngine, ChangeDetector and ToneMeter per `docs/superpowers/specs/2026-10-03-ios-app-design.md`. Verified on GitHub Actions only.
- OmniParser detector on demand: measure the VRAM headroom beside Qwen3-VL first, per CLAUDE.md "measure before optimizing".

## Wave 3: P2

Mini-quizzes after a Hode, richer analytics, voice cloning (ElevenLabs), and assistive action mode (opt-in; it never becomes the default).

## Not automatable here

Gates 1–5 and 10, and Gate 6 on real Excel, need the learner's laptop. Workstream 7 writes the procedure; the user records the results.
