# Shell + Teaching Loop Implementation Plan

**Spec:** `docs/superpowers/specs/2026-10-03-shell-teaching-loop-design.md` · **Execution:** native, TDD for logic, one commit per task.

## Global constraints
- Local-only; no cloud keys needed. Copy strings from `CLAUDE.md`. No coordinates in task packs.
- Functions < 40 lines, named constants, no silent catches (log + visible state).
- Notch window is fixed-size and click-through outside the pill (Rust cursor hit-test) instead of per-state window resizing — removes resize jank entirely.

## Tasks
1. Tooling (vitest, zod, @types/node) + `lib/types.ts`, `lib/coords.ts` (+tests)
2. `lib/bus.ts` LocalBus (+tests), `lib/tauri-bus.ts`
3. Task packs: schema, `excel-pivot.json`, `windows-zip.json`, goal matching (+tests)
4. `features/hode/signals.ts`, `policy.ts` (+tests)
5. Providers: interfaces, TaskPack reasoner, fallback router, MemorySkillStore (+tests)
6. Hode reducer: model, flow, learner, session handlers (+tests)
7. Mock perception + practice scenes (Excel, Explorer) (+tests)
8. Runtime + end-to-end integration tests (correction, reduced help, fallback, stuck, mute, Point & Ask)
9. Notch UI: view model (+tests), components, CSS, native shell boundary, Windows speech TTS
10. Overlay + Point & Ask: geometry (+tests), guidance layer, annotate layer, composer
11. Practice stage (`index.html`), delete prototype
12. Tauri: notch/overlay windows, WS_EX_NOACTIVATE, hit-test thread, commands, Ctrl+Alt+H, SQLite skills (+Rust tests)
13. Docs + verification (typecheck, test, build, cargo test)

## Review focus
- Learner acts while reasoning is in flight → stale result dropped, latest action wins (reducer test).
- Whitespace-only goal → ignored (reducer test).
- Point & Ask while paused → ignored (reducer test).
- Same skill on consecutive steps → write completes before next read (runtime test asserts reduced level).
- Muted voice → nothing spoken (runtime test).
