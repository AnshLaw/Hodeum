import { z } from "zod";
import type { Settings, SettingsStore, VoiceSettings } from "../../data/settings";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Must match the commands in src-tauri/src/voice/devices.rs and voice/mod.rs. */
const AUDIO_DEVICES = "audio_devices";
const SET_AUDIO_DEVICES = "set_audio_devices";
const VOICE_MODELS = "voice_models";
const SET_ASR_MODEL = "set_asr_model";

const deviceSchema = z.object({ id: z.string().min(1), name: z.string(), isDefault: z.boolean() });
const devicesSchema = z.object({ inputs: z.array(deviceSchema), outputs: z.array(deviceSchema) });
const modelsSchema = z.object({ asr: z.array(z.object({ id: z.string().min(1), label: z.string(), available: z.boolean() })), active: z.string() });

export type AudioDevice = z.infer<typeof deviceSchema>;
export type AudioDevices = z.infer<typeof devicesSchema>;
export type VoiceModels = z.infer<typeof modelsSchema>;

/** One row in a notch picker. `value` "" means the system's (or engine's) own choice. */
export interface Choice {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
}

/** What the notch's voice menus need: the hardware lists, the saved settings, and a way to tell every window they changed. */
export interface VoiceSetup {
  hardware: VoiceHardware;
  settings: SettingsStore;
  changed(): void;
}

/** The PC's microphones, speakers and installed speech models. */
export interface VoiceHardware {
  devices(): Promise<AudioDevices>;
  models(): Promise<VoiceModels>;
}

function parse<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error(`The ${what} list came back in an unexpected shape`);
  return result.data;
}

export class TauriVoiceHardware implements VoiceHardware {
  constructor(private readonly invoke: Invoke) {}

  async devices(): Promise<AudioDevices> {
    return parse(devicesSchema, await this.invoke<unknown>(AUDIO_DEVICES), "audio device");
  }

  async models(): Promise<VoiceModels> {
    return parse(modelsSchema, await this.invoke<unknown>(VOICE_MODELS), "speech model");
  }
}

const SYSTEM_DEFAULT = "System default";
const SAVED_DEVICE = "Saved device";
const NOT_CONNECTED = "Not connected";
const NOT_INSTALLED = "Not installed";

/** "System default" (naming what that is now), then each device; a saved one that's unplugged stays listed. */
export function deviceChoices(devices: AudioDevice[], saved: string): Choice[] {
  const current = devices.find((d) => d.isDefault)?.name;
  const choices: Choice[] = [{ value: "", label: SYSTEM_DEFAULT, ...(current ? { detail: current } : {}) }, ...devices.map((d) => ({ value: d.id, label: d.name }))];
  if (saved && !devices.some((d) => d.id === saved)) choices.push({ value: saved, label: SAVED_DEVICE, detail: NOT_CONNECTED, disabled: true });
  return choices;
}

export function modelChoices(models: VoiceModels): Choice[] {
  return models.asr.map((m) => (m.available ? { value: m.id, label: m.label } : { value: m.id, label: m.label, detail: NOT_INSTALLED, disabled: true }));
}

/** Points the voice engine at the learner's chosen devices and speech model. */
export async function applyVoiceHardware(invoke: Invoke, voice: VoiceSettings): Promise<void> {
  await invoke<void>(SET_AUDIO_DEVICES, { input: voice.inputDevice || null, output: voice.outputDevice || null });
  if (voice.asrModel) await invoke<void>(SET_ASR_MODEL, { id: voice.asrModel });
}

export function withVoiceChange(settings: Settings, change: Partial<VoiceSettings>): Settings {
  return { ...settings, voice: { ...settings.voice, ...change } };
}
