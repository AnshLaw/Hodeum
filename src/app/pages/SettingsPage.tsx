import { useEffect, useState, type ReactNode } from "react";
import { HELP_PRESETS, SETTINGS_LIMITS, type HelpPreset, type Settings } from "../../data/settings";
import type { VisionStatus } from "../../providers/vision/types";
import type { AppServices, VoicePreview } from "../services";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { Row } from "./settings/controls";
import { OnScreenSettings } from "./settings/OnScreenSettings";
import { KeySettings } from "./settings/KeySettings";
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

function HodeySettings({ settings, natural, update }: { settings: Settings; natural?: VoicePreview; update: (next: Settings) => void }) {
  return (
    <section className="hcard">
      <h2>Hodey</h2>
      <VoiceSettings voice={settings.voice} natural={natural} onChange={(voice) => update({ ...settings, voice })} />
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

function AboutSettings({ vision, webSearch }: { vision?: VisionStatus; webSearch?: ReactNode }) {
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
        {webSearch}
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
          <HodeySettings settings={settings} natural={services.voice} update={update} />
          <AppearanceSettings appearance={settings.appearance} onChange={(appearance) => update({ ...settings, appearance })} />
        </>
      )}
      {loadError && <p className="hchat__error">Couldn't load settings: {loadError}</p>}
      <OnScreenSettings bus={services.bus} />
      {settings && <KeySettings hodeyKey={settings.hodeyKey} onChange={(hodeyKey) => update({ ...settings, hodeyKey })} />}
      <AboutSettings
        vision={vision}
        webSearch={
          settings && (
            <Row label="Let Hodey search the web" detail="For questions in Ask Hodey. On this PC, Hodey turns what you typed into a short, generic query and removes emails, links, file names and long numbers; only that query is sent, to Stack Exchange and Microsoft Learn (or Brave Search if you've set a key). Your screen, files and Hodey's replies never are. Each answer shows the exact query, and the blue dot shows while it searches.">
              <input type="checkbox" className="hswitch" checked={settings.webSearch} onChange={(e) => update({ ...settings, webSearch: e.target.checked })} aria-label="Let Hodey search the web" />
            </Row>
          )
        }
      />
    </div>
  );
}
