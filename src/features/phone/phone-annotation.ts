import type { AnnotationShape, LearnerAnnotation, Point, Rect, Size } from "../../lib/types";

const usable = (s: Size) => s.width > 0 && s.height > 0;

/**
 * A Point & Ask mark (physical screen px) whose centre is on the mirrored iPhone, moved into the phone
 * frame's pixels, where phone perception reads and Hodey's phone highlights are drawn. `canvas` is where the
 * mirror is drawn on screen (physical px). Any other mark is returned as it was.
 */
export function placeOnPhone(annotation: LearnerAnnotation, canvas: Rect, frame: Size): LearnerAnnotation {
  const { bounds } = annotation.shape;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const inside = cx >= canvas.x && cx <= canvas.x + canvas.width && cy >= canvas.y && cy <= canvas.y + canvas.height;
  if (!usable(canvas) || !usable(frame) || !inside) return annotation;
  const sx = frame.width / canvas.width;
  const sy = frame.height / canvas.height;
  const point = (p: Point): Point => ({ x: (p.x - canvas.x) * sx, y: (p.y - canvas.y) * sy });
  const rect = (r: Rect): Rect => ({ ...point(r), width: r.width * sx, height: r.height * sy });
  const shape: AnnotationShape =
    annotation.shape.kind === "point"
      ? { kind: "point", at: point(annotation.shape.at), bounds: rect(bounds) }
      : annotation.shape.kind === "stroke"
        ? { kind: "stroke", points: annotation.shape.points.map(point), bounds: rect(bounds) }
        : { kind: "rect", bounds: rect(bounds) };
  // The marked window is the notch's, not the learner's app: drop it so nothing is clipped to it.
  return { ...annotation, shape, surface: "phone", window: undefined };
}
