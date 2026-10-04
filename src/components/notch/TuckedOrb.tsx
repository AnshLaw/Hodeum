import type { ActivityState } from "../../lib/activity";
import { COPY } from "../../lib/copy";
import { HodeyFace } from "../hodey/HodeyFace";
import type { HodeyMood } from "../hodey/mood";
import { PrivacyDots, privacyLabels } from "./NotchParts";

/** Hodey's face in the tucked orb, in CSS px: a touch smaller than in the busy orb, as the orb itself is. */
const TUCKED_FACE_SIZE = 36;

export interface TuckedOrbProps {
  /** Asleep with no Hode, resting over a paused one. */
  mood: HodeyMood;
  activity: ActivityState;
  /** A Hode is paused, rather than Hodey waiting for one. */
  paused: boolean;
  /** Brings the notch out as hovering does, for a click that comes with no hover (touch, a screen reader). */
  onReveal: () => void;
}

/**
 * Auto-hide's resting state: Hodey in a small circle at the dock edge, with the privacy dots on it, so the learner
 * always knows Hodeum is running and what it's using. Hovering or clicking it brings the notch back.
 */
export function TuckedOrb({ mood, activity, paused, onReveal }: TuckedOrbProps) {
  const label = [paused ? COPY.tuckedOrbPaused : COPY.tuckedOrb, ...privacyLabels(activity)].join(". ");
  return (
    <button type="button" className="notch__orb notch__orb--tucked" aria-label={label} onClick={onReveal}>
      <HodeyFace mood={mood} size={TUCKED_FACE_SIZE} />
      {/* The label already says what the dots mean. */}
      <span className="notch__orb-dots" aria-hidden="true">
        <PrivacyDots activity={activity} />
      </span>
    </button>
  );
}
