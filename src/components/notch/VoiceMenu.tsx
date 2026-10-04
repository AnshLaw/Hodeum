import { useCallback, useEffect, useState } from "react";
import { COPY } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import type { VoiceSettings } from "../../data/settings";
import { NATURAL_PREFIX, type NaturalVoice } from "../../providers/speech/native-voice";
import type { SurfaceProps } from "./surface";
import { CloudMenu } from "./CloudMenu";
import { deviceChoices, modelChoices, withVoiceChange, type AudioDevices, type Choice, type VoiceModels, type VoiceSetup } from "../../features/voice/hardware";

/** Which quick menu is open: the mic's (microphone, speech model), the speaker's (speaker, voice), or the badge's (local or cloud). */
export type VoiceMenuKind = "mic" | "speaker" | "cloud";

interface Loaded {
  devices: AudioDevices;
  models: VoiceModels;
  voice: VoiceSettings;
}

type LoadState = { state: "loading" } | { state: "ready"; data: Loaded } | { state: "error"; error: string };

/** The PC's devices, models and the saved choices, read each time the menu opens; changes are saved for every window. */
function useVoiceSetup(setup: VoiceSetup) {
  const [load, setLoad] = useState<LoadState>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoad({ state: "loading" });
    Promise.all([setup.hardware.devices(), setup.hardware.models(), setup.settings.load()]).then(
      ([devices, models, settings]) => alive && setLoad({ state: "ready", data: { devices, models, voice: settings.voice } }),
      (error: unknown) => {
        console.error("Couldn't read the PC's audio devices or speech models", error);
        if (alive) setLoad({ state: "error", error: errorMessage(error) });
      },
    );
    return () => {
      alive = false;
    };
  }, [setup, attempt]);
  const change = useCallback(
    (next: Partial<VoiceSettings>) => {
      setLoad((current) => (current.state === "ready" ? { state: "ready", data: { ...current.data, voice: { ...current.data.voice, ...next } } } : current));
      setup.settings
        .load()
        .then((settings) => setup.settings.save(withVoiceChange(settings, next)))
        .then(() => setup.changed())
        .catch((error: unknown) => {
          console.error("Couldn't save the voice choice", error);
          setLoad({ state: "error", error: errorMessage(error) });
        });
    },
    [setup],
  );
  return { load, change, retry: () => setAttempt((n) => n + 1) };
}

export function ChoiceList({ label, choices, value, onSelect }: { label: string; choices: Choice[]; value: string; onSelect: (value: string) => void }) {
  return (
    <div className="dock-menu__group">
      <p className="dock-menu__label">{label}</p>
      <div className="choice-list" role="radiogroup" aria-label={label}>
        {choices.map((choice) => (
          <button key={choice.value || "default"} type="button" role="radio" aria-checked={value === choice.value} disabled={choice.disabled} className="choice-list__option" onClick={() => onSelect(choice.value)}>
            <span className="choice-list__label">{choice.label}</span>
            {choice.detail && <span className="choice-list__detail">{choice.detail}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function voiceChoices(voices: NaturalVoice[]): Choice[] {
  return [{ value: "", label: COPY.voiceDefault }, ...voices.map((v) => ({ value: `${NATURAL_PREFIX}${v.id}`, label: v.label, detail: v.description }))];
}

function MicSections({ data, change }: { data: Loaded; change: (next: Partial<VoiceSettings>) => void }) {
  return (
    <>
      <ChoiceList label={COPY.microphone} choices={deviceChoices(data.devices.inputs, data.voice.inputDevice)} value={data.voice.inputDevice} onSelect={(inputDevice) => change({ inputDevice })} />
      <ChoiceList label={COPY.speechModel} choices={modelChoices(data.models)} value={data.voice.asrModel || data.models.active} onSelect={(asrModel) => change({ asrModel })} />
    </>
  );
}

function SpeakerSections({ data, voices, change }: { data: Loaded; voices: NaturalVoice[]; change: (next: Partial<VoiceSettings>) => void }) {
  return (
    <>
      <ChoiceList label={COPY.speaker} choices={deviceChoices(data.devices.outputs, data.voice.outputDevice)} value={data.voice.outputDevice} onSelect={(outputDevice) => change({ outputDevice })} />
      {voices.length > 0 && <ChoiceList label={COPY.hodeyVoice} choices={voiceChoices(voices)} value={data.voice.name} onSelect={(name) => change({ name })} />}
    </>
  );
}

/**
 * The mic's and speaker's menus in the notch: which microphone and speech model Hodey listens with, and which
 * speaker and voice it talks through. `both`: show all four (the idle notch has no speaker button).
 */
export function VoiceMenu({ kind, setup, voices, both }: { kind: Exclude<VoiceMenuKind, "cloud">; setup: VoiceSetup; voices: NaturalVoice[]; both: boolean }) {
  const { load, change, retry } = useVoiceSetup(setup);
  if (load.state === "loading") return <p className="notch__content notch__detail">{COPY.voiceMenuLoading}</p>;
  if (load.state === "error") {
    return (
      <div className="notch__content dock-menu">
        <p className="dock-menu__vision" data-tone="warn">
          {COPY.voiceMenuFailed}: {load.error}
        </p>
        <button type="button" className="btn" onClick={retry}>
          {COPY.retry}
        </button>
      </div>
    );
  }
  return (
    <div className="notch__content dock-menu voice-menu">
      {(kind === "mic" || both) && <MicSections data={load.data} change={change} />}
      {(kind === "speaker" || both) && <SpeakerSections data={load.data} voices={voices} change={change} />}
    </div>
  );
}

/** The open quick menu; the idle notch has no speaker button, so the mic's shows the speaker's choices too. */
export function openVoiceMenu(props: SurfaceProps) {
  if (props.voiceMenu === "cloud") return props.cloudSetup ? <CloudMenu setup={props.cloudSetup} /> : undefined;
  if (!props.voiceMenu || !props.voiceSetup) return undefined;
  const both = props.view.mode === "idle" || props.view.mode === "annotate";
  return <VoiceMenu kind={props.voiceMenu} setup={props.voiceSetup} voices={props.naturalVoices} both={both} />;
}
