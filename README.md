# Hodeum

Hodeum is a Windows-first, local-first AI learning companion that sees the learner's current software, understands their actions, and teaches them through voice, visual annotations, and adaptive step-by-step assistance.

## Current bootstrap

The repository now contains a runnable React/Vite notch prototype and the Tauri 2 desktop shell. The prototype demonstrates the core interaction shape:

`Start a Hode -> listen -> inspect the screen -> guide -> learner acts -> verify -> complete`

The UI is intentionally deterministic while native Windows adapters and local model services are added behind stable interfaces.

## Run locally

Requirements:

- Node.js 20+
- Rust stable and Windows build tools for the Tauri desktop build

```powershell
npm install
npm run dev
```

Open `http://localhost:1420` for the browser prototype. To run the Tauri shell:

```powershell
npm run tauri:dev
```

The local demo does not require cloud API keys. Copy `.env.example` to `.env.local` only when explicitly enabling sponsor providers.

See [`CLAUDE.md`](./CLAUDE.md) for implementation priorities, architecture boundaries, reliability gates, and hackathon execution rules.
