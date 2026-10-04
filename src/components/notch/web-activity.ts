import { COPY } from "../../lib/copy";
import type { WebProgress } from "../../providers/web/types";
import type { NotchView } from "./notch-view";

/** The app's web search as the notch tracks it: the latest step, and whether the answer is done. */
export interface WebActivity {
  progress: Exclude<WebProgress, { state: "finished" }>;
  finished: boolean;
}

export function nextWebActivity(current: WebActivity | undefined, progress: WebProgress): WebActivity | undefined {
  if (progress.state !== "finished") return { progress, finished: false };
  // Finished while still searching means the learner stopped it: nothing left to show.
  return current && current.progress.state !== "searching" ? { ...current, finished: true } : undefined;
}

/** The notch card for a web search: the exact query, then where the answer comes from, or that the web was out of reach. */
export function webSearchView({ progress, finished }: WebActivity): NotchView {
  const base = { size: "guidance", eyebrow: COPY.webEyebrow } as const;
  switch (progress.state) {
    case "searching":
      return { ...base, mode: "status", title: COPY.searchingWeb(progress.query), detail: COPY.webOnlyQuery, busy: true, controls: ["stop_search"] };
    case "found": {
      const title = progress.hosts.length > 0 ? COPY.webFound(progress.hosts.length) : COPY.webNothing;
      return { ...base, mode: "status", title, detail: progress.hosts.join(" · ") || undefined, busy: !finished, controls: finished ? ["dismiss"] : ["stop_search"] };
    }
    case "failed":
      return { ...base, mode: "error", title: COPY.webFallback, busy: false, controls: finished ? ["dismiss"] : ["stop_search"] };
  }
}
