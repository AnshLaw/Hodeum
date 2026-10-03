# Sub-project 3 — Local Vision (Qwen3-VL) + Plan

**Date:** 2026-10-03 · **Branch:** `feat/shell-teaching-loop` · **PRD:** §10 Layer 3, §15, §21, §36–37

## Goal

Hodey understands the screen locally when UI Automation alone isn't enough, and Point & Ask gives real answers about what you marked, with no cloud involved. The deterministic task-pack planner stays first; the vision model is only consulted when it adds something.

## Decisions

- **Runtime:** llama.cpp `llama-server` (CUDA 12.4 build) on `127.0.0.1:8737`, model `Qwen3VL-4B-Instruct-Q4_K_M` + `mmproj-…-F16`, all layers on the RTX 3060, 8k context. Fetched by `scripts/setup-local-ai.ps1` into git-ignored `models/` and `runtime/`.
- **Sidecar:** Rust starts and supervises it (`vlm.rs`): status `missing | starting | ready | failed`, up to 3 restarts with backoff, killed on exit, log to `runtime/llama-server.log`. Status is pushed as `vlm:status` and shown in the notch's ⋯ menu.
- **Grounding through UIA first:** the model receives the screenshot plus a numbered list of on-screen UIA controls and answers with `target_index`. Only when no listed control fits may it return a `bbox` (0–1000 relative to the capture), which is mapped to screen pixels and capped at confidence 0.8 so it draws a broad highlight, never a precise arrow (PRD §37).
- **When the model is consulted** (`LocalReasoningProvider`):
  1. task-pack step whose target UIA can't find (`clarify`) → vision grounding;
  2. Point & Ask questions → vision answer about the marked region (falls back to the pack's answer);
  3. otherwise the task-pack result is used as is (fast, deterministic).
  Any vision failure (timeout 20 s, invalid JSON, server down) falls back to the task-pack result, so a Hode never dies because of the model.
- **Output contract:** JSON schema enforced by llama-server's `response_format` and validated again with zod: `{ kind: "guide"|"answer"|"clarify", speech, target_index, bbox?, confidence, skill }`. Speech is at most two short sentences and never claims Hodey did the work.
- **Privacy:** screenshots go only to the local server, in memory, downscaled to 1280 px. Nothing is written to disk.

## Out of scope here

- OmniParser detector (Python sidecar): next slice once the VLM path is measured.
- Open-ended goals without a task pack (needs model-judged verification): next slice.

## Tasks

1. Rust: capture returns the window rect alongside the PNG; `vlm.rs` sidecar supervisor + `vlm_status` command + `vlm:status` events.
2. TS: `QwenVisionProvider` (prompt, candidate selection, schema, bbox mapping, timeout) with fake-fetch tests.
3. TS: `LocalReasoningProvider` composition with tests; wire into the notch entry; vision status in the ⋯ menu.
4. Live: model loads without OOM; one Excel screenshot reasoned (Gate 3); latency logged; Point & Ask answer on real Excel.
5. Docs.
