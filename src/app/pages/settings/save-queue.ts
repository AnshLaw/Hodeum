import type { Settings, SettingsStore } from "../../../data/settings";

/** Saves settings one at a time, in the order they were made, so a slow write never lands after a newer one. */
export class SaveQueue {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: SettingsStore,
    private readonly onSaved: () => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  save(settings: Settings): Promise<void> {
    this.tail = this.tail.then(() => this.store.save(settings)).then(this.onSaved, this.onError);
    return this.tail;
  }
}
