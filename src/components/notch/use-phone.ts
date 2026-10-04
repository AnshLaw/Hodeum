import { useEffect } from "react";
import type { HodeState } from "../../features/hode/model";
import type { PhoneMirror } from "../../features/phone/phone-mirror";
import { loadPhonePrefs } from "../../features/phone/prefs";
import { usePhoneMirror } from "./PhonePanel";

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
