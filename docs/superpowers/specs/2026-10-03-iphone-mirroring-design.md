# iPhone Mirroring + Mobile Hode — Design

**Date:** 2026-10-03 · **Branch:** `feat/iphone-mirroring` (off `feat/shell-teaching-loop`) · **PRD:** §24 iPhone → Windows Teaching Flow, §25 iPhone Limitation, Demo D

## Goal

The Hodian's iPhone screen appears live inside the enlarged notch, and Hodey teaches a real iPhone task on it: step guidance with a highlight drawn on the mirrored screen, success verification, wrong-action correction and stuck help, all local. Teach Mode holds: the Hodian taps their own phone; Hodey never controls it.

## What the user has / decided

- iPhone with USB-C and a USB-C↔USB-C cable; **no capture card**. A laptop's USB-C port is a DisplayPort source, never a sink, so the cable alone cannot carry video in.
- Build **both** sources: a camera source (wired) and an AirPlay source (wireless).
- Scope is a **full mobile Hode**, not just a viewer.

## Decisions

### Sources

One TS interface, two implementations, both owned by the notch webview (single place for display and frame grabs):

```ts
type PhoneSourceKind = "camera" | "airplay";
type PhoneSourceStatus =
  | { state: "off" }
  | { state: "connecting" }
  | { state: "waiting"; hint: string }        // receiver up, no iPhone yet
  | { state: "live"; width: number; height: number }
  | { state: "error"; message: string };

interface PhoneSource {
  readonly kind: PhoneSourceKind;
  start(target: HTMLCanvasElement): Promise<void>;
  stop(): Promise<void>;
  status(): PhoneSourceStatus;
  onStatus(handler: (s: PhoneSourceStatus) => void): () => void;
  /** Current frame, downscaled to ≤1280 px, PNG base64; rect is in frame pixels (origin 0,0). */
  grabFrame(): Promise<CapturedFrame>;
}
```

- **`CameraPhoneSource`** — `getUserMedia({ video: { deviceId } })` on the device picked in Settings, drawn to the canvas. Works with:
  - **iPhoneMirror** (RayrenSX, GPL-3, separate app) over the user's USB-C cable; it publishes a Windows 11 virtual camera;
  - a UVC capture card later (USB-C→HDMI→MS2130), no code change;
  - any webcam / OBS Virtual Camera for development.
  Rust grants the `Camera` permission silently for the `main_notch` webview only (Tauri `on_permission_request`; upgrade `tauri` if the locked version lacks it); every other permission keeps WebView2's default.
- **`AirPlayPhoneSource`** — Rust `phone/airplay.rs`:
  - spawns `uxplay.exe` (found via setting `airplayReceiverPath`, else `PATH`) with `-n Hodeum -nh -vrtp "config-interval=1 ! udpsink host=127.0.0.1 port=<free port>"` and audio disabled; supervised like `vlm.rs` (status, kill on exit, log to `runtime/uxplay.log`);
  - receives RTP on that port, depacketizes H.264 (RFC 6184: single NAL, STAP-A, FU-A) into Annex-B access units, and streams them to the notch over a `tauri::ipc::Channel` with a keyframe flag;
  - the notch decodes with WebCodecs `VideoDecoder` (`avc1` from the SPS) and draws to the canvas.
  UxPlay is GPL: never bundled, only launched if installed. Missing binary → `error: "AirPlay receiver not installed"` with a link to the setup doc.
- Only one phone source is live at a time. Source kind and camera device are settings (`phoneSource`, `phoneCameraId`, `airplayReceiverPath`).

### Seeing the phone (vision-first, cheapest signal first)

`PhonePerception implements PerceptionAdapter`:

- **`observe()`** — `grabFrame()` → Rust `ocr_frame(png)` using built-in `Windows.Media.Ocr` (windows-rs features `Media_Ocr`, `Graphics_Imaging`, `Storage_Streams`) → each OCR **line** becomes a `UiElement { name: text, role: "text", source: "ocr", bounds: frame px, confidence: 0.9 }`. `app: "iPhone"`, `windowTitle: ""`. Also sets `tone: "dark" | "light"` from mean frame luminance (threshold constant `DARK_TONE_LUMA`).
- **Learner actions** — no input hooks exist for a phone. A `FrameChangeWatcher` samples a 32×64 grayscale thumbnail every `PHONE_SAMPLE_MS` (250); when the mean absolute difference exceeds `CHANGE_THRESHOLD` and the screen then stays stable for `SETTLE_MS` (600), it observes and fires `onLearnerAction`. Runs only while the runtime is watching (`guiding | reasoning`), like native perception.
- **`focusApp("iPhone")`** — resolves `true` only when a source is `live`; otherwise the existing `waitingForApp` state shows **"Connect your iPhone"**.
- **Grounding fallback** — unchanged `LocalReasoningProvider`: task-pack name match on OCR elements first; on `clarify`, Qwen3-VL gets the phone frame (capture routed to `grabFrame()`). The system prompt gains a phone variant ("a mirrored iPhone screen") selected by surface. Box → frame px via the existing `fromImageBox` (frame rect origin is 0,0).
- Frames stay in memory; nothing is written to disk; nothing leaves the machine.

### Surface routing

