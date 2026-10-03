import { COPY } from "../../lib/copy";
import type { Dock, DockPrefs, Visibility } from "../../features/dock/dock";

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

interface DockMenuProps {
  prefs: DockPrefs;
  onChange: (change: Partial<DockPrefs>) => void;
  onHide: () => void;
}

/** Where Hodey lives and how it behaves when idle. Rendered inside the notch so hit-testing stays exact. */
export function DockMenu({ prefs, onChange, onHide }: DockMenuProps) {
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
    </div>
  );
}
