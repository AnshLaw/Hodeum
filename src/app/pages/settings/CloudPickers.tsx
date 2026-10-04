import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_VOICE, DEFAULT_GEMINI_MODEL, type CloudSettings as Cloud } from "../../../data/settings";
import type { CloudCatalog } from "../../../providers/cloud/catalog";
import { catalogErrorMessage, catalogStatus, elevenLabsModelOption, geminiOption, linkLabel, pickerOptions, voiceOption, type CatalogState, type CloudRow, type PickerOption } from "./cloud-settings";

/** Loads one list once a key is saved, again whenever keys change, and on "Try again". */
function useCatalog<T>(load: (() => Promise<T[]>) | undefined, present: boolean, reloadKey: unknown) {
  const [state, setState] = useState<CatalogState<T>>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!load || !present) return setState({ status: "idle" });
    let live = true;
    setState({ status: "loading" });
    load().then(
      (items) => live && setState({ status: "ready", items }),
      (error: unknown) => {
        console.error("Couldn't load a cloud model or voice list", error);
        if (live) setState({ status: "error", error: catalogErrorMessage(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [load, present, reloadKey, attempt]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}

const itemsOf = <T,>(state: CatalogState<T>): T[] => (state.status === "ready" ? state.items : []);

interface PickerProps {
  label: string;
  noun: "models" | "voices";
  state: CatalogState<unknown>;
  options: PickerOption[];
  value: string;
  onSelect: (value: string) => void;
  onRetry: () => void;
  /** Extra controls beside the dropdown (a preview button). */
  children?: ReactNode;
}

/** A dropdown that always offers the current choice, with the list's loading, empty and error states under it. */
function Picker({ label, noun, state, options, value, onSelect, onRetry, children }: PickerProps) {
  const status = catalogStatus(state, noun);
  const failed = state.status === "error";
  return (
    <div className="hcloud__picker">
      <div className="hcloud__pick">
        <span className="hcloud__pick-label">{label}</span>
        <select className="hselect" value={value} onChange={(e) => onSelect(e.target.value)} aria-label={label} aria-busy={state.status === "loading"}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {children}
      </div>
      {status && (
        <p className={failed ? "hcloud__error" : "hmuted hcloud__status"} role={failed ? "alert" : undefined}>
          {status}{" "}
          {failed && (
            <button type="button" className="btn" onClick={onRetry}>
              Try again
            </button>
          )}
        </p>
      )}
    </div>
  );
}

interface PickersProps {
  cloud: Cloud;
  catalog: CloudCatalog;
  present: boolean;
  /** Changes whenever saved keys change, so a replaced key gets a fresh list. */
  reloadKey: unknown;
  onChange: (cloud: Cloud) => void;
}

function GeminiPicker({ cloud, catalog, present, reloadKey, onChange }: PickersProps) {
  const load = useMemo(() => () => catalog.geminiModels(), [catalog]);
  const { state, retry } = useCatalog(load, present, reloadKey);
  const options = pickerOptions(itemsOf(state).map(geminiOption), cloud.geminiModel, DEFAULT_GEMINI_MODEL);
  return <Picker label="Gemini model" noun="models" state={state} options={options} value={cloud.geminiModel} onSelect={(geminiModel) => onChange({ ...cloud, geminiModel })} onRetry={retry} />;
}

/** Plays the fixed preview sentence; a failure stays on screen until the next try. */
function usePreview(catalog: CloudCatalog, cloud: Cloud) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const play = () => {
    setBusy(true);
    setError(undefined);
    catalog
      .previewVoice({ model: cloud.elevenlabsModel, voice: cloud.elevenlabsVoice })
      .catch((failure: unknown) => {
        console.error("ElevenLabs voice preview failed", failure);
        setError(`Couldn't play the preview: ${catalogErrorMessage(failure)}`);
      })
      .finally(() => setBusy(false));
  };
  return { busy, error, play };
}

function ElevenLabsPickers({ cloud, catalog, present, reloadKey, onChange }: PickersProps) {
  const loadModels = useMemo(() => () => catalog.elevenlabsModels(), [catalog]);
  const loadVoices = useMemo(() => () => catalog.elevenlabsVoices(), [catalog]);
  const models = useCatalog(loadModels, present, reloadKey);
  const voices = useCatalog(loadVoices, present, reloadKey);
  const preview = usePreview(catalog, cloud);
  const modelOptions = pickerOptions(itemsOf(models.state).map(elevenLabsModelOption), cloud.elevenlabsModel, DEFAULT_ELEVENLABS_MODEL);
  const voiceOptions = pickerOptions(itemsOf(voices.state).map(voiceOption), cloud.elevenlabsVoice, DEFAULT_ELEVENLABS_VOICE);
  return (
    <>
      <Picker label="Voice model" noun="models" state={models.state} options={modelOptions} value={cloud.elevenlabsModel} onSelect={(elevenlabsModel) => onChange({ ...cloud, elevenlabsModel })} onRetry={models.retry} />
      <Picker label="Voice" noun="voices" state={voices.state} options={voiceOptions} value={cloud.elevenlabsVoice} onSelect={(elevenlabsVoice) => onChange({ ...cloud, elevenlabsVoice })} onRetry={voices.retry}>
        <button type="button" className="btn" onClick={preview.play} disabled={!present || preview.busy} title={present ? "Hear a short sentence in this voice" : "Save a key first"}>
          {preview.busy ? "Playing…" : "▶ Preview"}
        </button>
      </Picker>
      {preview.error && (
        <p className="hcloud__error" role="alert">
          {preview.error}
        </p>
      )}
    </>
  );
}

/** Model (and voice) dropdowns for the providers that have them. */
export function ProviderPickers(props: PickersProps & { row: CloudRow }) {
  if (props.row.provider === "gemini") return <GeminiPicker {...props} />;
  if (props.row.provider === "elevenlabs") return <ElevenLabsPickers {...props} />;
  return null;
}

/** "Get a key" with the provider's official page, opened in the default browser. */
export function KeyLink({ row, openLink }: { row: CloudRow; openLink?: (url: string) => Promise<void> }) {
  const [error, setError] = useState<string>();
  const open = (event: MouseEvent) => {
    if (!openLink) return;
    event.preventDefault();
    setError(undefined);
    openLink(row.keyUrl).catch((failure: unknown) => {
      console.error(`Couldn't open the ${row.name} key page`, failure);
      setError(`Couldn't open your browser (${catalogErrorMessage(failure)}). The page is ${row.keyUrl}`);
    });
  };
  return (
    <>
      <p className="hmuted hcloud__getkey">
        Get a key:{" "}
        <a href={row.keyUrl} target="_blank" rel="noreferrer" onClick={open}>
          {linkLabel(row.keyUrl)}
        </a>
        {row.keyHint && `, ${row.keyHint}`}
      </p>
      {error && (
        <p className="hcloud__error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
