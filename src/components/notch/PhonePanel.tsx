import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Bus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import type { OverlayPrimitive, Rect, Size } from "../../lib/types";
import { listCameras, type CameraInfo } from "../../features/phone/camera-source";
import type { PhoneMirror } from "../../features/phone/phone-mirror";
import type { PhoneSourceKind, PhoneSourceStatus } from "../../features/phone/phone-source";
import { loadPhonePrefs, savePhonePrefs } from "../../features/phone/prefs";
import { BeamRing } from "../overlay/BeamRing";
import { markRect } from "./phone-layout";

/** Highlight corner radius in CSS px of the drawn screen. */
const MARK_RADIUS = 6;

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

const keyOf = (r: Rect) => [r.x, r.y, r.width, r.height].map(Math.round).join(",");

/** Hodey's highlights, mapped from frame pixels onto the screen as drawn (it scales with the notch). */
function Highlights({ primitives, toFrame, frame, display }: { primitives: OverlayPrimitive[]; toFrame: (bounds: Rect) => Rect; frame: Size; display: Size }) {
  return (
    <svg className="phone-panel__marks" viewBox={`0 0 ${display.width} ${display.height}`} preserveAspectRatio="none" aria-hidden="true">
      {primitives.map((p) => {
        if (p.kind !== "highlight") return null;
        const box = markRect(toFrame(p.bounds), frame, display);
        // Keyed by position, so the ring glides from one control on the phone to the next.
        return <BeamRing key={keyOf(box)} ring={box} radius={MARK_RADIUS} emphasis={p.emphasis} channel="phone" />;
      })}
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

interface PhoneScreenProps {
  mirror: PhoneMirror;
  status: PhoneSourceStatus;
  kind?: PhoneSourceKind;
  primitives: OverlayPrimitive[];
  /** The drawn screen's size in CSS px; CSS falls back to a fixed size until the room is measured. */
  screen?: Size;
}

function PhoneScreen({ mirror, status, kind, primitives, screen }: PhoneScreenProps) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = mirror.surface.element;
  useEffect(() => {
    if (canvas && holder.current && canvas.parentElement !== holder.current) holder.current.appendChild(canvas);
  }, [canvas]);
  const frame = mirror.surface.size;
  const style: CSSProperties | undefined = screen && { width: screen.width, height: screen.height };
  return (
    <div className="phone-panel__screen" data-live={status.state === "live"} style={style}>
      <div ref={holder} className="phone-panel__canvas" />
      {status.state === "live" && frame && screen && <Highlights primitives={primitives} toFrame={mirror.toFrame} frame={frame} display={screen} />}
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
export function PhonePanel({ mirror, bus, stacked = false, screen, children }: { mirror: PhoneMirror; bus: Bus; stacked?: boolean; screen?: Size; children: ReactNode }) {
  const { status, kind } = usePhoneMirror(mirror);
  const primitives = usePhonePrimitives(bus);
  return (
    <div className={stacked ? "phone-panel phone-panel--stacked" : "phone-panel"}>
      <PhoneScreen mirror={mirror} status={status} kind={kind} primitives={primitives} screen={screen} />
      <div className="phone-panel__side">
        <SourceBar mirror={mirror} kind={kind} />
        {children}
      </div>
    </div>
  );
}
