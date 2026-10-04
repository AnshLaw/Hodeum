import { HODEY_KEYS, HODEY_KEY_LABELS, shortcutsFor, type HodeyKey } from "../../../lib/keys";
import { Row, Segmented } from "./controls";
import { SECTION_ID } from "./sections";

const KEY_OPTIONS: [HodeyKey, string][] = HODEY_KEYS.map((key) => [key, HODEY_KEY_LABELS[key]]);

/** The Hodey key and what it does. One key, or that key plus one letter: nothing longer. */
export function KeySettings({ hodeyKey, onChange }: { hodeyKey: HodeyKey; onChange: (key: HodeyKey) => void }) {
  return (
    <section className="hcard" id={SECTION_ID.keys}>
      <h2>Keys</h2>
      <Row label="Hodey key" detail="Apps rarely use it on its own, so Hodey can. Pick Right Alt if your keyboard has no Right Ctrl.">
        <Segmented label="Hodey key" options={KEY_OPTIONS} value={hodeyKey} onSelect={onChange} />
      </Row>
      <ul className="hkeys">
        {shortcutsFor(hodeyKey).map((shortcut) => (
          <li key={shortcut.does}>
            {shortcut.keys.map((key, i) => (
              <span key={key}>
                {i > 0 && " + "}
                <kbd>{key}</kbd>
              </span>
            ))}{" "}
            {shortcut.does}
          </li>
        ))}
      </ul>
    </section>
  );
}
