import { COPY } from "../../lib/copy";
import type { AirplayNetwork } from "./phone-source";
import type { AirplayNetworkChoice } from "./prefs";

/** What the notch tells the learner while AirPlay waits for the iPhone. */
export interface AirplayGuide {
  steps: string[];
  note?: string;
  /** The other network, for when this one doesn't suit (e.g. the iPhone is already on the laptop's Wi-Fi). */
  switchTo?: { network: AirplayNetworkChoice; label: string };
}

const TO_WIFI = { network: "wifi", label: COPY.phoneUseWifi } as const;
const TO_DIRECT = { network: "direct", label: COPY.phoneUseDirect } as const;

export function airplayGuide(network: AirplayNetwork | undefined): AirplayGuide {
  switch (network?.kind) {
    case "usb":
      return { steps: [COPY.phoneUsbLinked, COPY.phoneMirrorToHodeum], switchTo: TO_WIFI };
    case "hotspot":
      return { steps: [COPY.phoneJoinHotspot(network.ssid, network.passphrase), COPY.phoneMirrorToHodeum], note: COPY.phoneUsbTip, switchTo: TO_WIFI };
    case "wifi":
      return { steps: [COPY.phoneSameWifi, COPY.phoneMirrorToHodeum], note: network.problem ?? undefined, switchTo: TO_DIRECT };
    default:
      return { steps: [COPY.phoneWaitingAirplay] };
  }
}
