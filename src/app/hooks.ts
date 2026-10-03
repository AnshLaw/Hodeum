import { useCallback, useEffect, useState } from "react";
import type { Bus, HodeSummary } from "../lib/bus";
import { isLiveHode } from "./view";

export type Loadable<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "error"; message: string };

/** Loads data and reloads whenever local data changes (a Hode logged, settings saved, a skill adjusted). */
export function useLiveQuery<T>(bus: Bus, load: () => Promise<T>, deps: unknown[]): [Loadable<T>, () => void] {
  const [result, setResult] = useState<Loadable<T>>({ state: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => bus.on("data:changed", reload), [bus, reload]);
  useEffect(() => {
    let alive = true;
    load().then(
      (value) => alive && setResult({ state: "ready", value }),
      (error) => {
        console.error("Loading Hodeum data failed", error);
        if (alive) setResult({ state: "error", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is described by `deps`
  }, [version, ...deps]);
  return [result, reload];
}

/** The Hode running in the notch, if any, kept live over the bus. */
export function useLiveHode(bus: Bus): HodeSummary | undefined {
  const [summary, setSummary] = useState<HodeSummary>();
  useEffect(() => {
    const off = bus.on("hode:summary", (next) => setSummary(isLiveHode(next) ? next : undefined));
    bus.emit("hode:summary-request", {});
    return off;
  }, [bus]);
  return summary;
}
