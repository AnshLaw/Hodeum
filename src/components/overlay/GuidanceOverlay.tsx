import { useCallback, useEffect, useRef, useState } from "react";
import { guidanceHidden, type AppPresenceState } from "../../app/frame";
import type { Bus } from "../../lib/bus";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import type { AnnotationShape, LearnerAnnotation, MonitorInfo, OverlayPrimitive, Surface } from "../../lib/types";
import { useElementSize } from "../shared/use-element-size";
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

function useOverlayBus(bus: Bus, surfaces: Surface[]) {
  const [primitives, setPrimitives] = useState<OverlayPrimitive[]>([]);
  const [annotating, setAnnotating] = useState(false);
  const [app, setApp] = useState<AppPresenceState>();
  useEffect(() => {
    const offs = [
      bus.on("app:presence", setApp),
      // Guidance for another surface replaces ours, so a stale desktop highlight never lingers.
      bus.on("overlay:render", (payload) => setPrimitives(surfaces.includes(payload.surface ?? "windows") ? payload.primitives : [])),
      bus.on("overlay:clear", () => setPrimitives([])),
      bus.on("annotate:start", () => setAnnotating(true)),
      bus.on("annotate:cancel", () => setAnnotating(false)),
    ];
    return () => offs.forEach((off) => off());
  }, [bus, surfaces.join()]);
  // Highlights are for the learner's app; while they're in the Hodeum app they'd only cover it.
  return { primitives: guidanceHidden(app) ? [] : primitives, annotating, setAnnotating };
}

/** The click-through guidance surface; becomes interactive only while the learner is marking for Point & Ask. */
const DESKTOP_ONLY: Surface[] = ["windows"];

export function GuidanceOverlay({ bus, shell, surfaces = DESKTOP_ONLY }: { bus: Bus; shell: NativeShell; surfaces?: Surface[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(rootRef);
  const monitor = useOverlayMonitor(shell);
  const { primitives, annotating, setAnnotating } = useOverlayBus(bus, surfaces);

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
      const annotation: LearnerAnnotation = { id: crypto.randomUUID(), shape: shapeToScreen(shape, monitor), intent, question, createdAt: Date.now() };
      bus.emit("annotation:submitted", { annotation });
      setAnnotating(false);
    },
    [bus, monitor, setAnnotating],
  );

  const local = monitor ? primitives.map((p) => primitiveToOverlay(p, monitor)) : [];
  return (
    <div ref={rootRef} className="overlay-root">
      <GuidanceLayer primitives={local} size={size} />
      {annotating && <AnnotateLayer size={size} onSubmit={submit} onCancel={cancel} />}
    </div>
  );
}
