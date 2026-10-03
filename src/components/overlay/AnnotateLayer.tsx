import { useEffect, useRef, useState, type PointerEvent } from "react";
import { boundsOf } from "../../lib/coords";
import { COPY } from "../../lib/copy";
import type { AnnotationShape, LearnerAnnotation, Point, Size } from "../../lib/types";
import { Composer } from "./Composer";
import { POINT_BOX_PX, shapeFromGesture } from "./geometry";

interface Gesture {
  points: Point[];
  freehand: boolean;
}

interface AnnotateLayerProps {
  size: Size;
  onSubmit: (shape: AnnotationShape, intent: LearnerAnnotation["intent"], question?: string) => void;
  onCancel: () => void;
}

const polyline = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");

function Mark({ shape }: { shape: AnnotationShape }) {
  switch (shape.kind) {
    case "rect":
      return <rect {...shape.bounds} rx={6} />;
    case "stroke":
      return <polyline points={polyline(shape.points)} />;
    case "point":
      return <circle cx={shape.at.x} cy={shape.at.y} r={POINT_BOX_PX / 2} />;
  }
}

function Draft({ gesture }: { gesture: Gesture }) {
  if (gesture.freehand) return <polyline points={polyline(gesture.points)} />;
  return <rect {...boundsOf(gesture.points)} rx={6} />;
}

function toLocal(event: PointerEvent<HTMLDivElement>): Point {
  const box = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/** Point & Ask: drag a box, Shift-draw a circle, or click; then ask beside the mark. Esc cancels. */
export function AnnotateLayer({ size, onSubmit, onCancel }: AnnotateLayerProps) {
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Gesture | null>(null);
  const [shape, setShape] = useState<AnnotationShape | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { points: [toLocal(event)], freehand: event.shiftKey };
    setShape(null);
    setDraft(gesture.current);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const point = toLocal(event);
    g.points = g.freehand ? [...g.points, point] : [g.points[0], point];
    setDraft({ ...g });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    const point = toLocal(event);
    setDraft(null);
    setShape(shapeFromGesture(g.freehand ? [...g.points, point] : [g.points[0], point], g.freehand));
  };

  return (
    <div className="annotate" role="application" aria-label={COPY.annotateTitle} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <svg className="annotate__marks" width={size.width} height={size.height} aria-hidden="true">
        {draft && <Draft gesture={draft} />}
        {shape && <Mark shape={shape} />}
      </svg>
      {shape && <Composer anchor={shape.bounds} viewport={size} onSubmit={(intent, question) => onSubmit(shape, intent, question)} />}
    </div>
  );
}
