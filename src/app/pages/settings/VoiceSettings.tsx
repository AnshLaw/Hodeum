import { useEffect, useState } from "react";
import { SETTINGS_LIMITS, type Settings, type SpeechLanguage } from "../../../data/settings";
import { localVoices } from "../../../lib/appearance";
import { WebSpeechTTSProvider } from "../../../providers/web-speech-tts";
import { NATURAL_PREFIX, type NaturalVoice } from "../../../providers/speech/native-voice";
import type { VoicePreview } from "../../services";
import { Row, Segmented } from "./controls";
import { VoiceGallery } from "./VoiceGallery";
import { WakeWords } from "./WakeWords";

const LANGUAGE_OPTIONS: [SpeechLanguage, string][] = [
  ["en", "English (US)"],
  ["en-GB", "English (UK)"],
  ["hi", "Hindi"],
  ["auto", "Hindi + English"],
];
const PREVIEW_TEXT = "Hi, I'm Hodey. Click the Insert tab, and I'll show you what comes next.";
const RATE_STEP = 0.05;

/** On-device voices; the list arrives asynchronously in WebView2. */
function useLocalVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const read = () => setVoices(localVoices(window.speechSynthesis.getVoices()));
    read();
    window.speechSynthesis.addEventListener("voiceschanged", read);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", read);
  }, []);
  return voices;
}

async function* once(text: string): AsyncGenerator<string> {
  yield text;
}

function preview(voice: Settings["voice"], natural: VoicePreview | undefined, onError: (message: string) => void): void {
  const speaking = natural
    ? natural.preview(voice, PREVIEW_TEXT)
    : (() => {
        const tts = new WebSpeechTTSProvider();
        tts.rate = voice.rate;
        tts.voiceName = voice.name;
        return tts.speak(once(PREVIEW_TEXT), new AbortController().signal);
      })();
  speaking.catch((error: unknown) => {
    console.error("Voice preview failed", error);
    onError(error instanceof Error ? error.message : String(error));
  });
}

/** Hodey's natural voices (empty until the voice has loaded). */
function useNaturalVoices(natural?: VoicePreview): NaturalVoice[] {
  const [voices, setVoices] = useState(natural?.naturalVoices() ?? []);
  useEffect(() => {
    if (!natural) return;
    setVoices(natural.naturalVoices());
    return natural.subscribe(() => setVoices(natural.naturalVoices()));
  }, [natural]);
  return voices;
}

export function VoiceSettings({ voice, natural, onChange }: { voice: Settings["voice"]; natural?: VoicePreview; onChange: (voice: Settings["voice"]) => void }) {
  const voices = useLocalVoices();
  const naturalVoices = useNaturalVoices(natural);
  const [error, setError] = useState<string>();
  return (
    <>
      <Row label="Speak instructions" detail="Hodey reads each step aloud. You can also mute from the notch.">
        <input type="checkbox" className="hswitch" checked={voice.enabled} onChange={(e) => onChange({ ...voice, enabled: e.target.checked })} aria-label="Speak instructions" />
      </Row>
      <Row label="Talk back and forth" detail="After Hodey answers, it listens a few seconds for your reply, so you can keep talking without pressing anything. Say “that's all” or stay quiet to stop.">
        <input type="checkbox" className="hswitch" checked={voice.conversation} onChange={(e) => onChange({ ...voice, conversation: e.target.checked })} aria-label="Talk back and forth" />
      </Row>
      <Row label="Your speech" detail="What you speak to Hodey. There's no Indian-English option in the speech model; if English (US) mishears you, try English (UK). Hindi + English handles switching between the two.">
        <Segmented label="Your speech" options={LANGUAGE_OPTIONS} value={voice.language} onSelect={(language) => onChange({ ...voice, language })} />
      </Row>
      <Row label="Wake words" detail="Start what you say with any of these and Hodey knows you mean it. Add your own names for Hodey.">
        <span />
      </Row>
      <WakeWords words={voice.wakeWords} onChange={(wakeWords) => onChange({ ...voice, wakeWords })} />
      <Row label="Voice" detail={error ? `Couldn't play the preview: ${error}` : "Every voice runs on this PC. Press ▶ to hear one, click it to choose."}>
        <span />
      </Row>
      {naturalVoices.length > 0 ? (
        <VoiceGallery voices={naturalVoices} selected={voice.name} onSelect={(name) => onChange({ ...voice, name })} onPreview={(name) => preview({ ...voice, name }, natural, setError)} />
      ) : (
        <p className="hmuted hvoices__missing">{natural ? "Hodey's natural voices are loading, or aren't installed yet (scripts/setup-local-ai.ps1)." : "Natural voices run in the Hodeum desktop app."}</p>
      )}
      <Row label="Windows voices" detail="Robotic, but always available. Online voices aren't offered: they'd send Hodey's words to the cloud.">
        <span className="hvoice">
          <select className="hselect" value={voice.name.startsWith(NATURAL_PREFIX) || voice.name === "" ? "" : voice.name} onChange={(e) => onChange({ ...voice, name: e.target.value })} aria-label="Windows voice">
            <option value="">{naturalVoices.length > 0 ? "Not used (natural voice chosen)" : "System default"}</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name.replace(/^Microsoft /, "")} · {v.lang}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => preview(voice, natural, setError)} disabled={voice.name.startsWith(NATURAL_PREFIX) || (voice.name === "" && naturalVoices.length > 0)}>
            Preview
          </button>
        </span>
      </Row>
      <Row label="Speaking speed" detail={`${voice.rate.toFixed(2)}×`}>
        <input type="range" min={SETTINGS_LIMITS.MIN_RATE} max={SETTINGS_LIMITS.MAX_RATE} step={RATE_STEP} value={voice.rate} onChange={(e) => onChange({ ...voice, rate: Number(e.target.value) })} aria-label="Speaking speed" />
      </Row>
    </>
  );
}
