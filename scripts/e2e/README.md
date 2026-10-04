# Real-app test harness

Scripts that start, drive, screenshot and stop the **real** desktop Hodeum on this PC, with no voice and no browser stage. Everything is PowerShell 5.1 (physical pixels, Per-Monitor-V2 DPI aware) plus two dependency-free Node scripts (Node 22: global `fetch` and `WebSocket`).

Run them from the repo root (`$E` below is `scripts\e2e`). Each script finds the repo from its own folder.

| Script | What it does |
|---|---|
| `start-hodeum.ps1` | Starts Hodeum (`npm run tauri:dev`, or `-Standalone` for the `npm run app` exe), optionally with the WebView2 DevTools port (`-CdpPort 9229`), then waits until ready. `-Restart` stops it first. |
| `wait-ready.ps1` | Prints one JSON status (right exe, notch rendered, Vite, vision model `/health`, CDP pages). Exit 0 = ready. |
| `stop-hodeum.ps1` | Quits gracefully over CDP (`__hodeumDebug.quit()` / `debug_quit`), then forces whatever is left (this repo's processes only). `-DryRun` lists them. |
| `cdp.mjs` | Talks to the notch, overlay and app pages over CDP: start/say/state/events/end a Hode, read the last overlay, call any command, stream the console. |
| `screenshot.ps1` | Screenshot of every monitor, a region or one window, in physical px. Prints the origin so image px map back to screen px. |
| `uia-tree.ps1` / `uia-find.ps1` | Read-only UI Automation dump of a window, or the rects of named elements as JSON (the ground truth). |
| `compare.mjs` | Gate 2 check: is each overlay highlight on the UIA element (precise: every edge within 10 px; broad: contains it)? |
| `mark.ps1` | Draws rects onto a screenshot for eyeballing. |
| `hodeum-windows.ps1` / `hover-dump.ps1` | Hodeum's windows and monitors; the expanded notch's UIA tree (hovers the pill, never clicks). |
| `e2e-zip.ps1` | Gate 6 end to end on the windows-zip pack: goal, highlight, real right-click and menu clicks, verification, `.zip` created. `-NoHodeum` only drives Explorer. |
| `drive-test.ps1` / `test-target.ps1` | Proves SendInput clicks and Unicode typing land exactly, on a throwaway window. |
| `HodeumNative.ps1` | Dot-sourced helper (DPI, monitors, windows, BitBlt capture, SendInput). Compiles `HodeumNative.dll` next to itself on first use (git-ignored). |

Run artifacts go to `scripts\e2e\runs\<stamp>\` (git-ignored). Screenshots show the learner's screen: delete them when done.

## Runbook

```powershell
$E = 'scripts\e2e'

# 0. What is running? (Close an installed Hodeum from its tray first: single instance means a new launch
#    would only show the copy already running.)
powershell -NoProfile -ExecutionPolicy Bypass -File $E\stop-hodeum.ps1 -DryRun

# 1. Start the real app with CDP on 9229 and wait until ready (the first Rust build takes minutes).
npm run e2e:start                      # = start-hodeum.ps1 -CdpPort 9229 (tauri dev)
#    or: npm run app; then start-hodeum.ps1 -Standalone -CdpPort 9229   (no Vite, current frontend embedded)
npm run e2e:ready                      # readiness only

# 2. Drive a Hode through the DEV-only hook (window.__hodeumDebug in the notch).
$env:CDP_PORT = 9229
node $E\cdp.mjs build                  # which build answered (git sha, dirty flag, build time)
node $E\cdp.mjs arm                    # overlay page records every overlay:render
node $E\cdp.mjs start "zip files"      # or: start "make a pivot table" teach
node $E\cdp.mjs state                  # phase, step, chosen target, last observation
node $E\cdp.mjs say "I'm stuck"        # what the learner says, as if spoken
node $E\cdp.mjs events 20              # recent transitions (loops show up here)
node $E\cdp.mjs console notch.html 20  # console errors and exceptions for 20 s
node $E\cdp.mjs invoke observe '{}'    # what Hodeum's UIA perception sees now

# 3. Screenshot and ground truth.
powershell -NoProfile -ExecutionPolicy Bypass -File $E\screenshot.ps1 -Out $E\runs\shot.png
powershell -NoProfile -ExecutionPolicy Bypass -File $E\uia-find.ps1 -Window '^Settings$' -Name '^Accent color$' > $E\runs\uia.json

# 4. Compare the highlight with UIA, and mark it for a human.
node $E\cdp.mjs overlay > $E\runs\overlay.json
node $E\compare.mjs $E\runs\overlay.json $E\runs\uia.json 10
powershell -NoProfile -ExecutionPolicy Bypass -File $E\mark.ps1 -In $E\runs\shot.png -OriginX -1600 -OriginY 0 -Out $E\runs\marked.png -Rects '[{"x":32,"y":606,"width":560,"height":72,"color":"Lime"}]'

# 5. The full Gate 6 demo.
npm run e2e:zip

# 6. Stop (graceful quit, then forced fallback).
node $E\cdp.mjs end
npm run e2e:stop
```

## Logs

- App log: `%LOCALAPPDATA%\com.hodeum.app\logs\hodeum.log` (5 MB, one previous file kept). Rust logs and every `reportError` from the web side land here; the first line of each run names the build (`Hodeum debug <sha>[-dirty] <UTC time> starting`).
- Launcher output from `start-hodeum.ps1`: `launch-<stamp>.out.log` / `.err.log` in the same folder.
- Vision model: `runtime\llama-server.log` (recreated on each start).

## Notes and gotchas

- CDP only works on debug builds: release builds clear `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` at startup. The port binds to loopback.
- Hodeum ignores injected (SendInput) clicks and keys, so its own Do-it presses never count as the learner's. `start-hodeum.ps1` sets `HODEUM_E2E_INPUT=1`, which makes a debug build count the harness's input as the learner's; release builds ignore it. Starting the app another way, set it yourself or say "I did it" after each scripted action.
- `cdp.mjs start`/`end` fall back to the `hode:start`/`hode:end` bus events when `__hodeumDebug` is missing; `state`, `say`, `events` need the hook.
- The notch's DOM appears in UIA only after a second query (Chromium enables accessibility lazily) and only while the pill is hovered.
- Explorer often ignores the first right-click after its window opens, and Win11 menus take up to ~1.8 s to appear and animate ~35 px while settling; `e2e-zip.ps1` retries and waits for two equal rect reads.
- Edit `.ps1` files with an editor, not a bash heredoc (backslashes get collapsed). Keep the UTF-8 BOM: PowerShell 5.1 needs it for non-ASCII text. Use `Add-Content -Encoding UTF8`.
- Never drive the user's own windows: the scripts open and close their own (Explorer on a temp folder, a WinForms target).
