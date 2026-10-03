import { useCallback, useEffect, useRef, useState } from "react";
import type { Bus } from "../../lib/bus";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import type { AnnotationShape, LearnerAnnotation, MonitorInfo, OverlayPrimitive } from "../../lib/types";
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
    // DPI and resolution changes resize the overlay window.
    window.addEventListener("resize", refresh);
    return () => {
      alive = false;
      window.removeEventListener("resize", refresh);
    };
  }, [shell]);
  return monitor;
}

function useOverlayBus(bus: Bus) {
  const [primitives, setPrimitives] = useState<OverlayPrimitive[]>([]);
  const [annotating, setAnnotating] = useState(false);
  useEffect(() => {
    const offs = [
      bus.on("overlay:render", (payload) => setPrimitives(payload.primitives)),
      bus.on("overlay:clear", () => setPrimitives([])),
      bus.on("annotate:start", () => setAnnotating(true)),
      bus.on("annotate:cancel", () => setAnnotating(false)),
    ];
    return () => offs.forEach((off) => off());
  }, [bus]);
  return { primitives, annotating, setAnnotating };
}

/** The click-through guidance surface; becomes interactive only while the learner is marking for Point & Ask. */
export function GuidanceOverlay({ bus, shell }: { bus: Bus; shell: NativeShell }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(rootRef);
  const monitor = useOverlayMonitor(shell);
  const { primitives, annotating, setAnnotating } = useOverlayBus(bus);

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
