import { useEffect, useState } from "react";
import { SETTINGS_LIMITS, type Settings } from "../../../data/settings";
import { localVoices } from "../../../lib/appearance";
import { WebSpeechTTSProvider } from "../../../providers/web-speech-tts";
import { NATURAL_PREFIX } from "../../../providers/speech/native-voice";
import type { VoicePreview } from "../../services";
import { Row } from "./controls";

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
function useNaturalVoices(natural?: VoicePreview): { id: string; label: string }[] {
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
      <Row label="Voice" detail={error ? `Couldn't play the preview: ${error}` : "All voices run on this PC. Online voices aren't offered: they'd send Hodey's words to the cloud."}>
        <span className="hvoice">
          <select className="hselect" value={voice.name} onChange={(e) => onChange({ ...voice, name: e.target.value })} aria-label="Voice">
            <option value="">{naturalVoices.length > 0 ? `Hodey's voice (${naturalVoices[0].label.split(" · ")[0]})` : "System default"}</option>
            {naturalVoices.length > 0 && (
              <optgroup label="Natural voices">
                {naturalVoices.map((v) => (
                  <option key={v.id} value={`${NATURAL_PREFIX}${v.id}`}>
                    {v.label}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Windows voices">
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name.replace(/^Microsoft /, "")} · {v.lang}
                </option>
              ))}
            </optgroup>
          </select>
          <button type="button" className="btn" onClick={() => preview(voice, natural, setError)}>
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
