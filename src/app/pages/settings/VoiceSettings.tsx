import { useEffect, useState } from "react";
import { SETTINGS_LIMITS, type Settings } from "../../../data/settings";
import { localVoices } from "../../../lib/appearance";
import { WebSpeechTTSProvider } from "../../../providers/web-speech-tts";
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

function preview(voice: Settings["voice"], onError: (message: string) => void): void {
  const tts = new WebSpeechTTSProvider();
  tts.rate = voice.rate;
  tts.voiceName = voice.name;
  tts.speak(once(PREVIEW_TEXT), new AbortController().signal).catch((error: unknown) => {
    console.error("Voice preview failed", error);
    onError(error instanceof Error ? error.message : String(error));
  });
}

export function VoiceSettings({ voice, onChange }: { voice: Settings["voice"]; onChange: (voice: Settings["voice"]) => void }) {
  const voices = useLocalVoices();
  const [error, setError] = useState<string>();
  return (
    <>
      <Row label="Speak instructions" detail="Hodey reads each step aloud. You can also mute from the notch.">
        <input type="checkbox" className="hswitch" checked={voice.enabled} onChange={(e) => onChange({ ...voice, enabled: e.target.checked })} aria-label="Speak instructions" />
      </Row>
      <Row label="Voice" detail={error ? `Couldn't play the preview: ${error}` : "Voices installed on this PC. Online voices aren't offered: they'd send Hodey's words to the cloud."}>
        <span className="hvoice">
          <select className="hselect" value={voice.name} onChange={(e) => onChange({ ...voice, name: e.target.value })} aria-label="Voice">
            <option value="">System default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name.replace(/^Microsoft /, "")} · {v.lang}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => preview(voice, setError)}>
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
