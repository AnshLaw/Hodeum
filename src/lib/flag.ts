/** A value that changes over time: read it now, or hear each change. */
export interface Watchable<T> {
  current(): T;
  subscribe(listener: (value: T) => void): () => void;
}

/** An on/off state other parts can watch, e.g. Hodey talking or a conversation open. */
export class Flag implements Watchable<boolean> {
  private value = false;
  private readonly listeners = new Set<(value: boolean) => void>();

  current(): boolean {
    return this.value;
  }

  subscribe(listener: (value: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  set(value: boolean): void {
    if (value === this.value) return;
    this.value = value;
    this.listeners.forEach((listener) => listener(value));
  }
}
