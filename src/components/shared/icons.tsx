import type { ReactNode, SVGProps } from "react";

const BASE: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

/** Hodey's mark: an eye looking up and to the right — at your screen. */
export const HodeyGlyph = () => (
  <svg {...BASE} className="glyph">
    <circle cx="8" cy="8" r="6.25" />
    <circle cx="10" cy="6" r="2.1" fill="var(--hd-accent)" stroke="none" />
  </svg>
);

export const CrosshairIcon = () => (
  <svg {...BASE}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
  </svg>
);

export const PauseIcon = () => (
  <svg {...BASE}>
    <path d="M5.5 3.5v9M10.5 3.5v9" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...BASE}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const VolumeIcon = () => (
  <svg {...BASE}>
    <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" />
    <path d="M11 5.5a3.5 3.5 0 0 1 0 5" />
  </svg>
);

export const MutedIcon = () => (
  <svg {...BASE}>
    <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" />
    <path d="M11 6.5l3 3M14 6.5l-3 3" />
  </svg>
);

export const CheckIcon = () => (
  <svg {...BASE} className="check">
    <path d="M3 8.5l3 3 7-7" />
  </svg>
);

export const MoreIcon = () => (
  <svg {...BASE}>
    <circle cx="3.5" cy="8" r="1.1" fill="currentColor" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" />
    <circle cx="12.5" cy="8" r="1.1" fill="currentColor" />
  </svg>
);

export function IconButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}
