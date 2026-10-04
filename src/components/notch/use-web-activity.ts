import { useEffect, useState } from "react";
import type { Bus } from "../../lib/bus";
import { nextWebActivity, type WebActivity } from "./web-activity";

/** How long the result card stays after the answer is done, unless the learner closes it. */
const WEB_CARD_LINGER_MS = 4000;
/** Past the app's own reply timeout: if the app never says it's finished (it crashed), the card goes anyway. */
const WEB_CARD_STALE_MS = 75_000;

/** The app's web search, mirrored from the bus, with a way to close the card. */
export function useWebActivity(bus: Bus): [WebActivity | undefined, () => void] {
  const [activity, setActivity] = useState<WebActivity>();
  useEffect(() => bus.on("web:search", (progress) => setActivity((current) => nextWebActivity(current, progress))), [bus]);
  useEffect(() => {
    if (!activity) return;
    const timer = setTimeout(() => setActivity(undefined), activity.finished ? WEB_CARD_LINGER_MS : WEB_CARD_STALE_MS);
    return () => clearTimeout(timer);
  }, [activity]);
  return [activity, () => setActivity(undefined)];
}
