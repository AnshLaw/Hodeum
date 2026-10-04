import { useEffect, useReducer, useState } from "react";
import { center } from "../lib/coords";
import { StageKeys, hodeyKeySetting } from "../lib/keys";
import type { Bus } from "../lib/bus";
import type { BrowserShell } from "../lib/shell";
import type { Surface } from "../lib/types";
import type { MouseButton } from "../providers/mock-perception";
import { Notch } from "../components/notch/Notch";
import { GuidanceOverlay } from "../components/overlay/GuidanceOverlay";
import { HodeumMark } from "../components/shared/icons";
import { TASK_PACKS } from "../task-packs";
import { ExcelBackdrop, ExplorerBackdrop, IphoneBackdrop } from "./Backdrops";
import { MockAppView } from "./MockAppView";
import { STAGE_OPEN_APP_EVENT, StageAppWindow } from "./StageAppWindow";
import type { StageAppId, StageEnvironment } from "./environment";
import { DESKTOP } from "./scenes/layout";
import { PHONE_FRAME } from "./scenes/iphone";
import "./stage.css";

const APP_TABS: { id: StageAppId; label: string }[] = [
  { id: "excel", label: "Excel" },
  { id: "explorer", label: "File Explorer" },
  { id: "iphone", label: "iPhone" },
];
/** The stage's iPhone lives on the page, so phone highlights draw on the page overlay here. */
const STAGE_SURFACES: Surface[] = ["windows", "phone"];

function backdropFor(appId: StageAppId, env: StageEnvironment) {
  if (appId === "excel") return <ExcelBackdrop scene={env.apps.excel} />;
  if (appId === "iphone") return <IphoneBackdrop scene={env.apps.iphone} />;
  return <ExplorerBackdrop />;
}

/** Mirrors the native Hodey key in the browser: Hodey key + P, H or A (no hold-to-talk: no voice here). */
function useStageHotkeys(bus: Bus, shell: BrowserShell): void {
  useEffect(() => {
    const keys = new StageKeys(() => hodeyKeySetting.get());
    const onKey = (event: KeyboardEvent) => {
      const command = keys.handle(event);
      if (!command) return;
      event.preventDefault();
      if (command === "point") bus.emit("annotate:start", {});
      else if (command === "show-hide") shell.command("toggle-visibility");
      else window.dispatchEvent(new Event(STAGE_OPEN_APP_EVENT));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [bus, shell]);
}

/** Browser-only harness: a pretend desktop where the real notch, overlay, and runtime drive scripted apps. */
export function Stage({ env }: { env: StageEnvironment }) {
  const [appId, setAppId] = useState<StageAppId>("excel");
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const app = env.apps[appId];
  useStageHotkeys(env.bus, env.shell);

  const select = (id: StageAppId) => {
    env.select(id);
    setAppId(id);
    // Switching apps is a learner action: a Hode waiting for this app picks up.
    env.perception.notifyLearnerAction();
  };
  const press = (elementId: string, button: MouseButton) => {
    const pressed = app.snapshot().elements.find((e) => e.id === elementId);
    app.press(elementId, button);
    env.perception.notifyLearnerAction(pressed ? [{ kind: "click", at: center(pressed.bounds), button }] : []);
    rerender();
  };
  const reset = () => {
    env.runtime.dispatch({ type: "END_HODE" });
    app.reset();
    rerender();
  };

  return (
    <div className="stage">
      <header className="stage-bar">
        <strong className="stage-brand">
          <HodeumMark size={20} />
          Hodeum practice stage
        </strong>
        <nav className="stage-tabs" aria-label="Practice app">
          {APP_TABS.map((tab) => (
            <button key={tab.id} type="button" aria-pressed={tab.id === appId} onClick={() => select(tab.id)}>
              {tab.label}
            </button>
          ))}
        </nav>
        <button type="button" className="stage-reset" onClick={reset}>
          Reset
        </button>
        <span className="stage-hint">
          <kbd>Right Ctrl</kbd> + <kbd>P</kbd> Point &amp; Ask · <kbd>H</kbd> show/hide · <kbd>A</kbd> app
        </span>
      </header>
      <main className="stage-desktop" style={{ width: DESKTOP.width, height: DESKTOP.height }}>
        <MockAppView app={app} onPress={press} frame={appId === "iphone" ? PHONE_FRAME : undefined}>
          {backdropFor(appId, env)}
        </MockAppView>
        <div className="stage-layer stage-layer--overlay">
          <GuidanceOverlay bus={env.bus} shell={env.shell} surfaces={STAGE_SURFACES} />
        </div>
        <StageAppWindow env={env} />
        <div className="stage-layer stage-layer--notch">
          <Notch runtime={env.runtime} bus={env.bus} shell={env.shell} packs={TASK_PACKS} activity={env.activity} speech={env.speech} />
        </div>
      </main>
    </div>
  );
}
