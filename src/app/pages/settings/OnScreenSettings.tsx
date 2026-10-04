import { useEffect, useState } from "react";
import type { Dock, DockPrefs, SidebarStyle, Visibility } from "../../../features/dock/dock";
import type { Bus } from "../../../lib/bus";
import { Row, Segmented } from "./controls";
import { SECTION_ID } from "./sections";

const POSITIONS: [Dock, string][] = [
  ["top", "Top notch"],
  ["left", "Left sidebar"],
  ["right", "Right sidebar"],
];
const STYLES: [SidebarStyle, string][] = [
  ["copilot", "Copilot"],
  ["floating", "Floating"],
];
const IDLE: [Exclude<Visibility, "hidden">, string][] = [
  ["auto", "Auto-hide"],
  ["pinned", "Always show"],
];

function sidebarDetail(prefs: DockPrefs): string {
  if (prefs.dock === "top") return "For the left and right sidebar. Choose one under Position to change this.";
  return prefs.sidebar === "copilot" ? "A real side panel: your windows move over so Hodey never covers them." : "Floats over your windows, which keep their space.";
}

/** The notch owns these preferences; the app mirrors them over the bus. */
function useDockPrefs(bus: Bus): DockPrefs | undefined {
  const [prefs, setPrefs] = useState<DockPrefs>();
  useEffect(() => {
    const off = bus.on("dock:prefs", setPrefs);
    bus.emit("dock:prefs-request", {});
    return off;
  }, [bus]);
  return prefs;
}

export function OnScreenSettings({ bus }: { bus: Bus }) {
  const prefs = useDockPrefs(bus);
  const change = (next: Partial<DockPrefs>) => bus.emit("dock:change", next);
  return (
    <section className="hcard" id={SECTION_ID.screen}>
      <h2>Hodey on screen</h2>
      {!prefs && <p className="hmuted">Hodey isn't running, so its position can't be changed right now.</p>}
      {prefs && (
        <>
          <Row label="Position" detail="You can also drag Hodey by its face to the top or either side.">
            <Segmented label="Position" options={POSITIONS} value={prefs.dock} onSelect={(dock) => change({ dock })} />
          </Row>
          <Row label="Sidebar style" detail={sidebarDetail(prefs)}>
            <Segmented label="Sidebar style" options={STYLES} value={prefs.sidebar} disabled={prefs.dock === "top"} onSelect={(sidebar) => change({ sidebar })} />
          </Row>
          <Row label="When idle" detail="Auto-hide tucks Hodey into a sliver until you hover it or a Hode starts.">
            <Segmented label="When idle" options={IDLE} value={prefs.visibility === "hidden" ? "pinned" : prefs.visibility} onSelect={(visibility) => change({ visibility })} />
          </Row>
        </>
      )}
    </section>
  );
}
