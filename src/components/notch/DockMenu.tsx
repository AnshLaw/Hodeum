import { COPY } from "../../lib/copy";
import type { Dock, DockPrefs, Visibility } from "../../features/dock/dock";
import type { VisionStatus } from "../../providers/vision/types";

const DOCK_OPTIONS: [Dock, string][] = [
  ["top", COPY.dockTop],
  ["left", COPY.dockLeft],
  ["right", COPY.dockRight],
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
  /** Absent in the browser stage, which has no local model. */
  vision?: VisionStatus;
  onChange: (change: Partial<DockPrefs>) => void;
  onHide: () => void;
}

/** Where Hodey lives and how it behaves when idle. Rendered inside the notch so hit-testing stays exact. */
export function DockMenu({ prefs, vision, onChange, onHide }: DockMenuProps) {
  const idle = prefs.visibility === "hidden" ? "pinned" : prefs.visibility;
  return (
    <div className="notch__content dock-menu">
      <Segmented label={COPY.position} options={DOCK_OPTIONS} value={prefs.dock} onSelect={(dock) => onChange({ dock })} />
      <Segmented label={COPY.whenIdle} options={IDLE_OPTIONS} value={idle} onSelect={(visibility) => onChange({ visibility })} />
      <div className="dock-menu__footer">
        <button type="button" className="btn" onClick={onHide}>
          {COPY.hideHodey}
        </button>
        <span className="dock-menu__hint">
          <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>N</kbd> {COPY.bringsBack}
        </span>
      </div>
      <p className="dock-menu__hint">{COPY.dragTip}</p>
      {vision && <VisionLine status={vision} />}
    </div>
  );
}
