import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Rect } from "../lib/types";
import { HodeumApp } from "../app/App";
import { fold, unfold } from "../app/unfold";
import type { StageEnvironment } from "./environment";

/** Viewport rect -> rect relative to `element`. */
function relativeTo(rect: Rect, element: HTMLElement): Rect {
  const box = element.getBoundingClientRect();
  return { x: rect.x - box.left, y: rect.y - box.top, width: rect.width, height: rect.height };
}

function AppFrame({ env, from, onClosed }: { env: StageEnvironment; from?: Rect; onClosed: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const local = useRef<Rect | undefined>(undefined);
  const closing = useRef(false);
  const close = () => {
    const element = frame.current;
    if (!element || closing.current) return;
    closing.current = true;
    fold(element, local.current).finished.then(onClosed, onClosed);
  };
  const services = useMemo(() => env.appServices(close), [env]); // eslint-disable-line react-hooks/exhaustive-deps -- close is stable for this frame
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    local.current = from ? relativeTo(from, element) : undefined;
    unfold(element, local.current);
  }, [from]);
  return (
    <div ref={frame} className="stage-app" role="dialog" aria-label="Hodeum">
      <HodeumApp services={services} />
    </div>
  );
}

/** In the stage the desktop app is an in-page window that unfolds from the notch, like the native one. */
export function StageAppWindow({ env }: { env: StageEnvironment }) {
  const [opening, setOpening] = useState<{ from?: Rect; key: number }>();
  useEffect(() => env.shell.onOpenApp((from) => setOpening({ from, key: Date.now() })), [env]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.code === "KeyJ") {
        event.preventDefault();
        setOpening((current) => current ?? { key: Date.now() });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!opening) return null;
  return <AppFrame key={opening.key} env={env} from={opening.from} onClosed={() => setOpening(undefined)} />;
}
