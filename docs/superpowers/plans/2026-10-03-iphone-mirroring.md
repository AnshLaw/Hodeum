# iPhone Mirroring + Mobile Hode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The learner's iPhone screen shows live in an enlarged notch, and Hodey teaches the "Turn on Dark Mode" iPhone Hode on it: highlights on the mirror, success checks, corrections and stuck help. Everything runs locally.

**Architecture:**
- **Frames:** two sources draw into one canvas that the notch webview owns.
  - A camera source uses `getUserMedia`. It covers iPhoneMirror's virtual camera and capture cards.
  - An AirPlay source runs UxPlay as a separate process. Rust turns its RTP stream back into H.264 frames and streams them to the webview, which decodes them with WebCodecs.
- **Perception:** `PhonePerception` turns frames into named `UiElement`s with Windows OCR. A frame-change detector stands in for the input hooks.
- **Routing:** a new `surface` field on task packs sends perception, vision capture and overlay highlights to either the phone or the Windows desktop.

**Tech Stack:** Tauri 2.12 (Rust, windows-rs 0.62 WinRT `Media.Ocr`), React 19 + TypeScript, WebCodecs, Vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-10-03-iphone-mirroring-design.md`

**Worktree:** all work happens in `.claude/worktrees/iphone` on `feat/iphone-mirroring`. The main checkout belongs to another session, so never `cd` into it and never use bare `git stash`.

**Spec deviations (decided while planning; Task 13 records them in the spec):**
1. **No `airplayReceiverPath` setting.** UxPlay is looked up only at fixed paths (`runtime/uxplay/uxplay.exe`, then `C:/msys64/ucrt64/bin/uxplay.exe`). This follows `vlm.rs`: a synced setting must never choose which binary runs.
2. **Source and camera choices live in the notch's phone panel, not a Settings page.** They are stored in `localStorage` like the dock prefs, because camera devices can only be enumerated in the notch webview that holds the camera permission.
3. **One `Surface = "windows" | "phone"` type** is used for both packs and overlays (the spec said `"screen" | "phone"`). `overlay:clear` is unchanged and clears both.
4. **Phone-only flow changes:**
   - After a learner action that is neither success nor a known mistake, Hodey re-locates the target, because scrolling moves things. That action is not counted as wrong (it's usually navigation), and Hodey does not repeat the same sentence. Hesitation is still caught by the stuck timer.
   - When the target can't be found, the copy is `COPY.clarifyPhone` instead of the Windows "move your pointer" copy.

## Global Constraints

- Local only. Frames, OCR text and decoded video never leave the machine, and nothing is written to disk.
- No cloud credentials are needed. UxPlay and iPhoneMirror are never bundled; UxPlay runs only if it is installed at a fixed path.
- Teach Mode holds. Hodey never taps or controls the phone, and the copy never claims Hodey did the work.
- Named constants only, functions under 40 lines, explicit error handling with visible error states, and no silent catches.
- The Windows teaching loop (Gate 6) keeps its behavior. Every existing test must still pass.
- Commits are conventional and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never force push.
- Commands, run from the worktree root:
  - `npx vitest run <path>`
  - `npm run typecheck`
  - `npm run build`
  - `cd src-tauri; cargo test --lib <filter>`
  - `cd src-tauri; cargo build`

## Review Focus

1. **The source drops mid-Hode** (cable pulled, AirPlay stopped). The Hode must not end. Hodey says "Connect your iPhone…" and picks up when frames return. Tests: Task 3 (`waits for the iPhone`) and Task 6 (`fires a learner action when the mirror goes live`).
2. **Capture cards send the phone pillarboxed in a 16:9 frame.** The frame must be cropped to the centred portrait phone before OCR and display, or targets land in the black bars. Test: Task 4 `phoneCrop`.
3. **The learner scrolls the Settings list.** The highlight must move to the target's new place, and Hodey must not repeat the sentence. Test: Task 3 `re-locates the target after a scroll`.
4. **AirPlay joins mid-stream or loses a packet.** The decoder must wait for the next keyframe instead of drawing garbage or throwing. Tests: Task 8 (`drops until the next keyframe`) and Task 10 (`findSps`; no decoder before a keyframe).
5. **OCR merges home-screen labels** that share a baseline ("Clock  Settings  Maps") into one line. Lines must split at wide gaps so "Settings" is its own element. Test: Task 5 `splits a line at wide gaps`.

---

### Task 0: Worktree setup

**Files:** none

- [ ] **Step 1: Install dependencies in the worktree**

Run: `npm install`
Expected: completes without errors.

- [ ] **Step 2: Baseline is green**

Run: `npm test` and `npm run typecheck`, then `cd src-tauri; cargo test --lib`
Expected: all pass. If anything fails, stop and report it before changing code.

- [ ] **Step 3: (Optional, for live runs) link the local AI files from the main checkout**

`vlm.rs` looks for `models/` and `runtime/` in the repository the build was compiled from. Both are git-ignored, so the worktree has neither. Link them with junctions:

```powershell
cmd /c mklink /J models "..\..\..\models"
cmd /c mklink /J runtime "..\..\..\runtime"
```

Check that both are ignored: `git status --short` must not list them.

---

### Task 1: Phone types, `screen_tone` signal, pack `surface`

**Files:**
- Modify: `src/lib/types.ts` (ElementSource, ScreenObservation, StateSignal, TaskPack)
- Modify: `src/features/hode/signals.ts`
- Modify: `src/task-packs/schema.ts`
- Test: `src/features/hode/signals-policy.test.ts`, `src/task-packs/task-packs.test.ts`

**Interfaces:**
- Produces:
  - `type Surface = "windows" | "phone"`
  - `type ScreenTone = "dark" | "light"`
  - `ScreenObservation.tone?: ScreenTone`
  - `StateSignal` kind `{ kind: "screen_tone"; tone: ScreenTone }`
  - `TaskPack.surface?: Surface`
  - `ElementSource` gains `"ocr"`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/hode/signals-policy.test.ts`. Add `evaluateSignal` to the existing import from `./signals` if it isn't there yet:

```ts
describe("screen_tone signal", () => {
  const observation = (tone?: "dark" | "light") => ({ app: "iPhone", windowTitle: "", elements: [], at: 0, tone });

  it("holds when the screen's tone matches", () => {
    expect(evaluateSignal({ kind: "screen_tone", tone: "dark" }, observation("dark"))).toBe(true);
  });

  it("fails for the other tone or an unknown tone", () => {
    expect(evaluateSignal({ kind: "screen_tone", tone: "dark" }, observation("light"))).toBe(false);
    expect(evaluateSignal({ kind: "screen_tone", tone: "dark" }, observation())).toBe(false);
  });
});
```

Append inside `describe("loadTaskPack", …)` in `src/task-packs/task-packs.test.ts`:

```ts
  it("accepts a phone surface and a screen_tone signal", () => {
    const raw = JSON.parse(JSON.stringify(excelPivot)) as Record<string, unknown> & { steps: Array<Record<string, unknown>> };
    raw.surface = "phone";
    raw.steps[0].success = { kind: "screen_tone", tone: "dark" };
    expect(loadTaskPack(raw).surface).toBe("phone");
  });

  it("rejects an unknown surface", () => {
    const raw = JSON.parse(JSON.stringify(excelPivot)) as Record<string, unknown>;
    raw.surface = "android";
    expect(() => loadTaskPack(raw)).toThrow(/Invalid task pack/);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/hode/signals-policy.test.ts src/task-packs/task-packs.test.ts`
Expected: FAIL (type errors are ignored by vitest; the assertions fail or the schema rejects `screen_tone`).

- [ ] **Step 3: Implement**

`src/lib/types.ts`: replace `ElementSource` and `ScreenObservation`, and add the new types next to them:

```ts
export type ElementSource = "uia" | "detector" | "vlm" | "mock" | "ocr";

/** Where an app lives: the Windows desktop, or the learner's iPhone mirrored into the notch. */
export type Surface = "windows" | "phone";

/** Overall screen brightness; only reported where pixels are read (the phone mirror). */
export type ScreenTone = "dark" | "light";

export interface ScreenObservation {
  app: string;
  windowTitle: string;
  elements: UiElement[];
  at: number;
  tone?: ScreenTone;
}
```

Add a member to `StateSignal`:

```ts
  | { kind: "screen_tone"; tone: ScreenTone };
```

Add to `TaskPack`, after `app`:

```ts
  /** Defaults to "windows". Phone packs are taught on the mirrored iPhone, read by OCR. */
  surface?: Surface;
```

`src/features/hode/signals.ts`: add a case inside `evaluateSignal`'s switch:

```ts
    case "screen_tone":
      return observation.tone === signal.tone;
```

`src/task-packs/schema.ts`: add to the `signalSchema` union:

```ts
  z.object({ kind: z.literal("screen_tone"), tone: z.enum(["dark", "light"]) }).strict(),
```

and to `packSchema`, after `app`:

```ts
    surface: z.enum(["windows", "phone"]).optional(),
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/features/hode/signals-policy.test.ts src/task-packs/task-packs.test.ts` then `npm run typecheck`
Expected: PASS. If typecheck reports a non-exhaustive `switch` over `StateSignal["kind"]` elsewhere, add the `screen_tone` case there with the same meaning.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/features/hode/signals.ts src/task-packs/schema.ts src/features/hode/signals-policy.test.ts src/task-packs/task-packs.test.ts
git commit -m "feat: phone surface and screen_tone signal for task packs"
```

---

### Task 2: Overlay surface routing

**Files:**
- Modify: `src/lib/bus.ts` (`overlay:render` payload)
- Modify: `src/features/hode/runtime.ts:118` (renderOverlay)
- Modify: `src/components/overlay/GuidanceOverlay.tsx` (`useOverlayBus`, `surfaces` prop)
- Modify: `src/components/notch/hooks.ts` (`useCoveringTarget`)
- Test: `src/features/hode/runtime.test.ts`

**Interfaces:**
- Consumes: `Surface` (Task 1).
- Produces:
  - `BusEvents["overlay:render"] = { primitives: OverlayPrimitive[]; surface?: Surface }`. A missing surface means `"windows"`.
  - `GuidanceOverlay` prop `surfaces?: Surface[]`, default `["windows"]`.

- [ ] **Step 1: Write the failing test**

In `src/features/hode/runtime.test.ts`, change `setup` to record surfaces. Add `const surfaces: string[] = [];` and change the render listener to:

```ts
  bus.on("overlay:render", ({ primitives, surface }) => {
    overlays.push(primitives.map((p) => p.kind).join("+"));
    surfaces.push(surface ?? "unset");
  });
