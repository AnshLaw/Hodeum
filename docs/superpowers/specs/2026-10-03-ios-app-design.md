# Hodeum iPhone App (on-device Dark Mode Hode) — Design

**Date:** 2026-10-03 · **Branch:** `feat/ios-app` (off `feat/iphone-mirroring`) · **Related:** `2026-10-03-iphone-mirroring-design.md`

## Goal

A sideloaded iPhone app that teaches the "Turn on Dark Mode" Hode **on the iPhone itself**, while the learner taps through the real Settings app. Hodey watches the screen, shows where to tap, speaks the step, checks it, corrects mistakes, and finishes when the screen is dark. Everything runs on the phone; nothing is uploaded.

## Constraints (decided)

- **Device:** the user's iPhone, on iOS 27.
- **No Mac and no paid account:**
  - Built by GitHub Actions (macOS runner) on pushes to `feat/ios-app` in the public repo `AnshLaw/Hodeum`, producing an unsigned `.ipa` artifact.
  - The user signs and installs it with **Sideloadly** and a **free Apple ID**. The signature expires after 7 days.
  - No TestFlight. Free-account capability limits apply.
- **iOS cannot draw over other apps** (confirmed; no public API, including in iOS 27). "Annotation" means a floating Picture-in-Picture window showing a zoomed crop of the current screen with Hodey's ring on the target, plus the Dynamic Island and speech.
- **Teach Mode:** the learner taps; Hodey never acts for them. Copy follows CLAUDE.md vocabulary.

## Experience

1. In the app, the learner taps **Start a Hode — Turn on Dark Mode**, then **Start watching** (iOS screen-capture picker → full screen).
2. The learner goes to the Home Screen; the app keeps running in the background:
   - **PiP window:** a zoomed crop around the target with a ring and its label ("Settings"). If the target isn't visible, it shows the whole screen and "Scroll a little…".
   - **Dynamic Island / Live Activity:** "Step n of 3 · Tap Settings", and "Hode complete ✓" at the end.
   - **Speech:** each new instruction is spoken once (AVSpeechSynthesizer).
3. Each time the screen changes and settles, the frame is read again:
   - the step's success signal holds → next step;
   - a known mistake appears → correction (spoken, and shown in the island);
   - neither → re-locate the target, without repeating the speech.
4. Success on "Choose Dark" means the screen is dark **and** "Appearance" is visible, so a lock screen never counts.

## Architecture (Swift, `ios/`)

| Unit | Responsibility |
|---|---|
| `ScreenWatcher` | ScreenCaptureKit full-display stream (iOS 27) → latest `CVPixelBuffer`; status `off / starting / live / stopped(reason)` |
| `TextReader` | Vision text recognition on a frame → `[ScreenText(text, rect)]` in frame pixels |
| `ChangeDetector` | 32×64 grayscale thumbnail; fires once when the screen changed and then held still (port of the TS detector) |
| `ToneMeter` | Mean luma → `dark` / `light` (same threshold, 80) |
| `TaskPack` + `Signals` | Decode the bundled `iphone-dark-mode.json` (the same file as `src/task-packs`); name matching with `*` and case-insensitivity; `element_visible` and `screen_tone` (+ names) |
| `HodeEngine` | Pure state machine: step index, `observe(Observation) -> Guidance` (target, speech, correction, done). Unit-tested with fixtures. |
| `GuideRenderer` | Frame + target → zoomed crop with ring and label → `CMSampleBuffer` |
| `PipPresenter` | `AVPictureInPictureController` with a sample-buffer layer; starts automatically when the app goes to the background |
| `IslandPresenter` | ActivityKit Live Activity (start, update, end) |
| `HodeyVoice` | AVSpeechSynthesizer; the audio session is shared with PiP |
| `HodeumWidgets` (extension) | Live Activity UI: lock screen + Dynamic Island compact/expanded |

The data path is: watcher frame → change detector → (settled) text reader + tone → `Observation` → engine → `Guidance` → PiP renderer, island and voice.

## Error handling

- **Capture denied or stopped:** the island and app say "Screen watching stopped — open Hodeum to restart"; the engine keeps its step.
- **No text read / target missing:** the guidance has no ring, and the island and speech say "Scroll a little and I'll look again."
- **PiP unavailable:** the island and voice still guide; the app shows why.
- **Live Activity disabled by the user:** PiP and voice still guide.

## Testing

- Engine, signals, change detector, tone and crop/ring math are pure Swift. **XCTest runs on the GitHub macOS runner** on every push, alongside the build.
- The device check is done by the user, following a written checklist.

## Out of scope

Voice conversation, Point & Ask on the phone, other packs, laptop companion mode, TestFlight and App Store, iOS < 27 (ReplayKit fallback only if iOS 27 capture proves unreliable).

## Amendments (after API research, approved by the user)

- **Phase 1 is a capture spike.** iOS 27 ScreenCaptureKit needs the `com.apple.developer.screen-recording` entitlement, and nothing confirms a free Apple ID (via Sideloadly) can sign it. The first installable build therefore tests the following before the Dark Mode engine is built on top:
  - capture through ScreenCaptureKit, plus the ReplayKit broadcast extension as a fallback;
  - on-device OCR;
  - PiP with a drawn ring;
  - speech in the background.
- **CI ships two IPAs:** `Hodeum-sck.ipa` (with the entitlement) and `Hodeum-basic.ipa` (without it). If the first won't install, the second still tests ReplayKit capture, PiP and voice.
- **Build:** GitHub's `xcode-27` runner image (iOS 27 SDK). Pure logic lives in a SwiftPM package, `HodeyCore`, tested with `swift test` on the macOS host, because ScreenCaptureKit doesn't build for the Simulator.
- **Known iOS behaviour handled:**
  - ScreenCaptureKit sends no frames while the screen is static, so the app keeps the last frame.
  - PiP can only start from the foreground, or automatically as the app is backgrounded; its first start may fail, so the app retries.
