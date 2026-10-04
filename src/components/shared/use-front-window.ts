import { useEffect, useState } from "react";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import type { WindowRef } from "../../lib/types";

/** The learner's front window as the native side reports it: null when none, undefined until it has said. */
export function useFrontWindow(shell: NativeShell): WindowRef | null | undefined {
  const [front, setFront] = useState<WindowRef | null>();
  useEffect(() => {
    let alive = true;
    const stop = shell.onLearnerWindow((next) => setFront(next));
    shell
      .learnerWindow()
      .then((next) => alive && setFront((known) => (known === undefined ? next : known)))
      .catch(reportError("Couldn't tell which window the learner is in"));
    return () => {
      alive = false;
      stop();
    };
  }, [shell]);
  return front;
}
