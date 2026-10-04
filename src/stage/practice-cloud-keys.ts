import type { CloudKeyService } from "../app/services";
import type { CloudProvider } from "../data/settings";
import { NO_KEYS, type KeyPresence } from "../providers/cloud/keys";

/** Typing this key in the practice stage fails the save, to rehearse the error message. */
export const PRACTICE_FAILING_KEY = "fail";

/** The stage's stand-in for Windows Credential Manager: it keeps only whether a key was saved. */
export class PracticeCloudKeys implements CloudKeyService {
  private presence: KeyPresence = NO_KEYS;

  current(): KeyPresence {
    return this.presence;
  }

  async refresh(): Promise<KeyPresence> {
    return this.presence;
  }

  async save(provider: CloudProvider, key: string): Promise<void> {
    if (key === PRACTICE_FAILING_KEY) throw new Error("the practice stage refused this key on purpose");
    this.presence = { ...this.presence, [provider]: true };
  }

  async clear(provider: CloudProvider): Promise<void> {
    this.presence = { ...this.presence, [provider]: false };
  }
}
