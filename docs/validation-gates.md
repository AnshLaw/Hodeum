# Validation gates

The ten gates from `CLAUDE.md` that must pass before the core demo counts as complete. Automated tests cover the logic. Most gates also need a live run on the demo laptop (Windows 11, RTX 3060). Record each live result in the table at the end.

Before any live run:

```powershell
scripts/setup-local-ai.ps1   # models: vision (~3 GB) and voice (~950 MB)
npm install
npm run tauri:dev
```

Turn every cloud provider off in Settings → Cloud, so the run proves the local path. The notch badge must read **● Local**.

## 1. The notch resizes smoothly and never steals focus

**Automated:** `src/components/notch/footprint.test.ts` and `notch-view.test.ts` cover the size logic. Nothing automated covers focus.

**Live:**
1. Open Excel and click into cell A1.
2. Start a Hode by voice (hold Right Ctrl: "teach me how to make a pivot table").
3. While the notch goes from pill to orb to card, type `123`.
4. **Pass:** `123` lands in A1, the caret never leaves Excel, and no resize frame visibly jumps. Note the effective frame rate from a screen recording, if you can.

## 2. Overlay alignment error is under 10 px

**Automated:** `src/lib/coords.test.ts`, `src/components/overlay/geometry.test.ts`, and the Rust hit-test tests check the coordinate maths only.

**Live:** do this at 100 % and at 150 % display scale, and on the second monitor if there is one.
1. Run the PivotTable Hode until it highlights **Insert**, then **PivotTable**, then the field list checkboxes.
2. Screenshot each highlight (Win+Shift+S), and measure the gap between the highlight edge and the control's edge in Paint.
3. **Pass:** every gap is under 10 px.

## 3. A screenshot is reasoned about without running out of GPU memory

**Automated:** none.

**Live:**
1. With Excel open, use Point & Ask on the ribbon and ask "what does this do?".
2. Run `nvidia-smi -l 1` in a terminal at the same time.
3. **Pass:** you get an answer, there's no OOM in the llama-server log, and peak VRAM stays under 12 GB. Record the peak and the time to the answer.

## 4. Local speech recognition handles a short English command

**Automated:** the routing is covered (`src/features/voice/route.test.ts`). Recognition itself isn't.

**Live:**
1. Hold Right Ctrl and say "give me a hint" during a Hode.
2. **Pass:** the notch shows the words as they're heard, and a hint follows. Repeat with Nemotron's model folder renamed: the second engine must take over, and the status must name it.

## 5. Local voice starts and stops on interruption

**Automated:** `src/providers/speech/native-voice.test.ts` covers stop and barge-in.

**Live:**
1. During a long explanation (say "explain"), start talking.
2. **Pass:** Hodey goes quiet within about 300 ms and the new utterance is handled.

## 6. Spoken goal → target guidance → learner action → verified success

**Automated:** `src/features/hode/runtime.test.ts` covers this against the scripted apps in `src/test-support/scenes/`.

**Live, on real Excel:**
1. Open the sample sales workbook and click inside the table.
2. Say the goal, then follow every step yourself.
3. **Pass:** each step highlights the right control, success is detected without pressing "I did it", and the Hode ends with *Hode complete* and *Skill learned ✓*.

## 7. A deliberate wrong action gets corrected

**Automated:** `src/features/hode/runtime.test.ts` and `reducer.test.ts`.

**Live:**
1. In the PivotTable Hode, open **Data** instead of **Insert**.
2. **Pass:** Hodey names the mistake and moves the highlight to Insert.

## 8. A repeated skill gets less help

**Automated:** `src/features/hode/runtime.test.ts` ("gives less help on a repeated skill in the next Hode").

**Live:**
1. Complete the PivotTable Hode twice in a row.
2. **Pass:** the second run starts at a lower assistance level (fewer highlights, shorter speech), and Learning paths shows higher mastery.

## 9. The complete flow works with cloud disabled

**Live:**
1. Turn on airplane mode.
2. Run gates 6 and 7.
3. **Pass:** both pass, and the badge reads **● Local** throughout.

## 10. A cloud outage returns to the local path without ending the Hode

**Automated:** `src/features/hode/runtime.test.ts` (a failing provider) and `src/providers/cloud/policy.test.ts` (cooldown).

**Live:**
1. Save a Gemini key and turn on cloud reasoning; the badge should read **☁ Cloud**.
2. Start the PivotTable Hode, then disconnect Wi-Fi after the first step.
3. **Pass:** the next step still arrives, with at most a single delay of about the request timeout, and the Hode completes. Repeat the same check with ElevenLabs voice: Hodey keeps speaking in the local voice.

## Also check: the notch and overlay stay above every app

**Automated:** the Rust tests in `src-tauri/src/topmost/` check the z-order against real (invisible, off-screen) windows, and which monitor the overlay picks.

**Live:**
1. In Edge or Chrome, pop a video out with **Picture in picture** (an always-on-top window), drag it over the notch and click it.
2. Watch a video full screen in the browser, then start a PowerPoint slide show.
3. With a Hode showing a highlight, drag the app to the second monitor (if there is one).
4. **Pass:** the notch comes back above the picture-in-picture video, the full-screen video and the slide show within about 1.5 s (at once when they take focus), typing still goes to the app, and a notch hidden with the Hodey key + H stays hidden. On the second monitor the highlight is drawn there, lined up with its control (if that monitor has another scale, the app resizes, so the highlight comes back on Hodey's next look). `hodeum.log` shows `keeping the notch and overlay above other windows` once at startup and no `SetWindowPos couldn't put` warnings.

Don't test with Task Manager's **Always on top**: Windows can place it in a z-band above every app, like Start, Search, the touch keyboard and Magnifier, so it may stay over the notch. Exclusive-fullscreen games are out of scope.

## Results

| Gate | Date | Machine | Result | Measurement / notes |
|------|------|---------|--------|---------------------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |
