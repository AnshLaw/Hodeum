import type { ReactNode } from "react";
import { MOOD_LABELS, type HodeyMood } from "./mood";

/** Hodey's head is the notch's own silhouette: flat where it meets the screen edge, round below. */
const HEAD = "M8 10h48v22a24 24 0 0 1-24 24A24 24 0 0 1 8 32z";
/** Extra room around the 64-unit head for z's, sound waves, thought dots, and sparkles. */
const VIEW_BOX = "-8 -14 90 84";
const DEFAULT_SIZE = 20;

const OpenEyes = ({ className = "" }: { className?: string }) => (
  <g className={`hodey__eyes ${className}`}>
    <rect x="24" y="19" width="6.5" height="13" rx="3.25" />
    <rect x="36" y="19" width="6.5" height="13" rx="3.25" />
  </g>
);

const ClosedEyes = () => <path className="hodey__line" d="M22 27q4.5 3.5 9 0M35 27q4.5 3.5 9 0" />;
const Smile = () => <path className="hodey__line" d="M26 41q7 6 14 0" />;
const FlatMouth = () => <path className="hodey__line" d="M29 42h8" />;
const WavyMouth = () => <path className="hodey__line" d="M26 43q3-3 6 0t6 0" />;
const Z = ({ x, y, s, delay }: { x: number; y: number; s: number; delay: number }) => (
  <path className="hodey__z" style={{ animationDelay: `${delay}s` }} d={`M${x} ${y}h${s}l-${s} ${s * 1.2}h${s}`} />
);

function Sleeping(): ReactNode {
  return (
    <>
      <g className="hodey__face hodey__face--breathe">
        <path className="hodey__head" d={HEAD} />
        <ClosedEyes />
        <path className="hodey__line" d="M30 42q3 2 6 0" />
      </g>
      <Z x={52} y={4} s={5} delay={0} />
      <Z x={58} y={-4} s={6.5} delay={0.8} />
      <Z x={65} y={-12} s={8} delay={1.6} />
    </>
  );
}

/** Wavefronts from a voice off to the right, curving toward Hodey and fading as they arrive. */
const SOUND_WAVES = [
  { d: "M70 22q-5 9 0 18", delay: 0 },
  { d: "M74 17q-7 14 0 28", delay: 0.4 },
  { d: "M78 12q-9 19 0 38", delay: 0.8 },
];

function Listening(): ReactNode {
  return (
    <>
      <g className="hodey__face hodey__face--lean">
        <path className="hodey__head" d={HEAD} />
        <OpenEyes className="hodey__eyes--right" />
        <ellipse className="hodey__ink" cx="35" cy="43" rx="3" ry="3.5" />
      </g>
      {SOUND_WAVES.map((wave) => (
        <path key={wave.d} className="hodey__wave" style={{ animationDelay: `${wave.delay}s` }} d={wave.d} />
      ))}
    </>
  );
}

/** Outgoing wavefronts from Hodey's mouth side, travelling away and fading. */
const VOICE_WAVES = [
  { d: "M58 34q5 7 0 14", delay: 0 },
  { d: "M62 30q7 11 0 22", delay: 0.35 },
  { d: "M66 26q9 15 0 30", delay: 0.7 },
];

function Speaking(): ReactNode {
  return (
    <>
      <g className="hodey__face">
        <path className="hodey__head" d={HEAD} />
        <OpenEyes className="hodey__eyes--blink" />
        <ellipse className="hodey__ink hodey__mouth--talk" cx="33" cy="42" rx="5" ry="4" />
      </g>
      {VOICE_WAVES.map((wave) => (
        <path key={wave.d} className="hodey__wave hodey__wave--out" style={{ animationDelay: `${wave.delay}s` }} d={wave.d} />
      ))}
    </>
  );
}

