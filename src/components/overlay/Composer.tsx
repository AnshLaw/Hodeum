import { useState } from "react";
import { COPY } from "../../lib/copy";
import type { LearnerAnnotation, Rect, Size } from "../../lib/types";
import { composerPosition } from "./geometry";

/** Used only to keep the composer on-screen; matches the rendered card closely enough. */
const COMPOSER_SIZE: Size = { width: 320, height: 136 };

interface ComposerProps {
  anchor: Rect;
  viewport: Size;
  onSubmit: (intent: LearnerAnnotation["intent"], question?: string) => void;
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
      className="composer"
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
      <input id="point-ask-question" className="field" autoFocus autoComplete="off" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={COPY.composerPlaceholder} />
      <div className="composer__chips">
        <button type="button" className="chip" onClick={() => ask(COPY.whatIsThis)}>
          {COPY.whatIsThis}
        </button>
        <button type="button" className="chip" onClick={() => ask(COPY.howDoIUse)}>
          {COPY.howDoIUse}
        </button>
        <button type="button" className="chip chip--focus" onClick={() => onSubmit("focus")}>
          {COPY.focusHere}
        </button>
      </div>
      <p className="composer__hint">{COPY.composerHint}</p>
    </form>
  );
}
