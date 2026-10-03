import { useEffect, useState, type ReactNode } from "react";
import { HELP_PRESETS, SETTINGS_LIMITS, type HelpPreset, type Settings } from "../../data/settings";
import type { VisionStatus } from "../../providers/vision/types";
import { useLiveQuery } from "../hooks";
import type { AppServices } from "../services";

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

function Row({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <div className="hsetting">
      <span className="hsetting__text">
        <strong>{label}</strong>
        {detail && <span className="hmuted">{detail}</span>}
      </span>
      {children}
    </div>
  );
}

function useVision(services: AppServices): VisionStatus | undefined {
  const [status, setStatus] = useState(services.vision?.current());
  useEffect(() => services.vision?.subscribe(setStatus), [services.vision]);
  return status;
}

function HodeySettings({ settings, update }: { settings: Settings; update: (next: Settings) => void }) {
  return (
    <section className="hcard">
      <h2>Hodey</h2>
      <Row label="Speak instructions" detail="Hodey reads each step aloud. You can also mute from the notch.">
        <input type="checkbox" className="hswitch" checked={settings.voice.enabled} onChange={(e) => update({ ...settings, voice: { ...settings.voice, enabled: e.target.checked } })} aria-label="Speak instructions" />
      </Row>
      <Row label="Speaking speed" detail={`${settings.voice.rate.toFixed(2)}×`}>
        <input type="range" min={SETTINGS_LIMITS.MIN_RATE} max={SETTINGS_LIMITS.MAX_RATE} step={0.05} value={settings.voice.rate} onChange={(e) => update({ ...settings, voice: { ...settings.voice, rate: Number(e.target.value) } })} aria-label="Speaking speed" />
      </Row>
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
  const [loaded] = useLiveQuery(services.bus, () => services.settings.load(), []);
  const [error, setError] = useState<string>();
  const vision = useVision(services);
  const update = (next: Settings) => {
    services.settings.save(next).then(
      () => {
        setError(undefined);
        services.bus.emit("settings:changed", {});
        services.bus.emit("data:changed", {});
      },
      (e) => {
        console.error("Couldn't save settings", e);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  };
  return (
    <div className="hpage">
      <header className="hpage__head">
        <h1>Settings</h1>
        <p className="hmuted">Changes apply to the notch right away.</p>
      </header>
      {error && <p className="hchat__error" role="alert">Couldn't save: {error}</p>}
      {loaded.state === "ready" && <HodeySettings settings={loaded.value} update={update} />}
      {loaded.state === "error" && <p className="hchat__error">Couldn't load settings: {loaded.message}</p>}
      <AboutSettings vision={vision} />
    </div>
  );
}