function Thinking(): ReactNode {
  return (
    <>
      <g className="hodey__face">
        <path className="hodey__head" d={HEAD} />
        <OpenEyes className="hodey__eyes--up" />
        <path className="hodey__line hodey__mouth--ponder" d="M30 43h7" />
      </g>
      <circle className="hodey__dot" style={{ animationDelay: "0s" }} cx="54" cy="3" r="2.4" />
      <circle className="hodey__dot" style={{ animationDelay: "0.25s" }} cx="61" cy="-3" r="3.1" />
      <circle className="hodey__dot" style={{ animationDelay: "0.5s" }} cx="68" cy="-10" r="3.8" />
    </>
  );
}

function Celebrating(): ReactNode {
  const sparkle = (x: number, y: number, delay: number) => (
    <path className="hodey__sparkle" style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px` }} d={`M${x} ${y - 5}l1.4 3.6 3.6 1.4-3.6 1.4-1.4 3.6-1.4-3.6-3.6-1.4 3.6-1.4z`} />
  );
  return (
    <>
      <g className="hodey__face hodey__face--bounce">
        <path className="hodey__head" d={HEAD} />
        <path className="hodey__line" d="M22 28q4.5-6 9 0M35 28q4.5-6 9 0" />
        <path className="hodey__ink" d="M24 37q9 11 18 0z" />
      </g>
      {sparkle(0, 4, 0)}
      {sparkle(64, -4, 0.3)}
      {sparkle(70, 30, 0.6)}
    </>
  );
}

function simpleFace(className: string, features: ReactNode): () => ReactNode {
  return () => (
    <g className={`hodey__face ${className}`}>
      <path className="hodey__head" d={HEAD} />
      {features}
    </g>
  );
}

const FACES: Record<HodeyMood, () => ReactNode> = {
  sleeping: Sleeping,
  listening: Listening,
  thinking: Thinking,
  celebrating: Celebrating,
  speaking: Speaking,
  awake: simpleFace("", <><OpenEyes className="hodey__eyes--blink" /><Smile /></>),
  looking: simpleFace("", <><OpenEyes className="hodey__eyes--scan" /><FlatMouth /></>),
  guiding: simpleFace("hodey__face--nod", <><OpenEyes className="hodey__eyes--down" /><Smile /></>),
  watching: simpleFace("", <><g className="hodey__eyes hodey__eyes--blink-slow"><rect x="24" y="24" width="6.5" height="7" rx="3.25" /><rect x="36" y="24" width="6.5" height="7" rx="3.25" /></g><path className="hodey__line" d="M28 41q5 4 10 0" /></>),
  correcting: simpleFace("hodey__face--shake", <><path className="hodey__line" d="M22 17l8-3M44 17l-8-3" /><OpenEyes /><WavyMouth /></>),
  curious: simpleFace("hodey__face--tilt", <><path className="hodey__line" d="M35 13l9-3" /><circle className="hodey__ink" cx="27" cy="26" r="5.5" /><circle className="hodey__ink" cx="39" cy="26" r="6.5" /><path className="hodey__line" d="M30 43q3 2 6 0" /></>),
  resting: simpleFace("hodey__face--breathe", <><ClosedEyes /><FlatMouth /></>),
  confused: simpleFace("", <><path className="hodey__line" d="M21 16l9 2M45 15l-8 3" /><circle className="hodey__ink" cx="27" cy="26" r="3" /><circle className="hodey__ink" cx="39" cy="26" r="3" /><WavyMouth /><path className="hodey__sweat" d="M52 14q3 5 0 7q-3-2 0-7z" /></>),
};

/** Hodey, personified. `key={mood}` restarts one-shot animations (nod, shake) whenever the mood changes. */
export function HodeyFace({ mood, size = DEFAULT_SIZE }: { mood: HodeyMood; size?: number }) {
  const Face = FACES[mood];
  return (
    <svg key={mood} className={`hodey hodey--${mood}`} width={size} height={size} viewBox={VIEW_BOX} role="img" aria-label={MOOD_LABELS[mood]}>
      <Face />
    </svg>
  );
}
