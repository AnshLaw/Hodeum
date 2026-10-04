import { useState } from "react";
import { COPY } from "../../lib/copy";
import type { LearnerAnnotation, Point, Rect, Size } from "../../lib/types";
import { CrosshairIcon, SendIcon } from "../shared/icons";
import { composerPosition } from "./geometry";

/** Used only to keep the composer on-screen; matches the rendered card closely enough. */
const COMPOSER_SIZE: Size = { width: 320, height: 172 };

interface ComposerProps {
  anchor: Rect;
  viewport: Size;
  onSubmit: (intent: LearnerAnnotation["intent"], question?: string) => void;
}

/**
 * Which side of the mark the composer opened on, so it grows out of the mark rather than from nowhere.
 * It opens below unless that's off-screen, when it's pushed up, possibly above the mark.
 */
function sideOf(anchor: Rect, at: Point): "right" | "left" | "below" | "above" {
  if (at.x >= anchor.x + anchor.width) return "right";
  if (at.x + COMPOSER_SIZE.width <= anchor.x) return "left";
  return at.y + COMPOSER_SIZE.height <= anchor.y ? "above" : "below";
}

export function Composer({ anchor, viewport, onSubmit }: ComposerProps) {
  const [question, setQuestion] = useState("");
  const position = composerPosition(anchor, viewport, COMPOSER_SIZE);
  const ask = (text: string) => {
    const trimmed = text.trim();
    if (trimmed !== "") onSubmit("ask", trimmed);
  };

  return (
    <form
      className={`composer composer--${sideOf(anchor, position)}`}
      style={{ left: position.x, top: position.y, width: COMPOSER_SIZE.width }}
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        ask(question);
      }}
    >
      <label className="composer__label" htmlFor="point-ask-question">
        {COPY.askHodey}
      </label>
      <div className="composer__field">
        <input id="point-ask-question" className="field" autoFocus autoComplete="off" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={COPY.composerPlaceholder} />
        <button type="submit" className="composer__send" aria-label={COPY.askHodey} title={COPY.askHodey} disabled={question.trim() === ""}>
          <SendIcon />
        </button>
      </div>
      <div className="composer__chips">
        <button type="button" className="chip" onClick={() => ask(COPY.whatIsThis)}>
          {COPY.whatIsThis}
        </button>
        <button type="button" className="chip" onClick={() => ask(COPY.howDoIUse)}>
          {COPY.howDoIUse}
        </button>
        <button type="button" className="chip chip--focus" onClick={() => onSubmit("focus")}>
          <CrosshairIcon />
          {COPY.focusHere}
        </button>
      </div>
      <p className="composer__hint">{COPY.composerHint}</p>
    </form>
  );
}
