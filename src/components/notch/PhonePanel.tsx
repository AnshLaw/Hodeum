import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Bus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import type { OverlayPrimitive } from "../../lib/types";
import { listCameras, type CameraInfo } from "../../features/phone/camera-source";
import type { PhoneMirror } from "../../features/phone/phone-mirror";
import type { PhoneSourceKind, PhoneSourceStatus } from "../../features/phone/phone-source";
import { loadPhonePrefs, savePhonePrefs } from "../../features/phone/prefs";

const SOURCES: [PhoneSourceKind, string][] = [
  ["camera", COPY.phoneSourceCamera],
  ["airplay", COPY.phoneSourceAirplay],
];

export function usePhoneMirror(mirror: PhoneMirror | undefined) {
  const read = () => ({ open: mirror?.isOpen() ?? false, status: mirror?.status() ?? ({ state: "off" } as PhoneSourceStatus), kind: mirror?.kind() });
  const [snapshot, setSnapshot] = useState(read);
  useEffect(() => {
    if (!mirror) return;
    setSnapshot(read());
    return mirror.subscribe(() => setSnapshot(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read only closes over mirror
  }, [mirror]);
  return snapshot;
}

function usePhonePrimitives(bus: Bus): OverlayPrimitive[] {
  const [primitives, setPrimitives] = useState<OverlayPrimitive[]>([]);
  useEffect(() => {
    const offs = [bus.on("overlay:render", (p) => setPrimitives(p.surface === "phone" ? p.primitives : [])), bus.on("overlay:clear", () => setPrimitives([]))];
    return () => offs.forEach((off) => off());
  }, [bus]);
  return primitives;
}

function Highlights({ primitives, width, height }: { primitives: OverlayPrimitive[]; width: number; height: number }) {
  return (
    <svg className="phone-panel__marks" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {primitives.map((p, i) =>
        p.kind === "highlight" ? <rect key={i} className={`phone-mark phone-mark--${p.emphasis}`} x={p.bounds.x} y={p.bounds.y} width={p.bounds.width} height={p.bounds.height} rx={12} /> : null,
      )}
    </svg>
  );
}

function StatusCard({ status, kind, onRetry }: { status: PhoneSourceStatus; kind?: PhoneSourceKind; onRetry: () => void }) {
  if (status.state === "error") {
    return (
      <div className="phone-panel__card" role="alert">
        <p>{status.message}</p>
        <button type="button" className="btn" onClick={onRetry}>{COPY.retry}</button>
        <p className="phone-panel__hint">{COPY.phoneSetupHint}</p>
      </div>
    );
  }
  const text = status.state === "waiting" ? (kind === "airplay" ? COPY.phoneWaitingAirplay : COPY.phoneWaitingCamera) : COPY.phoneConnecting;
  return <div className="phone-panel__card" role="status"><p>{text}</p></div>;
}

function PhoneScreen({ mirror, status, kind, primitives }: { mirror: PhoneMirror; status: PhoneSourceStatus; kind?: PhoneSourceKind; primitives: OverlayPrimitive[] }) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = mirror.surface.element;
  useEffect(() => {
    if (canvas && holder.current && canvas.parentElement !== holder.current) holder.current.appendChild(canvas);
  }, [canvas]);
  const size = mirror.surface.size;
  return (
    <div className="phone-panel__screen" data-live={status.state === "live"}>
      <div ref={holder} className="phone-panel__canvas" />
      {status.state === "live" && size && <Highlights primitives={primitives} width={size.width} height={size.height} />}
      {status.state !== "live" && <StatusCard status={status} kind={kind} onRetry={() => void mirror.retry()} />}
    </div>
  );
}

function SourceBar({ mirror, kind }: { mirror: PhoneMirror; kind?: PhoneSourceKind }) {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  useEffect(() => {
    if (kind !== "camera") return;
    listCameras().then(setCameras, (error) => console.error("Couldn't list cameras", error));
  }, [kind]);
  const choose = (source: PhoneSourceKind) => {
    savePhonePrefs({ ...loadPhonePrefs(), source });
    void mirror.open(source);
  };
  const pickCamera = (cameraLabel: string) => {
    savePhonePrefs({ ...loadPhonePrefs(), cameraLabel });
    void mirror.retry();
  };
  return (
    <div className="phone-panel__bar">
      <div className="segmented" role="radiogroup" aria-label={COPY.phoneSource}>
        {SOURCES.map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={kind === key} className="segmented__option" onClick={() => choose(key)}>{label}</button>
        ))}
      </div>
      {kind === "camera" && cameras.length > 0 && (
        <select aria-label={COPY.phoneCamera} value={loadPhonePrefs().cameraLabel ?? ""} onChange={(e) => pickCamera(e.target.value)}>
          <option value="" disabled>
            {COPY.phoneCamera}
          </option>
          {cameras.map((c) => <option key={c.deviceId} value={c.label}>{c.label}</option>)}
        </select>
      )}
      <button type="button" className="icon-btn" aria-label={COPY.closeIphone} onClick={() => void mirror.close()}>✕</button>
    </div>
  );
}

/** The enlarged notch with the iPhone: live mirror (and Hodey's highlights) on the left, guidance on the right. */
export function PhonePanel({ mirror, bus, children }: { mirror: PhoneMirror; bus: Bus; children: ReactNode }) {
  const { status, kind } = usePhoneMirror(mirror);
  const primitives = usePhonePrimitives(bus);
  return (
    <div className="phone-panel">
      <PhoneScreen mirror={mirror} status={status} kind={kind} primitives={primitives} />
      <div className="phone-panel__side">
        <SourceBar mirror={mirror} kind={kind} />
        {children}
      </div>
    </div>
  );
}
