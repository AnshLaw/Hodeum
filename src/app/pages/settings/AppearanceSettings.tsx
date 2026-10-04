import { useEffect, useState, type CSSProperties } from "react";
import { HodeyFace } from "../../../components/hodey/HodeyFace";
import { MOOD_LABELS, type HodeyMood } from "../../../components/hodey/mood";
import { HODEY_ACCESSORIES, type Accent, type Appearance, type HodeyAccessory, type HodeyColor, type Theme } from "../../../data/settings";
import { ACCENT_SWATCHES, HODEY_SWATCHES, hodeyVars } from "../../../lib/appearance";
import { Row, Segmented, Swatches } from "./controls";
import { SECTION_ID } from "./sections";

const THEMES: [Theme, string][] = [
  ["system", "System"],
  ["dark", "Dark"],
  ["light", "Light"],
];
const ACCENT_NAMES: Record<Accent, string> = { amber: "Amber", mint: "Mint", sky: "Sky", rose: "Rose", violet: "Violet" };
const HODEY_NAMES: Record<HodeyColor, string> = { amber: "Amber", mint: "Mint", sky: "Sky", coral: "Coral", violet: "Violet", snow: "Snow" };
const ACCESSORY_NAMES: Record<HodeyAccessory, string> = { none: "None", glasses: "Glasses", headphones: "Headphones", beanie: "Beanie" };
const PREVIEW_MOODS: HodeyMood[] = ["awake", "listening", "thinking", "guiding", "speaking", "celebrating", "sleeping"];
const PREVIEW_MOOD_MS = 1800;
const TILE_FACE = 52;
const PREVIEW_FACE = 112;

function useCycle<T>(items: T[], ms: number): T {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % items.length), ms);
    return () => clearInterval(timer);
  }, [items.length, ms]);
  return items[index];
}

/** Hodey as the learner styled it, cycling through its moods. */
function HodeyPreview({ appearance }: { appearance: Appearance }) {
  const mood = useCycle(PREVIEW_MOODS, PREVIEW_MOOD_MS);
  return (
    <figure className="hodey-preview" data-hodey-accessory={appearance.hodeyAccessory} style={hodeyVars(appearance.hodeyColor) as CSSProperties}>
      <HodeyFace mood={mood} size={PREVIEW_FACE} />
      <figcaption className="hmuted">{MOOD_LABELS[mood]}</figcaption>
    </figure>
  );
}

function AccessoryTiles({ appearance, onSelect }: { appearance: Appearance; onSelect: (accessory: HodeyAccessory) => void }) {
  return (
    <div className="haccessories" role="radiogroup" aria-label="Hodey's accessory">
      {HODEY_ACCESSORIES.map((accessory) => (
        <button key={accessory} type="button" role="radio" aria-checked={appearance.hodeyAccessory === accessory} className="haccessory" data-hodey-accessory={accessory} style={hodeyVars(appearance.hodeyColor) as CSSProperties} onClick={() => onSelect(accessory)}>
          <HodeyFace mood="awake" size={TILE_FACE} />
          <span>{ACCESSORY_NAMES[accessory]}</span>
        </button>
      ))}
    </div>
  );
}

export function AppearanceSettings({ appearance, onChange }: { appearance: Appearance; onChange: (appearance: Appearance) => void }) {
  const set = (change: Partial<Appearance>) => onChange({ ...appearance, ...change });
  return (
    <section className="hcard happearance" id={SECTION_ID.look}>
      <h2>Look &amp; feel</h2>
      <div className="happearance__grid">
        <HodeyPreview appearance={appearance} />
        <div className="happearance__controls">
          <Row label="Theme" detail="For this window. The notch stays black, like a cutout in the screen.">
            <Segmented label="Theme" options={THEMES} value={appearance.theme} onSelect={(theme) => set({ theme })} />
          </Row>
          <Row label="Accent" detail="Highlights, buttons and Hodey's working ring.">
            <Swatches label="Accent" colors={ACCENT_SWATCHES} names={ACCENT_NAMES} value={appearance.accent} onSelect={(accent) => set({ accent })} />
          </Row>
          <Row label="Hodey's colour">
            <Swatches label="Hodey's colour" colors={HODEY_SWATCHES} names={HODEY_NAMES} value={appearance.hodeyColor} onSelect={(hodeyColor) => set({ hodeyColor })} />
          </Row>
        </div>
      </div>
      <AccessoryTiles appearance={appearance} onSelect={(hodeyAccessory) => set({ hodeyAccessory })} />
    </section>
  );
}
