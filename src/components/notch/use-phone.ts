import { useEffect, useState, type RefObject } from "react";
import type { HodeState } from "../../features/hode/model";
import type { PhoneMirror } from "../../features/phone/phone-mirror";
import { loadPhonePrefs } from "../../features/phone/prefs";
import { reportError } from "../../lib/errors";
import type { NativeShell } from "../../lib/shell";
import type { Size } from "../../lib/types";
import { usePhoneMirror } from "./PhonePanel";
import { frameAspect, phoneScreenSize, visibleRoom, type PhoneArrangement } from "./phone-layout";

/** The notch's size spring (520 ms in notch.css) plus a little slack, so shrinking finishes before the window does. */
const NOTCH_MORPH_MS = 600;

function openWithLastSource(phone: PhoneMirror): void {
  void phone.open(loadPhonePrefs().source);
}

/** The iPhone mirror from the notch's side: opens with a phone Hode, and toggles from the menu. */
export function usePhoneControls(phone: PhoneMirror | undefined, state: HodeState, closeMenu: () => void) {
  const { open } = usePhoneMirror(phone);
  const phoneHode = state.pack?.surface === "phone" && state.phase !== "idle";
  useEffect(() => {
    if (phone && phoneHode && !phone.isOpen()) openWithLastSource(phone);
  }, [phone, phoneHode]);
  const onTogglePhone = phone
    ? () => {
        closeMenu();
        if (phone.isOpen()) void phone.close();
        else openWithLastSource(phone);
      }
    : undefined;
  return { phoneOpen: open, onTogglePhone };
}

/** Grows the top notch window at once for the mirror; shrinks it only after the notch has animated back. */
export function useTallNotch(shell: NativeShell, tall: boolean): void {
  useEffect(() => {
    const apply = (value: boolean) => shell.setNotchTall(value).catch(reportError("Couldn't resize Hodey's window for the iPhone"));
    if (tall) {
      apply(true);
      return;
    }
    const timer = setTimeout(() => apply(false), NOTCH_MORPH_MS);
    return () => clearTimeout(timer);
  }, [shell, tall]);
}

const sameSize = (a: Size | undefined, b: Size) => a !== undefined && a.width === b.width && a.height === b.height;

/** The on-screen room of the surface's container (the notch window, or the stage desktop), kept current. */
function useRoom(stageRef: RefObject<HTMLElement | null>, active: boolean): Size | undefined {
  const [room, setRoom] = useState<Size>();
  useEffect(() => {
    const container = stageRef.current?.parentElement;
    if (!active || !container) return;
    const measure = () => {
      const { x, y, width, height } = container.getBoundingClientRect();
      const next = visibleRoom({ x, y, width, height }, { width: window.innerWidth, height: window.innerHeight });
      setRoom((current) => (sameSize(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [stageRef, active]);
  return room;
}

/** How big the mirrored screen is drawn: as large as the room allows, in the incoming frames' shape. */
export function usePhoneScreen(mirror: PhoneMirror | undefined, stageRef: RefObject<HTMLElement | null>, arrangement: PhoneArrangement): Size | undefined {
  // Re-renders when the mirror goes live, which is when the first frame's size is known.
  const { open } = usePhoneMirror(mirror);
  const room = useRoom(stageRef, open);
  if (!open || !room) return undefined;
  return phoneScreenSize(room, frameAspect(mirror?.surface.size), arrangement);
}
