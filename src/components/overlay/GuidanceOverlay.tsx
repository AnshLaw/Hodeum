import { useCallback, useEffect, useRef, useState } from "react";
import { guidanceHidden, type AppPresenceState } from "../../app/frame";
import type { Bus } from "../../lib/bus";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import { toOverlay } from "../../lib/coords";
import type { AnnotationShape, LearnerAnnotation, MonitorInfo, OverlayPrimitive, Rect, Surface, WindowRef } from "../../lib/types";
import { useElementSize } from "../shared/use-element-size";
import { useFrontWindow } from "../shared/use-front-window";
import { anchorPrimitives } from "./anchor";
import { AnnotateLayer } from "./AnnotateLayer";
import { GuidanceLayer } from "./GuidanceLayer";
import { primitiveToOverlay, shapeToScreen } from "./geometry";
import "./overlay.css";

function useOverlayMonitor(shell: NativeShell): MonitorInfo | undefined {
  const [monitor, setMonitor] = useState<MonitorInfo>();
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      shell
        .overlayMonitor()
        .then((m) => alive && setMonitor(m))
        .catch(reportError("Couldn't read the overlay's monitor"));
    };
    refresh();
    // DPI and resolution changes resize the overlay; following the app to another monitor moves it.
    window.addEventListener("resize", refresh);
    const stopMoved = shell.onOverlayMoved(refresh);
    return () => {
      alive = false;
      window.removeEventListener("resize", refresh);
      stopMoved();
    };
  }, [shell]);
  return monitor;
}

interface Rendered {
  primitives: OverlayPrimitive[];
  anchor?: WindowRef;
}

const NOTHING: Rendered = { primitives: [] };

function useOverlayBus(bus: Bus, surfaces: Surface[]) {
  const [rendered, setRendered] = useState<Rendered>(NOTHING);
  const [annotating, setAnnotating] = useState(false);
  const [app, setApp] = useState<AppPresenceState>();
  useEffect(() => {
    const offs = [
      bus.on("app:presence", setApp),
      // Guidance for another surface replaces ours, so a stale desktop highlight never lingers.
      bus.on("overlay:render", (payload) =>
        setRendered(surfaces.includes(payload.surface ?? "windows") ? { primitives: payload.primitives, anchor: payload.anchor } : NOTHING),
      ),
      bus.on("overlay:clear", () => setRendered(NOTHING)),
      bus.on("annotate:start", () => setAnnotating(true)),
      bus.on("annotate:cancel", () => setAnnotating(false)),
    ];
    return () => offs.forEach((off) => off());
  }, [bus, surfaces.join()]);
  // Highlights are for the learner's app; while they're in the Hodeum app they'd only cover it.
  return { rendered: guidanceHidden(app) ? NOTHING : rendered, annotating, setAnnotating };
}

/** Where the notch is (physical screen px), as it reports it; asks once in case it reported before we listened. */
function useNotchRect(bus: Bus): Rect | undefined {
  const [rect, setRect] = useState<Rect>();
  useEffect(() => {
    const off = bus.on("notch:rect", ({ rect: next }) => setRect(next));
    bus.emit("notch:rect-request", {});
    return off;
  }, [bus]);
  return rect;
}

/** Nothing drawn outside `r` (overlay CSS px): rings, dims and labels stay on the learner's window. */
function clipPathOf(r: Rect): string {
  return `polygon(${r.x}px ${r.y}px, ${r.x + r.width}px ${r.y}px, ${r.x + r.width}px ${r.y + r.height}px, ${r.x}px ${r.y + r.height}px)`;
}

/** The click-through guidance surface; becomes interactive only while the learner is marking for Point & Ask. */
const DESKTOP_ONLY: Surface[] = ["windows"];

export function GuidanceOverlay({ bus, shell, surfaces = DESKTOP_ONLY }: { bus: Bus; shell: NativeShell; surfaces?: Surface[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(rootRef);
  const monitor = useOverlayMonitor(shell);
  const { rendered, annotating, setAnnotating } = useOverlayBus(bus, surfaces);
  const notch = useNotchRect(bus);
  const front = useFrontWindow(shell);

  useEffect(() => {
    shell.setOverlayInteractive(annotating).catch(reportError("Couldn't switch the overlay mode"));
  }, [annotating, shell]);

  const cancel = useCallback(() => bus.emit("annotate:cancel", {}), [bus]);
  const submit = useCallback(
    (shape: AnnotationShape, intent: LearnerAnnotation["intent"], question?: string) => {
      if (!monitor) {
        console.error("Point & Ask dropped: the overlay's monitor is unknown");
        bus.emit("annotate:cancel", {});
        return;
      }
      const marked = front ? { window: front } : {};
      const annotation: LearnerAnnotation = { id: crypto.randomUUID(), shape: shapeToScreen(shape, monitor), intent, question, createdAt: Date.now(), ...marked };
      bus.emit("annotation:submitted", { annotation });
      setAnnotating(false);
    },
    [bus, monitor, front, setAnnotating],
  );

  const scene = anchorPrimitives(rendered.primitives, rendered.anchor, front);
  const local = monitor ? scene.primitives.map((p) => primitiveToOverlay(p, monitor)) : [];
  const keepOut = monitor && notch ? [toOverlay(notch, monitor)] : undefined;
  const clip = monitor && scene.clip ? toOverlay(scene.clip, monitor) : undefined;
  return (
    <div ref={rootRef} className="overlay-root">
      <div className="overlay-clip" style={clip ? { clipPath: clipPathOf(clip) } : undefined}>
        <GuidanceLayer primitives={local} size={size} keepOut={keepOut} />
      </div>
      {annotating && <AnnotateLayer size={size} onSubmit={submit} onCancel={cancel} />}
    </div>
  );
}
