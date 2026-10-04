import type { SVGProps } from "react";

const BASE: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const HomeIcon = () => (
  <svg {...BASE}>
    <path d="M3 8.2 9 3.5l6 4.7V15H11v-4H7v4H3z" />
  </svg>
);

export const HodesIcon = () => (
  <svg {...BASE}>
    <path d="M4 4.5h10M4 9h10M4 13.5h6" />
  </svg>
);

export const PathIcon = () => (
  <svg {...BASE}>
    <path d="M4 14h3v-3.5h3V7h4" />
    <circle cx="14" cy="4.5" r="1.6" />
  </svg>
);

export const ChatIcon = () => (
  <svg {...BASE}>
    <path d="M3.5 4.5h11v7.5H8.5L5 14.5V12H3.5z" />
  </svg>
);

export const GearIcon = () => (
  <svg {...BASE}>
    <circle cx="9" cy="9" r="2.3" />
    <path d="M9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2M4.4 4.4l1.4 1.4M12.2 12.2l1.4 1.4M4.4 13.6l1.4-1.4M12.2 5.8l1.4-1.4" />
  </svg>
);

export const MinimizeIcon = () => (
  <svg {...BASE}>
    <path d="M5 9h8" />
  </svg>
);

export const MaximizeIcon = () => (
  <svg {...BASE}>
    <rect x="5" y="5" width="8" height="8" rx="1.2" />
  </svg>
);

export const CloseWindowIcon = () => (
  <svg {...BASE}>
    <path d="M5.5 5.5l7 7M12.5 5.5l-7 7" />
  </svg>
);

export const SendIcon = () => (
  <svg {...BASE}>
    <path d="M3.5 9h9M9 4.5 13.5 9 9 13.5" />
  </svg>
);

export const WindowIcon = () => (
  <svg {...BASE}>
    <rect x="3" y="4" width="12" height="10" rx="1.5" />
    <path d="M3 7h12" />
  </svg>
);

export const GlobeIcon = () => (
  <svg {...BASE}>
    <circle cx="9" cy="9" r="6" />
    <path d="M3 9h12M9 3c1.8 1.8 2.6 3.8 2.6 6S10.8 13.2 9 15M9 3C7.2 4.8 6.4 6.8 6.4 9s.8 4.2 2.6 6" />
  </svg>
);
