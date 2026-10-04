import { useEffect, useState, type ReactNode } from "react";
import { SETTINGS_LIMITS, type Settings } from "../../data/settings";
import { AGENT_STYLE_COPY, MODE_COPY } from "../../lib/modes";
import { AGENT_STYLES, HODE_MODES } from "../../lib/types";
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
import { SECTION_ID } from "./settings/sections";
import { SettingsNav } from "./settings/SettingsNav";
import "./pages.css";

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
    <section className="hcard" id={SECTION_ID.hodey}>
      <h2>Hodey</h2>
      <VoiceSettings voice={settings.voice} natural={natural} onChange={(voice) => update({ ...settings, voice })} />
      <Row label="Wait before offering help" detail={`${settings.stuckSeconds} seconds without progress`}>
        <input type="range" min={SETTINGS_LIMITS.MIN_STUCK_SECONDS} max={SETTINGS_LIMITS.MAX_STUCK_SECONDS} step={1} value={settings.stuckSeconds} onChange={(e) => update({ ...settings, stuckSeconds: Number(e.target.value) })} aria-label="Wait before offering help" />
      </Row>
      <span className="hsetting__text hmode-label">
        <strong id="default-mode-label">Default learning mode</strong>
        <span className="hmuted">For new Hodes. You can pick another when you start one, or switch mid-Hode from the ⋯ menu or by saying "teach mode", "help mode" or "agent mode".</span>
      </span>
      <div className="hpresets" role="radiogroup" aria-labelledby="default-mode-label">
        {HODE_MODES.map((mode) => (
          <button key={mode} type="button" role="radio" aria-checked={settings.mode === mode} className="hpreset" onClick={() => update({ ...settings, mode })}>
            <strong>{MODE_COPY[mode].title} mode</strong>
            <span className="hmuted">{MODE_COPY[mode].detail}</span>
          </button>
        ))}
      </div>
      <span className="hsetting__text hmode-label">
        <strong id="agent-style-label">In Agent mode</strong>
        <span className="hmuted">Mid-Hode, say "do it for me" or "guide me", or say "let me try" to take over.</span>
      </span>
      <div className="hpresets" role="radiogroup" aria-labelledby="agent-style-label">
        {AGENT_STYLES.map((agentStyle) => (
          <button key={agentStyle} type="button" role="radio" aria-checked={settings.agentStyle === agentStyle} className="hpreset" onClick={() => update({ ...settings, agentStyle })}>
            <strong>{AGENT_STYLE_COPY[agentStyle].title}</strong>
            <span className="hmuted">{AGENT_STYLE_COPY[agentStyle].detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AboutSettings({ vision, webSearch }: { vision?: VisionStatus; webSearch?: ReactNode }) {
  return (
    <>
      <section className="hcard" id={SECTION_ID.privacy}>
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
      <section className="hcard" id={SECTION_ID.ai}>
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
      <SettingsNav />
      <AccountSettings bus={services.bus} />
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
            <Row label="Let Hodey search the web" detail="Hodey first checks its offline help for Excel, File Explorer, Settings, Notepad, Calculator, Brave, Chrome and WhatsApp; that never leaves this PC. With this on, a question it doesn't cover can go to the web: one you type in Ask Hodey when Hodey decides it needs the web, or one you say when you ask Hodey to look it up or the screen couldn't answer it. It's turned into a short, generic query with emails, links, file paths and names, your Windows user name and numbers of four or more digits (card, phone, ID) removed. These are found as they're written (jane@example.com), so in a question you say, anything speech recognition spells out in words stays in. Only that query is sent: to your Tavily, Exa or Brave Search key if you've set one, then Exa's free search, DuckDuckGo and Stack Exchange, each only if the one before finds nothing, fails or is slow. Hodey then reads the top one or two pages it found, directly or through Jina Reader, which receives only the public page address. Your screen, files and Hodey's replies are never sent. Answers are remembered for a day. Each answer shows the exact query and its sources, says why if the search couldn't run, and the blue dot shows while it searches.">
              <input type="checkbox" className="hswitch" checked={settings.webSearch} onChange={(e) => update({ ...settings, webSearch: e.target.checked })} aria-label="Let Hodey search the web" />
            </Row>
          )
        }
      />
      {settings && <CloudSettings cloud={settings.cloud} keys={services.cloudKeys} catalog={services.cloudCatalog} openLink={services.openLink} bus={services.bus} onChange={(cloud) => update({ ...settings, cloud })} />}
    </div>
  );
}
