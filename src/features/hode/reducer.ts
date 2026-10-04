import { onGoalSubmitted, onStartHode, onThinking } from "./flow";
import { onActionReadyActing, onHodeyActed, onPerformFailed } from "./execute";
import { onPracticeAgain, onReviewAnswered } from "./closing";
import { onExplainRequested, onHintRequested, onLearnerActed, onLetMeTry, onObservedStep, onLookAgain, onRepeat, onSaidStuck, onSkillLoadedStep, onSkipStep, onStuckTimeout } from "./learner";
import type { EventOf, HodeEvent, HodeState, Transition } from "./model";
import {
  onAnnotateCancel,
  onAnnotateStart,
  onAnnotationSubmitted,
  onVoiceQuestion,
  onSetMode,
  onSetAgentStyle,
  onSetLanguage,
  onShowAllSteps,
  onDismiss,
  onSpeechFinished,
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
  SKILL_LOADED: onSkillLoadedStep,
  OBSERVED: onObservedStep,
  ACTION_READY: onActionReadyActing,
  THINKING: onThinking,
  HODEY_ACTED: onHodeyActed,
  PERFORM_FAILED: onPerformFailed,
  LEARNER_ACTED: onLearnerActed,
  STUCK_TIMEOUT: onStuckTimeout,
  SAID_STUCK: onSaidStuck,
  HINT_REQUESTED: onHintRequested,
  EXPLAIN_REQUESTED: onExplainRequested,
  REPEAT: onRepeat,
  LOOK_AGAIN: onLookAgain,
  LET_ME_TRY: onLetMeTry,
  SKIP_STEP: onSkipStep,
  REVIEW_ANSWERED: onReviewAnswered,
  PRACTICE_AGAIN: onPracticeAgain,
  ANNOTATE_START: onAnnotateStart,
  ANNOTATE_CANCEL: onAnnotateCancel,
  ANNOTATION_SUBMITTED: onAnnotationSubmitted,
  VOICE_QUESTION: onVoiceQuestion,
  SET_MODE: onSetMode,
  SET_AGENT_STYLE: onSetAgentStyle,
  SET_LANGUAGE: onSetLanguage,
  SHOW_ALL_STEPS: onShowAllSteps,
  DISMISS: onDismiss,
  SPEECH_FINISHED: onSpeechFinished,
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
