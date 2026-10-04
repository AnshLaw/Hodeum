import type { Settings } from "../../data/settings";
import { COPY } from "../../lib/copy";
import type { ActivityTracker } from "../../lib/activity";
import type { SpeechInput } from "./speech-input";
import type { VoicePreview } from "../../app/services";
import { WebSpeechTTSProvider } from "../web-speech-tts";
import { NativeSpeechInput, NativeTTSProvider, NativeVoiceStatus, RoutedTTS, voiceChoice, type VoiceBridge } from "./native-voice";

/** Hodey's ears and voice on this PC: Nemotron in, Supertonic (or a Windows voice) out. */
export interface LocalVoice {
  status: NativeVoiceStatus;
  speech: NativeSpeechInput;
  tts: RoutedTTS;
  /** Applies the learner's voice settings (which voice, how fast). */
  apply(voice: Settings["voice"]): void;
}

export function createLocalVoice(bridge: VoiceBridge): LocalVoice {
  const status = new NativeVoiceStatus(bridge);
  const natural = new NativeTTSProvider(bridge, status);
  const windows = new WebSpeechTTSProvider();
  let preferNatural = true;
  // While the natural voice is still loading, its queue holds the first lines rather than
  // switching to a robotic Windows voice; Windows voices are for when no natural voice is installed.
  const tts = new RoutedTTS(natural, windows, () => preferNatural && status.current()?.tts !== "missing");
  return {
    status,
    speech: new NativeSpeechInput(bridge, status),
    tts,
    apply(voice) {
      const choice = voiceChoice(voice.name);
      preferNatural = choice.engine === "natural";
      natural.voiceId = choice.engine === "natural" ? choice.id : "";
      windows.voiceName = choice.engine === "windows" ? choice.uri : "";
      natural.rate = voice.rate;
      windows.rate = voice.rate;
      // The quick acknowledgements are said often and must start instantly: prepare them in this voice.
      if (preferNatural) natural.prepare([...COPY.acks]).catch((error) => console.error("Couldn't prepare Hodey's phrases", error));
    },
  };
}

/** The orange privacy dot stays on exactly while the microphone is listening. */
export function showMicDot(speech: SpeechInput, activity: ActivityTracker): () => void {
  let end: (() => void) | undefined = speech.status() === "listening" ? activity.begin("mic") : undefined;
  return speech.onStatus((status) => {
    if (status === "listening" && !end) end = activity.begin("mic");
    if (status !== "listening" && end) {
      end();
      end = undefined;
    }
  });
}

/** The app window's view of the local voice: how many natural voices, and a preview that uses the chosen one. */
export function voicePreview(voice: LocalVoice): VoicePreview {
  return {
    naturalVoices: () => (voice.status.current()?.tts === "ready" ? (voice.status.current()?.voices ?? []) : []),
    subscribe: (listener) => voice.status.subscribe(() => listener()),
    async preview(settings, text) {
      voice.apply(settings);
      await voice.tts.speak(once(text), new AbortController().signal);
    },
  };
}

async function* once(text: string): AsyncGenerator<string> {
  yield text;
}
