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

/** Hodeum's mark: an H whose crossbar climbs like stairs to an amber point (a Hode, step by step). */
export const HodeumMark = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className="hodeum-mark">
    <path d="M15 11v42M49 11v42" stroke="currentColor" strokeWidth="7.5" strokeLinecap="round" />
    <path d="M15 41h11v-9h11v-9h12" stroke="currentColor" strokeWidth="5.5" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx="49" cy="23" r="6" fill="#ffb224" />
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

export const RepeatIcon = () => (
  <svg {...BASE}>
    <path d="M3.5 8a4.5 4.5 0 0 1 7.7-3.2L12.5 6" />
    <path d="M12.5 2.8V6H9.3" />
    <path d="M12.5 8a4.5 4.5 0 0 1-7.7 3.2L3.5 10" />
  </svg>
);

export const EyeIcon = () => (
  <svg {...BASE}>
    <path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8z" />
    <circle cx="8" cy="8" r="1.9" />
  </svg>
);

export const MicIcon = () => (
  <svg {...BASE}>
    <rect x="5.8" y="1.8" width="4.4" height="7.6" rx="2.2" />
    <path d="M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v2.2" />
  </svg>
);

export const ExpandIcon = () => (
  <svg {...BASE}>
    <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" />
  </svg>
);

export function IconButton({ label, onClick, children, pressed }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}
