import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { Rect } from "../../lib/types";
import { beamLayout, glideOrigin, type BeamLayout, type Emphasis, type ShownRing } from "./beam-layout";
import { pulseScale } from "./placement";
import "./beam-ring.css";

/** The ring drawing itself in, when there's no earlier ring to glide from. */
const TRACE_MS = 640;
const GLIDE_MS = 680;
/** Starts gently so the eye catches it leaving, then overshoots a touch and settles on the target. */
const GLIDE_EASING = "cubic-bezier(0.45, 0, 0.2, 1.18)";
/** How far the lock-on ping grows on every side before fading. */
const PING_SPREAD_PX = 12;
const COMET_PARTS = ["tail", "body", "head"] as const;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** How the ring arrives: drawn in, glided over from the last target, or (when unsure) faded in. */
type Arrival = "trace" | "glide" | "fade";

/** The last ring per channel, so the next target's ring can glide in from it. */
const lastShown = new Map<string, ShownRing>();

function glideFrames(from: Rect, to: Rect): Keyframe[] {
  const frame = (r: Rect) => ({ x: `${r.x}px`, y: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  return [frame(from), frame(to)];
}

/** Glides every part of the ring over from the channel's previous ring, and records this ring for the next. */
function useGlide(group: RefObject<SVGGElement | null>, ring: Rect, channel: string | undefined): Rect | undefined {
  const [from] = useState(() => (channel ? glideOrigin(lastShown.get(channel), ring, performance.now()) : undefined));
  useLayoutEffect(() => {
    const element = group.current;
    if (!from || !element || window.matchMedia(REDUCED_MOTION).matches) return;
    const frames = glideFrames(from, ring);
    const animations = [...element.querySelectorAll("rect")].map((rect) => rect.animate(frames, { duration: GLIDE_MS, easing: GLIDE_EASING }));
    return () => animations.forEach((animation) => animation.cancel());
    // Mount-only: a new target mounts a new ring, so `ring` never changes under a running glide.
  }, [from, group]);
  useLayoutEffect(() => {
    if (!channel) return;
    const shown = { x: ring.x, y: ring.y, width: ring.width, height: ring.height };
    lastShown.set(channel, { rect: shown });
    return () => void lastShown.set(channel, { rect: shown, hiddenAt: performance.now() });
  }, [channel, ring.x, ring.y, ring.width, ring.height]);
  return from;
}

/**
 * One comet stroke: a dash of `length` with the rest of the ring as its gap, orbiting from its head
 * at the ring's start to one lap on. Plain numbers, not calc(): Chromium interpolates a number into a
 * calc() discretely, which would freeze the comet in place.
 */
function cometStyle(length: number, perimeter: number): CSSProperties {
  return { "--comet-len": length, "--comet-gap": perimeter - length, "--comet-end": length - perimeter } as CSSProperties;
}

function ringStyle(ring: Rect, layout: BeamLayout, arrival: Arrival): CSSProperties {
  const ping = pulseScale(ring, PING_SPREAD_PX);
  return {
    "--beam-perimeter": layout.perimeter,
    "--beam-lap": `${layout.lapMs}ms`,
    "--beam-arrive": `${arrival === "glide" ? GLIDE_MS : arrival === "trace" ? TRACE_MS : 0}ms`,
    // Gliding, the comet circles on the way; drawn in, it takes over where the drawing ends.
    "--comet-start": `${arrival === "trace" ? TRACE_MS : 0}ms`,
    "--ping-sx": ping.x,
    "--ping-sy": ping.y,
  } as CSSProperties;
}

export interface BeamRingProps {
  /** The ring's rectangle in the SVG's px (already outset from the target). */
  ring: Rect;
  radius: number;
  emphasis: Emphasis;
  /** Rings on one channel glide from target to target; without one, each ring draws itself in. */
  channel?: string;
}

/**
 * Hodey's highlight: a ring that draws itself in (or glides over from the last target), pings once
 * when it locks on, then a comet of light keeps circling it, accent fading into its companion hue.
 */
export function BeamRing({ ring, radius, emphasis, channel }: BeamRingProps) {
  const group = useRef<SVGGElement>(null);
  const tint = `beam-tint-${useId().replace(/[^\w-]/g, "")}`;
  const from = useGlide(group, ring, channel);
  // Nothing to ring: a target with no size on screen.
  if (ring.width <= 0 || ring.height <= 0) return null;
  const arrival: Arrival = from ? "glide" : emphasis === "broad" ? "fade" : "trace";
  const layout = beamLayout(ring, radius, emphasis);
  const shape = { x: ring.x, y: ring.y, width: ring.width, height: ring.height, rx: radius };
  return (
    <g ref={group} className={`beam-ring beam-ring--${emphasis} beam-ring--${arrival}`} style={ringStyle(ring, layout, arrival)}>
      <defs>
        <linearGradient id={tint} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="beam-ring__tint-from" />
          <stop offset="1" className="beam-ring__tint-to" />
        </linearGradient>
      </defs>
      <rect className="beam-ring__glow" stroke={`url(#${tint})`} {...shape} />
      <rect className="beam-ring__outline" pathLength={layout.perimeter} {...shape} />
      <rect className="beam-ring__line" stroke={`url(#${tint})`} pathLength={layout.perimeter} {...shape} />
      {emphasis === "precise" && <rect className="beam-ring__ping" {...shape} />}
      <g className="beam-ring__comet">
        {COMET_PARTS.map((part) => (
          <rect key={part} className={`beam-ring__${part}`} pathLength={layout.perimeter} style={cometStyle(layout[part], layout.perimeter)} {...shape} />
        ))}
      </g>
    </g>
  );
}
