import { useEffect, useState } from "react";
import { COPY } from "../../lib/copy";
import { HODEY_KEY_LABELS, KEY_LETTERS, hodeyKeySetting } from "../../lib/keys";
import { MODE_COPY } from "../../lib/modes";
import { HODE_MODES, type HodeMode } from "../../lib/types";
import type { Dock, DockPrefs, SidebarStyle, Visibility } from "../../features/dock/dock";
import type { VisionStatus } from "../../providers/vision/types";

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
  /** Absent in the browser stage, which has no local model. */
  vision?: VisionStatus;
  onChange: (change: Partial<DockPrefs>) => void;
  onHide: () => void;
}

/** Where Hodey lives and how it behaves when idle. Rendered inside the notch so hit-testing stays exact. */
function useHodeyKeyLabel(): string {
  const [key, setKey] = useState(hodeyKeySetting.get());
  useEffect(() => hodeyKeySetting.subscribe(setKey), []);
  return HODEY_KEY_LABELS[key];
}

const MODE_OPTIONS: [HodeMode, string][] = HODE_MODES.map((mode) => [mode, MODE_COPY[mode].title]);

export function DockMenu({ prefs, vision, mode, onModeChange, onChange, onHide }: DockMenuProps) {
  const keyLabel = useHodeyKeyLabel();
  const idle = prefs.visibility === "hidden" ? "pinned" : prefs.visibility;
  return (
    <div className="notch__content dock-menu">
      {mode && <Segmented label={COPY.modeLabel} options={MODE_OPTIONS} value={mode} onSelect={onModeChange} />}
      <Segmented label={COPY.position} options={DOCK_OPTIONS} value={prefs.dock} onSelect={(dock) => onChange({ dock })} />
      {prefs.dock !== "top" && (
        <>
          <Segmented label={COPY.sidebarStyle} options={SIDEBAR_OPTIONS} value={prefs.sidebar} onSelect={(sidebar) => onChange({ sidebar })} />
          {prefs.sidebar === "copilot" && <p className="dock-menu__hint">{COPY.sidebarCopilotTip}</p>}
        </>
      )}
      <Segmented label={COPY.whenIdle} options={IDLE_OPTIONS} value={idle} onSelect={(visibility) => onChange({ visibility })} />
      <div className="dock-menu__footer">
        <button type="button" className="btn" onClick={onHide}>
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
