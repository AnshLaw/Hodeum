import { useState, type FormEvent } from "react";
import { MAX_SENSITIVE_APP, MAX_SENSITIVE_APPS } from "../../../data/settings";
import { addSensitiveApp, isDefaultSensitiveApps, removeSensitiveApp, resetSensitiveApps } from "./cloud-settings";

/** Apps and sites where cloud stays off, matched against the app and window title. */
export function SensitiveApps({ apps, onChange }: { apps: string[]; onChange: (apps: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const full = apps.length >= MAX_SENSITIVE_APPS;
  const add = (event: FormEvent) => {
    event.preventDefault();
    const result = addSensitiveApp(apps, draft);
    if ("error" in result) return setError(result.error);
    setError(undefined);
    setDraft("");
    onChange(result.apps);
  };
  return (
    <div className="hcloud__sensitive">
      <strong>Sensitive apps</strong>
      <p className="hmuted">Cloud stays off while one of these is in front, even when it's turned on.</p>
      <ul className="hwake__list" aria-label="Sensitive apps">
        {apps.map((app) => (
          <li key={app} className="hwake__chip">
            {app}
            <button type="button" className="hwake__remove" aria-label={`Remove ${app}`} onClick={() => onChange(removeSensitiveApp(apps, app))}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <form className="hwake__add" onSubmit={add}>
        <input className="field" value={draft} maxLength={MAX_SENSITIVE_APP} onChange={(e) => setDraft(e.target.value)} placeholder={full ? "That's the maximum" : "Add one, e.g. Signal"} disabled={full} aria-label="New sensitive app" />
        <button type="submit" className="btn" disabled={full || draft.trim() === ""}>
          Add
        </button>
        <button type="button" className="btn" disabled={isDefaultSensitiveApps(apps)} onClick={() => onChange(resetSensitiveApps())}>
          Reset to defaults
        </button>
      </form>
      {error && <p className="hcloud__error" role="alert">{error}</p>}
    </div>
  );
}
