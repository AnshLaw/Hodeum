import { padRect } from "../../lib/coords";
import type { OverlayPrimitive, Rect, Size } from "../../lib/types";
import { arrowGeometry, roundedRectPath } from "./geometry";

const HIGHLIGHT_OUTSET_PX = 4;
const HIGHLIGHT_RADIUS_PX = 8;
const SPOTLIGHT_PADDING_PX = 10;
const PIN_RADIUS_PX = 6;
const LABEL_HEIGHT_PX = 26;
const LABEL_GAP_PX = 8;
const ARROW_PATH_LENGTH = 100;

function keyOf(primitive: OverlayPrimitive): string {
  const r = primitive.kind === "arrow" ? primitive.to : primitive.bounds;
  return `${primitive.kind}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
}

function rectProps(r: Rect, rx: number) {
  return { x: r.x, y: r.y, width: r.width, height: r.height, rx };
}

function Highlight({ bounds, emphasis }: { bounds: Rect; emphasis: "precise" | "broad" }) {
  const props = rectProps(padRect(bounds, HIGHLIGHT_OUTSET_PX), HIGHLIGHT_RADIUS_PX);
  return (
    <g className={`hl hl--${emphasis}`}>
      <rect className="hl__under" {...props} />
      <rect className="hl__ring" {...props} />
      {emphasis === "precise" && <rect className="hl__pulse" {...props} />}
    </g>
  );
}

function Arrow({ to, size }: { to: Rect; size: Size }) {
  const { start, control, end, angle } = arrowGeometry(to, size);
  const d = `M${start.x} ${start.y}Q${control.x} ${control.y} ${end.x} ${end.y}`;
  return (
    <g className="arrow">
      <path className="arrow__under" d={d} />
      <path className="arrow__line" d={d} pathLength={ARROW_PATH_LENGTH} />
      <path className="arrow__head" d="M0 0L-13 -7.5L-13 7.5Z" transform={`translate(${end.x} ${end.y}) rotate(${angle})`} />
    </g>
  );
}

function Shape({ primitive, size }: { primitive: OverlayPrimitive; size: Size }) {
  switch (primitive.kind) {
    case "spotlight": {
      const hole = roundedRectPath(padRect(primitive.bounds, SPOTLIGHT_PADDING_PX), HIGHLIGHT_RADIUS_PX);
      return <path className="spotlight" d={`M0 0H${size.width}V${size.height}H0Z${hole}`} />;
    }
    case "highlight":
      return <Highlight bounds={primitive.bounds} emphasis={primitive.emphasis} />;
    case "arrow":
      return <Arrow to={primitive.to} size={size} />;
    case "pin":
      return (
        <g className="pin">
          <rect className="pin__under" {...rectProps(primitive.bounds, PIN_RADIUS_PX)} />
          <rect className="pin__line" {...rectProps(primitive.bounds, PIN_RADIUS_PX)} />
        </g>
      );
  }
}

function LabelChip({ bounds, text }: { bounds: Rect; text: string }) {
  const above = bounds.y - HIGHLIGHT_OUTSET_PX - LABEL_GAP_PX - LABEL_HEIGHT_PX;
  const top = above >= LABEL_GAP_PX ? above : bounds.y + bounds.height + HIGHLIGHT_OUTSET_PX + LABEL_GAP_PX;
  return (
    <div className="label-chip" style={{ left: bounds.x - HIGHLIGHT_OUTSET_PX, top, height: LABEL_HEIGHT_PX }}>
      {text}
    </div>
  );
}

/** Draws guidance primitives (already in overlay CSS pixels). Purely visual: never captures input. */
export function GuidanceLayer({ primitives, size }: { primitives: OverlayPrimitive[]; size: Size }) {
  return (
    <>
      <svg className="guidance" width={size.width} height={size.height} aria-hidden="true">
        {primitives.map((p) => (
          <Shape key={keyOf(p)} primitive={p} size={size} />
        ))}
      </svg>
      {primitives.map((p) => (p.kind === "highlight" && p.label ? <LabelChip key={`label-${keyOf(p)}`} bounds={p.bounds} text={p.label} /> : null))}
    </>
  );
}
