import { useEffect, useState } from "react";
import { COPY } from "../../lib/copy";
import { HODEY_KEY_LABELS, KEY_LETTERS, hodeyKeySetting } from "../../lib/keys";
import { AGENT_STYLE_COPY, MODE_COPY } from "../../lib/modes";
import { AGENT_STYLES, HODE_MODES, type AgentStyle, type HodeMode } from "../../lib/types";
import { applyCommand, type Dock, type DockPrefs, type SidebarStyle, type Visibility } from "../../features/dock/dock";
import type { VisionStatus } from "../../providers/vision/types";
import type { SurfaceProps } from "./surface";

const DOCK_OPTIONS: [Dock, string][] = [
  ["top", COPY.dockTop],
  ["left", COPY.dockLeft],
  ["right", COPY.dockRight],
];
const SIDEBAR_OPTIONS: [SidebarStyle, string][] = [
  ["copilot", COPY.sidebarCopilot],
  ["floating", COPY.sidebarFloating],
];
const IDLE_OPTIONS: [Exclude<Visibility, "hidden">, string][] = [
  ["pinned", COPY.alwaysShow],
  ["auto", COPY.autoHide],
];

function Segmented<T extends string>({ label, options, value, onSelect }: { label: string; options: [T, string][]; value: T; onSelect: (value: T) => void }) {
  return (
    <div className="dock-menu__group">
      <p className="dock-menu__label">{label}</p>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map(([key, text]) => (
          <button key={key} type="button" role="radio" aria-checked={value === key} className="segmented__option" onClick={() => onSelect(key)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function visionLine(status: VisionStatus): { text: string; tone: "ok" | "busy" | "warn" } {
  switch (status.state) {
    case "ready":
      return { text: COPY.visionReady, tone: "ok" };
    case "starting":
      return { text: COPY.visionStarting, tone: "busy" };
    case "missing":
      return { text: COPY.visionMissing, tone: "warn" };
    case "failed":
      return { text: `${COPY.visionFailed}: ${status.detail}`, tone: "warn" };
  }
}

function VisionLine({ status }: { status: VisionStatus }) {
  const { text, tone } = visionLine(status);
  return (
    <p className="dock-menu__vision" data-tone={tone}>
      {text}
    </p>
  );
}

interface DockMenuProps {
  prefs: DockPrefs;
  /** The running Hode's mode; absent when no Hode is running. */
  mode?: HodeMode;
  onModeChange: (mode: HodeMode) => void;
  agentStyle?: AgentStyle;
  onAgentStyleChange: (style: AgentStyle) => void;
  /** Absent in the browser stage, which has no local model. */
  vision?: VisionStatus;
  onChange: (change: Partial<DockPrefs>) => void;
  onHide: () => void;
  phoneOpen?: boolean;
  /** Absent where there is no iPhone mirror. */
  onTogglePhone?: () => void;
  /** Opens "Your skills"; absent where no skill store is readable. */
  onShowSkills?: () => void;
}

/** Where Hodey lives and how it behaves when idle. Rendered inside the notch so hit-testing stays exact. */
function useHodeyKeyLabel(): string {
  const [key, setKey] = useState(hodeyKeySetting.get());
  useEffect(() => hodeyKeySetting.subscribe(setKey), []);
  return HODEY_KEY_LABELS[key];
}

const MODE_OPTIONS: [HodeMode, string][] = HODE_MODES.map((mode) => [mode, MODE_COPY[mode].title]);
const AGENT_STYLE_OPTIONS: [AgentStyle, string][] = AGENT_STYLES.map((style) => [style, AGENT_STYLE_COPY[style].title]);

export function DockMenu({ prefs, vision, mode, onModeChange, agentStyle, onAgentStyleChange, onChange, onHide, phoneOpen, onTogglePhone, onShowSkills }: DockMenuProps) {
  const keyLabel = useHodeyKeyLabel();
  const idle = prefs.visibility === "hidden" ? "pinned" : prefs.visibility;
  return (
    <div className="notch__content dock-menu">
      {mode && <Segmented label={COPY.modeLabel} options={MODE_OPTIONS} value={mode} onSelect={onModeChange} />}
      {mode === "agent" && agentStyle && <Segmented label={COPY.agentStyleLabel} options={AGENT_STYLE_OPTIONS} value={agentStyle} onSelect={onAgentStyleChange} />}
      <Segmented label={COPY.position} options={DOCK_OPTIONS} value={prefs.dock} onSelect={(dock) => onChange({ dock })} />
      {prefs.dock !== "top" && (
        <>
          <Segmented label={COPY.sidebarStyle} options={SIDEBAR_OPTIONS} value={prefs.sidebar} onSelect={(sidebar) => onChange({ sidebar })} />
          {prefs.sidebar === "copilot" && <p className="dock-menu__hint">{COPY.sidebarCopilotTip}</p>}
        </>
      )}
      <Segmented label={COPY.whenIdle} options={IDLE_OPTIONS} value={idle} onSelect={(visibility) => onChange({ visibility })} />
      {onShowSkills && (
        <button type="button" className="btn" onClick={onShowSkills}>
          {COPY.yourSkills}
        </button>
      )}
      {onTogglePhone && (
        <button type="button" className="btn" onClick={onTogglePhone}>
          {phoneOpen ? COPY.hideIphone : COPY.showIphone}
        </button>
      )}
      <div className="dock-menu__footer">
        <button type="button" className="btn btn--neutral" onClick={onHide}>
          {COPY.hideHodey}
        </button>
        <span className="dock-menu__hint">
          <kbd>{keyLabel}</kbd> <kbd>{KEY_LETTERS["show-hide"]}</kbd> {COPY.bringsBack}
        </span>
      </div>
      <p className="dock-menu__hint">{COPY.dragTip}</p>
      {vision && <VisionLine status={vision} />}
    </div>
  );
}

/** The menu as both surfaces show it. "Your skills" closes the menu and opens the skill graph. */
export function SurfaceMenu(props: SurfaceProps) {
  const { dock, skills } = props;
  const showSkills = skills
    ? () => {
        props.onToggleMenu();
        skills.setOpen(true);
      }
    : undefined;
  return (
    <DockMenu
      prefs={dock.prefs}
      vision={props.vision}
      mode={props.hodeActive ? props.hodeMode : undefined}
      onModeChange={props.onSetMode}
      agentStyle={props.hodeAgentStyle}
      onAgentStyleChange={props.onSetAgentStyle}
      onChange={dock.update}
      onHide={() => dock.update(applyCommand(dock.prefs, "toggle-visibility"))}
      phoneOpen={props.phoneOpen}
      onTogglePhone={props.onTogglePhone}
      onShowSkills={showSkills}
    />
  );
}
