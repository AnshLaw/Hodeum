# Learning modes: Teach, Help, Agent

Date: 2026-10-03. Each Hode runs in one mode. The default comes from Settings; you can pick another when starting a Hode, or switch mid-Hode from the ⋯ menu or by voice. In every mode the learner does the clicking. Hodey never acts for them; "Agent" means Hodey walks them through every step.

| | Teach (default) | Help | Agent |
| --- | --- | --- | --- |
| Promise | You learn it | You drive, Hodey stands by | Hodey walks you through every step |
| Each step starts | As a challenge: a question/nudge, no highlight ("Which tab would you use to add something new?") | Silent: Hodey watches | Explicit instruction + highlight (spotlight + arrow for a brand-new skill) |
| More help | Stuck timer or "Need a hint?" escalates: instruction + highlight → full demonstration with the why | Only when stuck or asked: hint → instruction + highlight → demonstration | Already at full guidance |
| Practised skills | Start quieter (watch / on your own) | Same | Never quieter than guidance |
| Step list | Only finished steps and the current one; "Show all steps" reveals the rest | Hidden | All shown |
| Mistakes | Corrected, with the why | Corrected | Corrected |

## Mechanics (assistance ladder: demonstrate → guide → hint → observe → independent)

- **`startLevel(mode, record)`:**
  - Teach: the quieter of `hint` and the skill's saved level (a new skill starts at `hint`).
  - Help: the quieter of `observe` and the saved level.
  - Agent: the more-helpful of `guide` and the saved level (a new skill starts at `demonstrate`).
- **Escalation** works as today. Agent mode never relaxes below `guide`.
- **`SET_MODE`** changes the mode mid-Hode. The current step's level is clamped to the new mode's rule, then Hodey re-reasons, so the guidance updates right away.
- **`SHOW_ALL_STEPS`** toggles the full step list in Teach mode. Voice: "show all steps" / "show me the whole thing".
- **Voice:** "teach mode", "help mode", "agent mode" and "guide me through every step" switch modes.
- **Settings:** "Default mode" replaces the Beginner / Guided / Confident presets, which overlapped with the modes. Old saved settings fall back to Teach.
- **Help-mode notch:** "I'm here if you get stuck", with Need a hint?, Point & Ask, Pause and End. The step itself isn't spelled out.
