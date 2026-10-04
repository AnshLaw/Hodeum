import type { HodeMode } from "./types";

/** How each mode is named and explained everywhere it can be picked. In every mode, the learner does the clicking. */
export const MODE_COPY: Record<HodeMode, { title: string; detail: string }> = {
  teach: { title: "Teach", detail: "Learn it for good: Hodey asks, you find it, more help only if you're stuck." },
  help: { title: "Help", detail: "You drive. Hodey watches and steps in when you're stuck or ask." },
  agent: { title: "Agent", detail: "Hodey walks you through every step. You still do the clicking." },
};
