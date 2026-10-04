import { useCallback, useEffect, useState } from "react";
import { COPY } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_VOICE, DEFAULT_GEMINI_MODEL, type CloudSettings, type MemoryMode, type SettingsStore } from "../../data/settings";
import type { CloudCatalog } from "../../providers/cloud/catalog";
import type { KeyPresence } from "../../providers/cloud/keys";
import { anyKey, cloudMode, withCloudMode, type CloudMode } from "../../features/cloud/cloud-mode";
import { elevenLabsModelOption, geminiOption, pickerOptions, voiceOption, type PickerOption } from "../../app/pages/settings/cloud-settings";
import type { Choice } from "../../features/voice/hardware";
import { ChoiceList } from "./VoiceMenu";

/** What the notch's cloud menu needs: the provider lists, which keys are saved, and the saved settings. */
export interface CloudSetup {
  catalog: CloudCatalog;
  keys: () => KeyPresence;
  settings: SettingsStore;
  changed(): void;
}

interface Lists {
  gemini: PickerOption[];
  elevenlabsModels: PickerOption[];
  voices: PickerOption[];
}

const NO_LISTS: Lists = { gemini: [], elevenlabsModels: [], voices: [] };
const MODE_OPTIONS: [CloudMode, string][] = [
  ["local", COPY.local],
  ["cloud", COPY.cloud],
];
const MEMORY_CHOICES: Choice[] = [
  { value: "off", label: COPY.memoryOff },
  { value: "readonly", label: COPY.memoryRecall },
  { value: "auto", label: COPY.memoryRecallSave },
];

/** A provider list, or nothing (logged) when it can't be read: the saved choice is still offered. */
async function listOrNothing<T>(load: () => Promise<T[]>, map: (item: T) => PickerOption, what: string): Promise<PickerOption[]> {
  try {
    return (await load()).map(map);
  } catch (error) {
    console.error(`Couldn't list ${what} for the notch's cloud menu`, error);
    return [];
  }
}

function useCloudSetup(setup: CloudSetup) {
  const [cloud, setCloud] = useState<CloudSettings>();
  const [lists, setLists] = useState<Lists>(NO_LISTS);
  const [error, setError] = useState<string>();
  const keys = setup.keys();
  useEffect(() => {
    let alive = true;
    setup.settings.load().then(
      (settings) => alive && setCloud(settings.cloud),
      (failure: unknown) => alive && setError(errorMessage(failure)),
    );
    const { catalog } = setup;
    Promise.all([
      keys.gemini ? listOrNothing(() => catalog.geminiModels(), geminiOption, "Gemini models") : [],
      keys.elevenlabs ? listOrNothing(() => catalog.elevenlabsModels(), elevenLabsModelOption, "ElevenLabs models") : [],
      keys.elevenlabs ? listOrNothing(() => catalog.elevenlabsVoices(), voiceOption, "ElevenLabs voices") : [],
    ]).then(([gemini, elevenlabsModels, voices]) => alive && setLists({ gemini, elevenlabsModels, voices }));
    return () => {
      alive = false;
    };
  }, [setup, keys.gemini, keys.elevenlabs]);
  const change = useCallback(
    (next: CloudSettings) => {
      setCloud(next);
      setup.settings
        .load()
        .then((settings) => setup.settings.save({ ...settings, cloud: next }))
        .then(() => setup.changed())
        .catch((failure: unknown) => {
          console.error("Couldn't save the cloud choice", failure);
          setError(errorMessage(failure));
        });
    },
    [setup],
  );
  return { cloud, lists, keys, error, change };
}

const OFF = "off";
const asChoices = (options: PickerOption[]): Choice[] => options.map(({ value, label }) => ({ value, label }));

function ModeSwitch({ mode, canUseCloud, onSelect }: { mode: CloudMode; canUseCloud: boolean; onSelect: (mode: CloudMode) => void }) {
  return (
    <div className="dock-menu__group">
      <div className="segmented" role="radiogroup" aria-label={COPY.cloudMode}>
        {MODE_OPTIONS.map(([key, text]) => (
          <button key={key} type="button" role="radio" aria-checked={mode === key} disabled={key === "cloud" && !canUseCloud} className="segmented__option" onClick={() => onSelect(key)}>
            {text}
          </button>
        ))}
      </div>
      <p className="dock-menu__hint">{canUseCloud ? (mode === "local" ? COPY.localModeHint : COPY.cloudModeHint) : COPY.cloudNeedsKey}</p>
    </div>
  );
}

/** Each service with a key: off, or on with a chosen model (and voice). */
function Services({ cloud, lists, keys, change }: { cloud: CloudSettings; lists: Lists; keys: KeyPresence; change: (next: CloudSettings) => void }) {
  const gemini = pickerOptions(lists.gemini, cloud.geminiModel, DEFAULT_GEMINI_MODEL);
  const models = pickerOptions(lists.elevenlabsModels, cloud.elevenlabsModel, DEFAULT_ELEVENLABS_MODEL);
  const voices = pickerOptions(lists.voices, cloud.elevenlabsVoice, DEFAULT_ELEVENLABS_VOICE);
  const off: Choice = { value: OFF, label: COPY.serviceOff };
  return (
    <>
      {keys.gemini && (
        <ChoiceList label={COPY.geminiReasoning} choices={[off, ...asChoices(gemini)]} value={cloud.reasoning ? cloud.geminiModel : OFF} onSelect={(value) => change(value === OFF ? { ...cloud, reasoning: false } : { ...cloud, reasoning: true, geminiModel: value })} />
      )}
      {keys.elevenlabs && (
        <ChoiceList label={COPY.elevenlabsVoiceModel} choices={[off, ...asChoices(models)]} value={cloud.voice ? cloud.elevenlabsModel : OFF} onSelect={(value) => change(value === OFF ? { ...cloud, voice: false } : { ...cloud, voice: true, elevenlabsModel: value })} />
      )}
      {keys.elevenlabs && cloud.voice && <ChoiceList label={COPY.elevenlabsVoice} choices={asChoices(voices)} value={cloud.elevenlabsVoice} onSelect={(elevenlabsVoice) => change({ ...cloud, elevenlabsVoice })} />}
      {keys.backboard && <ChoiceList label={COPY.backboardMemory} choices={MEMORY_CHOICES} value={cloud.memory} onSelect={(memory) => change({ ...cloud, memory: memory as MemoryMode })} />}
    </>
  );
}

/** The badge's menu: Local or Cloud at a glance, and which model each cloud service uses. */
export function CloudMenu({ setup }: { setup: CloudSetup }) {
  const { cloud, lists, keys, error, change } = useCloudSetup(setup);
  if (error) {
    return (
      <p className="notch__content dock-menu__vision" data-tone="warn">
        {COPY.cloudMenuFailed}: {error}
      </p>
    );
  }
  if (!cloud) return <p className="notch__content notch__detail">{COPY.cloudMenuLoading}</p>;
  const mode = cloudMode(cloud);
  return (
    <div className="notch__content dock-menu voice-menu">
      <ModeSwitch mode={mode} canUseCloud={anyKey(keys)} onSelect={(next) => change(withCloudMode(cloud, next, keys))} />
      {mode === "cloud" && <Services cloud={cloud} lists={lists} keys={keys} change={change} />}
      <p className="dock-menu__hint">{COPY.cloudPrivacy}</p>
    </div>
  );
}
