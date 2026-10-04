import type { Bus } from "../../lib/bus";
import type { AccountStatus, AccountUser, GoogleCallback, SignInAttempt, SyncStatus } from "./types";

/** Supabase Auth, narrowed to what the desktop needs. */
export interface AuthBackend {
  user(): Promise<AccountUser | undefined>;
  onUserChange(listener: (user?: AccountUser) => void): () => void;
  /** Starts an attempt: its state (for the listener) and Hodeum's sign-in page for a redirect. The nonce stays here. */
  begin(): Promise<SignInAttempt>;
  /** Checks the state and signs in to Supabase with Google's ID token. */
  finish(callback: GoogleCallback): Promise<void>;
  signOut(): Promise<void>;
}

/** The system browser and the one-shot callback server on 127.0.0.1 (Rust). */
export interface Loopback {
  /** Starts listening for the sign-in with this state (others are ignored); returns the redirect URL. */
  listen(state: string): Promise<string>;
  /** What the sign-in page sent back, or a rejection with its error. */
  waitForCallback(): Promise<GoogleCallback>;
  openBrowser(url: string): Promise<void>;
}

/** Sync plus the web command channel for one signed-in learner. */
export interface SyncSession {
  start(): void;
  stop(): void;
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
}

/** Choices about this PC, so they aren't synced. */
export interface AccountPrefs {
  paused(): boolean;
  setPaused(paused: boolean): void;
  /** The account this PC's local data belongs to: the first one that synced it. */
  owner(): AccountUser | undefined;
  setOwner(user: AccountUser): void;
}

/** Local data is one learner's; it must never be uploaded to (or have deletions applied in) another account. */
export function otherAccountMessage(owner: AccountUser): string {
  return `This PC's learning belongs to another Hodeum account (${owner.email ?? owner.name ?? owner.id}), so it won't sync here. Sign in with that account to sync.`;
}

export interface AccountServiceDeps {
  /** Absent when this build has no Supabase project. */
  backend?: AuthBackend;
  loopback: Loopback;
  bus: Bus;
  session: (user: AccountUser) => SyncSession;
  prefs: AccountPrefs;
}

const OFF: SyncStatus = { state: "off" };
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Owns sign-in and sync in the notch window; the app window drives it over the bus. */
export class AccountService {
  private current: AccountStatus;
  private session: { user: AccountUser; sync: SyncSession; off: () => void } | undefined;
  /** Bumped by each sign-in and by cancel, so a late browser callback can't sign in after a cancel. */
  private attempt = 0;

  constructor(private readonly deps: AccountServiceDeps) {
    this.current = { configured: deps.backend !== undefined, phase: "signed-out", paused: deps.prefs.paused(), sync: OFF };
  }

  status(): AccountStatus {
    return this.current;
  }

  async start(): Promise<void> {
    const { bus, backend } = this.deps;
    bus.on("account:status-request", () => this.broadcast());
    bus.on("account:sign-in", () => void this.signIn());
    bus.on("account:cancel", () => this.cancel());
    bus.on("account:sign-out", () => void this.signOut());
    bus.on("account:pause", ({ paused }) => this.setPaused(paused));
    if (!backend) return this.broadcast();
    backend.onUserChange((user) => this.userChanged(user));
    try {
      this.userChanged(await backend.user());
    } catch (error) {
      console.error("Couldn't restore the saved sign-in", error);
      this.update({ error: `Couldn't restore your sign-in: ${errorText(error)}` });
    }
  }

  async signIn(): Promise<void> {
    const { backend, loopback } = this.deps;
    if (!backend || this.current.phase !== "signed-out") return;
    const attempt = ++this.attempt;
    this.update({ phase: "signing-in", error: undefined });
    try {
      const signIn = await backend.begin();
      const redirect = await loopback.listen(signIn.state);
      const callback = loopback.waitForCallback();
      await loopback.openBrowser(signIn.url(redirect));
      const received = await callback;
      if (attempt === this.attempt) await backend.finish(received);
    } catch (error) {
      console.error("Google sign-in failed", error);
      if (attempt === this.attempt) this.update({ phase: "signed-out", error: errorText(error) });
    }
  }

  cancel(): void {
    if (this.current.phase !== "signing-in") return;
    this.attempt++;
    this.update({ phase: "signed-out", error: undefined });
  }

  async signOut(): Promise<void> {
    if (!this.deps.backend) return;
    try {
      await this.deps.backend.signOut();
    } catch (error) {
      console.error("Sign-out failed", error);
      this.update({ error: `Couldn't sign out: ${errorText(error)}` });
    }
  }

  setPaused(paused: boolean): void {
    this.deps.prefs.setPaused(paused);
    this.update({ paused });
    this.reconcile();
  }

  private userChanged(user?: AccountUser): void {
    if (user) this.update({ phase: "signed-in", user, error: undefined });
    else if (this.current.phase !== "signing-in") this.update({ phase: "signed-out", user: undefined });
    this.reconcile();
  }

  /** A session runs exactly while someone is signed in and sync isn't paused. */
  private reconcile(): void {
    const user = this.current.phase === "signed-in" ? this.current.user : undefined;
    const want = user && !this.current.paused ? user : undefined;
    if (this.session && this.session.user.id === want?.id) return;
    if (this.session) {
      this.session.off();
      this.session.sync.stop();
      this.session = undefined;
    }
    if (!want) return this.update({ sync: OFF });
    const owner = this.deps.prefs.owner();
    if (owner && owner.id !== want.id) return this.update({ sync: { state: "blocked", error: otherAccountMessage(owner) } });
    if (!owner) this.deps.prefs.setOwner(want);
    const sync = this.deps.session(want);
    const off = sync.subscribe((status) => this.update({ sync: status }));
    this.session = { user: want, sync, off };
    this.update({ sync: sync.status() });
    sync.start();
  }

  private update(patch: Partial<AccountStatus>): void {
    this.current = { ...this.current, ...patch };
    this.broadcast();
  }

  private broadcast(): void {
    this.deps.bus.emit("account:status", this.current);
  }
}
