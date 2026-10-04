import type { Loopback } from "./service";
import type { GoogleCallback } from "./types";

/** Emitted by Rust once the sign-in page comes back to the loopback (or it times out). */
const CALLBACK_EVENT = "account:callback";

interface CallbackPayload {
  idToken?: string;
  state?: string;
  error?: string;
}

export interface TauriLoopbackDeps {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): () => void;
}

/** The Rust side of desktop sign-in: a one-shot server on 127.0.0.1 and the system browser. */
export class TauriLoopback implements Loopback {
  private callback: Promise<GoogleCallback> | undefined;

  constructor(private readonly deps: TauriLoopbackDeps) {}

  async listen(state: string): Promise<string> {
    this.callback = new Promise((resolve, reject) => {
      const off = this.deps.listen<CallbackPayload>(CALLBACK_EVENT, ({ idToken, state, error }) => {
        off();
        if (idToken && state) resolve({ idToken, state });
        else reject(new Error(error ?? "Sign-in was cancelled."));
      });
    });
    return this.deps.invoke<string>("auth_listen", { state });
  }

  waitForCallback(): Promise<GoogleCallback> {
    return this.callback ?? Promise.reject(new Error("Sign-in isn't listening for the browser yet."));
  }

  openBrowser(url: string): Promise<void> {
    return this.deps.invoke<void>("open_url", { url });
  }
}
