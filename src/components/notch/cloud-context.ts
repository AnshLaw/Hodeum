import { createContext, useContext, useEffect, useState } from "react";
import type { CloudState } from "../../providers/cloud/policy";

/** The cloud policy, for the Local/Cloud badge. Absent (browser stage, tests) means Local. */
export const CloudContext = createContext<CloudState | undefined>(undefined);

export function useEnhanced(): boolean {
  const cloud = useContext(CloudContext);
  const [enhanced, setEnhanced] = useState(() => cloud?.enhanced() ?? false);
  useEffect(() => {
    if (!cloud) return;
    setEnhanced(cloud.enhanced());
    return cloud.subscribe(() => setEnhanced(cloud.enhanced()));
  }, [cloud]);
  return enhanced;
}
