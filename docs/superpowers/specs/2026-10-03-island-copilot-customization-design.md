# Dynamic island, copilot sidebar, and customization

Date: 2026-10-03. Follows `2026-10-03-notch-and-desktop-app-design.md`.

## 1. Dynamic island (top dock)

The notch changes shape to match what Hodey is doing, like the iPhone Dynamic Island:

| Situation | Shape |
| --- | --- |
| Idle | Pill flush with the top edge (196 px; 304 px on hover) |
| Looking / thinking (`observing`, `reasoning`) | **Orb**: a 44 px circle, 6 px below the edge, showing only Hodey's face in its current mood with an accent ring sweeping around it |
| Guidance, answer, error, success | Card, which springs out of the orb |
| Paused, annotating, peek | Compact bar |

- **New size `orb`.** `notchView` returns it for `observing` and `reasoning`. The title stays as the accessible label. Hovering the orb opens the compact bar with the title and Pause.
- **No flicker.** The notch only becomes an orb once Hodey has been busy for 180 ms (`useSettled`). It leaves the orb as soon as the reply is ready.
- **Motion.**
  - Width, height, border radius and top offset transition together.
  - Opening uses a spring easing that overshoots slightly; closing uses a plain ease-in.
  - Content fades in after the shape settles.
  - With reduced motion there's no overshoot or sweep, just a short cross-fade.
- **Sidebar.** It stays a panel; there is no orb in a sidebar. While busy, the panel shows a large Hodey with the status line.

## 2. Copilot sidebar

New dock preference: `sidebar: "copilot" | "floating"`. It is stored with `dock` and `visibility` in the notch's local preferences.

- **Copilot (default).**
  - A side dock is a real panel: full height, flush to the edge, square corners.
  - Windows reserves its width (app bar).
  - Normal windows that overlap the panel's strip are moved or resized into the remaining work area; maximized windows already reflow.
  - When the panel releases its space, the windows Hodeum moved go back, unless the learner has moved them since.
  - When the panel reserves space:
    - pinned: always, and the idle panel stays open with *Start a Hode*;
    - auto-hide: only while a Hode is active;
    - hidden: never.
- **Floating.** The panel floats over windows, as before, and never reserves space or moves windows.
- **Rust.** `set_dock` gains `arrange: bool`. After the app bar is granted, `nudge_windows` moves overlapping windows on that monitor and records their original rects; `release` restores them. Window filtering reuses the Alt+Tab rule from `chat_context`.

## 3. Customization (Settings)

New `appearance` and voice fields in `Settings` (SQLite, synced later with the rest):

- **Voice:**
  - `voice.name`: a Windows voice (`speechSynthesis` voices with `localService === true` only; online "Natural" voices would send text to the cloud, so they're not offered);
  - Preview button;
  - an empty name means the system default.
- **Theme:**
  - `appearance.theme`: `system | dark | light` for the app window. The notch stays black: it's a cutout.
  - `appearance.accent`: `amber | mint | sky | rose | violet`. It sets `--hd-accent*` in every window: guidance highlights, buttons, scan line, orb ring.
- **Hodey:**
  - `appearance.hodeyColor`: `amber | mint | sky | coral | violet | snow`;
  - `appearance.hodeyAccessory`: `none | glasses | headphones | beanie`. It's drawn inside the face group, so it follows every mood's motion.
  - A live preview cycles through moods.
- **Hodey on screen:** position (Top / Left / Right), sidebar style (Copilot / Floating), and visibility (Auto-hide / Always show).
  - These live in the notch's dock preferences.
  - The app reads them from a `dock:prefs` broadcast and changes them with `dock:change`.

`applyAppearance(root, appearance)` sets the CSS variables and `data-theme`. The notch, overlay and app each load settings at boot and on `settings:changed`.

## Testing

- `notchView` orb mapping;
- `useSettled` timing (pure helper);
- dock rules for copilot vs floating;
- settings parsing with the new fields (old rows fall back field by field);
- appearance variables;
- voice filtering;
- Rust: the nudge geometry (fit a rect into the work area) and the restore rule.
