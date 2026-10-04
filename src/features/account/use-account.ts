import { useEffect, useState } from "react";
import type { Bus } from "../../lib/bus";
import type { AccountStatus } from "./types";

/** The account as the notch reports it; undefined until the notch answers (or where there's no notch). */
export function useAccount(bus: Bus): AccountStatus | undefined {
  const [status, setStatus] = useState<AccountStatus>();
  useEffect(() => {
    const off = bus.on("account:status", setStatus);
    bus.emit("account:status-request", {});
    return off;
  }, [bus]);
  return status;
}
