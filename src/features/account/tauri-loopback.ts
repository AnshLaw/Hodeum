import type { Loopback } from "./service";

/** Emitted by Rust once the browser lands on the loopback (or it times out). */
const CALLBACK_EVENT = "account:callback";

interface CallbackPayload {
  code?: string;
  error?: string;
}

export interface TauriLoopbackDeps {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): () => void;
}

/** The Rust side of Google sign-in: a one-shot server on 127.0.0.1 and the system browser. */
export class TauriLoopback implements Loopback {
  private code: Promise<string> | undefined;

  constructor(private readonly deps: TauriLoopbackDeps) {}

  async listen(): Promise<string> {
    this.code = new Promise((resolve, reject) => {
      const off = this.deps.listen<CallbackPayload>(CALLBACK_EVENT, ({ code, error }) => {
        off();
        if (code) resolve(code);
        else reject(new Error(error ?? "Sign-in was cancelled."));
      });
    });
    return this.deps.invoke<string>("auth_listen");
  }

  waitForCode(): Promise<string> {
    return this.code ?? Promise.reject(new Error("Sign-in isn't listening for the browser yet."));
  }

  openBrowser(url: string): Promise<void> {
    return this.deps.invoke<void>("open_url", { url });
  }
}
