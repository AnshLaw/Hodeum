import { useEffect, useState, type ReactNode } from "react";
import { SETTINGS_LIMITS, type Settings } from "../../data/settings";
import { MODE_COPY } from "../../lib/modes";
import { HODE_MODES } from "../../lib/types";
import type { VisionStatus } from "../../providers/vision/types";
import type { AppServices, VoicePreview } from "../services";
import { AccountSettings } from "./settings/AccountSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { CloudSettings } from "./settings/CloudSettings";
import { Row } from "./settings/controls";
import { OnScreenSettings } from "./settings/OnScreenSettings";
import { KeySettings } from "./settings/KeySettings";
import { useEditableSettings } from "./settings/use-settings";
import { VoiceSettings } from "./settings/VoiceSettings";


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
      <div className="hpresets" role="radiogroup" aria-label="Default mode">
        {HODE_MODES.map((mode) => (
          <button key={mode} type="button" role="radio" aria-checked={settings.mode === mode} className="hpreset" onClick={() => update({ ...settings, mode })}>
            <strong>{MODE_COPY[mode].title} mode</strong>
            <span className="hmuted">{MODE_COPY[mode].detail}</span>
          </button>
        ))}
      </div>
      <p className="hmuted hmode-note">The default for new Hodes. You can pick another when you start one, or switch mid-Hode from the ⋯ menu or by saying "teach mode", "help mode" or "agent mode".</p>
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
      {settings && <CloudSettings cloud={settings.cloud} keys={services.cloudKeys} bus={services.bus} onChange={(cloud) => update({ ...settings, cloud })} />}
      <AccountSettings bus={services.bus} />
    </div>
  );
}
