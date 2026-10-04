import type { CloudProvider } from "../../data/settings";

export type KeyPresence = Record<CloudProvider, boolean>;

export const NO_KEYS: KeyPresence = { gemini: false, elevenlabs: false, backboard: false };

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Which cloud keys are saved in Windows Credential Manager. Keys go in, never come back out. */
export class CloudKeys {
  private presence: KeyPresence = NO_KEYS;

  constructor(private readonly invoke: Invoke) {}

  current(): KeyPresence {
    return this.presence;
  }

  /** Re-reads presence; on failure keeps every key treated as missing, so cloud stays off. */
  async refresh(): Promise<KeyPresence> {
    try {
      this.presence = await this.invoke<KeyPresence>("cloud_key_status");
    } catch (error) {
      console.error("Couldn't read which cloud keys are saved; cloud stays off", error);
      this.presence = NO_KEYS;
    }
    return this.presence;
  }

  async save(provider: CloudProvider, key: string): Promise<void> {
    await this.invoke<void>("cloud_key_set", { provider, key });
    await this.refresh();
  }

  async clear(provider: CloudProvider): Promise<void> {
    await this.invoke<void>("cloud_key_clear", { provider });
    await this.refresh();
  }
}
