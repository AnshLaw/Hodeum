import { z } from "zod";
import browsers from "./browsers.json";
import calculator from "./calculator.json";
import excel from "./excel.json";
import fileExplorer from "./file-explorer.json";
import notepad from "./notepad.json";
import settings from "./settings.json";
import whatsapp from "./whatsapp.json";

/**
 * Offline how-to help for the demo apps, written by hand from each vendor's help page (linked as the
 * source). Hodey grounds answers in it with no network at all; web search, when on, covers the rest.
 */
const helpEntrySchema = z.object({
  id: z.string().min(1),
  /** Stable app id ("excel", "file-explorer", …), as in `knownAppId`. */
  app: z.string().min(1),
  title: z.string().min(1),
  /** Words and phrases a learner would use for this task; phrases count more than single words. */
  keywords: z.array(z.string().min(1)).min(1),
  steps: z.array(z.string().min(1)).min(1),
  source: z.object({ title: z.string().min(1), url: z.string().url().startsWith("https://") }),
});

export type HelpEntry = z.infer<typeof helpEntrySchema>;

export const HELP_ENTRIES: readonly HelpEntry[] = z.array(helpEntrySchema).parse([...excel, ...fileExplorer, ...settings, ...notepad, ...calculator, ...browsers, ...whatsapp]);
