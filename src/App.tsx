import { useState } from "react";

type NotchState = "idle" | "listening" | "thinking" | "guidance" | "success";

const stateCopy: Record<NotchState, { label: string; detail: string }> = {
  idle: { label: "Hodey", detail: "Ready when you are" },
  listening: { label: "Hodey is listening…", detail: "Tell me what you want to learn" },
  thinking: { label: "Hodey is looking at this screen…", detail: "Finding the next useful step" },
  guidance: { label: "Next step", detail: "Open the Insert tab in Excel" },
  success: { label: "Hode complete", detail: "Skill learned ✓" },
};

export function App() {
  const [state, setState] = useState<NotchState>("idle");
  const [expanded, setExpanded] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const startHode = () => {
    setExpanded(true);
    setState("listening");
    setOverlayVisible(false);
  };

  const lookAtScreen = () => {
    setState("thinking");
    window.setTimeout(() => {
      setState("guidance");
      setOverlayVisible(true);
    }, 700);
  };

  const completeStep = () => {
    setOverlayVisible(false);
    setState("success");
    window.setTimeout(() => setState("idle"), 1800);
  };

  const copy = stateCopy[state];

  return (
    <main className="app-shell">
      <section className={`notch ${expanded ? "notch-expanded" : ""}`} aria-live="polite">
        <div className="notch-topline">
          <div className="brand-mark" aria-hidden="true">✦</div>
          <div className="notch-copy">
            <strong>{copy.label}</strong>
            {expanded && <span>{copy.detail}</span>}
          </div>
          <span className="provider-pill"><i /> Local</span>
          <button className="icon-button" onClick={() => setExpanded((value) => !value)} aria-label="Expand or collapse Hodey">
            {expanded ? "⌃" : "⌄"}
          </button>
        </div>

        {expanded && (
          <div className="lesson-card">
            <div className="lesson-progress"><span style={{ width: state === "success" ? "100%" : "32%" }} /></div>
            <p className="eyebrow">Excel · Teach Mode</p>
            <h1>Make a pivot table</h1>
            <p className="lesson-description">Hodey will guide you while you stay in control.</p>
            <div className="action-row">
              <button className="secondary-button" onClick={() => setState("listening")}>Ask Hodey</button>
              {state === "listening" && <button className="primary-button" onClick={lookAtScreen}>Look at my screen</button>}
              {state === "guidance" && <button className="primary-button" onClick={completeStep}>I did it</button>}
              {state === "success" && <button className="primary-button" onClick={() => setState("idle")}>Done</button>}
            </div>
          </div>
        )}
      </section>

      <section className="welcome-panel">
        <div className="panel-glow" />
        <p className="eyebrow">HODEUM · LOCAL FIRST</p>
        <h2>Start a Hode.<br /><em>Own the skill.</em></h2>
        <p className="hero-copy">A teaching companion that lives on your screen, notices when you are stuck, and helps you learn by doing.</p>
        <button className="primary-button hero-button" onClick={startHode}>Start a Hode <span>→</span></button>
        <div className="principles">
          <span><b>01</b> You stay in control</span>
          <span><b>02</b> Guidance appears in context</span>
          <span><b>03</b> Help fades as you learn</span>
        </div>
      </section>

      {overlayVisible && (
        <button className="demo-overlay" onClick={completeStep} aria-label="Highlighted Insert tab demo target">
          <span className="target-ring" />
          <span className="target-label">Insert</span>
          <span className="target-arrow">↗</span>
        </button>
      )}
    </main>
  );
}
