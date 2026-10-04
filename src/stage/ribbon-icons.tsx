import type { ReactNode } from "react";

/** Simple line glyphs for the practice Excel ribbon, keyed by command name. Decorative: the name is the label. */
const GLYPHS: Record<string, ReactNode> = {
  Paste: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 9h6M9 13h6M9 17h4" />
    </>
  ),
  Bold: <path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z" />,
  "Merge & Center": (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M7 12h10M9 10l-2 2 2 2M15 10l2 2-2 2" />
    </>
  ),
  "Conditional Formatting": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9.5h18M3 14.5h18" />
      <rect x="6" y="11" width="9" height="2" className="fill" />
      <rect x="6" y="16" width="5" height="2" className="fill" />
    </>
  ),
  "Sort & Filter": <path d="M4 5h11l-4 6v6l-3 2v-8zM18 6v13M15.5 16.5 18 19l2.5-2.5" />,
  PivotTable: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      <rect x="3" y="3" width="18" height="5" className="fill" />
      <rect x="3" y="3" width="6" height="18" className="fill" />
      <path d="M9 13h12M15 8v13" />
    </>
  ),
  "Recommended PivotTables": (
    <>
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M3 8h14M8 3v14" />
      <path d="m18 13 1.2 2.6 2.8.4-2 2 .5 2.8-2.5-1.4-2.5 1.4.5-2.8-2-2 2.8-.4z" className="fill" />
    </>
  ),
  Table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 9h18M3 14.5h18M9 9v11M15 9v11" />
    </>
  ),
  Pictures: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <circle cx="9" cy="9.5" r="1.8" />
      <path d="m3 18 6-5 4 3 3-2 5 4" />
    </>
  ),
  "Recommended Charts": <path d="M4 20h16M6 20v-6M10.5 20V8M15 20v-9M19.5 20V5" />,
  "Insert Function": <path d="M10 4c-2 0-2.5 1.5-2.8 3.5L5.5 20M4.5 10h6M13 10l6 8M19 10l-6 8" />,
  AutoSum: <path d="M18 5H6l6 7-6 7h12" />,
  "Lookup & Reference": (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  "Get Data": (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  "Refresh All": <path d="M19 11a7 7 0 0 0-12.5-4.3L4 9M4 4v5h5M5 13a7 7 0 0 0 12.5 4.3L20 15M20 20v-5h-5" />,
  Sort: <path d="M5 4h5l-5 7h5M5 20l2.5-6 2.5 6M5.8 18h3.4M17 4v16M14 17l3 3 3-3" />,
  Filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
};

export function ribbonIcon(name: string): ReactNode | undefined {
  const glyph = GLYPHS[name];
  if (!glyph) return undefined;
  return (
    <svg className="mock-el__icon" viewBox="0 0 24 24" aria-hidden="true">
      {glyph}
    </svg>
  );
}
