import { knownAppId } from "../../features/apps/resolve";

/**
 * Apps whose names may go into a web query. Only these: an app name comes from the learner's window,
 * and anything off this list (an exe stem, a window title) could carry something personal.
 */
interface SearchableApp {
  id: string;
  /** How a person would name the app in a search engine. */
  searchName: string;
  /** Words in a question that mean the learner is asking about this app. */
  mentions: RegExp;
}

const APPS: readonly SearchableApp[] = [
  { id: "excel", searchName: "Excel", mentions: /\bexcel\b|\bspreadsheet/i },
  { id: "word", searchName: "Microsoft Word", mentions: /\bms word\b|\bmicrosoft word\b|\bin word\b/i },
  { id: "powerpoint", searchName: "PowerPoint", mentions: /\bpower ?point\b|\bppt\b/i },
  { id: "file-explorer", searchName: "File Explorer Windows 11", mentions: /\bfile explorer\b|\bexplorer\b/i },
  { id: "settings", searchName: "Windows 11 Settings", mentions: /\bsettings\b/i },
  { id: "calculator", searchName: "Windows Calculator", mentions: /\bcalculator\b|\bcalc\b/i },
  { id: "notepad", searchName: "Windows Notepad", mentions: /\bnote ?pad\b/i },
  { id: "paint", searchName: "Windows Paint", mentions: /\bms paint\b|\bin paint\b/i },
  { id: "brave", searchName: "Brave browser", mentions: /\bbrave\b/i },
  { id: "chrome", searchName: "Chrome", mentions: /\bchrome\b/i },
  { id: "edge", searchName: "Microsoft Edge", mentions: /\bedge browser\b|\bmicrosoft edge\b|\bin edge\b/i },
  { id: "whatsapp", searchName: "WhatsApp Desktop", mentions: /\bwhats ?app\b/i },
];

/** The stable id for an app id or friendly name ("File Explorer" → "file-explorer"), if it's a known app. */
export function searchableAppId(nameOrId: string | undefined): string | undefined {
  if (!nameOrId?.trim()) return undefined;
  const id = APPS.some((a) => a.id === nameOrId) ? nameOrId : knownAppId(nameOrId);
  return APPS.some((a) => a.id === id) ? id : undefined;
}

export function searchName(appId: string | undefined): string | undefined {
  return APPS.find((a) => a.id === appId)?.searchName;
}

/** Apps the question names itself, e.g. "in WhatsApp". */
export function appsMentioned(question: string): string[] {
  return APPS.filter((a) => a.mentions.test(question)).map((a) => a.id);
}
