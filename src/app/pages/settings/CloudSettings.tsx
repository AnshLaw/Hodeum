import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CloudProvider, CloudSettings as Cloud, MemoryMode } from "../../../data/settings";
import type { Bus } from "../../../lib/bus";
import type { KeyPresence } from "../../../providers/cloud/keys";
import type { CloudKeyService } from "../../services";
import { CLOUD_ROWS, MEMORY_OPTIONS, controlEnabled, keyDraftError, keyErrorMessage, keyStatusLabel, withKeyCleared, withProvider, type CloudRow } from "./cloud-settings";
import { Row, Segmented } from "./controls";
import { SensitiveApps } from "./SensitiveApps";
import { SECTION_ID } from "./sections";

/** Which keys are saved; refreshed when any window saves or clears one. */
function useKeyPresence(keys: CloudKeyService | undefined, bus: Bus): [KeyPresence | undefined, () => void] {
  const [presence, setPresence] = useState<KeyPresence>();
  const refresh = useRef(() => {});
  refresh.current = () => {
    keys?.refresh().then(setPresence, (error: unknown) => {
      console.error("Couldn't read which cloud keys are saved", error);
      setPresence(undefined);
    });
  };
  useEffect(() => {
    refresh.current();
    return bus.on("cloud:keys-changed", () => refresh.current());
  }, [keys, bus]);
  return [presence, () => refresh.current()];
}

function ProviderControl({ row, cloud, enabled, onChange }: { row: CloudRow; cloud: Cloud; enabled: boolean; onChange: (cloud: Cloud) => void }) {
  if (row.provider === "backboard") {
    return <Segmented<MemoryMode> label={`${row.name} memory`} options={MEMORY_OPTIONS} value={enabled ? cloud.memory : "off"} disabled={!enabled} onSelect={(mode) => onChange(withProvider(cloud, row.provider, mode))} />;
  }
  const on = row.provider === "gemini" ? cloud.reasoning : cloud.voice;
  return <input type="checkbox" className="hswitch" checked={enabled && on} disabled={!enabled} onChange={(e) => onChange(withProvider(cloud, row.provider, e.target.checked))} aria-label={`Use ${row.name} for ${row.role.toLowerCase()}`} />;
}

interface KeyFormProps {
  row: CloudRow;
  present: boolean;
  keys: CloudKeyService;
  /** Turns the provider off before its key is removed. */
  onCleared: (provider: CloudProvider) => void;
  onKeysChanged: () => void;
}

/** Runs one save or clear at a time and keeps its failure as a recoverable inline message. */
function useKeyAction(name: string, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (action: "save" | "clear", work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      onDone();
    } catch (failure) {
      console.error(`Couldn't ${action} the ${name} key`, failure);
      setError(keyErrorMessage(failure, action));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/** The key is read from the input only on submit and the input is emptied at once; it never enters React state. */
function KeyForm({ row, present, keys, onCleared, onKeysChanged }: KeyFormProps) {
  const input = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(false);
  const { busy, error, setError, run } = useKeyAction(row.name, onKeysChanged);
  const save = (event: FormEvent) => {
    event.preventDefault();
    const field = input.current;
    if (!field) return;
    const draft = field.value;
    field.value = "";
    setTyped(false);
    const invalid = keyDraftError(draft);
    if (invalid) return setError(invalid);
    void run("save", () => keys.save(row.provider, draft.trim()));
  };
  const clear = () => {
    onCleared(row.provider);
    void run("clear", () => keys.clear(row.provider));
  };
  return (
    <>
      <form className="hcloud__key" onSubmit={save}>
        <span className="hchip" data-tone={present ? "done" : "ended"}>{keyStatusLabel(present)}</span>
        <input ref={input} type="password" className="field" autoComplete="off" spellCheck={false} placeholder={present ? "Paste a new key to replace it" : "Paste your API key"} aria-label={`${row.name} API key`} disabled={busy} onInput={(e) => setTyped(e.currentTarget.value !== "")} />
        <button type="submit" className="btn" disabled={busy || !typed}>Save</button>
        <button type="button" className="btn" disabled={busy || !present} onClick={clear}>Clear</button>
      </form>
      {error && <p className="hcloud__error" role="alert">{error}</p>}
    </>
  );
}

interface CloudSettingsProps {
  cloud: Cloud;
  keys?: CloudKeyService;
  bus: Bus;
  onChange: (cloud: Cloud) => void;
}

/** Opt-in cloud providers: keys go to Windows Credential Manager, settings sync like the rest. */
export function CloudSettings({ cloud, keys, bus, onChange }: CloudSettingsProps) {
  const [presence, refresh] = useKeyPresence(keys, bus);
  const keysChanged = () => {
    refresh();
    bus.emit("cloud:keys-changed", {});
  };
  return (
    <section className="hcard" id={SECTION_ID.cloud}>
      <h2>Cloud (optional)</h2>
      <p className="hmuted">Local is always on. Cloud only receives the current step, never your screen or voice.</p>
      <p className="hmuted hcloud__note">{keys ? "Keys are kept in Windows Credential Manager and never shown again." : "Add keys in the Hodeum app on your PC; they never leave it."}</p>
      {CLOUD_ROWS.map((row) => (
        <div key={row.provider} className="hcloud__provider">
          <Row label={`${row.name} · ${row.role}`} detail={row.detail}>
            <ProviderControl row={row} cloud={cloud} enabled={controlEnabled(presence, row.provider)} onChange={onChange} />
          </Row>
          {keys && <KeyForm row={row} present={controlEnabled(presence, row.provider)} keys={keys} onCleared={(provider) => onChange(withKeyCleared(cloud, provider))} onKeysChanged={keysChanged} />}
        </div>
      ))}
      <SensitiveApps apps={cloud.sensitiveApps} onChange={(sensitiveApps) => onChange({ ...cloud, sensitiveApps })} />
    </section>
  );
}
