import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { COPY } from "../../lib/copy";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import { AGENT_STYLE_COPY, MODE_COPY } from "../../lib/modes";
import { AGENT_STYLES, HODE_MODES, type AgentStyle, type HodeMode, type TaskPack } from "../../lib/types";
import { CloseIcon, IconButton } from "../shared/icons";

interface GoalFormProps {
  packs: TaskPack[];
  shell: NativeShell;
  notice?: string;
  defaultMode: HodeMode;
  defaultAgentStyle: AgentStyle;
  onSubmit: (goal: string, mode: HodeMode, agentStyle: AgentStyle) => void;
  onClose: () => void;
}

/** Teach · Help · Agent, with a line saying what the picked one means. */
function ModePicker({ mode, onChange }: { mode: HodeMode; onChange: (mode: HodeMode) => void }) {
  return (
    <div className="goal__modes">
      <div className="segmented" role="radiogroup" aria-label={COPY.modeLabel}>
        {HODE_MODES.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={mode === option} className="segmented__option" onClick={() => onChange(option)}>
            {MODE_COPY[option].title}
          </button>
        ))}
      </div>
      <p className="goal__mode-detail">{MODE_COPY[mode].detail}</p>
    </div>
  );
}

/** Agent mode only: guide every step, or let Hodey do them and stop at checkpoints. */
function AgentStylePicker({ style, onChange }: { style: AgentStyle; onChange: (style: AgentStyle) => void }) {
  return (
    <div className="goal__modes">
      <div className="segmented" role="radiogroup" aria-label={COPY.agentStyleLabel}>
        {AGENT_STYLES.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={style === option} className="segmented__option" onClick={() => onChange(option)}>
            {AGENT_STYLE_COPY[option].title}
          </button>
        ))}
      </div>
      <p className="goal__mode-detail">{AGENT_STYLE_COPY[style].detail}</p>
    </div>
  );
}

export function GoalForm({ packs, shell, notice, defaultMode, defaultAgentStyle, onSubmit: submit, onClose }: GoalFormProps) {
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState(defaultMode);
  const [agentStyle, setAgentStyle] = useState(defaultAgentStyle);
  const onSubmit = (text: string, picked: HodeMode) => submit(text, picked, agentStyle);
  const inputRef = useRef<HTMLInputElement>(null);

  // The notch normally never takes focus; it may only while the learner is typing a goal.
  useEffect(() => {
    shell
      .setNotchActivatable(true)
      .then(() => inputRef.current?.focus())
      .catch(reportError("Couldn't focus the goal field"));
    return () => {
      shell.setNotchActivatable(false).catch(reportError("Couldn't release notch focus"));
    };
  }, [shell]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };

  return (
    <form
      className="notch__content goal"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(goal, mode);
      }}
    >
      <div className="goal__head">
        <p className="notch__title">{COPY.startHode}</p>
        <IconButton label={COPY.cancel} onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
      <label className="goal__label" htmlFor="hode-goal">
        {COPY.goalPrompt}
      </label>
      <div className="goal__field">
        <input id="hode-goal" ref={inputRef} className="field" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={COPY.goalPlaceholder} autoComplete="off" />
        <button type="submit" className="btn btn--primary" disabled={goal.trim() === ""}>
          {COPY.begin}
        </button>
      </div>
      <ModePicker mode={mode} onChange={setMode} />
      {mode === "agent" && <AgentStylePicker style={agentStyle} onChange={setAgentStyle} />}
      <div className="goal__suggestions">
        {packs.map((pack) => (
          <button key={pack.id} type="button" className="chip" onClick={() => onSubmit(pack.title, mode)}>
            {pack.title}
          </button>
        ))}
      </div>
      {notice && <p className="notch__detail notch__detail--warn">{notice}</p>}
    </form>
  );
}
