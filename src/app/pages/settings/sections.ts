/** Settings cards in page order; each card's element id, and its name in the jump bar. */
export const SECTION_ID = {
  hodey: "settings-hodey",
  look: "settings-look",
  screen: "settings-screen",
  keys: "settings-keys",
  privacy: "settings-privacy",
  ai: "settings-ai",
  cloud: "settings-cloud",
  account: "settings-account",
} as const;

export const SETTINGS_SECTIONS: { id: string; label: string }[] = [
  { id: SECTION_ID.hodey, label: "Hodey" },
  { id: SECTION_ID.look, label: "Look & feel" },
  { id: SECTION_ID.screen, label: "On screen" },
  { id: SECTION_ID.keys, label: "Keys" },
  { id: SECTION_ID.privacy, label: "Privacy" },
  { id: SECTION_ID.ai, label: "Local AI" },
  { id: SECTION_ID.cloud, label: "Cloud" },
  { id: SECTION_ID.account, label: "Account" },
];

/**
 * The section being read: the last one whose top has scrolled past `line`, or the last one
 * at the bottom of the page, where short final sections can never reach the line.
 */
export function activeSection(tops: { id: string; top: number }[], line: number, atBottom: boolean): string | undefined {
  if (tops.length === 0) return undefined;
  if (atBottom) return tops[tops.length - 1].id;
  let current = tops[0].id;
  for (const { id, top } of tops) if (top <= line) current = id;
  return current;
}
