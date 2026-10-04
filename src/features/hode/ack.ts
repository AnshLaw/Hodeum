import { spoken } from "../../lib/spoken";
import { currentStep, type HodeState } from "./model";

/** Hodey only watched this step (escalating moves the level, so a step that needed help never counts). */
export const watchedOnly = (s: HodeState): boolean => s.level === "observe" || s.level === "independent";

/**
 * A short "that's right" for a step just done: always in Teach (a remembered step gets its own line),
 * in Help only when Hodey stepped in on it, and a lighter one in Agent. Never the same phrase twice running.
 */
export function acknowledgement(s: HodeState): string | undefined {
  if (s.mode === "help" && !s.escalated) return undefined;
  const words = spoken(s.language);
  const unaided = s.mode === "teach" && !s.escalated && watchedOnly(s);
  // A skill picked up earlier in this Hode isn't remembered from before: the learner has the hang of it now.
  const skill = currentStep(s)?.skill;
  const own = skill !== undefined && s.learnedSkills.includes(skill) ? words.gotTheHang : words.rememberedOnYourOwn;
  if (unaided && s.lastAck !== own) return own;
  const pool = (s.mode === "agent" ? words.stepDoneLight : words.stepDone).filter((line) => line !== s.lastAck);
  return pool[s.stepIndex % pool.length];
}