```

Return `surfaces` from `setup`, then add inside `describe("HodeRuntime end to end", …)`:

```ts
  it("tags Windows guidance with the windows surface", async () => {
    const h = setup();
    await h.start();
    expect(h.surfaces.at(-1)).toBe("windows");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/hode/runtime.test.ts -t "windows surface"`
Expected: FAIL, because it received `"unset"`.

- [ ] **Step 3: Implement**

`src/lib/bus.ts`: import `Surface` from `./types` and change the entry:

```ts
  /** Highlights for one surface; absent means the Windows desktop. The notch draws "phone" ones on the mirror. */
  "overlay:render": { primitives: OverlayPrimitive[]; surface?: Surface };
```

`src/features/hode/runtime.ts`: change the `renderOverlay` case:

```ts
      case "renderOverlay":
        return this.deps.bus.emit("overlay:render", { primitives: effect.primitives, surface: this.state.pack?.surface ?? "windows" });
```

`src/components/overlay/GuidanceOverlay.tsx`:
- Import `Surface`.
- Give `useOverlayBus(bus: Bus, surfaces: Surface[])` a second parameter, and replace its render handler:

```ts
      // Guidance for another surface replaces ours, so a stale desktop highlight never lingers.
      bus.on("overlay:render", (payload) => setPrimitives(surfaces.includes(payload.surface ?? "windows") ? payload.primitives : [])),
```

- Add `surfaces` to that effect's dependency list as `surfaces.join()`.
- Change the component signature and call:

```ts
const DESKTOP_ONLY: Surface[] = ["windows"];

export function GuidanceOverlay({ bus, shell, surfaces = DESKTOP_ONLY }: { bus: Bus; shell: NativeShell; surfaces?: Surface[] }) {
  …
  const { primitives, annotating, setAnnotating } = useOverlayBus(bus, surfaces);
```

`src/components/notch/hooks.ts`, in `useCoveringTarget`: change the render handler's parameter to `({ primitives, surface })`. Add this as its first line:

```ts
      // Phone highlights sit on the mirror inside the notch, never under it.
      if ((surface ?? "windows") !== "windows") return setCovering(false);
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/features/hode/runtime.test.ts` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bus.ts src/features/hode/runtime.ts src/components/overlay/GuidanceOverlay.tsx src/components/notch/hooks.ts src/features/hode/runtime.test.ts
git commit -m "feat: route overlay highlights by surface (windows or phone)"
```

---

### Task 3: iPhone Dark Mode pack, mock iPhone, phone flow and stage

**Files:**
- Create: `src/task-packs/iphone-dark-mode.json`
- Modify: `src/task-packs/index.ts`
- Create: `src/stage/scenes/iphone.ts`
- Modify: `src/providers/mock-perception.ts` (`MockScene.tone`)
- Modify: `src/lib/copy.ts` (`connectPhone`, `clarifyPhone`)
- Modify: `src/features/hode/flow.ts` (`waitForApp`, `onActionReady`, `showGuidance`)
- Modify: `src/features/hode/learner.ts` (`onLearnerActed`)
- Modify: `src/providers/task-pack-reasoner.ts` (`guideStep`)
- Modify: `src/stage/environment.ts`, `src/stage/Stage.tsx`, `src/stage/MockAppView.tsx`, `src/stage/Backdrops.tsx`, `src/stage/stage.css`
- Test: create `src/features/hode/phone-hode.test.ts`; modify `src/task-packs/task-packs.test.ts`; modify `src/stage/scenes/scenes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `IphoneScene implements MockApp` (`id: "iphone"`, `label: "iPhone"`) with element ids `app:<Label>`, `row:<Label>`, `list:scroll`, `nav:back`, `option:Light`, `option:Dark`
  - `PHONE_FRAME: Rect`
  - `MockScene.tone?: ScreenTone`
  - `COPY.connectPhone`, `COPY.clarifyPhone`
  - pack id `iphone-dark-mode`

- [ ] **Step 1: Write the pack**

Create `src/task-packs/iphone-dark-mode.json`:

```json
{
  "id": "iphone-dark-mode",
  "title": "Turn on Dark Mode on iPhone",
  "app": "iPhone",
  "surface": "phone",
  "goalPhrases": ["iphone dark mode", "dark mode on my iphone", "dark mode on my phone", "dark mode phone"],
  "prerequisites": ["Mirror your iPhone into Hodey (menu → Show iPhone) and start on the Home Screen, in Light mode."],
  "steps": [
    {
      "id": "open-settings",
      "objective": "Open Settings",
      "skill": "ios.settings.open",
      "target": { "names": ["Settings"], "label": "Settings" },
      "speech": {
        "demonstrate": "On your iPhone, tap Settings, the grey gear. I've highlighted it.",
        "guide": "Tap Settings.",
        "hint": "Which app holds all of your phone's options?",
        "observe": "",
        "independent": ""
      },
      "explain": "Settings is where every iPhone option lives, including how the screen looks.",
      "success": { "kind": "element_visible", "names": ["Airplane Mode"] },
      "mistakes": []
    },
    {
      "id": "open-display",
      "objective": "Open Display & Brightness",
      "skill": "ios.settings.display",
      "target": { "names": ["Display*Brightness"], "label": "Display & Brightness" },
      "speech": {
        "demonstrate": "Scroll down a little and tap Display & Brightness.",
        "guide": "Tap Display & Brightness.",
        "hint": "Look for the setting about your screen.",
        "observe": "",
        "independent": ""
      },
      "explain": "Display & Brightness controls light and dark appearance, text size and brightness.",
      "success": { "kind": "element_visible", "names": ["Appearance"] },
      "mistakes": [
        { "signal": { "kind": "element_visible", "names": ["*Add New Wallpaper*"] }, "correction": "That's Wallpaper. Tap Settings at the top left to go back, then choose Display & Brightness." }
      ]
    },
    {
      "id": "choose-dark",
      "objective": "Choose Dark",
      "skill": "ios.appearance.dark_mode",
      "target": { "names": ["Dark"], "label": "Dark" },
      "speech": {
        "demonstrate": "Under Appearance, tap Dark. The whole screen will turn dark.",
        "guide": "Tap Dark.",
        "hint": "Appearance has two choices. Which one is easier on the eyes at night?",
        "observe": "",
        "independent": ""
      },
      "explain": "Dark Mode uses light text on dark backgrounds, which is easier on your eyes in low light.",
      "success": { "kind": "screen_tone", "tone": "dark" },
      "mistakes": [
        { "signal": { "kind": "element_visible", "names": ["*Dynamic Type*"] }, "correction": "That opened Text Size. Go back; Dark is under Appearance at the top." }
      ]
    }
  ]
}
```

Register it in `src/task-packs/index.ts`:

```ts
import iphoneDarkMode from "./iphone-dark-mode.json";
…
export const TASK_PACKS = [loadTaskPack(excelPivot), loadTaskPack(windowsZip), loadTaskPack(iphoneDarkMode)];
```

In `src/task-packs/task-packs.test.ts`:
- Update `loads both shipped packs` to expect `["excel-pivot", "windows-zip", "iphone-dark-mode"]` and rename it `loads every shipped pack`.
- Add these rows to the `matchGoal` `it.each`:

```ts
    ["turn on dark mode on my iphone", "iphone-dark-mode"],
    ["make my phone dark mode", "iphone-dark-mode"],
```

- [ ] **Step 2: Write the mock iPhone scene**

Add `tone` to `MockScene` in `src/providers/mock-perception.ts` and pass it through `snapshot`:

```ts
export interface MockScene {
  app: string;
  windowTitle: string;
  /** In paint order: containers before their children. */
  elements: UiElement[];
  /** Phone scenes report their brightness, as the OCR mirror does. */
  tone?: ScreenTone;
}
…
    return { app: scene.app, windowTitle: scene.windowTitle, elements, at: Date.now(), tone: scene.tone };
```

Import `ScreenTone` from `../lib/types`.

Create `src/stage/scenes/iphone.ts`:

```ts
import type { Rect, UiElement } from "../../lib/types";
import type { MockApp, MockScene, MouseButton } from "../../providers/mock-perception";
import { element, splitId } from "./layout";

/** The practice iPhone, portrait, centred on the stage desktop. */
export const PHONE_FRAME: Rect = { x: 500, y: 96, width: 280, height: 600 };
const PAD = 16;
const STATUS_BAR = 44;
const ROW_HEIGHT = 44;
const VISIBLE_ROWS = 6;
const SCROLL_STEP = 3;
const ICON = { size: 56, gap: 10, label: 16 };
const HOME_APPS = ["Clock", "Settings", "Maps", "Photos"];
const SETTINGS_ROWS = ["Airplane Mode", "Wi-Fi", "Bluetooth", "Battery", "General", "Accessibility", "Camera", "Display & Brightness", "Wallpaper"];
const DISPLAY_ROWS = ["Text Size", "Bold Text"];

type Screen = "home" | "settings" | "display" | "wallpaper" | "textsize";

interface PhoneState {
  screen: Screen;
  scroll: number;
  dark: boolean;
}

const initialPhoneState = (): PhoneState => ({ screen: "home", scroll: 0, dark: false });

function row(index: number): Rect {
  return { x: PHONE_FRAME.x + PAD, y: PHONE_FRAME.y + STATUS_BAR + ROW_HEIGHT * (index + 1), width: PHONE_FRAME.width - PAD * 2, height: ROW_HEIGHT - 4 };
}

function title(text: string): UiElement {
  return element(`title:${text}`, text, "text", { x: PHONE_FRAME.x + PAD, y: PHONE_FRAME.y + STATUS_BAR, width: 160, height: ROW_HEIGHT - 8 });
}

function backButton(): UiElement {
  return element("nav:back", "Settings", "text", { x: PHONE_FRAME.x + PAD, y: PHONE_FRAME.y + STATUS_BAR - 30, width: 80, height: 26 });
}

function homeElements(): UiElement[] {
  return HOME_APPS.map((label, i) => {
    const x = PHONE_FRAME.x + PAD + i * (ICON.size + ICON.gap);
    return element(`app:${label}`, label, "text", { x, y: PHONE_FRAME.y + STATUS_BAR + ICON.size, width: ICON.size, height: ICON.label });
  });
}

function settingsElements(scroll: number): UiElement[] {
  const rows = SETTINGS_ROWS.slice(scroll, scroll + VISIBLE_ROWS).map((label, i) => element(`row:${label}`, label, "text", row(i)));
  const more = element("list:scroll", "Scroll", "scroll bar", { ...row(VISIBLE_ROWS), height: ROW_HEIGHT / 2 });
  return [title("Settings"), ...rows, more];
}

function displayElements(): UiElement[] {
  const half = (PHONE_FRAME.width - PAD * 2) / 2;
  const option = (label: string, i: number) => element(`option:${label}`, label, "text", { ...row(1), x: PHONE_FRAME.x + PAD + i * half, width: half - 4 });
  const rows = DISPLAY_ROWS.map((label, i) => element(`row:${label}`, label, "text", row(i + 3)));
  return [backButton(), title("Display & Brightness"), element("header:Appearance", "APPEARANCE", "text", row(0)), option("Light", 0), option("Dark", 1), ...rows];
}

function screenElements(state: PhoneState): UiElement[] {
  switch (state.screen) {
    case "home":
      return homeElements();
    case "settings":
      return settingsElements(state.scroll);
    case "display":
      return displayElements();
    case "wallpaper":
      return [backButton(), title("Wallpaper"), element("row:add", "+ Add New Wallpaper", "text", row(0))];
    case "textsize":
      return [backButton(), title("Text Size"), element("row:hint", "Apps that support Dynamic Type will adjust to your preferred reading size below.", "text", row(0))];
  }
}

const ROW_TARGETS: Record<string, Screen> = { "Display & Brightness": "display", Wallpaper: "wallpaper", "Text Size": "textsize" };

/** Practice iPhone: Home Screen → Settings (scrollable) → Display & Brightness → Dark. */
export class IphoneScene implements MockApp {
  readonly id = "iphone";
  readonly label = "iPhone";
  private state = initialPhoneState();

  snapshot(): MockScene {
    return { app: "iPhone", windowTitle: "", elements: screenElements(this.state), tone: this.state.dark ? "dark" : "light" };
  }

  press(elementId: string, _button: MouseButton): void {
    const [kind, name] = splitId(elementId);
    const s = this.state;
    if (kind === "app" && name === "Settings") this.state = { ...s, screen: "settings", scroll: 0 };
    else if (kind === "list") this.state = { ...s, scroll: s.scroll === 0 ? SCROLL_STEP : 0 };
    else if (kind === "row" && ROW_TARGETS[name]) this.state = { ...s, screen: ROW_TARGETS[name] };
    else if (kind === "nav") this.state = { ...s, screen: s.screen === "textsize" ? "display" : "settings" };
    else if (kind === "option") this.state = { ...s, dark: name === "Dark" };
  }

  reset(): void {
    this.state = initialPhoneState();
  }
}
```

Add to `src/stage/scenes/scenes.test.ts`:

```ts
describe("IphoneScene", () => {
  it("goes Home → Settings → Display & Brightness → Dark", () => {
    const phone = new IphoneScene();
    phone.press("app:Settings", "left");
    expect(phone.snapshot().elements.some((e) => e.name === "Display & Brightness")).toBe(false);
    phone.press("list:scroll", "left");
    phone.press("row:Display & Brightness", "left");
    expect(phone.snapshot().elements.some((e) => e.name === "APPEARANCE")).toBe(true);
    phone.press("option:Dark", "left");
    expect(phone.snapshot().tone).toBe("dark");
  });
});
```

Import `IphoneScene` from `./iphone`.

- [ ] **Step 3: Write the failing end-to-end phone Hode test**

Create `src/features/hode/phone-hode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LocalBus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import type { TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception, type MockApp } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../stage/scenes/excel";
import { IphoneScene } from "../../stage/scenes/iphone";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import { HodeRuntime } from "./runtime";

const GOAL = "turn on dark mode on my iphone";

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

function setup(startOn: "iphone" | "excel" = "iphone") {
  const phone = new IphoneScene();
  let current: MockApp = startOn === "iphone" ? phone : new ExcelScene();
  const perception = new MockPerception(() => current);
  const bus = new LocalBus();
  const renders: { surface?: string; bounds?: unknown }[] = [];
  bus.on("overlay:render", ({ primitives, surface }) => renders.push({ surface, bounds: primitives.find((p) => p.kind === "highlight")?.bounds }));
  const spoken: string[] = [];
  const tts: TTSProvider = {
    async speak(text) {
      for await (const chunk of text) spoken.push(chunk);
    },
    async stop() {},
    async healthCheck() {
      return true;
    },
  };
  const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus, tts });
  const act = async (...ids: string[]) => {
    for (const id of ids) {
      phone.press(id, "left");
      perception.notifyLearnerAction();
      await settle();
    }
  };
  const start = async () => {
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode: "agent" });
    await settle();
  };
  const connectPhone = async () => {
    current = phone;
    perception.notifyLearnerAction();
    await settle();
  };
  return { runtime, renders, spoken, act, start, connectPhone, state: () => runtime.getState() };
}

