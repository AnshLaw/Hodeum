import type { AgentStyle, HodeMode } from "./types";

/** How each mode is named and explained everywhere it can be picked. */
export const MODE_COPY: Record<HodeMode, { title: string; detail: string }> = {
  teach: { title: "Teach", detail: "Learn it for good: Hodey asks, you find it, more help only if you're stuck." },
  help: { title: "Help", detail: "You drive. Hodey watches and steps in when you're stuck or ask." },
  agent: { title: "Agent", detail: "Hodey takes every step with you: it guides you through them, or does them while you check its work." },
};

/** Agent mode's two styles. Only "Do it for me" ever clicks for the learner. */
export const AGENT_STYLE_COPY: Record<AgentStyle, { title: string; detail: string }> = {
  guide: { title: "Guide me", detail: "Hodey walks you through every step. You do the clicking." },
  execute: { title: "Do it for me", detail: "Hodey does the clicking and stops at checkpoints so you can check its work. Say \"let me try\" to take over anytime." },
};
