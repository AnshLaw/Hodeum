# Perception + Docking Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-03-perception-and-docking-design.md` · **Execution:** native, TDD for pure logic, one commit per task.

## Global constraints
- Local only; screenshots in memory only; no key contents recorded.
- Hooks return immediately; UIA on its own COM thread.
- Functions < 40 lines, named constants, explicit errors surfaced to the notch.

## Tasks (status as of 2026-10-03)
1. ✅ Logo: three SVG directions → comparison page → user pick → glyph, app icon, tray icon.
2. ✅ Rust perception: `uia.rs` (+ pure role/prune tests), `input_hook.rs`, `capture.rs`, `observe` / `capture_active_window` commands.
3. 🟡 `NativePerception` adapter (+tests) wired into the notch entry; real-Excel label check of `excel-pivot.json` / `windows-zip.json`.
4. ✅ Dock model: `dockLayout`, snap, auto-hide rules (+tests); persistence.
5. 🟡 Rust docking: `set_dock`, app bar, drag + snap, `set_notch_visible`, Ctrl+Alt+N, tray menu.
6. ✅ UI: `⋯` menu, sidebar layout with step list, auto-hide slide/sliver, drag grip.
7. 🟡 Docs + verification (typecheck, vitest, build, cargo test, live native checks).

## Review focus
- Foreground is a Hodeum window → observe the last external window, never ourselves.
- Excel with a large sheet → pruned walk stays under ~300 ms (logged).
- Drag released mid-screen → snaps to top, never leaves the notch floating.
- App bar left registered after quit/crash → removed on exit; re-registration idempotent.
- Hidden notch during a Hode → overlay guidance continues; Ctrl+Alt+N restores.

## Added during build
- Hodey's animated face with 13 state-driven moods (user request).
- Overlay follows the target app's monitor; focus returns to the app after the goal field or Point & Ask.
- The top notch collapses to a slim bar when the highlighted control sits beneath its card.

## Open
- Live checks: real Excel and Explorer labels against the task packs; native drag-to-snap, app-bar reservation, and tray.