- `TaskPack` gains `surface?: "windows" | "phone"` (default `"windows"`; schema stays `.strict()` and coordinate-free).
- New `StateSignal` kind `{ kind: "screen_tone"; tone: "dark" | "light" }`, evaluated against `ScreenObservation.tone` (new optional field). `ElementSource` gains `"ocr"`.
- `SurfacePerception` wraps native + phone perception and delegates by the active pack's surface (set on `GOAL_SUBMITTED`, reset on `END_HODE`/success). The Qwen `capture` dependency is routed the same way.
- `overlay:render` / `overlay:clear` gain `surface: "screen" | "phone"`. `GuidanceOverlay` ignores `phone`; the notch phone view draws those primitives (frame px → displayed canvas px by the mirror's scale). Confidence bands are unchanged (≥0.85 precise, ≥0.65 broad, else re-observe/clarify).

### Notch phone view

- New `NotchSize "phone"` (expanded). Layout: live mirror on the left (portrait, height `PHONE_VIEW_HEIGHT` ≈ 500 CSS px, width by aspect), Hodey's instruction, detail and the usual guidance controls on the right. SVG highlight layer over the mirror.
- The notch window grows to `600 × 600` logical px (`NOTCH_WINDOW_HEIGHT`). It stays transparent and click-through outside the hit rect, so other states look and behave as today.
- Entry points: **"Show iPhone"** in the dock menu (toggles the phone view with no Hode), and automatically when a `surface: "phone"` Hode starts. Closing it stops the source.
- States, each visible: `connecting` (spinner + source name), `waiting` ("Open Control Center → Screen Mirroring → Hodeum" for AirPlay; "Start iPhoneMirror and unlock your iPhone" for camera), `live`, `error` (message + Retry + "Setup guide").
- Settings → new "iPhone" panel: source (Camera / AirPlay), camera device picker (`enumerateDevices`), receiver path, status line.

### iPhone task pack — `iphone-dark-mode.json`

`app: "iPhone"`, `surface: "phone"`, goal phrases like "turn on dark mode on my iphone".

| Step | Target (OCR names) | Success | Mistake → correction |
|---|---|---|---|
| Open Settings | `Settings` | `element_visible ["Display & Brightness"]` | — |
| Open Display & Brightness | `Display & Brightness` | `element_visible ["Appearance", "Text Size"]` | `element_visible ["Wallpaper"]` → "That's Wallpaper — go back and pick Display & Brightness." |
| Choose Dark | `Dark` | `screen_tone dark` | `element_visible ["Larger Text"]` → "That opened Text Size — go back; Dark is under Appearance." |

Skill ids: `ios.settings.open`, `ios.settings.display`, `ios.appearance.dark_mode`.

### Rehearsal

The browser practice stage gets a mock iPhone scene (`src/stage/scenes/iphone.ts`, `MockApp` with `surface: "phone"` elements and a tone), so the whole phone Hode can be rehearsed with `npm run dev`, no phone or receiver needed.

## Error handling

- Source failures never end a Hode: status → `error`, the Hode goes to `waitingForApp` ("Connect your iPhone") and resumes on `live`.
- OCR failure → logged, observation with no elements → planner `clarify` → Qwen fallback → existing clarify copy.
- UxPlay exits → status `error` with the last log line; Retry restarts it.
- Camera permission or device missing → `error` naming the device and pointing to Settings → iPhone.

## Testing

- **Vitest:** `FrameChangeWatcher` (change → settle → one event; noise below threshold ignored); OCR result → `UiElement` mapping; `screen_tone` signal; `SurfacePerception` + capture routing; pack schema validity and `matchGoal`; end-to-end phone Hode on mock perception: goal → guide (highlight with `surface: "phone"`) → wrong action (Wallpaper) → correction → steps → `screen_tone dark` → `Hode complete`; source-disconnect → waiting → resume.
- **cargo test:** RTP depacketizer (single NAL, STAP-A, FU-A start/middle/end, loss → drop until next keyframe); OCR line → element bounds mapping; uxplay argument builder.
- **Manual (documented):** camera path with a webcam, then iPhoneMirror; AirPlay with UxPlay on the same Wi-Fi and on the laptop hotspot; highlight alignment on the mirror; latency noted.

## Docs

`docs/iphone-mirroring.md`: why the cable alone can't work; iPhoneMirror setup (Apple Mobile Device Support, libusb filter, do **not** use Zadig/WinUSB); UxPlay + GStreamer install, firewall rule for its ports, Private network profile, laptop Mobile Hotspot fallback; avoiding DRM video apps (HDCP black screen); privacy note.

## Out of scope

- Hodey tapping the phone (Assistive mode) or any iOS-side app.
- Bundling UxPlay or iPhoneMirror; audio mirroring.
- iPhone packs beyond Dark Mode; generalized mobile gestures.
- OmniParser on phone frames.

## Amendments (planning and implementation)

- **No receiver-path setting.** UxPlay runs only from `runtime/uxplay/uxplay.exe`, and Hodeum never searches shared folders such as `C:\msys64` on its own. A learner who links `runtime/uxplay` to MSYS2's `ucrt64\bin` is trusting that folder explicitly. On a shared PC that folder must not be writable by other accounts; the setup doc says how to check.
- **AirPlay sender check.** Video is accepted only from a loopback socket whose address and port belong to the spawned UxPlay process (OS UDP owner table), and that is re-checked every second. Unfinished access units are capped at 4 MiB.
- **Source and camera choice live in the notch's phone panel** and are stored per machine in the notch webview's `localStorage`, not in synced settings. Camera labels are only readable where the camera permission is held.
- **One `Surface = "windows" | "phone"`** covers packs and `overlay:render`. `overlay:clear` clears both.
- **Phone-only flow tweaks:**
  - A screen change that is neither success nor a known mistake re-locates the target without counting as a wrong action, and an identical instruction isn't spoken twice. Hesitation is still caught by the stuck timer.
  - A missing target uses phone copy ("Scroll a little…").
- **Corrections without a visible target** (the learner left the page) are spoken as corrections, never downgraded to "clarify". This applies to both surfaces.
