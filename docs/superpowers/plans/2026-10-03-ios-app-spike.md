# iPhone App — Phase 1: Capture Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (the user chose native/inline execution for this project). Steps use checkbox (`- [ ]`) syntax.

**Goal:** One sideloadable test app that proves, on the user's iPhone (iOS 27, free Apple ID), the four risky pieces:
1. seeing other apps' screens;
2. reading them with on-device OCR;
3. a floating Picture-in-Picture window that draws Hodey's ring on a zoomed crop;
4. speaking while backgrounded.

**Architecture:** XcodeGen project under `ios/`.
- **`HodeyCore`:** a SwiftPM package of pure, unit-tested logic (geometry, name matching, Vision-box conversion). `swift test` runs it on the macOS host.
- **`Hodeum` app:** iOS 27 ScreenCaptureKit, PiP, Vision and AVSpeech.
- **`HodeumBroadcast`:** a ReplayKit broadcast extension used as the capture fallback.
- **Build:** GitHub Actions on the `xcode-27` runner builds two unsigned `.ipa`s, with and without the ScreenCaptureKit entitlement, because free-team signing of that entitlement is unknown. The user installs with Sideloadly.

**Spec:** `docs/superpowers/specs/2026-10-03-ios-app-design.md`, including the **Amendments** section that adds this spike phase.

## Global Constraints

- iOS deployment target 27.0. Swift 5 language mode (`SWIFT_VERSION: 5.10`) keeps concurrency checks from blocking a no-Mac compile loop.
- No compile is possible locally (Windows). Every Swift change is verified by the GitHub Actions run on `feat/ios-app` (`gh run watch` / `gh run view --log-failed`).
- Frames, text and audio never leave the phone or get written to disk.
- No paid-account capabilities: no push, no iCloud, no App Groups needed for the spike (ReplayKit signals the app with Darwin notifications).
- Named constants; functions under 40 lines; visible error states (an on-screen diagnostics log); no silent catches.
- Commits are conventional, with the Co-Authored-By trailer. Pushing `feat/ios-app` to `origin` was approved by the user.

## Review Focus

1. **Static screens produce no ScreenCaptureKit frames.** Keep the last frame; the diagnostics must not report "stopped".
2. **Vision boxes are normalized with a bottom-left origin.** A wrong flip puts the ring on the mirrored row. Covered by a `HodeyCore` test.
3. **The target sits near a screen edge.** The crop must stay inside the frame and keep the PiP aspect. Covered by a `HodeyCore` test.
4. **PiP's first start fails (`-1003`).** Retry once and log it.
5. **Signing strips the entitlement.** The second `.ipa` without it must still install, and ReplayKit must still count frames.

---

### Task 1: HodeyCore package (TDD on macOS host)

**Files:** `ios/HodeyCore/Package.swift`, `Sources/HodeyCore/{GuideGeometry,NameMatcher,VisionBox}.swift`, `Tests/HodeyCoreTests/*.swift`

**Produces:**
- `NameMatcher.matches(pattern:name:)`: same semantics as `src/features/hode/signals.ts` `nameMatches` (case-insensitive, `*` wildcard).
- `VisionBox.toPixels(normalized:imageSize:) -> CGRect`: top-left origin.
- `GuideGeometry.focusCrop(target:frame:aspect:padding:) -> CGRect`: clamped to the frame, with the given width/height aspect.
- `GuideGeometry.map(_:from:to:) -> CGRect`: frame rect to output rect.

- [ ] Write tests: wildcard/case cases from the TS tests; a Vision flip example; crop at the centre, at the corners, and with a target bigger than the crop.
- [ ] `swift test` must fail first (in CI), then implement and see it green.

### Task 2: Xcode project + CI producing two IPAs

**Files:** `ios/project.yml`, `ios/Hodeum/Hodeum.entitlements`, `.github/workflows/ios.yml`, plus minimal app sources so it builds.

- [ ] The workflow runs on pushes to `feat/ios-app` touching `ios/**` or the workflow, and on manual dispatch.
- [ ] Workflow steps: `swift test` (HodeyCore), `xcodegen generate`, an unsigned `xcodebuild`, then package two IPAs:
  - `Hodeum-sck.ipa`: ad-hoc signed with entitlements;
  - `Hodeum-basic.ipa`: no ScreenCaptureKit entitlement.
- [ ] The build is green on GitHub.

### Task 3: Capture (ScreenCaptureKit + ReplayKit fallback) with a diagnostics screen

- [ ] `ScreenFeed`: picker → `SCStream`; keeps the latest complete frame; counts frames in total and while in the background; reports stop errors by name.
- [ ] `HodeumBroadcast` `SampleHandler`: throttled Darwin notification for each video frame; `BroadcastCounter` in the app counts them.
- [ ] `ContentView`: buttons (Start screen capture, ReplayKit picker, Start PiP, Speak test, Read screen now), live counters, a timestamped event log.

### Task 4: PiP ring + OCR + voice loop

- [ ] `TextReader`: `VNRecognizeTextRequest` on the latest frame → `[(text, pixelRect)]` via `VisionBox`.
- [ ] `GuideRenderer`: frame + optional target → BGRA buffer (zoomed crop via `GuideGeometry`, ring and label; full screen with the banner "Hodey is watching" when there's no target).
- [ ] `PiPGuide`: sample-buffer PiP; starts automatically from inline; retries once on first-start failure.
- [ ] `SpikeLoop`: every 0.5 s, render PiP from the latest frame. Every 1.5 s, when the frame changed, run OCR and look for "Settings". The first time it's seen while backgrounded, say "I can see Settings."

### Task 5: Sideload guide

- [ ] `docs/ios-sideload.md`, covering:
  - Sideloadly install, using the web (non-Microsoft Store) iTunes and iCloud;
  - Developer Mode;
  - trusting the Apple ID;
  - installing the `sck` IPA first and the `basic` one if the install fails;
  - the spike checklist (what to try and what to report back).
