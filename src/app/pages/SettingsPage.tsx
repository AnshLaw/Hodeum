import { useEffect, useState } from "react";
import { HELP_PRESETS, SETTINGS_LIMITS, type HelpPreset, type Settings } from "../../data/settings";
import type { VisionStatus } from "../../providers/vision/types";
import type { AppServices } from "../services";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { Row } from "./settings/controls";
import { OnScreenSettings } from "./settings/OnScreenSettings";
import { useEditableSettings } from "./settings/use-settings";
import { VoiceSettings } from "./settings/VoiceSettings";

const PRESET_LABELS: Record<HelpPreset, { title: string; detail: string }> = {
  beginner: { title: "Beginner", detail: "Hodey shows each step and points at it." },
  guided: { title: "Guided", detail: "Hodey tells you what to do and highlights it." },
  confident: { title: "Confident", detail: "Hodey starts with hints and lets you find things." },
};

const VISION_TEXT: Record<VisionStatus["state"], string> = {
  ready: "Qwen3-VL is running on your GPU.",
  starting: "Loading the local model…",
  missing: "Not installed. Run scripts/setup-local-ai.ps1 once.",
  failed: "Stopped. Restart Hodeum to try again.",
};

function useVision(services: AppServices): VisionStatus | undefined {
  const [status, setStatus] = useState(services.vision?.current());
  useEffect(() => services.vision?.subscribe(setStatus), [services.vision]);
  return status;
}

function HodeySettings({ settings, update }: { settings: Settings; update: (next: Settings) => void }) {
  return (
    <section className="hcard">
      <h2>Hodey</h2>
      <VoiceSettings voice={settings.voice} onChange={(voice) => update({ ...settings, voice })} />
      <Row label="Wait before offering help" detail={`${settings.stuckSeconds} seconds without progress`}>
        <input type="range" min={SETTINGS_LIMITS.MIN_STUCK_SECONDS} max={SETTINGS_LIMITS.MAX_STUCK_SECONDS} step={1} value={settings.stuckSeconds} onChange={(e) => update({ ...settings, stuckSeconds: Number(e.target.value) })} aria-label="Wait before offering help" />
      </Row>
      <div className="hpresets" role="radiogroup" aria-label="How much help for new skills">
        {HELP_PRESETS.map((preset) => (
          <button key={preset} type="button" role="radio" aria-checked={settings.help === preset} className="hpreset" onClick={() => update({ ...settings, help: preset })}>
            <strong>{PRESET_LABELS[preset].title}</strong>
            <span className="hmuted">{PRESET_LABELS[preset].detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AboutSettings({ vision }: { vision?: VisionStatus }) {
  return (
    <>
      <section className="hcard">
        <h2>Privacy</h2>
        <p className="hmuted">The dots in the notch tell you what Hodey is using right now.</p>
        <ul className="hlegend">
          <li data-dot="screen">Green: reading your screen</li>
          <li data-dot="mic">Orange: microphone on</li>
          <li data-dot="cloud">Blue: a cloud service is receiving data</li>
        </ul>
        <p className="hmuted">Screenshots and audio are never saved or synced.</p>
      </section>
      <section className="hcard">
        <h2>Local AI</h2>
        <Row label="Screen understanding" detail={vision ? VISION_TEXT[vision.state] : "Not available here."}>
          <span className="hchip" data-tone={vision?.state === "ready" ? "done" : "ended"}>
            {vision?.state === "ready" ? "Ready" : "Off"}
          </span>
        </Row>
      </section>
      <section className="hcard">
        <h2>Shortcuts</h2>
        <ul className="hkeys">
          <li><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>H</kbd> Point &amp; Ask</li>
          <li><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>N</kbd> Show or hide Hodey</li>
          <li><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>J</kbd> Open this app</li>
        </ul>
      </section>
      <section className="hcard">
        <h2>Account</h2>
        <Row label="Sign in with Google" detail="Signing in syncs your skills, Hodes, settings and chats to your account so the web app and your other PCs see them. Coming next.">
          <button type="button" className="btn" disabled>
            Sign in
          </button>
        </Row>
      </section>
    </>
  );
}

export function SettingsPage({ services }: { services: AppServices }) {
  const { settings, loadError, saveError, update } = useEditableSettings(services);
  const vision = useVision(services);
  return (
    <div className="hpage">
      <header className="hpage__head">
        <h1>Settings</h1>
        <p className="hmuted">Changes apply to the notch right away.</p>
      </header>
      {saveError && <p className="hchat__error" role="alert">Couldn't save: {saveError}</p>}
      {settings && (
        <>
          <HodeySettings settings={settings} update={update} />
          <AppearanceSettings appearance={settings.appearance} onChange={(appearance) => update({ ...settings, appearance })} />
        </>
      )}
      {loadError && <p className="hchat__error">Couldn't load settings: {loadError}</p>}
      <OnScreenSettings bus={services.bus} />
      <AboutSettings vision={vision} />
    </div>
  );
}
