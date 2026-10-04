import { useEffect, useState } from "react";
import { SETTINGS_LIMITS, type HindiScript, type Settings, type SpeechLanguage } from "../../../data/settings";
import { localVoices } from "../../../lib/appearance";
import { WebSpeechTTSProvider } from "../../../providers/web-speech-tts";
import { NATURAL_PREFIX, type NaturalVoice } from "../../../providers/speech/native-voice";
import type { VoicePreview } from "../../services";
import { Row, Segmented } from "./controls";
import { VoiceGallery } from "./VoiceGallery";
import { WakeWords } from "./WakeWords";

const LANGUAGE_OPTIONS: [SpeechLanguage, string][] = [
  ["auto", "Auto"],
  ["en", "English US"],
  ["en-GB", "English UK"],
  ["hi", "हिन्दी"],
  ["hinglish", "Hinglish"],
];
const SCRIPT_OPTIONS: [HindiScript, string][] = [
  ["devanagari", "देवनागरी"],
  ["roman", "English letters"],
];
const PREVIEW_TEXT = "Hi, I'm Hodey. Click the Insert tab, and I'll show you what comes next.";
const HINDI_PREVIEW_TEXT = "नमस्ते, मैं होडी हूँ। ऊपर इंसर्ट टैब पर क्लिक कीजिए, फिर आगे का रास्ता साथ में देखते हैं।";
const isHindiVoice = (voice: NaturalVoice) => voice.description.startsWith("Hindi");
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

function preview(voice: Settings["voice"], natural: VoicePreview | undefined, onError: (message: string) => void, text = PREVIEW_TEXT): void {
  const speaking = natural
    ? natural.preview(voice, text)
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
      <Row label="Hands-free" detail="Say “Hey Hodey” any time, no key needed. The mic stays on (orange dot) and speech is checked on this PC for a wake word; anything else is dropped at once. Nothing is recorded or sent. Uses some CPU.">
        <input type="checkbox" className="hswitch" checked={voice.handsFree} onChange={(e) => onChange({ ...voice, handsFree: e.target.checked })} aria-label="Hands-free" />
      </Row>
      <Row label="Language" detail="Auto answers in whatever you speak: English, Hindi, or Hinglish. Or fix one. There's no Indian-English option in the speech model; if Auto or English US mishears you, try English UK.">
        <Segmented label="Language" options={LANGUAGE_OPTIONS} value={voice.language} onSelect={(language) => onChange({ ...voice, language })} />
      </Row>
      {voice.language !== "en" && voice.language !== "en-GB" && (
        <Row label="Hindi written as" detail="How Hodey's Hindi and Hinglish show on screen: देवनागरी, or English letters (“Insert tab par click kijiye”). It sounds the same either way.">
          <Segmented label="Hindi written as" options={SCRIPT_OPTIONS} value={voice.hindiScript} onSelect={(hindiScript) => onChange({ ...voice, hindiScript })} />
        </Row>
      )}
      {voice.language !== "en" && voice.language !== "en-GB" && naturalVoices.some(isHindiVoice) && (
        <>
          <Row label="Hindi voice" detail="Says Hodey's Hindi and Hinglish answers. Press ▶ to hear one.">
            <span />
          </Row>
          <VoiceGallery
            voices={naturalVoices.filter(isHindiVoice)}
            selected={`${NATURAL_PREFIX}${voice.hindiVoice}`}
            onSelect={(name) => onChange({ ...voice, hindiVoice: name.slice(NATURAL_PREFIX.length) })}
            onPreview={(name) => preview({ ...voice, hindiVoice: name.slice(NATURAL_PREFIX.length) }, natural, setError, HINDI_PREVIEW_TEXT)}
          />
        </>
      )}
      <Row label="Wake words" detail="Start what you say with any of these and Hodey knows you mean it. Add your own names for Hodey.">
        <span />
      </Row>
      <WakeWords words={voice.wakeWords} onChange={(wakeWords) => onChange({ ...voice, wakeWords })} />
      <Row label="Voice" detail={error ? `Couldn't play the preview: ${error}` : "Every voice runs on this PC. Press ▶ to hear one, click it to choose."}>
        <span />
      </Row>
      {naturalVoices.length > 0 ? (
        <VoiceGallery voices={naturalVoices.filter((v) => !isHindiVoice(v))} selected={voice.name} onSelect={(name) => onChange({ ...voice, name })} onPreview={(name) => preview({ ...voice, name }, natural, setError)} />
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
