import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { padRect } from "../../lib/coords";
import type { OverlayPrimitive, Point, Rect, Size } from "../../lib/types";
import { GUIDANCE_CARD_HEIGHT } from "../notch/footprint";
import { NOTCH_WIDTHS } from "../notch/notch-view";
import { BeamRing } from "./BeamRing";
import { roundedRectPath } from "./geometry";
import { type ArrowGeometry, arrowBounds, arrowGeometry, labelPosition } from "./placement";

const HIGHLIGHT_OUTSET_PX = 4;
const HIGHLIGHT_RADIUS_PX = 8;
const SPOTLIGHT_PADDING_PX = 10;
const PIN_RADIUS_PX = 6;
const LABEL_HEIGHT_PX = 26;
const ARROW_PATH_LENGTH = 100;

function keyOf(primitive: OverlayPrimitive): string {
  const r = primitive.kind === "arrow" ? primitive.to : primitive.bounds;
  return `${primitive.kind}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
}

function rectProps(r: Rect, rx: number) {
  return { x: r.x, y: r.y, width: r.width, height: r.height, rx };
}

/** Consecutive highlights share a channel, so each new target's ring glides over from the last one. */
function Highlight({ bounds, emphasis }: { bounds: Rect; emphasis: "precise" | "broad" }) {
  return <BeamRing ring={padRect(bounds, HIGHLIGHT_OUTSET_PX)} radius={HIGHLIGHT_RADIUS_PX} emphasis={emphasis} channel="guidance" />;
}

function Arrow({ geometry }: { geometry: ArrowGeometry }) {
  const { start, control, end, shaftEnd, angle } = geometry;
  const d = `M${start.x} ${start.y}Q${control.x} ${control.y} ${shaftEnd.x} ${shaftEnd.y}`;
  return (
    <g className="arrow">
      <path className="arrow__under" d={d} />
      <path className="arrow__line" d={d} pathLength={ARROW_PATH_LENGTH} />
      <path className="arrow__flow" d={d} pathLength={ARROW_PATH_LENGTH} />
      <path className="arrow__head" d="M0 0L-13 -7.5L-13 7.5Z" transform={`translate(${end.x} ${end.y}) rotate(${angle})`} />
    </g>
  );
}

function Shape({ primitive, size, arrow }: { primitive: OverlayPrimitive; size: Size; arrow?: ArrowGeometry }) {
  switch (primitive.kind) {
    case "spotlight": {
      const hole = roundedRectPath(padRect(primitive.bounds, SPOTLIGHT_PADDING_PX), HIGHLIGHT_RADIUS_PX);
      return <path className="spotlight" d={`M0 0H${size.width}V${size.height}H0Z${hole}`} />;
    }
    case "highlight":
      return <Highlight bounds={primitive.bounds} emphasis={primitive.emphasis} />;
    case "arrow":
      // No arrow when the target is off this monitor or has no room around it: the highlight carries it.
      return arrow ? <Arrow geometry={arrow} /> : null;
    case "pin":
      return (
        <g className="pin">
          <rect className="pin__under" {...rectProps(primitive.bounds, PIN_RADIUS_PX)} />
          <rect className="pin__line" {...rectProps(primitive.bounds, PIN_RADIUS_PX)} />
        </g>
      );
  }
}

/** Measures itself, then asks `place` where to sit; hidden for the one frame before it knows its size. */
function LabelChip({ text, place }: { text: string; place: (chip: Size) => Point }) {
  const ref = useRef<HTMLDivElement>(null);
  const [chip, setChip] = useState<Size>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (element) setChip({ width: element.offsetWidth, height: element.offsetHeight });
  }, [text]);
  const at = chip ? place(chip) : undefined;
  const style: CSSProperties = at ? { left: at.x, top: at.y, height: LABEL_HEIGHT_PX } : { left: 0, top: 0, height: LABEL_HEIGHT_PX, visibility: "hidden" };
  return (
    <div ref={ref} className="label-chip" style={style}>
      {text}
    </div>
  );
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** What each primitive covers on screen, so labels can keep clear of it. */
function footprint(primitive: OverlayPrimitive, arrow: ArrowGeometry | undefined): Rect | undefined {
  if (primitive.kind === "highlight") return padRect(primitive.bounds, HIGHLIGHT_OUTSET_PX);
  if (primitive.kind === "pin") return primitive.bounds;
  if (primitive.kind === "arrow") return arrow && arrowBounds(arrow);
  return undefined;
}

/** Until the notch reports where it is: the expanded card's usual spot (top centre). */
function estimatedNotch(size: Size): Rect {
  const width = NOTCH_WIDTHS.guidance;
  return { x: (size.width - width) / 2, y: 0, width, height: GUIDANCE_CARD_HEIGHT };
}

function arrowsFor(primitives: OverlayPrimitive[], size: Size, keepOut: Rect[]): Map<OverlayPrimitive, ArrowGeometry | undefined> {
  return new Map(primitives.map((p) => [p, p.kind === "arrow" ? arrowGeometry(p.to, size, keepOut) : undefined]));
}

interface LabelScene {
  primitives: OverlayPrimitive[];
  arrows: Map<OverlayPrimitive, ArrowGeometry | undefined>;
  size: Size;
  keepOut: Rect[];
}

function labelPlacer(label: OverlayPrimitive & { kind: "highlight" }, { primitives, arrows, size, keepOut }: LabelScene) {
  const pointing = primitives.find((p) => p.kind === "arrow" && sameRect(p.to, label.bounds));
  const marks = primitives.filter((p) => p !== label).flatMap((p) => footprint(p, arrows.get(p)) ?? []);
  const avoid = [...marks, ...(label.keepClear ?? [])];
  return (chip: Size) => labelPosition({ target: label.bounds, chip, viewport: size, avoid, keepOut, arrow: pointing && arrows.get(pointing) });
}

/**
 * Draws guidance primitives (already in overlay CSS pixels). Purely visual: never captures input.
 * `keepOut`: where the notch is; arrows and labels never go under it.
 */
export function GuidanceLayer({ primitives, size, keepOut }: { primitives: OverlayPrimitive[]; size: Size; keepOut?: Rect[] }) {
  const zones = keepOut ?? [estimatedNotch(size)];
  const arrows = arrowsFor(primitives, size, zones);
  const scene: LabelScene = { primitives, arrows, size, keepOut: zones };
  return (
    <>
      <svg className="guidance" width={size.width} height={size.height} aria-hidden="true">
        {primitives.map((p) => (
          <Shape key={keyOf(p)} primitive={p} size={size} arrow={arrows.get(p)} />
        ))}
      </svg>
      {primitives.map((p) =>
        p.kind === "highlight" && p.label ? <LabelChip key={`label-${keyOf(p)}`} text={p.label} place={labelPlacer(p, scene)} /> : null,
      )}
    </>
  );
}
