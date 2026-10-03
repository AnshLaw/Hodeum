import { useEffect, useReducer, useState } from "react";
import type { Bus } from "../lib/bus";
import type { BrowserShell } from "../lib/shell";
import type { MouseButton } from "../providers/mock-perception";
import { Notch } from "../components/notch/Notch";
import { GuidanceOverlay } from "../components/overlay/GuidanceOverlay";
import { HodeumMark } from "../components/shared/icons";
import { TASK_PACKS } from "../task-packs";
import { ExcelBackdrop, ExplorerBackdrop } from "./Backdrops";
import { MockAppView } from "./MockAppView";
import type { StageAppId, StageEnvironment } from "./environment";
import { DESKTOP } from "./scenes/layout";
import "./stage.css";

const APP_TABS: { id: StageAppId; label: string }[] = [
  { id: "excel", label: "Excel" },
  { id: "explorer", label: "File Explorer" },
];

/** Mirrors the native Ctrl+Alt+H (Point & Ask) and Ctrl+Alt+N (show/hide) shortcuts in the browser. */
function useStageHotkeys(bus: Bus, shell: BrowserShell): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey) return;
      if (event.code === "KeyH") bus.emit("annotate:start", {});
      else if (event.code === "KeyN") shell.command("toggle-visibility");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
  };
  const press = (elementId: string, button: MouseButton) => {
    app.press(elementId, button);
    env.perception.notifyLearnerAction();
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
          <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>H</kbd> Point &amp; Ask · <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>N</kbd> show/hide · drag via ⋯ menu
        </span>
      </header>
      <main className="stage-desktop" style={{ width: DESKTOP.width, height: DESKTOP.height }}>
        <MockAppView app={app} onPress={press}>
          {appId === "excel" ? <ExcelBackdrop scene={env.apps.excel} /> : <ExplorerBackdrop />}
        </MockAppView>
        <div className="stage-layer stage-layer--overlay">
          <GuidanceOverlay bus={env.bus} shell={env.shell} />
        </div>
        <div className="stage-layer stage-layer--notch">
          <Notch runtime={env.runtime} bus={env.bus} shell={env.shell} packs={TASK_PACKS} />
        </div>
      </main>
    </div>
  );
}
