# Sub-project 2 — Native Perception + Notch Docking & Visibility

**Date:** 2026-10-03 · **Branch:** `feat/shell-teaching-loop` (continues) · **Builds on:** `2026-10-03-shell-teaching-loop-design.md`

## 1. Goals

1. The desktop app runs real Hodes in real Excel and File Explorer: UI Automation for structure, a low-level input hook for learner actions, in-memory active-window capture ready for the local VLM (SP3).
2. The notch can live at the **top** (notch) or the **left/right** edge (sidebar), be dragged between them, and be **pinned**, **auto-hidden**, or **hidden**.
3. A real logo, used for the notch glyph, app icon, and tray icon.

## 2. Decisions (approved)

- Side dock = **Windows app bar** (`SHAppBarMessage`) that reserves screen width **only while a Hode is active**; idle side dock is a floating slim tab.
- Default visibility = **auto-hide**. Persisted with dock in `localStorage` of the notch webview plus mirrored to Rust on boot.
- Logo: three SVG directions (Notch-eye, H-path, Cursor+guide) shown for a pick; the winner replaces `HodeyGlyph` and `assets/hodey-icon.svg`.

## 3. Native perception (Rust, `src-tauri/src/perception/`)

| Module | Responsibility |
|---|---|
| `uia.rs` | `snapshot(region?) -> Observation`: foreground window (excluding Hodeum's own windows, falling back to the last external foreground window), UIA control-view walk from the window root. Prunes `DataGrid`/`Table`/`DataItem`/`Document` subtrees, skips offscreen elements, caps at `MAX_ELEMENTS = 1500` and `MAX_DEPTH = 40`. Per element: name, localized control type → role, bounding rect (physical px), `selected` from SelectionItem.IsSelected or Toggle.On. Runs on a dedicated COM (MTA) thread. |
| `input_hook.rs` | `WH_MOUSE_LL` + `WH_KEYBOARD_LL` on a message-loop thread. Clicks (down) and Enter/Tab/Esc/Space keys start a `SETTLE_MS = 350` debounce; then emits `perception:learner-action`. Ignores input over Hodeum's own windows. No key contents are recorded. |
| `capture.rs` | `capture_active_window()` → PNG bytes in memory, longest side ≤ 1280 px (`xcap`). Never written to disk. Exposed as a command for SP3. |

Commands: `observe(region?: Rect) -> ScreenObservation` (same JSON shape as `src/lib/types.ts`), `capture_active_window() -> base64 PNG`.

Front end: `NativePerception implements PerceptionAdapter` — `observe` invokes `observe`; `onLearnerAction` listens for `perception:learner-action` then calls `observe()`. Replaces `UnavailablePerception` in `entries/notch.tsx`. Observation errors surface through the existing `PROVIDER_FAILED` → recovering path.

Role names: UIA localized control types lowercased (`tab item`, `button`, `check box`, `menu item`, `list item`, `list`, `pane`, `window`) — the vocabulary task packs already use.

## 4. Docking & visibility

**State** (`src/features/dock/`): `dock: "top" | "left" | "right"`, `visibility: "pinned" | "auto" | "hidden"`, `revealed: boolean` (auto-hide currently showing). Pure `dockLayout(dock, monitor, hodeActive)` returns window rect + whether to reserve an app bar; unit-tested.

**Window geometry** (logical px):
- top: 600×340 at top-centre (as today).
- left/right: `SIDEBAR_WIDTH = 360` × monitor work-area height, flush to that edge.

**Rust commands:** `set_dock(dock, hodeActive)` → reposition notch window, register/unregister app bar (`ABM_NEW`/`ABM_SETPOS`/`ABM_REMOVE`) when a side dock has an active Hode; `set_notch_visible(visible)`. `begin_notch_drag()` → `start_dragging()`; Rust watches `WindowEvent::Moved` and, `DRAG_SETTLE_MS = 180` after the last move, picks the nearest edge from the cursor (left third / right third / otherwise top) and emits `dock:changed`.

**Auto-hide:** the pill slides off its edge leaving a 4 px sliver (`HIDE_SLIVER_PX`); the hit-test treats the sliver (and a 12 px edge band) as hover → reveal. It auto-reveals when the Hode needs the learner (guiding/answering/success/recovering after a phase change) and re-hides `AUTO_HIDE_DELAY_MS = 2500` after the cursor leaves, only when idle.

**Hidden:** notch window hidden; overlay keeps working; `Ctrl+Alt+N` and the tray toggle it.

**Tray:** Show/Hide, Dock ▸ Top/Left/Right, Visibility ▸ Pinned/Auto-hide, Quit.

**UI:** a `⋯` menu in the notch bar (Dock, Visibility, Hide). Sidebar layout (`Sidebar.tsx`) renders the same `NotchView` vertically plus the full step list from the pack and learned skills. The grip (bar area) starts a drag.

## 5. Testing

Vitest: `dockLayout`, edge-snapping, auto-hide reveal rules, `NativePerception` with a fake invoke/listen, step-list view model. Rust: role mapping, snap-edge choice, app-bar rect maths, pruning rules (pure functions). Manual: real Excel PivotTable Hode in the native app, drag to each edge, app bar resizes a maximized window, Ctrl+Alt+N, tray.

## 6. Risks

- UIA latency on big Excel trees → pruning + cap; measure and log `snapshot_ms`.
- Low-level hooks must return fast → hook only timestamps and signals; work happens on another thread.
- App bars misbehave if not removed → unregister on Hode end, dock change, and app exit.
