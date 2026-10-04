import { onActionReady, onGoalSubmitted, onObserved, onSkillLoaded, onStartHode } from "./flow";
import { onExplainRequested, onHintRequested, onLearnerActed, onLetMeTry, onLookAgain, onRepeat, onStuckTimeout } from "./learner";
import type { EventOf, HodeEvent, HodeState, Transition } from "./model";
import {
  onAnnotateCancel,
  onAnnotateStart,
  onAnnotationSubmitted,
  onVoiceQuestion,
  onSetMode,
  onShowAllSteps,
  onDismiss,
  onEndHode,
  onPause,
  onProviderFailed,
  onResume,
  onRetry,
} from "./session";

type Handlers = { [T in HodeEvent["type"]]: (s: HodeState, e: EventOf<T>) => Transition };

const handlers: Handlers = {
  START_HODE: onStartHode,
  GOAL_SUBMITTED: onGoalSubmitted,
  SKILL_LOADED: onSkillLoaded,
  OBSERVED: onObserved,
  ACTION_READY: onActionReady,
  LEARNER_ACTED: onLearnerActed,
  STUCK_TIMEOUT: onStuckTimeout,
  HINT_REQUESTED: onHintRequested,
  EXPLAIN_REQUESTED: onExplainRequested,
  REPEAT: onRepeat,
  LOOK_AGAIN: onLookAgain,
  LET_ME_TRY: onLetMeTry,
  ANNOTATE_START: onAnnotateStart,
  ANNOTATE_CANCEL: onAnnotateCancel,
  ANNOTATION_SUBMITTED: onAnnotationSubmitted,
  VOICE_QUESTION: onVoiceQuestion,
  SET_MODE: onSetMode,
  SHOW_ALL_STEPS: onShowAllSteps,
  DISMISS: onDismiss,
  PAUSE: onPause,
  RESUME: onResume,
  END_HODE: onEndHode,
  RETRY: onRetry,
  PROVIDER_FAILED: onProviderFailed,
};

/** Pure Hode state machine: no I/O, only a next state plus effects for the runtime to execute. */
export function step(state: HodeState, event: HodeEvent): Transition {
  const handler = handlers[event.type] as (s: HodeState, e: HodeEvent) => Transition;
  return handler(state, event);
}