describe("iPhone Dark Mode Hode", () => {
  it("teaches on the phone surface, correcting Wallpaper, until the screen turns dark", async () => {
    const h = setup();
    await h.start();
    expect(h.state()).toMatchObject({ phase: "guiding", stepIndex: 0 });
    expect(h.renders.at(-1)?.surface).toBe("phone");

    await h.act("app:Settings", "list:scroll", "row:Wallpaper");
    expect(h.state().action?.kind).toBe("correct");
    expect(h.spoken.at(-1)).toContain("That's Wallpaper");

    await h.act("nav:back", "row:Display & Brightness", "option:Dark");
    expect(h.state().phase).toBe("success");
    expect(h.state().learnedSkills).toEqual(["ios.settings.open", "ios.settings.display", "ios.appearance.dark_mode"]);
  });

  it("re-locates the target after a scroll without repeating itself", async () => {
    const h = setup();
    await h.start();
    await h.act("app:Settings");
    expect(h.state().action?.kind).toBe("clarify");
    expect(h.spoken.at(-1)).toBe(COPY.clarifyPhone);

    await h.act("list:scroll");
    expect(h.state().action?.kind).toBe("guide");
    expect(h.renders.at(-1)?.bounds).toBeDefined();
    // A tap that changes nothing re-checks the screen: same instruction, not said twice, not escalated.
    const said = h.spoken.length;
    const level = h.state().level;
    await h.act("row:Battery", "row:Battery");
    expect(h.spoken.length).toBe(said);
    expect(h.state().level).toBe(level);
  });

  it("waits for the iPhone when it isn't connected, then picks up", async () => {
    const h = setup("excel");
    await h.start();
    expect(h.spoken.at(-1)).toBe(COPY.connectPhone);
    await h.connectPhone();
    expect(h.state()).toMatchObject({ phase: "guiding", waitingForApp: undefined });
    expect(h.renders.at(-1)?.surface).toBe("phone");
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/features/hode/phone-hode.test.ts`
Expected: FAIL (`COPY.clarifyPhone` is undefined, the speech is wrong, and nothing is re-located after the scroll).

- [ ] **Step 5: Implement the phone flow**

`src/lib/copy.ts`, after `switchToApp`:

```ts
  connectPhone: "Connect your iPhone: open Show iPhone in Hodey's menu and start mirroring. I'll pick up there.",
  clarifyPhone: "I can't spot that on your iPhone yet. Scroll a little and I'll look again.",
```

`src/features/hode/flow.ts`:
- In `waitForApp`, replace `const speech = COPY.switchToApp(app);` with:

```ts
  const speech = s.pack?.surface === "phone" ? COPY.connectPhone : COPY.switchToApp(app);
```

- In `onActionReady`, replace the `shown` line with:

```ts
  const clarify = s.pack?.surface === "phone" ? COPY.clarifyPhone : COPY.clarify;
  const shown: TeachingAction = band === "uncertain" ? { ...action, kind: "clarify", speech: clarify, target: undefined } : action;
```

- In `showGuidance`, replace `if (action.speech !== "") effects.push({ type: "say", text: action.speech });` with:

```ts
  // On the phone every scroll re-locates the target; saying the same sentence again would nag.
  const repeat = s.pack?.surface === "phone" && action.speech === s.action?.speech;
  if (action.speech !== "" && !repeat) effects.push({ type: "say", text: action.speech });
```

`src/features/hode/learner.ts`: in `onLearnerActed`, insert this right before `const wrongActions = s.wrongActions + 1;`:

```ts
  // On the phone, screen changes are mostly navigation (scrolling, going back), not mistakes; known
  // mistakes are caught above and hesitation by the stuck timer. Re-locate so the highlight follows.
  if (s.pack?.surface === "phone") return withLeadingEffects(requestReason(next), [CANCEL_TIMER]);
```

The Windows path below it is unchanged. `showGuidance` restarts the stuck timer once the new action arrives.

`src/providers/task-pack-reasoner.ts`: in `guideStep`, replace the `if (!target)` line with:

```ts
  if (!target) {
    const speech = context.pack?.surface === "phone" ? COPY.clarifyPhone : COPY.clarify;
    return { kind: "clarify", speech, skill: step.skill, assistanceLevel: level };
  }
```

- [ ] **Step 6: Run the phone and existing Hode tests**

Run: `npx vitest run src/features/hode src/task-packs src/stage src/providers`
Expected: PASS. In particular, every existing Excel and zip test is unchanged and green.

- [ ] **Step 7: Put the mock iPhone on the practice stage**

`src/stage/environment.ts`:
- `export type StageAppId = "excel" | "explorer" | "iphone";`
- `apps: { excel: ExcelScene; explorer: ExplorerScene; iphone: IphoneScene };`
- `const apps = { excel: new ExcelScene(), explorer: new ExplorerScene(), iphone: new IphoneScene() };`

`src/stage/MockAppView.tsx`: add an optional `frame` prop that is used instead of `APP_WINDOW`:

```tsx
export function MockAppView({ app, onPress, frame = APP_WINDOW, children }: { app: MockApp; onPress: (id: string, button: MouseButton) => void; frame?: Rect; children?: ReactNode }) {
  …
      <div className={`mock-window mock-window--${app.id}`} style={rectStyle(frame)}>
```

`src/stage/Backdrops.tsx`: add

```tsx
/** The practice phone's body; the screen follows the scene's tone like real Dark Mode. */
export function IphoneBackdrop({ scene }: { scene: IphoneScene }) {
  return <div className="iphone-screen" data-tone={scene.snapshot().tone} style={rectStyle(PHONE_FRAME)} />;
}
```

Import `IphoneScene` and `PHONE_FRAME` from `./scenes/iphone`.

`src/stage/Stage.tsx`:
- Add `{ id: "iphone", label: "iPhone" }` to `APP_TABS`.
- Pick the backdrop and frame per app:

```tsx
function backdropFor(appId: StageAppId, env: StageEnvironment) {
  if (appId === "excel") return <ExcelBackdrop scene={env.apps.excel} />;
  if (appId === "iphone") return <IphoneBackdrop scene={env.apps.iphone} />;
  return <ExplorerBackdrop />;
}
…
        <MockAppView app={app} onPress={press} frame={appId === "iphone" ? PHONE_FRAME : undefined}>
          {backdropFor(appId, env)}
        </MockAppView>
        <div className="stage-layer stage-layer--overlay">
          {/* The stage's iPhone lives on the page, so phone highlights draw on the page overlay here. */}
          <GuidanceOverlay bus={env.bus} shell={env.shell} surfaces={STAGE_SURFACES} />
```

with `const STAGE_SURFACES: Surface[] = ["windows", "phone"];` at module level.

`src/stage/stage.css`: append

```css
.mock-window--iphone { border-radius: 36px; overflow: hidden; }
.mock-window--iphone .mock-window__title { display: none; }
.iphone-screen { position: absolute; border-radius: 36px; background: #f2f2f7; transition: background 300ms ease; }
.iphone-screen[data-tone="dark"] { background: #000; }
.iphone-screen[data-tone="dark"] ~ .mock-el span { color: #fff; }
```

- [ ] **Step 8: Verify on the stage**

Run: `npm run typecheck`, then `npm run dev`. Open the printed URL, pick the iPhone tab, and start a Hode with "turn on dark mode on my iphone".
Expected: Settings is highlighted; wrong taps get corrections; tapping Dark turns the phone black and the notch shows "Hode complete".

- [ ] **Step 9: Commit**

```bash
git add src/task-packs src/stage src/providers/mock-perception.ts src/lib/copy.ts src/features/hode src/providers/task-pack-reasoner.ts
git commit -m "feat: iPhone Dark Mode Hode with phone-surface teaching flow and a practice iPhone on the stage"
```

---

### Task 4: Frame math and the change detector

**Files:**
- Create: `src/features/phone/frame-math.ts`
- Create: `src/features/phone/change-detector.ts`
- Test: `src/features/phone/frame-math.test.ts`, `src/features/phone/change-detector.test.ts`

**Interfaces:**
- Produces:
  - `phoneCrop(width, height): Rect`
  - `fitWithin(width, height, maxSide): Size`
  - `grayscale(rgba: Uint8ClampedArray): Uint8Array`
  - `meanLuma(gray): number`
  - `toneOf(gray): ScreenTone`
  - `THUMB_WIDTH = 32`, `THUMB_HEIGHT = 64`, `MAX_PHONE_SIDE = 1280`
  - `class ChangeDetector { push(thumb: Uint8Array, at: number): boolean; reset(): void }`

- [ ] **Step 1: Write the failing tests**

`src/features/phone/frame-math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fitWithin, grayscale, meanLuma, phoneCrop, toneOf } from "./frame-math";

describe("phoneCrop", () => {
  it("keeps a portrait frame whole", () => {
    expect(phoneCrop(1170, 2532)).toEqual({ x: 0, y: 0, width: 1170, height: 2532 });
  });

  it("cuts the centred phone out of a pillarboxed 16:9 capture", () => {
    const crop = phoneCrop(1920, 1080);
    expect(crop.height).toBe(1080);
    expect(crop.width).toBe(498);
    expect(crop.x).toBe(711);
  });
});

describe("fitWithin", () => {
  it("shrinks the longest side to the limit, keeping the aspect", () => {
    expect(fitWithin(1170, 2532, 1280)).toEqual({ width: 591, height: 1280 });
    expect(fitWithin(400, 800, 1280)).toEqual({ width: 400, height: 800 });
  });
});

describe("tone", () => {
  it("averages luma from RGBA and calls black screens dark", () => {
    const black = grayscale(new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255]));
    const white = grayscale(new Uint8ClampedArray([255, 255, 255, 255, 240, 240, 240, 255]));
    expect(meanLuma(black)).toBeLessThan(10);
    expect(toneOf(black)).toBe("dark");
    expect(toneOf(white)).toBe("light");
  });
});
```

`src/features/phone/change-detector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ChangeDetector, SETTLE_MS } from "./change-detector";

const SIZE = 32 * 64;
const flat = (value: number) => new Uint8Array(SIZE).fill(value);
const STEP_MS = 250;

describe("ChangeDetector", () => {
  it("fires once when the screen changes and then holds still", () => {
    const d = new ChangeDetector();
    let t = 0;
    expect(d.push(flat(200), t)).toBe(false);
    expect(d.push(flat(30), (t += STEP_MS))).toBe(false);
    const fired: boolean[] = [];
    for (let elapsed = 0; elapsed <= SETTLE_MS + STEP_MS; elapsed += STEP_MS) fired.push(d.push(flat(30), (t += STEP_MS)));
    expect(fired.filter(Boolean)).toHaveLength(1);
  });

  it("ignores noise like the clock ticking", () => {
    const d = new ChangeDetector();
    d.push(flat(200), 0);
    const noisy = flat(200);
    noisy[0] = 0;
    let fired = false;
    for (let t = STEP_MS; t < SETTLE_MS * 4; t += STEP_MS) fired ||= d.push(noisy, t);
    expect(fired).toBe(false);
  });

  it("does not fire when the screen returns to where it was", () => {
    const d = new ChangeDetector();
    d.push(flat(200), 0);
    d.push(flat(30), STEP_MS);
    let fired = false;
    for (let t = STEP_MS * 2; t < SETTLE_MS * 4; t += STEP_MS) fired ||= d.push(flat(200), t);
    expect(fired).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/phone`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement**

`src/features/phone/frame-math.ts`:

```ts
import type { Rect, ScreenTone, Size } from "../../lib/types";

/** Portrait iPhone screens are 9 : 19.5. */
export const IPHONE_ASPECT = 9 / 19.5;
/** Same budget as desktop captures for the vision model (PRD §12). */
export const MAX_PHONE_SIDE = 1280;
/** Change detection and tone run on a tiny grayscale thumbnail. */
export const THUMB_WIDTH = 32;
export const THUMB_HEIGHT = 64;
/** Mean luma (0–255) below which the screen counts as dark. iOS Dark Mode lists sit near 20. */
export const DARK_TONE_LUMA = 80;
const LUMA = { r: 0.299, g: 0.587, b: 0.114 };
const RGBA = 4;

/** Capture cards pillarbox the portrait phone inside 16:9; keep just the centred phone. */
export function phoneCrop(width: number, height: number): Rect {
  if (width <= height) return { x: 0, y: 0, width, height };
  const cropWidth = Math.round(height * IPHONE_ASPECT);
  return { x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
}

export function fitWithin(width: number, height: number, maxSide: number): Size {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function grayscale(rgba: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array(rgba.length / RGBA);
  for (let i = 0; i < gray.length; i++) {
    const o = i * RGBA;
    gray[i] = Math.round(rgba[o] * LUMA.r + rgba[o + 1] * LUMA.g + rgba[o + 2] * LUMA.b);
  }
  return gray;
}

export function meanLuma(gray: Uint8Array): number {
  let sum = 0;
  for (const value of gray) sum += value;
  return gray.length === 0 ? 0 : sum / gray.length;
}

export function toneOf(gray: Uint8Array): ScreenTone {
  return meanLuma(gray) < DARK_TONE_LUMA ? "dark" : "light";
}

/** Mean absolute difference between two equal-size thumbnails (0–255). */
export function difference(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return a.length === 0 ? 0 : sum / a.length;
}
```

`src/features/phone/change-detector.ts`:

```ts
import { difference } from "./frame-math";

/** Frame-to-frame difference that means something is moving (a tap, a scroll, a page sliding in). */
export const MOTION_THRESHOLD = 2;
/** How different the settled screen must be from the last one to count as a learner action. */
export const CHANGE_THRESHOLD = 6;
/** Animations finish before Hodey reads the new screen. */
export const SETTLE_MS = 600;

/**
 * Stands in for mouse and keyboard hooks on the mirrored phone: reports one learner action each time
 * the screen changes and then holds still, so OCR runs on the finished screen, not mid-animation.
 */
export class ChangeDetector {
  private baseline: Uint8Array | undefined;
  private last: Uint8Array | undefined;
  private movedAt: number | undefined;

  push(thumb: Uint8Array, at: number): boolean {
    if (!this.baseline || !this.last) {
      this.baseline = thumb;
      this.last = thumb;
      return false;
    }
    const moving = difference(thumb, this.last) > MOTION_THRESHOLD;
    this.last = thumb;
    if (moving) {
      this.movedAt = at;
      return false;
    }
    if (this.movedAt === undefined || at - this.movedAt < SETTLE_MS) return false;
    this.movedAt = undefined;
    const changed = difference(thumb, this.baseline) > CHANGE_THRESHOLD;
    this.baseline = thumb;
    return changed;
  }

  reset(): void {
    this.baseline = undefined;
    this.last = undefined;
    this.movedAt = undefined;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/phone`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/phone
git commit -m "feat: phone frame crop, tone and settle-based change detection"
```

---

### Task 5: Windows OCR command (Rust)

**Files:**
- Create: `src-tauri/src/phone/mod.rs`, `src-tauri/src/phone/ocr.rs`
- Modify: `src-tauri/Cargo.toml` (windows features), `src-tauri/src/lib.rs` (mod + handler)

**Interfaces:**
- Produces:
  - Tauri command `ocr_frame(png: String /* base64 PNG */) -> Vec<OcrSegment>`
  - `OcrSegment { text, x, y, width, height }` in frame px, serialized camelCase-free (all lower-case field names)
  - Pure `ocr::segments(words: &[Word]) -> Vec<OcrSegment>`

- [ ] **Step 1: Write the failing tests**

`src-tauri/src/phone/ocr.rs`, test module only for now:

```rust
#[cfg(test)]
mod tests {
    use super::{segments, Word};

    fn word(text: &str, x: f64, width: f64) -> Word {
        Word { text: text.into(), x, y: 100.0, width, height: 20.0 }
    }

    #[test]
    fn joins_words_of_one_label() {
        let line = [word("Display", 10.0, 70.0), word("&", 86.0, 10.0), word("Brightness", 102.0, 100.0)];
        let out = segments(&line);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "Display & Brightness");
        assert_eq!((out[0].x, out[0].width), (10.0, 192.0));
    }

    #[test]
    fn splits_a_line_at_wide_gaps() {
        let line = [word("Clock", 10.0, 50.0), word("Settings", 110.0, 70.0), word("Maps", 230.0, 45.0)];
        let names: Vec<String> = segments(&line).into_iter().map(|s| s.text).collect();
        assert_eq!(names, ["Clock", "Settings", "Maps"]);
    }

    #[test]
    fn empty_line_gives_nothing() {
        assert!(segments(&[]).is_empty());
    }
}
```

Create `src-tauri/src/phone/mod.rs` with `pub mod ocr;`, and add `mod phone;` to `lib.rs`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri; cargo test --lib phone::ocr`
Expected: FAIL to compile (`segments` and `Word` don't exist).

- [ ] **Step 3: Implement**

Add to the `windows` features list in `src-tauri/Cargo.toml`: `"Foundation", "Foundation_Collections", "Globalization", "Graphics_Imaging", "Media_Ocr", "Storage_Streams", "Win32_System_Com"`.

`src-tauri/src/phone/ocr.rs`, above the tests:

```rust
use serde::Serialize;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::{OcrEngine, OcrWord};
use windows::Storage::Streams::DataWriter;
use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

/// A gap wider than this many text heights splits a line: home-screen labels share a baseline.
const SPLIT_GAP_HEIGHTS: f64 = 1.2;

/// One piece of on-screen text in frame pixels. Mirrors `OcrSegment` in `src/features/phone/phone-perception.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OcrSegment {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Word {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn merge(words: &[Word]) -> OcrSegment {
    let left = words.iter().map(|w| w.x).fold(f64::INFINITY, f64::min);
    let top = words.iter().map(|w| w.y).fold(f64::INFINITY, f64::min);
    let right = words.iter().map(|w| w.x + w.width).fold(f64::NEG_INFINITY, f64::max);
    let bottom = words.iter().map(|w| w.y + w.height).fold(f64::NEG_INFINITY, f64::max);
    let text = words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
    OcrSegment { text, x: left, y: top, width: right - left, height: bottom - top }
}

/// Splits one OCR line wherever words sit far apart, so separate labels become separate elements.
pub fn segments(line: &[Word]) -> Vec<OcrSegment> {
    let mut out = Vec::new();
    let mut start = 0;
    for i in 1..line.len() {
        let previous = &line[i - 1];
        let gap = line[i].x - (previous.x + previous.width);
        if gap > previous.height.max(line[i].height) * SPLIT_GAP_HEIGHTS {
            out.push(merge(&line[start..i]));
            start = i;
        }
    }
    if start < line.len() {
        out.push(merge(&line[start..]));
    }
    out
}

fn winrt<T>(result: windows::core::Result<T>, what: &str) -> Result<T, String> {
    result.map_err(|e| format!("Windows OCR failed ({what}): {e}"))
}

fn word_of(word: &OcrWord) -> Result<Word, String> {
    let rect = winrt(word.BoundingRect(), "word box")?;
    let text = winrt(word.Text(), "word text")?.to_string();
    Ok(Word { text, x: f64::from(rect.X), y: f64::from(rect.Y), width: f64::from(rect.Width), height: f64::from(rect.Height) })
}

/// WinRT needs COM on this worker thread; a thread already in another apartment still works.
fn ensure_com() -> Result<(), String> {
    // SAFETY: called once per blocking worker thread before any WinRT use.
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if hr.is_err() && hr != RPC_E_CHANGED_MODE {
        return Err(format!("couldn't start COM for OCR: {hr:?}"));
    }
    Ok(())
}

fn bitmap_of(png: &[u8]) -> Result<SoftwareBitmap, String> {
    let image = xcap::image::load_from_memory(png).map_err(|e| format!("couldn't decode the phone frame: {e}"))?.to_rgba8();
    let (width, height) = image.dimensions();
    let mut bgra = image.into_raw();
    bgra.chunks_exact_mut(4).for_each(|px| px.swap(0, 2));
    let writer = winrt(DataWriter::new(), "buffer")?;
    winrt(writer.WriteBytes(&bgra), "buffer")?;
    let buffer = winrt(writer.DetachBuffer(), "buffer")?;
    winrt(SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, width as i32, height as i32), "bitmap")
}

/// Reads every text line on a phone frame, in memory only. Blocking.
pub fn recognize(png: &[u8]) -> Result<Vec<OcrSegment>, String> {
    ensure_com()?;
    let engine = winrt(OcrEngine::TryCreateFromUserProfileLanguages(), "no OCR language is installed")?;
    let bitmap = bitmap_of(png)?;
    let result = winrt(winrt(engine.RecognizeAsync(&bitmap), "start")?.get(), "recognize")?;
    let mut out = Vec::new();
    for line in winrt(result.Lines(), "lines")? {
        let words = winrt(line.Words(), "words")?.into_iter().map(|w| word_of(&w)).collect::<Result<Vec<_>, _>>()?;
        out.extend(segments(&words));
    }
    Ok(out)
}
```

`src-tauri/src/phone/mod.rs`:

```rust
pub mod ocr;

use base64::prelude::{Engine, BASE64_STANDARD};

/// OCR on one mirrored-iPhone frame (base64 PNG) for the phone teaching loop. Nothing is kept.
#[tauri::command]
pub async fn ocr_frame(png: String) -> Result<Vec<ocr::OcrSegment>, String> {
    let bytes = BASE64_STANDARD.decode(png).map_err(|e| format!("the phone frame isn't valid base64: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || ocr::recognize(&bytes)).await.map_err(|e| e.to_string())?
}
```

Register `phone::ocr_frame` in `generate_handler!` in `lib.rs`.

If `windows` 0.62 names an API differently (for example `IAsyncOperation::get` → `join`), follow the compiler's suggestion and keep the behavior the same.

- [ ] **Step 4: Run tests and build**

Run: `cd src-tauri; cargo test --lib phone::ocr` then `cargo build`
Expected: 3 tests pass and the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/phone src-tauri/src/lib.rs
git commit -m "feat: local Windows OCR for mirrored iPhone frames"
```

---

### Task 6: PhoneMirror, PhonePerception, SurfacePerception

**Files:**
- Create: `src/features/phone/phone-source.ts`, `src/features/phone/phone-mirror.ts`, `src/features/phone/phone-perception.ts`, `src/providers/surface-perception.ts`
- Test: `src/features/phone/phone-mirror.test.ts`, `src/features/phone/phone-perception.test.ts`, `src/providers/surface-perception.test.ts`

**Interfaces:**
- Consumes: `ChangeDetector`, `toneOf` (Task 4); `CapturedFrame` (`src/providers/vision/types.ts`).
- Produces:

```ts
// phone-source.ts
export type PhoneSourceKind = "camera" | "airplay";
export type PhoneSourceStatus =
  | { state: "off" } | { state: "connecting" } | { state: "waiting" }
  | { state: "live"; width: number; height: number } | { state: "error"; message: string };
export interface FrameSink { draw(image: CanvasImageSource, width: number, height: number): void }
export interface FrameSurface extends FrameSink {
  readonly size: Size | undefined;
  readonly element?: HTMLCanvasElement;
  grab(): CapturedFrame;
  thumbnail(): Uint8Array;
}
export interface PhoneSource {
  readonly kind: PhoneSourceKind;
  start(sink: FrameSink): Promise<void>;
  stop(): Promise<void>;
  onStatus(handler: (status: PhoneSourceStatus) => void): () => void;
}
// phone-mirror.ts
export class PhoneMirror {
  constructor(surface: FrameSurface, create: (kind: PhoneSourceKind) => PhoneSource);
  readonly surface: FrameSurface;
  isOpen(): boolean; kind(): PhoneSourceKind | undefined; status(): PhoneSourceStatus; isLive(): boolean;
  subscribe(listener: () => void): () => void;
  onLive(handler: () => void): () => void;
  open(kind: PhoneSourceKind): Promise<void>; close(): Promise<void>; retry(): Promise<void>;
  grabFrame(): Promise<CapturedFrame>; thumbnail(): Uint8Array | undefined;
}
// phone-perception.ts
export const PHONE_APP = "iPhone"; export const PHONE_OFFLINE_APP = "iPhone (not connected)";
export interface OcrSegment { text: string; x: number; y: number; width: number; height: number }
export type PhoneEyes = Pick<PhoneMirror, "isLive" | "grabFrame" | "thumbnail" | "onLive">;
export function ocrElements(segments: OcrSegment[]): UiElement[];
export class PhonePerception implements PerceptionAdapter { constructor(eyes: PhoneEyes, ocr: (png: string) => Promise<OcrSegment[]>, sampleMs?: number); setWatching(w: boolean): void; dispose(): void }
// surface-perception.ts
export interface WatchablePerception extends PerceptionAdapter { setWatching(watching: boolean): void }
export class SurfacePerception implements PerceptionAdapter { constructor(adapters: Record<Surface, WatchablePerception>); current(): Surface; setSurface(s: Surface): void; setWatching(w: boolean): void }
```

- [ ] **Step 1: Write the failing tests**

`src/features/phone/phone-mirror.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PhoneMirror } from "./phone-mirror";
import type { FrameSink, FrameSurface, PhoneSource, PhoneSourceKind, PhoneSourceStatus } from "./phone-source";

class FakeSource implements PhoneSource {
  readonly handlers = new Set<(s: PhoneSourceStatus) => void>();
  stopped = false;
  constructor(readonly kind: PhoneSourceKind, private readonly failWith?: string) {}
  async start(_sink: FrameSink) {
    if (this.failWith) throw new Error(this.failWith);
    this.emit({ state: "connecting" });
  }
  async stop() {
    this.stopped = true;
  }
  onStatus(handler: (s: PhoneSourceStatus) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(status: PhoneSourceStatus) {
    this.handlers.forEach((h) => h(status));
  }
}

const surface: FrameSurface = { size: { width: 10, height: 20 }, draw() {}, grab: () => ({ png: "AAA", rect: { x: 0, y: 0, width: 10, height: 20 } }), thumbnail: () => new Uint8Array(4) };

describe("PhoneMirror", () => {
  it("opens a source, follows its status and reports live", async () => {
    const sources: FakeSource[] = [];
    const mirror = new PhoneMirror(surface, (kind) => sources[sources.push(new FakeSource(kind)) - 1]);
    let lives = 0;
    mirror.onLive(() => lives++);
    await mirror.open("camera");
    expect(mirror.status()).toEqual({ state: "connecting" });
    sources[0].emit({ state: "live", width: 10, height: 20 });
    expect(mirror.isLive()).toBe(true);
    expect(lives).toBe(1);
    await expect(mirror.grabFrame()).resolves.toMatchObject({ png: "AAA" });
  });

  it("switching source stops the old one", async () => {
    const sources: FakeSource[] = [];
    const mirror = new PhoneMirror(surface, (kind) => sources[sources.push(new FakeSource(kind)) - 1]);
    await mirror.open("camera");
    await mirror.open("airplay");
    expect(sources[0].stopped).toBe(true);
    expect(mirror.kind()).toBe("airplay");
  });

  it("shows a start failure as an error state instead of throwing", async () => {
    const mirror = new PhoneMirror(surface, (kind) => new FakeSource(kind, "AirPlay receiver not installed"));
    await mirror.open("airplay");
    expect(mirror.status()).toEqual({ state: "error", message: "AirPlay receiver not installed" });
  });

  it("refuses to grab a frame while not live", async () => {
    const mirror = new PhoneMirror(surface, (kind) => new FakeSource(kind));
    await expect(mirror.grabFrame()).rejects.toThrow(/isn't mirroring/);
  });
});
```

`src/features/phone/phone-perception.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { PHONE_OFFLINE_APP, PhonePerception, ocrElements, type OcrSegment, type PhoneEyes } from "./phone-perception";
import { SETTLE_MS } from "./change-detector";

const SIZE = 32 * 64;
const SAMPLE_MS = 250;

function fakeEyes(live = true) {
  const liveHandlers = new Set<() => void>();
  const eyes = {
    live,
    thumb: new Uint8Array(SIZE).fill(220),
    isLive: () => eyes.live,
    grabFrame: async () => ({ png: "PNG", rect: { x: 0, y: 0, width: 590, height: 1280 } }),
    thumbnail: () => eyes.thumb,
    onLive: (h: () => void) => {
      liveHandlers.add(h);
      return () => liveHandlers.delete(h);
    },
    goLive: () => {
      eyes.live = true;
      liveHandlers.forEach((h) => h());
    },
  };
  return eyes;
}

const SEGMENTS: OcrSegment[] = [{ text: "Settings", x: 10, y: 20, width: 80, height: 18 }];

afterEach(() => vi.useRealTimers());

describe("ocrElements", () => {
  it("makes named text elements in frame pixels", () => {
    expect(ocrElements(SEGMENTS)[0]).toMatchObject({ id: "ocr:0", name: "Settings", role: "text", source: "ocr", bounds: { x: 10, y: 20, width: 80, height: 18 } });
  });
});

describe("PhonePerception", () => {
  it("observes OCR text and the screen tone", async () => {
    const eyes = fakeEyes();
    const p = new PhonePerception(eyes as PhoneEyes, async () => SEGMENTS);
    const o = await p.observe();
    expect(o).toMatchObject({ app: "iPhone", tone: "light" });
    expect(o.elements.map((e) => e.name)).toEqual(["Settings"]);
  });

  it("reports the phone as not connected while nothing is mirroring", async () => {
    const p = new PhonePerception(fakeEyes(false) as PhoneEyes, async () => SEGMENTS);
    expect((await p.observe()).app).toBe(PHONE_OFFLINE_APP);
    expect(await p.focusApp("iPhone")).toBe(false);
  });

  it("fires a learner action when the screen changes and settles, only while watching", async () => {
    vi.useFakeTimers();
    const eyes = fakeEyes();
    const p = new PhonePerception(eyes as PhoneEyes, async () => SEGMENTS, SAMPLE_MS);
    const seen = vi.fn();
    p.onLearnerAction(seen);
    p.setWatching(true);
    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    eyes.thumb = new Uint8Array(SIZE).fill(10);
    await vi.advanceTimersByTimeAsync(SETTLE_MS + SAMPLE_MS * 3);
    expect(seen).toHaveBeenCalledTimes(1);
    p.setWatching(false);
    eyes.thumb = new Uint8Array(SIZE).fill(220);
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 4);
    expect(seen).toHaveBeenCalledTimes(1);
    p.dispose();
  });

  it("fires a learner action when the mirror goes live while watching", async () => {
    const eyes = fakeEyes(false);
    const p = new PhonePerception(eyes as PhoneEyes, async () => SEGMENTS);
    const seen = vi.fn();
    p.onLearnerAction(seen);
    p.setWatching(true);
    eyes.goLive();
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    p.dispose();
  });
});
```

`src/providers/surface-perception.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ScreenObservation } from "../lib/types";
import { SurfacePerception, type WatchablePerception } from "./surface-perception";

function fake(app: string) {
  const handlers = new Set<(o: ScreenObservation) => void>();
  const adapter: WatchablePerception & { fire(): void; watching: boolean } = {
    watching: false,
    observe: async () => ({ app, windowTitle: "", elements: [], at: 0 }),
    focusApp: async () => true,
    onLearnerAction: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    setWatching(w) {
      adapter.watching = w;
    },
    fire: () => handlers.forEach((h) => h({ app, windowTitle: "", elements: [], at: 0 })),
  };
  return adapter;
}

describe("SurfacePerception", () => {
  it("observes and watches only through the active surface", async () => {
    const windows = fake("Excel");
    const phone = fake("iPhone");
    const s = new SurfacePerception({ windows, phone });
    const seen = vi.fn();
    s.onLearnerAction(seen);
    s.setWatching(true);
    expect((await s.observe()).app).toBe("Excel");
    expect([windows.watching, phone.watching]).toEqual([true, false]);

    s.setSurface("phone");
    expect((await s.observe()).app).toBe("iPhone");
    expect([windows.watching, phone.watching]).toEqual([false, true]);
    windows.fire();
    phone.fire();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].app).toBe("iPhone");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/phone src/providers/surface-perception.test.ts`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement `phone-source.ts`** with exactly the types listed under Interfaces, plus `import type { Size } from "../../lib/types"; import type { CapturedFrame } from "../../providers/vision/types";`.

- [ ] **Step 4: Implement `phone-mirror.ts`**

```ts
import type { CapturedFrame } from "../../providers/vision/types";
import type { FrameSurface, PhoneSource, PhoneSourceKind, PhoneSourceStatus } from "./phone-source";

const OFF: PhoneSourceStatus = { state: "off" };

/** The one live iPhone mirror: which source feeds it, its status, and its latest frame. Lives outside React. */
export class PhoneMirror {
  private source: PhoneSource | undefined;
  private stopListening: (() => void) | undefined;
  private current: PhoneSourceStatus = OFF;
  private readonly listeners = new Set<() => void>();
  private readonly liveHandlers = new Set<() => void>();

  constructor(
    readonly surface: FrameSurface,
    private readonly create: (kind: PhoneSourceKind) => PhoneSource,
  ) {}

  isOpen = (): boolean => this.source !== undefined;
  kind = (): PhoneSourceKind | undefined => this.source?.kind;
  status = (): PhoneSourceStatus => this.current;
  isLive = (): boolean => this.current.state === "live";

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onLive(handler: () => void): () => void {
    this.liveHandlers.add(handler);
    return () => {
      this.liveHandlers.delete(handler);
    };
  }

  async open(kind: PhoneSourceKind): Promise<void> {
    if (this.source?.kind === kind && this.current.state !== "error") return;
    await this.close();
    const source = this.create(kind);
    this.source = source;
    this.stopListening = source.onStatus((status) => this.setStatus(status));
    this.setStatus({ state: "connecting" });
    try {
      await source.start(this.surface);
    } catch (error) {
      console.error(`Couldn't start the iPhone ${kind} source`, error);
      this.setStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async close(): Promise<void> {
    const source = this.source;
    this.stopListening?.();
    this.source = undefined;
    this.stopListening = undefined;
    this.setStatus(OFF);
    if (source) await source.stop().catch((error) => console.error("Stopping the iPhone source failed", error));
  }

  async retry(): Promise<void> {
    const kind = this.kind();
    if (!kind) return;
    await this.close();
    await this.open(kind);
  }

  async grabFrame(): Promise<CapturedFrame> {
    if (!this.isLive()) throw new Error("The iPhone isn't mirroring right now.");
    return this.surface.grab();
  }

  thumbnail(): Uint8Array | undefined {
    return this.isLive() ? this.surface.thumbnail() : undefined;
  }

  private setStatus(status: PhoneSourceStatus): void {
    const wasLive = this.isLive();
    this.current = status;
    this.listeners.forEach((listener) => listener());
    if (!wasLive && this.isLive()) this.liveHandlers.forEach((handler) => handler());
  }
}
```

- [ ] **Step 5: Implement `phone-perception.ts`**

```ts
import type { Rect, ScreenObservation, UiElement } from "../../lib/types";
import { intersects } from "../../lib/coords";
import type { PerceptionAdapter } from "../../providers/interfaces";
import { ChangeDetector } from "./change-detector";
import { toneOf } from "./frame-math";
import type { PhoneMirror } from "./phone-mirror";

export const PHONE_APP = "iPhone";
/** Never equal to PHONE_APP, so a phone Hode waits ("Connect your iPhone") instead of guiding blind. */
export const PHONE_OFFLINE_APP = "iPhone (not connected)";
/** How often the mirror is sampled for changes while Hodey is watching. */
export const PHONE_SAMPLE_MS = 250;
/** Windows OCR gives no per-line score; printed UI text reads reliably, so it earns a precise highlight. */
const OCR_CONFIDENCE = 0.9;

/** Mirrors `OcrSegment` in src-tauri/src/phone/ocr.rs. */
export interface OcrSegment {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PhoneEyes = Pick<PhoneMirror, "isLive" | "grabFrame" | "thumbnail" | "onLive">;

export function ocrElements(segments: OcrSegment[]): UiElement[] {
  return segments.map((s, i) => ({
    id: `ocr:${i}`,
    name: s.text,
    role: "text",
    bounds: { x: s.x, y: s.y, width: s.width, height: s.height },
    source: "ocr",
    confidence: OCR_CONFIDENCE,
  }));
}

/** The mirrored iPhone, read by OCR. Learner actions are screen changes that settle. */
export class PhonePerception implements PerceptionAdapter {
  private readonly handlers = new Set<(observation: ScreenObservation) => void>();
  private readonly detector = new ChangeDetector();
  private readonly stopLive: () => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private watching = false;
  private inFlight = false;
  private rerun = false;

  constructor(
    private readonly eyes: PhoneEyes,
    private readonly ocr: (png: string) => Promise<OcrSegment[]>,
    private readonly sampleMs = PHONE_SAMPLE_MS,
  ) {
    this.stopLive = eyes.onLive(() => this.watching && this.emit());
  }

  async observe(region?: Rect): Promise<ScreenObservation> {
    if (!this.eyes.isLive()) return { app: PHONE_OFFLINE_APP, windowTitle: "", elements: [], at: Date.now() };
    const frame = await this.eyes.grabFrame();
    const elements = ocrElements(await this.ocr(frame.png));
    const thumb = this.eyes.thumbnail();
    return {
      app: PHONE_APP,
      windowTitle: "",
      elements: region ? elements.filter((e) => intersects(e.bounds, region)) : elements,
      at: Date.now(),
      tone: thumb ? toneOf(thumb) : undefined,
    };
  }

  async focusApp(app: string): Promise<boolean> {
    return app.toLowerCase() === PHONE_APP.toLowerCase() && this.eyes.isLive();
  }

  onLearnerAction(handler: (observation: ScreenObservation) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  setWatching(watching: boolean): void {
    if (watching === this.watching) return;
    this.watching = watching;
    clearInterval(this.timer);
    this.timer = undefined;
    this.detector.reset();
    if (watching) this.timer = setInterval(() => this.sample(), this.sampleMs);
  }

  dispose(): void {
    this.setWatching(false);
    this.stopLive();
    this.handlers.clear();
  }

  private sample(): void {
    const thumb = this.eyes.thumbnail();
    if (thumb && this.detector.push(thumb, Date.now())) this.emit();
  }

  private emit(): void {
    if (this.inFlight) {
      this.rerun = true;
      return;
    }
    this.inFlight = true;
    this.observe()
      .then(
        (observation) => this.handlers.forEach((handler) => handler(observation)),
        (error) => console.error("Couldn't read the iPhone after the learner's action", error),
      )
      .finally(() => {
        this.inFlight = false;
        if (this.rerun) {
          this.rerun = false;
          this.emit();
        }
      });
  }
}
```

- [ ] **Step 6: Implement `src/providers/surface-perception.ts`**

```ts
import type { Rect, ScreenObservation, Surface } from "../lib/types";
import type { PerceptionAdapter } from "./interfaces";

export interface WatchablePerception extends PerceptionAdapter {
  setWatching(watching: boolean): void;
}

const SURFACES: Surface[] = ["windows", "phone"];

/** Sends perception to the Windows desktop or the mirrored iPhone, whichever the running Hode is about. */
export class SurfacePerception implements PerceptionAdapter {
  private active: Surface = "windows";
  private watching = false;

  constructor(private readonly adapters: Record<Surface, WatchablePerception>) {}

  current = (): Surface => this.active;

  setSurface(surface: Surface): void {
    if (surface === this.active) return;
    this.active = surface;
    this.applyWatching();
  }

  setWatching(watching: boolean): void {
    this.watching = watching;
    this.applyWatching();
  }

  observe(region?: Rect): Promise<ScreenObservation> {
    return this.adapters[this.active].observe(region);
  }

  async focusApp(app: string): Promise<boolean> {
    return (await this.adapters[this.active].focusApp?.(app)) ?? false;
  }

  onLearnerAction(handler: (observation: ScreenObservation) => void): () => void {
    const offs = SURFACES.map((surface) =>
      this.adapters[surface].onLearnerAction((observation) => {
        if (surface === this.active) handler(observation);
      }),
    );
    return () => offs.forEach((off) => off());
  }

  private applyWatching(): void {
    SURFACES.forEach((surface) => this.adapters[surface].setWatching(this.watching && surface === this.active));
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/features/phone src/providers` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/phone src/providers/surface-perception.ts src/providers/surface-perception.test.ts
git commit -m "feat: phone mirror, OCR phone perception and surface routing"
```

---

### Task 7: Camera source, frame canvas, camera permission, taller notch window

**Files:**
- Create: `src/features/phone/frame-canvas.ts`, `src/features/phone/camera-source.ts`
- Modify: `src-tauri/src/lib.rs` (permission handler)
- Modify: `src-tauri/src/surfaces.rs:19-20`, `src-tauri/tauri.conf.json` (main_notch height)
- Test: `src/features/phone/camera-source.test.ts`

**Interfaces:**
- Consumes: `FrameSurface`, `PhoneSource` (Task 6); `phoneCrop`, `fitWithin`, `grayscale`, `THUMB_*`, `MAX_PHONE_SIDE` (Task 4).
- Produces:
  - `class FrameCanvas implements FrameSurface` (DOM)
  - `class CameraPhoneSource implements PhoneSource` with `constructor(preferredLabel: () => string | undefined)`
  - `listCameras(): Promise<CameraInfo[]>`
  - pure `pickCamera(devices: CameraInfo[], preferredLabel?: string): CameraInfo | undefined`
  - `interface CameraInfo { deviceId: string; label: string }`

- [ ] **Step 1: Write the failing test for `pickCamera`**

`src/features/phone/camera-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickCamera } from "./camera-source";

const cams = [
  { deviceId: "a", label: "Integrated Webcam" },
  { deviceId: "b", label: "USB Video (534d:2109)" },
  { deviceId: "c", label: "iPhoneMirror Camera" },
];

describe("pickCamera", () => {
  it("prefers the camera the learner chose", () => {
    expect(pickCamera(cams, "USB Video (534d:2109)")?.deviceId).toBe("b");
  });

  it("otherwise picks one that looks like an iPhone or capture card", () => {
    expect(pickCamera(cams)?.deviceId).toBe("c");
    expect(pickCamera(cams.slice(0, 2))?.deviceId).toBe("b");
  });

  it("falls back to the first camera, or none", () => {
    expect(pickCamera(cams.slice(0, 1))?.deviceId).toBe("a");
    expect(pickCamera([])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/phone/camera-source.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement `camera-source.ts`**

```ts
import type { FrameSink, PhoneSource, PhoneSourceStatus } from "./phone-source";

export interface CameraInfo {
  deviceId: string;
  label: string;
}

/** Device names that are probably the mirrored iPhone rather than the laptop's own webcam. */
const PHONE_LIKE = /iphone|mirror|capture|hdmi|usb video|cam link|virtual/i;
const IDEAL = { width: 1920, height: 1080, frameRate: 30 };

export function pickCamera(devices: CameraInfo[], preferredLabel?: string): CameraInfo | undefined {
  return devices.find((d) => d.label === preferredLabel) ?? devices.find((d) => PHONE_LIKE.test(d.label)) ?? devices[0];
}

/** Device labels stay hidden until the page has used a camera once, so ask briefly first. */
export async function listCameras(): Promise<CameraInfo[]> {
  const probe = await navigator.mediaDevices.getUserMedia({ video: true });
  probe.getTracks().forEach((track) => track.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput").map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/** iPhoneMirror's virtual camera or a UVC capture card, read in the notch webview. */
export class CameraPhoneSource implements PhoneSource {
  readonly kind = "camera" as const;
  private readonly handlers = new Set<(status: PhoneSourceStatus) => void>();
  private stream: MediaStream | undefined;
  private video: HTMLVideoElement | undefined;
  private running = false;

  constructor(private readonly preferredLabel: () => string | undefined) {}

  onStatus(handler: (status: PhoneSourceStatus) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async start(sink: FrameSink): Promise<void> {
    const camera = pickCamera(await listCameras(), this.preferredLabel());
    if (!camera) throw new Error("No camera found. Start iPhoneMirror or plug in the capture card, then retry.");
    const constraints = { deviceId: { exact: camera.deviceId }, width: { ideal: IDEAL.width }, height: { ideal: IDEAL.height }, frameRate: { ideal: IDEAL.frameRate } };
    this.stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
    this.stream.getVideoTracks()[0]?.addEventListener("ended", () => this.emit({ state: "error", message: `${camera.label} stopped. Is it still plugged in?` }));
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play();
    this.video = video;
    this.running = true;
    this.pump(video, sink);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.video = undefined;
  }

  private pump(video: HTMLVideoElement, sink: FrameSink): void {
    let first = true;
    const next = () => {
      if (!this.running || this.video !== video) return;
      sink.draw(video, video.videoWidth, video.videoHeight);
      if (first) {
        first = false;
        this.emit({ state: "live", width: video.videoWidth, height: video.videoHeight });
      }
      video.requestVideoFrameCallback(next);
    };
    video.requestVideoFrameCallback(next);
  }

  private emit(status: PhoneSourceStatus): void {
    this.handlers.forEach((handler) => handler(status));
  }
}
```

- [ ] **Step 4: Implement `frame-canvas.ts`**

```ts
import type { Size } from "../../lib/types";
import type { CapturedFrame } from "../../providers/vision/types";
import { MAX_PHONE_SIDE, THUMB_HEIGHT, THUMB_WIDTH, fitWithin, grayscale, phoneCrop } from "./frame-math";
import type { FrameSurface } from "./phone-source";

const PNG_PREFIX = "data:image/png;base64,";

function context(canvas: HTMLCanvasElement, readBack: boolean): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: readBack });
  if (!ctx) throw new Error("This webview can't draw the iPhone mirror (no 2D canvas).");
  return ctx;
}

/** The latest phone frame, cropped to the phone and capped at MAX_PHONE_SIDE. Shown in the notch and read by OCR. */
export class FrameCanvas implements FrameSurface {
  readonly element = document.createElement("canvas");
  private readonly thumb = document.createElement("canvas");
  private readonly ctx = context(this.element, false);
  private readonly thumbCtx: CanvasRenderingContext2D;
  size: Size | undefined;

  constructor() {
    this.thumb.width = THUMB_WIDTH;
    this.thumb.height = THUMB_HEIGHT;
    this.thumbCtx = context(this.thumb, true);
  }

  draw(image: CanvasImageSource, width: number, height: number): void {
    const crop = phoneCrop(width, height);
    const out = fitWithin(crop.width, crop.height, MAX_PHONE_SIDE);
    if (this.element.width !== out.width || this.element.height !== out.height) {
      this.element.width = out.width;
      this.element.height = out.height;
    }
    this.ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);
    this.size = out;
  }

  grab(): CapturedFrame {
    const size = this.size;
    if (!size) throw new Error("No iPhone frame has arrived yet.");
    const png = this.element.toDataURL("image/png").slice(PNG_PREFIX.length);
    return { png, rect: { x: 0, y: 0, width: size.width, height: size.height } };
  }

  thumbnail(): Uint8Array {
    this.thumbCtx.drawImage(this.element, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    return grayscale(this.thumbCtx.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT).data);
  }
}
```

- [ ] **Step 5: Grant the camera to the notch only (Rust)**

`src-tauri/src/lib.rs`:

```rust
use tauri::webview::{PermissionKind, PermissionResponse};

/// The notch reads the mirrored iPhone (a camera device). Every other request keeps WebView2's default.
fn notch_camera(webview: &tauri::Webview, kind: PermissionKind) -> PermissionResponse {
    if matches!(kind, PermissionKind::Camera) && webview.label() == surfaces::NOTCH {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Default
    }
}
```

Chain this on the builder, right after `.plugin(...)`:

```rust
        .on_permission_request(|webview, kind| notch_camera(&webview, kind))
```

If `tauri::Webview` needs its runtime generic, write `tauri::Webview<tauri::Wry>`.

- [ ] **Step 6: Make the notch window tall enough for the phone panel**

- `src-tauri/src/surfaces.rs`: `const NOTCH_WINDOW_HEIGHT: f64 = 620.0;`
- `src-tauri/tauri.conf.json`: set the `main_notch` window's `"height"` to `620`.
- Run `grep -rn "340" src src-tauri/src` and update anything that assumes the old window height. Do not touch pill or card sizes.

- [ ] **Step 7: Verify**

Run: `npx vitest run src/features/phone` then `npm run typecheck`, then `cd src-tauri; cargo build`
Expected: PASS and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/features/phone src-tauri/src/lib.rs src-tauri/src/surfaces.rs src-tauri/tauri.conf.json
git commit -m "feat: camera iPhone source (iPhoneMirror or capture card), notch-only camera permission, taller notch window"
```

---

### Task 8: RTP → H.264 depacketizer (Rust)

**Files:**
- Create: `src-tauri/src/phone/rtp.rs`
- Modify: `src-tauri/src/phone/mod.rs` (`pub mod rtp;`)

**Interfaces:**
- Produces:
  - `pub struct AccessUnit { pub data: Vec<u8> /* Annex-B */, pub key: bool }`
  - `pub struct Depacketizer` with `new()` and `push(&mut self, packet: &[u8]) -> Option<AccessUnit>`

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn rtp(seq: u16, marker: bool, payload: &[u8]) -> Vec<u8> {
        let mut p = vec![0x80, if marker { 0xE0 } else { 0x60 }];
        p.extend_from_slice(&seq.to_be_bytes());
        p.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 2]);
        p.extend_from_slice(payload);
        p
    }

    #[test]
    fn single_nal_keyframe_becomes_an_annex_b_access_unit() {
        let mut d = Depacketizer::new();
        let au = d.push(&rtp(1, true, &[0x65, 0xAA])).expect("access unit");
        assert!(au.key);
        assert_eq!(au.data, [0, 0, 0, 1, 0x65, 0xAA]);
    }

    #[test]
    fn reassembles_fu_a_fragments() {
        let mut d = Depacketizer::new();
        assert!(d.push(&rtp(1, false, &[0x7C, 0x85, 1, 2])).is_none());
        assert!(d.push(&rtp(2, false, &[0x7C, 0x05, 3])).is_none());
        let au = d.push(&rtp(3, true, &[0x7C, 0x45, 4])).expect("access unit");
        assert_eq!(au.data, [0, 0, 0, 1, 0x65, 1, 2, 3, 4]);
    }

    #[test]
    fn unpacks_stap_a() {
        let mut d = Depacketizer::new();
        let payload = [0x18, 0, 2, 0x67, 0x42, 0, 2, 0x68, 0xCE, 0, 2, 0x65, 0x88];
        let au = d.push(&rtp(1, true, &payload)).expect("access unit");
        assert_eq!(au.data, [0, 0, 0, 1, 0x67, 0x42, 0, 0, 0, 1, 0x68, 0xCE, 0, 0, 0, 1, 0x65, 0x88]);
    }

    #[test]
    fn drops_until_the_next_keyframe_after_loss_or_on_a_delta_start() {
        let mut d = Depacketizer::new();
        assert!(d.push(&rtp(1, true, &[0x41, 1])).is_none(), "delta before any keyframe");
        assert!(d.push(&rtp(2, true, &[0x65, 1])).is_some());
        assert!(d.push(&rtp(4, true, &[0x41, 2])).is_none(), "sequence gap");
        assert!(d.push(&rtp(5, true, &[0x41, 3])).is_none(), "still waiting for a keyframe");
        assert!(d.push(&rtp(6, true, &[0x65, 2])).is_some());
    }

    #[test]
    fn ignores_malformed_packets() {
        let mut d = Depacketizer::new();
        assert!(d.push(&[0x80, 0x60]).is_none());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri; cargo test --lib phone::rtp`
Expected: FAIL to compile.

- [ ] **Step 3: Implement**

```rust
//! H.264 over RTP (RFC 6184) back to Annex-B access units, for UxPlay's `-vrtp` output.

const RTP_HEADER: usize = 12;
const RTP_VERSION: u8 = 2;
const NAL_TYPE_MASK: u8 = 0x1F;
const NAL_HEADER_HIGH_BITS: u8 = 0xE0;
const NAL_IDR: u8 = 5;
const NAL_STAP_A: u8 = 24;
const NAL_FU_A: u8 = 28;
const FU_START: u8 = 0x80;
const START_CODE: [u8; 4] = [0, 0, 0, 1];

pub struct AccessUnit {
    pub data: Vec<u8>,
    pub key: bool,
}

pub struct Depacketizer {
    current: Vec<u8>,
    key: bool,
    in_fragment: bool,
    broken: bool,
    need_key: bool,
    last_seq: Option<u16>,
}

struct Packet<'a> {
    seq: u16,
    marker: bool,
    payload: &'a [u8],
}

fn parse(packet: &[u8]) -> Option<Packet<'_>> {
    if packet.len() <= RTP_HEADER || packet[0] >> 6 != RTP_VERSION {
        return None;
    }
    let csrc = usize::from(packet[0] & 0x0F) * 4;
    let mut start = RTP_HEADER + csrc;
    if packet[0] & 0x10 != 0 {
        let words = usize::from(u16::from_be_bytes([*packet.get(start + 2)?, *packet.get(start + 3)?]));
        start += 4 + words * 4;
    }
    let padding = if packet[0] & 0x20 != 0 { usize::from(*packet.last()?) } else { 0 };
    let end = packet.len().checked_sub(padding)?;
    let payload = packet.get(start..end).filter(|p| !p.is_empty())?;
    Some(Packet { seq: u16::from_be_bytes([packet[2], packet[3]]), marker: packet[1] & 0x80 != 0, payload })
}

impl Depacketizer {
    pub fn new() -> Self {
        Self { current: Vec::new(), key: false, in_fragment: false, broken: false, need_key: true, last_seq: None }
    }

    pub fn push(&mut self, packet: &[u8]) -> Option<AccessUnit> {
        let packet = parse(packet)?;
        if self.last_seq.is_some_and(|last| last.wrapping_add(1) != packet.seq) {
            self.broken = true;
            self.need_key = true;
        }
        self.last_seq = Some(packet.seq);
        self.take_payload(packet.payload);
        if packet.marker { self.finish() } else { None }
    }

    fn nal(&mut self, nal: &[u8]) {
        if nal.first().is_some_and(|h| h & NAL_TYPE_MASK == NAL_IDR) {
            self.key = true;
        }
        self.current.extend_from_slice(&START_CODE);
        self.current.extend_from_slice(nal);
    }

    fn take_payload(&mut self, payload: &[u8]) {
        match payload[0] & NAL_TYPE_MASK {
            NAL_STAP_A => self.stap_a(&payload[1..]),
            NAL_FU_A => self.fu_a(payload),
            _ => self.nal(payload),
        }
    }

    fn stap_a(&mut self, mut rest: &[u8]) {
        while rest.len() > 2 {
            let size = usize::from(u16::from_be_bytes([rest[0], rest[1]]));
            let Some(nal) = rest.get(2..2 + size) else {
                self.broken = true;
                return;
            };
            self.nal(nal);
            rest = &rest[2 + size..];
        }
    }

    fn fu_a(&mut self, payload: &[u8]) {
        let (Some(&indicator), Some(&header)) = (payload.first(), payload.get(1)) else {
            self.broken = true;
            return;
        };
        if header & FU_START != 0 {
            self.nal(&[(indicator & NAL_HEADER_HIGH_BITS) | (header & NAL_TYPE_MASK)]);
            self.in_fragment = true;
        } else if !self.in_fragment {
            self.broken = true;
            return;
        }
        self.current.extend_from_slice(&payload[2..]);
    }

    fn finish(&mut self) -> Option<AccessUnit> {
        let data = std::mem::take(&mut self.current);
        let (key, broken) = (self.key, self.broken);
        self.key = false;
        self.broken = false;
        self.in_fragment = false;
        if broken || data.is_empty() || (self.need_key && !key) {
            return None;
        }
        self.need_key = false;
        Some(AccessUnit { data, key })
    }
}
```

`fu_a`'s `nal(&[...])` writes the start code plus the rebuilt NAL header. Later fragments then append payload bytes only. Keep `fu_a` under 40 lines.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri; cargo test --lib phone::rtp`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/phone
git commit -m "feat: RTP to H.264 access-unit depacketizer for AirPlay mirroring"
```

---

### Task 9: AirPlay receiver supervisor (Rust)

**Files:**
- Create: `src-tauri/src/child_job.rs` (kill-on-close job, extracted from `vlm.rs`)
- Modify: `src-tauri/src/vlm.rs` (use `ChildJob`)
- Create: `src-tauri/src/phone/airplay.rs`
- Modify: `src-tauri/src/phone/mod.rs`, `src-tauri/src/lib.rs` (state, handlers, exit cleanup)

**Interfaces:**
- Consumes: `rtp::Depacketizer` (Task 8); `vlm::local_ai_root()`.
- Produces:
  - Commands `airplay_start(on_frame: Channel<InvokeResponseBody>)` and `airplay_stop()`
  - Channel messages:
    - Raw bytes `[flags: u8 (bit 0 = keyframe), ...annexB]` for each access unit
    - JSON `{ "state": "waiting" | "streaming" | "failed", "detail"?: string }`
  - `airplay_start` returns `Err(AIRPLAY_MISSING)` when UxPlay isn't found

- [ ] **Step 1: Write the failing tests**

In `src-tauri/src/phone/airplay.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receiver_args_send_video_to_the_local_port_without_audio() {
        let args = receiver_args(5004);
        assert!(args.windows(2).any(|w| w[0] == "-n" && w[1] == RECEIVER_NAME));
        assert!(args.iter().any(|a| a == "-a"));
        let rtp = args.iter().position(|a| a == "-vrtp").expect("-vrtp");
        assert_eq!(args[rtp + 1], "config-interval=1 ! udpsink host=127.0.0.1 port=5004");
    }

    #[test]
    fn finds_the_receiver_only_at_fixed_places() {
        let root = std::env::temp_dir().join(format!("hodeum-uxplay-test-{}", std::process::id()));
        let exe = root.join(LOCAL_RECEIVER);
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        assert_ne!(receiver_path(&root).as_deref(), Some(exe.as_path()));
        std::fs::write(&exe, b"").unwrap();
        assert_eq!(receiver_path(&root).as_deref(), Some(exe.as_path()));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn last_line_skips_trailing_blanks() {
        assert_eq!(last_line("starting\nerror: port 7000 in use\n\n"), Some("error: port 7000 in use"));
        assert_eq!(last_line("  \n"), None);
    }
}
```

Add `pub mod airplay;` to `phone/mod.rs`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri; cargo test --lib phone::airplay`
Expected: FAIL to compile.

- [ ] **Step 3: Extract the kill-on-close job**

Create `src-tauri/src/child_job.rs` by moving `kill_on_close_job` and the body of `bind_to_app` out of `vlm.rs`:

```rust
use std::os::windows::io::AsRawHandle;
use std::process::Child;
use std::sync::OnceLock;

use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// A kill-on-close job: Windows closes its handle when Hodeum exits (even by crash), killing every child in it.
#[derive(Default)]
pub struct ChildJob(OnceLock<Result<isize, String>>);

fn kill_on_close_job() -> Result<isize, String> {
    // (body moved verbatim from vlm.rs)
}

impl ChildJob {
    /// Ties `child`'s lifetime to Hodeum's. `name` appears in the error.
    pub fn bind(&self, child: &Child, name: &str) -> Result<(), String> {
        let job = self.0.get_or_init(kill_on_close_job).clone()?;
        // SAFETY: both handles are valid for this call; the child handle is owned by `child`.
        unsafe { AssignProcessToJobObject(HANDLE(job as *mut _), HANDLE(child.as_raw_handle())) }
            .map_err(|e| format!("couldn't tie {name} to Hodeum: {e}"))
    }
}
```

In `vlm.rs`:
- Replace the `job: OnceLock<…>` field with `job: ChildJob`.
- Make `bind_to_app` call `vlm.job.bind(child, "llama-server")`.
- Remove the now-unused imports.

Add `mod child_job;` to `lib.rs`. Then run `cargo test --lib vlm` and confirm it still passes.

- [ ] **Step 4: Implement `airplay.rs`**

Check the flags against the installed UxPlay first, if it is available: `uxplay -h`. The flags used here are:
- `-n NAME`: the AirPlay name
- `-nh`: don't append the hostname
- `-a`: no audio
- `-nohold`: a new client may take over
- `-vrtp "<pipeline>"`: decrypted H.264 goes out as RTP instead of being rendered

If any flag differs, adjust `receiver_args` and its test together.

```rust
use std::fs::File;
use std::io::ErrorKind;
use std::net::UdpSocket;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use super::rtp::Depacketizer;
use crate::child_job::ChildJob;
use crate::vlm::local_ai_root;

pub const RECEIVER_NAME: &str = "Hodeum";
/// Fixed places only, like llama-server: no setting or variable can redirect which receiver binary runs.
pub const LOCAL_RECEIVER: &str = "runtime/uxplay/uxplay.exe";
const MSYS2_RECEIVER: &str = "C:/msys64/ucrt64/bin/uxplay.exe";
const LOG_FILE: &str = "runtime/uxplay.log";
pub const AIRPLAY_MISSING: &str = "AirPlay receiver not installed. See docs/iphone-mirroring.md to install UxPlay.";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const POLL: Duration = Duration::from_millis(250);
/// Large enough for any RTP packet on loopback.
const MAX_PACKET: usize = 65_536;
const KEY_FLAG: u8 = 1;

pub fn receiver_args(port: u16) -> Vec<String> {
    let rtp = format!("config-interval=1 ! udpsink host=127.0.0.1 port={port}");
    ["-n", RECEIVER_NAME, "-nh", "-a", "-nohold", "-vrtp", &rtp].iter().map(|s| s.to_string()).collect()
}

pub fn receiver_path(root: &Path) -> Option<PathBuf> {
    [root.join(LOCAL_RECEIVER), PathBuf::from(MSYS2_RECEIVER)].into_iter().find(|p| p.is_file())
}

pub fn last_line(text: &str) -> Option<&str> {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).last()
}

struct Session {
    child: Child,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Airplay {
    session: Mutex<Option<Session>>,
    job: ChildJob,
}

impl Airplay {
    pub fn stop(&self) -> Result<(), String> {
        let mut slot = self.session.lock().map_err(|e| e.to_string())?;
        if let Some(mut session) = slot.take() {
            session.stop.store(true, Ordering::SeqCst);
            session.child.kill().map_err(|e| format!("couldn't stop the AirPlay receiver: {e}"))?;
        }
        Ok(())
    }
}

fn status(channel: &Channel<InvokeResponseBody>, state: &str, detail: Option<String>) -> bool {
    let body = serde_json::json!({ "state": state, "detail": detail }).to_string();
    channel.send(InvokeResponseBody::Json(body)).is_ok()
}

fn spawn_receiver(root: &Path, exe: &Path, port: u16) -> Result<Child, String> {
    let log = File::create(root.join(LOG_FILE)).map_err(|e| format!("couldn't create {LOG_FILE}: {e}"))?;
    let errors = log.try_clone().map_err(|e| e.to_string())?;
    // UxPlay loads its GStreamer DLLs from its own folder (MSYS2 ucrt64/bin).
    let dir = exe.parent().ok_or("the AirPlay receiver path has no folder")?;
    Command::new(exe)
        .args(receiver_args(port))
        .current_dir(dir)
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errors))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("couldn't start the AirPlay receiver: {e}"))
}

fn exit_detail(root: &Path) -> String {
    let log = std::fs::read_to_string(root.join(LOG_FILE)).unwrap_or_default();
    last_line(&log).map_or_else(|| "The AirPlay receiver stopped.".to_string(), |l| format!("The AirPlay receiver stopped: {l}"))
}

/// Forwards access units until stopped, the webview goes away, or the receiver exits.
fn pump(socket: UdpSocket, channel: Channel<InvokeResponseBody>, stop: Arc<AtomicBool>, root: PathBuf) {
    let mut depacketizer = Depacketizer::new();
    let mut buffer = vec![0u8; MAX_PACKET];
    let mut streaming = false;
    while !stop.load(Ordering::SeqCst) {
        match socket.recv(&mut buffer) {
            Ok(n) => {
                if !streaming {
                    streaming = status(&channel, "streaming", None);
                }
                let Some(unit) = depacketizer.push(&buffer[..n]) else { continue };
                let mut message = Vec::with_capacity(unit.data.len() + 1);
                message.push(if unit.key { KEY_FLAG } else { 0 });
                message.extend_from_slice(&unit.data);
                if channel.send(InvokeResponseBody::Raw(message)).is_err() {
                    return;
                }
            }
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => continue,
            Err(e) => {
                status(&channel, "failed", Some(format!("AirPlay video stopped arriving: {e}")));
                return;
            }
        }
    }
    if !stop.load(Ordering::SeqCst) {
        status(&channel, "failed", Some(exit_detail(&root)));
    }
}
```

`pump` can't see the child exiting while no packets arrive. Add a watcher thread: it takes the child's id and polls `try_wait` through the session mutex. Rather than share the session across threads, put the exit check inside the `Err(WouldBlock)` branch, using a closure `exited: impl Fn() -> bool` passed into `pump`:

```rust
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                if exited() {
                    status(&channel, "failed", Some(exit_detail(&root)));
                    return;
                }
            }
```

and give `pump` the extra parameter `exited: impl Fn() -> bool`. Pass this closure from the command:

```rust
let state = app.state::<Airplay>();
move || state.session.lock().map(|mut s| s.as_mut().map_or(true, |s| s.child.try_wait().map_or(true, |c| c.is_some()))).unwrap_or(true)
```

The command needs `AppHandle` for `app.state` inside the thread: `let app = app.clone(); let exited = move || child_exited(&app.state::<Airplay>());`, where `child_exited(&Airplay) -> bool` is a small helper.

The commands:

```rust
#[tauri::command]
pub fn airplay_start(app: tauri::AppHandle, state: State<'_, Airplay>, on_frame: Channel<InvokeResponseBody>) -> Result<(), String> {
    state.stop()?;
    let root = local_ai_root();
    let exe = receiver_path(&root).ok_or(AIRPLAY_MISSING)?;
    let socket = UdpSocket::bind(("127.0.0.1", 0)).map_err(|e| format!("couldn't open a local port for AirPlay video: {e}"))?;
    socket.set_read_timeout(Some(POLL)).map_err(|e| e.to_string())?;
    let port = socket.local_addr().map_err(|e| e.to_string())?.port();
    let child = spawn_receiver(&root, &exe, port)?;
    state.job.bind(&child, "the AirPlay receiver")?;
    let stop = Arc::new(AtomicBool::new(false));
    *state.session.lock().map_err(|e| e.to_string())? = Some(Session { child, stop: stop.clone() });
    status(&on_frame, "waiting", None);
    let handle = app.clone();
    thread::spawn(move || pump(socket, on_frame, stop, root, move || child_exited(&handle.state::<Airplay>())));
    Ok(())
}

fn child_exited(airplay: &Airplay) -> bool {
    match airplay.session.lock() {
        Ok(mut slot) => slot.as_mut().map_or(true, |s| !matches!(s.child.try_wait(), Ok(None))),
        Err(_) => true,
    }
}

#[tauri::command]
pub fn airplay_stop(state: State<'_, Airplay>) -> Result<(), String> {
    state.stop()
}
```

`lib.rs`:
- `.manage(phone::airplay::Airplay::default())`
- Register `phone::airplay::airplay_start` and `phone::airplay::airplay_stop`.
- In `RunEvent::Exit`, add `if let Err(error) = app.state::<phone::airplay::Airplay>().stop() { eprintln!("{error}"); }`.
- Make `vlm::local_ai_root` `pub(crate)` if it isn't already.

- [ ] **Step 5: Run tests and build**

Run: `cd src-tauri; cargo test --lib` then `cargo build`
Expected: all Rust tests pass, including `vlm`; the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src
git commit -m "feat: AirPlay receiver supervisor streaming H.264 access units to the notch"
```

---

### Task 10: AirPlay source in the notch (WebCodecs)

**Files:**
- Create: `src/features/phone/h264.ts`, `src/features/phone/airplay-source.ts`
- Test: `src/features/phone/h264.test.ts`

**Interfaces:**
- Consumes: the Task 9 channel protocol; `PhoneSource` and `FrameSink` (Task 6).
- Produces:
  - `findSps(annexB: Uint8Array): Uint8Array | undefined`
  - `avcCodec(sps: Uint8Array): string`
  - `class AirPlayPhoneSource implements PhoneSource` with `constructor(invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>)`

- [ ] **Step 1: Write the failing tests**

`src/features/phone/h264.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { avcCodec, findSps } from "./h264";

const SC = [0, 0, 0, 1];

describe("h264", () => {
  it("finds the SPS NAL in an Annex-B access unit", () => {
    const unit = new Uint8Array([...SC, 0x67, 0x64, 0x00, 0x28, 0xac, ...SC, 0x68, 0xee, ...SC, 0x65, 0x88]);
    expect(Array.from(findSps(unit) ?? [])).toEqual([0x67, 0x64, 0x00, 0x28, 0xac]);
  });

  it("returns undefined without an SPS (a delta frame)", () => {
    expect(findSps(new Uint8Array([...SC, 0x41, 0x9a]))).toBeUndefined();
  });

  it("builds the WebCodecs codec string from profile, constraints and level", () => {
    expect(avcCodec(new Uint8Array([0x67, 0x64, 0x00, 0x28]))).toBe("avc1.640028");
    expect(avcCodec(new Uint8Array([0x67, 0x42, 0xe0, 0x1f]))).toBe("avc1.42e01f");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/phone/h264.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `h264.ts`**

```ts
const NAL_TYPE_MASK = 0x1f;
const NAL_SPS = 7;
const SPS_MIN_BYTES = 4;

/** NAL units of an Annex-B buffer (3- or 4-byte start codes), without their start codes. */
export function nalUnits(data: Uint8Array): Uint8Array[] {
  const starts: number[] = [];
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3);
      i += 2;
    }
  }
  return starts.map((start, n) => {
    let end = n + 1 < starts.length ? starts[n + 1] - 3 : data.length;
    if (end > start && data[end - 1] === 0) end--;
    return data.subarray(start, end);
  });
}

export function findSps(annexB: Uint8Array): Uint8Array | undefined {
  return nalUnits(annexB).find((nal) => nal.length >= SPS_MIN_BYTES && (nal[0] & NAL_TYPE_MASK) === NAL_SPS);
}

const hex = (byte: number) => byte.toString(16).padStart(2, "0");

/** "avc1.PPCCLL": profile_idc, constraint flags and level_idc follow the SPS NAL header. */
export function avcCodec(sps: Uint8Array): string {
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}
```

- [ ] **Step 4: Implement `airplay-source.ts`**

```ts
import { Channel } from "@tauri-apps/api/core";
import { avcCodec, findSps } from "./h264";
import type { FrameSink, PhoneSource, PhoneSourceStatus } from "./phone-source";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
/** Mirrors the JSON messages in src-tauri/src/phone/airplay.rs. */
type ReceiverMessage = { state: "waiting" | "streaming" | "failed"; detail?: string | null };

const KEY_FLAG = 1;
const MICROSECONDS = 1000;
/** Past this many queued frames the decoder is behind: skip to the next keyframe to stay live. */
const MAX_DECODE_QUEUE = 6;

/** AirPlay via the UxPlay receiver: Rust hands over H.264 access units, WebCodecs decodes them here. */
export class AirPlayPhoneSource implements PhoneSource {
  readonly kind = "airplay" as const;
  private readonly handlers = new Set<(status: PhoneSourceStatus) => void>();
  private decoder: VideoDecoder | undefined;
  private live = false;
  private skipToKey = false;

  constructor(private readonly invoke: Invoke) {}

  onStatus(handler: (status: PhoneSourceStatus) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async start(sink: FrameSink): Promise<void> {
    const channel = new Channel<ArrayBuffer | ReceiverMessage>();
    channel.onmessage = (message) => (message instanceof ArrayBuffer ? this.onUnit(new Uint8Array(message), sink) : this.onReceiver(message));
    await this.invoke<void>("airplay_start", { onFrame: channel });
  }

  async stop(): Promise<void> {
    this.closeDecoder();
    await this.invoke<void>("airplay_stop");
  }

  private onReceiver(message: ReceiverMessage): void {
    if (message.state === "waiting") this.emit({ state: "waiting" });
    else if (message.state === "failed") {
      this.closeDecoder();
      this.emit({ state: "error", message: message.detail ?? "The AirPlay receiver stopped." });
    }
  }

  private onUnit(bytes: Uint8Array, sink: FrameSink): void {
    const key = (bytes[0] & KEY_FLAG) !== 0;
    const data = bytes.subarray(1);
    if (!this.decoder && !this.configure(data, key, sink)) return;
    const decoder = this.decoder;
    if (!decoder || decoder.state !== "configured") return;
    if (decoder.decodeQueueSize > MAX_DECODE_QUEUE) this.skipToKey = true;
    if (this.skipToKey && !key) return;
    this.skipToKey = false;
    decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: performance.now() * MICROSECONDS, data }));
  }

  /** The decoder can only start on a keyframe that carries its SPS. */
  private configure(data: Uint8Array, key: boolean, sink: FrameSink): boolean {
    const sps = key ? findSps(data) : undefined;
    if (!sps) return false;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        sink.draw(frame, frame.displayWidth, frame.displayHeight);
        if (!this.live) {
          this.live = true;
          this.emit({ state: "live", width: frame.displayWidth, height: frame.displayHeight });
        }
        frame.close();
      },
      error: (error) => {
        console.error("Decoding the AirPlay video failed", error);
        this.closeDecoder();
        this.emit({ state: "error", message: `Couldn't decode the iPhone video: ${error.message}` });
      },
    });
    this.decoder.configure({ codec: avcCodec(sps), optimizeForLatency: true });
    return true;
  }

  private closeDecoder(): void {
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = undefined;
    this.live = false;
  }

  private emit(status: PhoneSourceStatus): void {
    this.handlers.forEach((handler) => handler(status));
  }
}
```

After the error callback closes the decoder, the next keyframe reconfigures it, because `configure` runs whenever `this.decoder` is undefined.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/features/phone` then `npm run typecheck`
Expected: PASS. If `lib.dom` types for `VideoDecoder` are missing, add `"DOM"` and `"DOM.Iterable"` to `lib` in `tsconfig.app.json`, or check the target is ES2022 or later; don't hand-roll type declarations.

- [ ] **Step 6: Commit**

```bash
git add src/features/phone
git commit -m "feat: AirPlay iPhone source decoding H.264 with WebCodecs"
```

---

### Task 11: Phone panel in the enlarged notch

**Files:**
- Create: `src/features/phone/prefs.ts`, `src/components/notch/PhonePanel.tsx`
- Modify: `src/components/notch/notch-view.ts` (`NotchSize`, widths, `isExpanded`, `islandSize`)
- Modify: `src/components/notch/Notch.tsx` (`phone` prop, auto-open, render the panel)
- Modify: `src/components/notch/surface.ts`, `src/components/notch/DockMenu.tsx` ("Show iPhone")
- Modify: `src/components/notch/notch.css`, `src/lib/copy.ts`
- Test: `src/components/notch/notch-view.test.ts`, `src/features/phone/prefs.test.ts`

**Interfaces:**
- Consumes: `PhoneMirror` and `PhoneSourceStatus` (Task 6); `listCameras` (Task 7); `BusEvents["overlay:render"]` with `surface` (Task 2).
- Produces:
  - `NotchSize` gains `"phone"` and `IslandContext` gains `phone: boolean`
  - `NotchProps.phone?: PhoneMirror`
  - `loadPhonePrefs(): PhonePrefs`, `savePhonePrefs(p: PhonePrefs): void`, `parsePhonePrefs(raw: string | null): PhonePrefs`
  - `interface PhonePrefs { source: PhoneSourceKind; cameraLabel?: string }`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/notch/notch-view.test.ts` (reuse the file's existing view fixture, or build a minimal `NotchView`):

```ts
describe("phone island", () => {
  const context = { settled: true, hovered: false, menuOpen: false, peek: false, listening: false, phone: true };
  const view = { mode: "guidance", size: "guidance", title: "Tap Settings.", busy: false, controls: [] } as const;

  it("opens to the phone layout while the mirror is open", () => {
    expect(islandSize({ ...view }, context)).toBe("phone");
  });

  it("still lets the menu take over", () => {
    expect(islandSize({ ...view }, { ...context, menuOpen: true })).toBe("lesson");
  });
});
```

Add `phone: false` to every existing `IslandContext` literal in that file.

`src/features/phone/prefs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePhonePrefs } from "./prefs";

describe("parsePhonePrefs", () => {
  it("reads saved prefs", () => {
    expect(parsePhonePrefs('{"source":"airplay"}')).toEqual({ source: "airplay" });
    expect(parsePhonePrefs('{"source":"camera","cameraLabel":"USB Video"}')).toEqual({ source: "camera", cameraLabel: "USB Video" });
  });

  it("falls back to the camera source for missing or broken prefs", () => {
    expect(parsePhonePrefs(null)).toEqual({ source: "camera" });
    expect(parsePhonePrefs("{nope")).toEqual({ source: "camera" });
    expect(parsePhonePrefs('{"source":"bluetooth"}')).toEqual({ source: "camera" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/notch/notch-view.test.ts src/features/phone/prefs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the prefs and the view model**

`src/features/phone/prefs.ts`:

```ts
import { z } from "zod";
import type { PhoneSourceKind } from "./phone-source";

const STORAGE_KEY = "hodeum.phone";
const prefsSchema = z.object({ source: z.enum(["camera", "airplay"]), cameraLabel: z.string().optional() });
const DEFAULT_PREFS: PhonePrefs = { source: "camera" };

export interface PhonePrefs {
  source: PhoneSourceKind;
  cameraLabel?: string;
}

export function parsePhonePrefs(raw: string | null): PhonePrefs {
  if (raw === null) return DEFAULT_PREFS;
  try {
    const parsed = prefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PREFS;
  } catch (error) {
    console.warn("Saved iPhone settings were unreadable; using defaults", error);
    return DEFAULT_PREFS;
  }
}

/** Per-machine choice (camera names differ between PCs), so it stays in this webview, not in synced settings. */
export function loadPhonePrefs(): PhonePrefs {
  try {
    return parsePhonePrefs(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    console.warn("Couldn't read iPhone settings; using defaults", error);
    return DEFAULT_PREFS;
  }
}

export function savePhonePrefs(prefs: PhonePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.warn("Couldn't save iPhone settings", error);
  }
}
```

`src/components/notch/notch-view.ts`:
- `export type NotchSize = "idle" | "orb" | "compact" | "guidance" | "lesson" | "success" | "phone";`
- Add `phone: 580` to `NOTCH_WIDTHS`.
- `const EXPANDED: NotchSize[] = ["guidance", "lesson", "success", "phone"];`
- In `IslandContext`, add `/** The iPhone mirror is open: the notch grows to hold it beside Hodey's guidance. */ phone: boolean;`
- In `islandSize`, right after the `menuOpen` line: `if (context.phone) return "phone";`

- [ ] **Step 4: Copy**

Add to `src/lib/copy.ts`:

```ts
  showIphone: "Show iPhone",
  hideIphone: "Hide iPhone",
  phoneSourceCamera: "Cable / camera",
  phoneSourceAirplay: "AirPlay",
  phoneConnecting: "Connecting to your iPhone…",
  phoneWaitingAirplay: "On your iPhone: Control Center → Screen Mirroring → Hodeum.",
  phoneWaitingCamera: "Start iPhoneMirror and unlock your iPhone.",
  phoneSetupHint: "Setup guide: docs/iphone-mirroring.md",
  retry: "Retry",
  closeIphone: "Close iPhone view",
  phoneCamera: "Camera",
```

If `retry` already exists in `COPY`, reuse it and don't add a duplicate key.

- [ ] **Step 5: Implement `PhonePanel.tsx`**

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Bus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import type { OverlayPrimitive } from "../../lib/types";
import { listCameras, type CameraInfo } from "../../features/phone/camera-source";
import type { PhoneMirror } from "../../features/phone/phone-mirror";
import type { PhoneSourceKind, PhoneSourceStatus } from "../../features/phone/phone-source";
import { loadPhonePrefs, savePhonePrefs } from "../../features/phone/prefs";

const SOURCES: [PhoneSourceKind, string][] = [
  ["camera", COPY.phoneSourceCamera],
  ["airplay", COPY.phoneSourceAirplay],
];

export function usePhoneMirror(mirror: PhoneMirror | undefined) {
  const read = () => ({ open: mirror?.isOpen() ?? false, status: mirror?.status() ?? ({ state: "off" } as PhoneSourceStatus), kind: mirror?.kind() });
  const [snapshot, setSnapshot] = useState(read);
  useEffect(() => {
    if (!mirror) return;
    setSnapshot(read());
    return mirror.subscribe(() => setSnapshot(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read only closes over mirror
  }, [mirror]);
  return snapshot;
}

function usePhonePrimitives(bus: Bus): OverlayPrimitive[] {
  const [primitives, setPrimitives] = useState<OverlayPrimitive[]>([]);
  useEffect(() => {
    const offs = [bus.on("overlay:render", (p) => setPrimitives(p.surface === "phone" ? p.primitives : [])), bus.on("overlay:clear", () => setPrimitives([]))];
    return () => offs.forEach((off) => off());
  }, [bus]);
  return primitives;
}

function Highlights({ primitives, width, height }: { primitives: OverlayPrimitive[]; width: number; height: number }) {
  return (
    <svg className="phone-panel__marks" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {primitives.map((p, i) =>
        p.kind === "highlight" ? <rect key={i} className={`phone-mark phone-mark--${p.emphasis}`} x={p.bounds.x} y={p.bounds.y} width={p.bounds.width} height={p.bounds.height} rx={12} /> : null,
      )}
    </svg>
  );
}

function StatusCard({ status, kind, onRetry }: { status: PhoneSourceStatus; kind?: PhoneSourceKind; onRetry: () => void }) {
  if (status.state === "error") {
    return (
      <div className="phone-panel__card" role="alert">
        <p>{status.message}</p>
        <button type="button" className="btn" onClick={onRetry}>{COPY.retry}</button>
        <p className="phone-panel__hint">{COPY.phoneSetupHint}</p>
      </div>
    );
  }
  const text = status.state === "waiting" ? (kind === "airplay" ? COPY.phoneWaitingAirplay : COPY.phoneWaitingCamera) : COPY.phoneConnecting;
  return <div className="phone-panel__card" role="status"><p>{text}</p></div>;
}

function PhoneScreen({ mirror, status, kind, primitives }: { mirror: PhoneMirror; status: PhoneSourceStatus; kind?: PhoneSourceKind; primitives: OverlayPrimitive[] }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = mirror.surface.element;
  useEffect(() => {
    if (canvas && holder.current && canvas.parentElement !== holder.current) holder.current.appendChild(canvas);
  }, [canvas]);
  const size = mirror.surface.size;
  return (
    <div className="phone-panel__screen" data-live={status.state === "live"}>
      <div ref={holder} className="phone-panel__canvas" />
      {status.state === "live" && size && <Highlights primitives={primitives} width={size.width} height={size.height} />}
      {status.state !== "live" && <StatusCard status={status} kind={kind} onRetry={() => void mirror.retry()} />}
    </div>
  );
}

function SourceBar({ mirror, kind }: { mirror: PhoneMirror; kind?: PhoneSourceKind }) {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  useEffect(() => {
    if (kind !== "camera") return;
    listCameras().then(setCameras, (error) => console.error("Couldn't list cameras", error));
  }, [kind]);
  const choose = (source: PhoneSourceKind) => {
    savePhonePrefs({ ...loadPhonePrefs(), source });
    void mirror.open(source);
  };
  const pickCamera = (cameraLabel: string) => {
    savePhonePrefs({ ...loadPhonePrefs(), cameraLabel });
    void mirror.retry();
  };
  return (
    <div className="phone-panel__bar">
      <div className="segmented" role="radiogroup" aria-label="iPhone source">
        {SOURCES.map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={kind === key} className="segmented__option" onClick={() => choose(key)}>{label}</button>
        ))}
      </div>
      {kind === "camera" && cameras.length > 1 && (
        <select aria-label={COPY.phoneCamera} value={loadPhonePrefs().cameraLabel ?? ""} onChange={(e) => pickCamera(e.target.value)}>
          {cameras.map((c) => <option key={c.deviceId} value={c.label}>{c.label}</option>)}
        </select>
      )}
      <button type="button" className="icon-btn" aria-label={COPY.closeIphone} onClick={() => void mirror.close()}>✕</button>
    </div>
  );
}

/** The enlarged notch with the iPhone: live mirror (and Hodey's highlights) on the left, guidance on the right. */
export function PhonePanel({ mirror, bus, children }: { mirror: PhoneMirror; bus: Bus; children: ReactNode }) {
  const { status, kind } = usePhoneMirror(mirror);
  const primitives = usePhonePrimitives(bus);
  return (
    <div className="phone-panel">
      <PhoneScreen mirror={mirror} status={status} kind={kind} primitives={primitives} />
      <div className="phone-panel__side">
        <SourceBar mirror={mirror} kind={kind} />
        {children}
      </div>
    </div>
  );
}
```

Keep every component under 40 lines; split one if a later edit grows it.

- [ ] **Step 6: Wire it into the notch**

`src/components/notch/surface.ts`: add

```ts
  /** The iPhone mirror is open (desktop app only). */
  phoneOpen?: boolean;
  /** Shows or hides the iPhone mirror; absent where there is no mirror (the stage). */
  onTogglePhone?: () => void;
```

`src/components/notch/DockMenu.tsx`:
- Add props `phoneOpen?: boolean; onTogglePhone?: () => void`.
- Render this before the footer:

```tsx
      {onTogglePhone && (
        <button type="button" className="btn" onClick={onTogglePhone}>
          {phoneOpen ? COPY.hideIphone : COPY.showIphone}
        </button>
      )}
```

`src/components/notch/Notch.tsx`:
- Add `phone?: PhoneMirror` to `NotchProps` and destructure it.
- Add `const EXPANDED_SIZES: NotchSize[] = ["guidance", "lesson", "success", "phone"];`
- In `Notch`:

```tsx
  const phoneState = usePhoneMirror(phone);
  const phoneHode = state.pack?.surface === "phone" && state.phase !== "idle";
  useEffect(() => {
    // A phone Hode brings the mirror up with the learner's last source.
    if (phone && phoneHode && !phone.isOpen()) void phone.open(loadPhonePrefs().source);
  }, [phone, phoneHode]);
```

- Add to `props`:

```tsx
    phoneOpen: phoneState.open,
    onTogglePhone: phone
      ? () => {
          setMenuOpen(false);
          void (phone.isOpen() ? phone.close() : phone.open(loadPhonePrefs().source));
        }
      : undefined,
```

- Pass `phoneOpen={props.phoneOpen}` and `onTogglePhone={props.onTogglePhone}` to `DockMenu` in `topBody`.
- In `TopNotch`, compute `const size = islandSize(props.view, { settled, hovered, menuOpen, peek, listening, phone: props.phoneOpen === true });`.
- Wrap the body:

```tsx
            <div aria-live="polite">
              {size === "phone" && props.phone ? (
                <PhonePanel mirror={props.phone} bus={props.bus}>{topBody(props, view, size, peek)}</PhonePanel>
              ) : (
                topBody(props, view, size, peek)
              )}
            </div>
```

For this to work, `SurfaceProps` also needs `phone?: PhoneMirror; bus: Bus`. Add both and pass `phone` and `bus` in `props`.
- The `Sidebar` ignores the phone panel. The phone Hode still works there, because perception doesn't depend on the panel; only the mirror view is missing.

`src/components/notch/notch.css`: append

```css
.notch--phone { --notch-width: 580px; }
.phone-panel { display: grid; grid-template-columns: auto 1fr; gap: 12px; padding: 4px 12px 12px; }
.phone-panel__screen { position: relative; height: 500px; aspect-ratio: 9 / 19.5; border-radius: 28px; overflow: hidden; background: #000; }
.phone-panel__canvas, .phone-panel__canvas canvas { width: 100%; height: 100%; display: block; }
.phone-panel__marks { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.phone-mark { fill: none; stroke: var(--accent, #f5a524); stroke-width: 8; }
.phone-mark--broad { stroke-dasharray: 18 12; }
.phone-panel__card { position: absolute; inset: 0; display: grid; place-content: center; gap: 10px; padding: 16px; text-align: center; color: #fff; }
.phone-panel__hint { opacity: 0.7; font-size: 12px; }
.phone-panel__side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.phone-panel__bar { display: flex; align-items: center; gap: 8px; }
```

Before writing new values, read how `notch.css` declares widths and colors, and reuse its existing tokens (accent variable, button classes).

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/components src/features/phone` then `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/notch src/features/phone/prefs.ts src/features/phone/prefs.test.ts src/lib/copy.ts
git commit -m "feat: iPhone mirror panel in the enlarged notch with source picker and on-mirror highlights"
```

---

### Task 12: Wire the notch entry and the phone vision prompt

**Files:**
- Modify: `src/entries/notch.tsx`
- Modify: `src/providers/vision/prompt.ts` (phone system prompt)
- Test: `src/providers/vision/vision.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: the running desktop app.

- [ ] **Step 1: Write the failing prompt test**

Append to `src/providers/vision/vision.test.ts`, reusing the file's existing context and frame fixtures:

```ts
describe("phone prompt", () => {
  it("tells the model it is looking at a mirrored iPhone", () => {
    const context = { ...baseContext, pack: { ...baseContext.pack!, surface: "phone" as const } };
    const [system] = buildMessages(context, [], frame);
    expect(system.content).toContain("iPhone");
    expect(system.content).not.toContain("inside Windows");
  });
});
```

If the fixtures are named differently, adapt the names (`baseContext` and `frame` stand for a `TeachingContext` with a pack, and a `CapturedFrame`). If the file has no pack fixture, build one with `TASK_PACKS[2]`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/providers/vision/vision.test.ts -t "phone prompt"`
Expected: FAIL.

- [ ] **Step 3: Implement the phone prompt**

In `src/providers/vision/prompt.ts`, add after `SYSTEM_PROMPT`:

```ts
/** Same rules, for a live mirror of the learner's iPhone; controls are text read from the screen by OCR. */
const PHONE_SYSTEM_PROMPT = SYSTEM_PROMPT.replace(
  "You are Hodey, a patient teaching companion inside Windows.",
  "You are Hodey, a patient teaching companion. You see a live mirror of the learner's iPhone; they tap their own phone.",
).replace("a numbered list of its on-screen controls", "a numbered list of text read from the phone screen");
```

In `buildMessages`, use `const system = context.pack?.surface === "phone" ? PHONE_SYSTEM_PROMPT : SYSTEM_PROMPT;` and `{ role: "system", content: system + pointing }`.

Add a module-load guard so a future edit to `SYSTEM_PROMPT` can't silently break the replacement:

```ts
if (PHONE_SYSTEM_PROMPT === SYSTEM_PROMPT) throw new Error("PHONE_SYSTEM_PROMPT no longer matches SYSTEM_PROMPT's wording");
```

- [ ] **Step 4: Wire the entry**

`src/entries/notch.tsx`, inside `boot()`, replacing the perception and vision lines:

```tsx
  const native = new NativePerception({ invoke, listen: (event, handler) => subscribeTauri(event, handler) });
  const mirror = new PhoneMirror(new FrameCanvas(), (kind) =>
    kind === "camera" ? new CameraPhoneSource(() => loadPhonePrefs().cameraLabel) : new AirPlayPhoneSource(invoke),
  );
  const phone = new PhonePerception(mirror, (png) => invoke<OcrSegment[]>("ocr_frame", { png }));
  const surfaces = new SurfacePerception({ windows: native, phone });
  const perception = withScreenActivity(surfaces, activity);
  const vision = new TauriVisionStatus();
  const qwen = new QwenVisionProvider({
    connection: () => connectionOf(vision.current()),
    capture: () => activity.track("screen", () => (surfaces.current() === "phone" ? mirror.grabFrame() : invoke<CapturedFrame>("capture_active_window"))),
  });
```

Replace the watching subscription:

```tsx
  // Runs before the transition's effects, so a phone Hode's first focusApp/observe already reach the phone.
  runtime.subscribe(() => {
    const state = runtime.getState();
    surfaces.setSurface(state.pack?.surface ?? "windows");
    surfaces.setWatching(WATCHING_PHASES.includes(state.phase));
  });
```

Pass `phone={mirror}` to `<Notch …/>`. Add the imports and remove any that are now unused.

Check `withScreenActivity`'s type: it must accept a `PerceptionAdapter` and forward `focusApp`. Read it, and if it narrows to `NativePerception`, widen it to `PerceptionAdapter`.

- [ ] **Step 5: Full verification**

Run: `npm test`, then `npm run typecheck`, then `npm run build`, then `cd src-tauri; cargo test --lib`, then `cargo build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/entries/notch.tsx src/providers/vision src/lib/activity.ts
git commit -m "feat: wire iPhone mirror, OCR perception and surface routing into the notch"
```

---

### Task 13: Docs and spec amendments

**Files:**
- Create: `docs/iphone-mirroring.md`
- Modify: `docs/superpowers/specs/2026-10-03-iphone-mirroring-design.md` (deviations)
- Modify: `CLAUDE.md` (commands section: one line about the stage's iPhone tab)

- [ ] **Step 1: Write `docs/iphone-mirroring.md`**

Sections, all with concrete steps:
1. **Why your USB-C cable alone can't do it.** A laptop's USB-C port only sends video out.
2. **Wired, free: iPhoneMirror.**
   - Install Apple Devices or iTunes (Apple Mobile Device Support).
   - Install iPhoneMirror from https://github.com/RayrenSX/iPhoneMirror and follow its libusb filter step.
   - Do **not** use Zadig or WinUSB on the Apple device.
   - Start iPhoneMirror and unlock the iPhone. In Hodey: menu → Show iPhone → Cable / camera, then pick the iPhoneMirror camera.
   - Caveats: preview software, demo-mode status bar.
3. **Wired, most reliable: capture card.** USB-C→HDMI adapter + MS2130 UVC card (about $20). Pick the card in Cable / camera. DRM video apps show black (HDCP).
4. **Wireless: AirPlay with UxPlay.**
   - Install MSYS2, then in the UCRT64 shell run `pacman -S mingw-w64-ucrt-x86_64-uxplay`. If no package exists, build from https://github.com/FDH2/UxPlay with its Windows instructions, including the GStreamer plugins (base, good, bad, libav).
   - Hodeum finds it at `C:\msys64\ucrt64\bin\uxplay.exe` or `runtime\uxplay\uxplay.exe`. It never uses a path from settings.
   - Allow it through Windows Firewall: TCP 7000, 7001, 7100; UDP 6000, 6001, 7011, 5353. Set the network profile to Private.
   - On the iPhone: Control Center → Screen Mirroring → Hodeum.
   - If venue Wi‑Fi blocks discovery: turn on Windows Mobile Hotspot and join it from the iPhone.
5. **Privacy.** Frames stay in memory on this PC. OCR is Windows' built-in engine. Nothing is uploaded or saved.
6. **Rehearse without a phone.** `npm run dev` → iPhone tab.
7. **Troubleshooting.** The panel's error text names the cause; for AirPlay, see `runtime/uxplay.log`.

- [ ] **Step 2: Amend the spec**

Add a short "Amendments (planning)" section that lists the four deviations from this plan's header.

- [ ] **Step 3: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: iPhone mirroring setup (iPhoneMirror, capture card, UxPlay) and spec amendments"
```

---

### Task 14: Live verification

**Files:** none (fix anything that fails in the owning task's files)

- [ ] **Step 1: Stage rehearsal (automated browser)**

Run `npm run dev`. Use Playwright to open the page, click the iPhone tab, start a Hode with "turn on dark mode on my iphone", and click through: Settings, Scroll, Wallpaper (expect a correction), back (Settings), Display & Brightness, Dark.
Expected:
- the notch shows each step, the correction, and "Hode complete";
- highlights are drawn on the practice iPhone;
- the browser console has no errors.

- [ ] **Step 2: Desktop app with a webcam stand-in**

Run `npm run tauri:dev`. Open the menu → Show iPhone → Cable / camera.
Expected:
- the laptop webcam appears portrait-cropped in the notch;
- the notch stays non-focusing and click-through outside the pill;
- closing the panel turns the camera off.

Report what was seen, and say which checks could not be confirmed.

- [ ] **Step 3: OCR smoke test**

In the dev app, hold a phone or a printed page with "Settings" up to the webcam and start the iPhone Hode.
Expected: Hodey highlights the word on the mirror, or the console shows the OCR segments. Record the OCR latency from the console.

- [ ] **Step 4: Hand the user the real-device checklist**

Tell the user exactly what remains to verify with their iPhone:
- iPhoneMirror over their USB-C cable;
- AirPlay via UxPlay, which is not installed on this machine yet;
- highlight alignment on the real Settings app;
- end-to-end latency.
