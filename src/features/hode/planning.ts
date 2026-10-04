import { noop, type EventOf, type HodeState, type Transition } from "./model";

/**
 * An open Teach Hode is planned once, in the background, as soon as its first step is showing, so that
 * step is never kept waiting for the plan.
 */
export function withPlanRequest(t: Transition): Transition {
  const s = t.state;
  if (!s.open || s.mode !== "teach" || s.planId !== undefined || s.phase !== "guiding") return t;
  const planId = s.requestId;
  const app = s.app ? { app: s.app } : {};
  return { state: { ...s, planId }, effects: [...t.effects, { type: "planOpenGoal", planId, goal: s.goal, ...app, language: s.language }] };
}

/** The plan is kept quietly: it shapes each next look at the screen, and the closing recap and check. */
export function onPlanReady(s: HodeState, e: EventOf<"PLAN_READY">): Transition {
  if (!s.open || e.planId !== s.planId || e.goal !== s.goal || s.plan !== undefined) return noop(s);
  return { state: { ...s, plan: e.plan }, effects: [] };
}
