import { useEffect, useRef, useState, type PointerEvent } from "react";
import { boundsOf } from "../../lib/coords";
import { COPY } from "../../lib/copy";
import type { AnnotationShape, LearnerAnnotation, Point, Rect, Size } from "../../lib/types";
import { BeamRing } from "./BeamRing";
import { Composer } from "./Composer";
import { roundedRectPath, shapeFromGesture } from "./geometry";

interface Gesture {
  points: Point[];
  freehand: boolean;
}

interface AnnotateLayerProps {
  size: Size;
  onSubmit: (shape: AnnotationShape, intent: LearnerAnnotation["intent"], question?: string) => void;
  onCancel: () => void;
}

const MARK_RADIUS_PX = 6;
const HANDLE_PX = 7;
const HANDLE_RADIUS_PX = 2;
/** Room the pointer hint needs below and right of the pointer before it flips to the other side. */
const HINT_ROOM: Size = { width: 340, height: 64 };

const polyline = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");

/** A point is ringed as a circle; boxes and circled areas as rounded rectangles. */
function markRadius(shape: AnnotationShape): number {
  return shape.kind === "point" ? shape.bounds.width / 2 : MARK_RADIUS_PX;
}

/** Once the learner lets go, Hodey's beam rings what they marked, the same light it points with. */
function Mark({ shape }: { shape: AnnotationShape }) {
  if (shape.kind === "stroke") return <polyline className="annotate__stroke" points={polyline(shape.points)} />;
  return <BeamRing ring={shape.bounds} radius={markRadius(shape)} emphasis="precise" />;
}

/** Named, not keyed by position: at the start of a drag all four sit on the same point. */
function corners({ x, y, width, height }: Rect): [string, Point][] {
  return [
    ["top-left", { x, y }],
    ["top-right", { x: x + width, y }],
    ["bottom-left", { x, y: y + height }],
    ["bottom-right", { x: x + width, y: y + height }],
  ];
}

/** While dragging: marching ants with a handle at each corner, or the freehand line as it's drawn. */
function Draft({ gesture }: { gesture: Gesture }) {
  if (gesture.freehand) return <polyline className="annotate__stroke" points={polyline(gesture.points)} />;
  const box = boundsOf(gesture.points);
  return (
    <g className="annotate__draft">
      <rect className="annotate__draft-under" {...box} rx={MARK_RADIUS_PX} />
      <rect className="annotate__draft-line" {...box} rx={MARK_RADIUS_PX} />
      {corners(box).map(([name, c]) => (
        <rect key={name} className="annotate__handle" x={c.x - HANDLE_PX / 2} y={c.y - HANDLE_PX / 2} width={HANDLE_PX} height={HANDLE_PX} rx={HANDLE_RADIUS_PX} />
      ))}
    </g>
  );
}

/** The box being dragged or the box or point marked; a freehand circle's own glowing line marks it instead. */
function holeFor(draft: Gesture | null, shape: AnnotationShape | null): Rect | undefined {
  if (draft) return draft.freehand ? undefined : boundsOf(draft.points);
  return shape && shape.kind !== "stroke" ? shape.bounds : undefined;
}

/** The dim, cut away over the mark so the learner sees exactly what they picked. */
function Scrim({ size, hole, radius }: { size: Size; hole?: Rect; radius: number }) {
  const cut = hole && hole.width > 0 && hole.height > 0 ? roundedRectPath(hole, radius) : "";
  return <path className="annotate__scrim" d={`M0 0H${size.width}V${size.height}H0Z${cut}`} />;
}

function toLocal(event: PointerEvent<HTMLDivElement>): Point {
  const box = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/** Until the first mark, how to mark rides beside the pointer, where the learner is looking. */
function CursorHint({ at, viewport }: { at?: Point; viewport: Size }) {
  if (!at) return null;
  const flipX = at.x + HINT_ROOM.width > viewport.width ? " annotate__hint--flip-x" : "";
  const flipY = at.y + HINT_ROOM.height > viewport.height ? " annotate__hint--flip-y" : "";
  return (
    <p className={`annotate__hint${flipX}${flipY}`} style={{ left: at.x, top: at.y }} aria-hidden="true">
      {COPY.annotateDetail}
    </p>
  );
}

function useEscape(onCancel: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
}

/** The drag in progress, the finished mark, and where the pointer is until the first mark. */
function useMarking() {
  const gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<Gesture | null>(null);
  const [shape, setShape] = useState<AnnotationShape | null>(null);
  const [pointer, setPointer] = useState<Point>();
  const [marked, setMarked] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { points: [toLocal(event)], freehand: event.shiftKey };
    setShape(null);
    setDraft(gesture.current);
    setMarked(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = toLocal(event);
    const g = gesture.current;
    if (!g) {
      if (!marked) setPointer(point);
      return;
    }
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
  return { draft, shape, hintAt: marked ? undefined : pointer, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}

/** Point & Ask: drag a box, Shift-draw a circle, or click; then ask beside the mark. Esc cancels. */
export function AnnotateLayer({ size, onSubmit, onCancel }: AnnotateLayerProps) {
  const { draft, shape, hintAt, handlers } = useMarking();
  useEscape(onCancel);
  return (
    <div className="annotate" role="application" aria-label={COPY.annotateTitle} {...handlers}>
      <svg className="annotate__marks" width={size.width} height={size.height} aria-hidden="true">
        <Scrim size={size} hole={holeFor(draft, shape)} radius={shape ? markRadius(shape) : MARK_RADIUS_PX} />
        {draft && <Draft gesture={draft} />}
        {shape && <Mark shape={shape} />}
      </svg>
      <CursorHint at={hintAt} viewport={size} />
      {shape && <Composer anchor={shape.bounds} viewport={size} onSubmit={(intent, question) => onSubmit(shape, intent, question)} />}
    </div>
  );
}
