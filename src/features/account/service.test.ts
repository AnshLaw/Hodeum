import { describe, expect, it } from "vitest";
import { LocalBus } from "../../lib/bus";
import { AccountService, type AuthBackend, type Loopback, type SyncSession } from "./service";
import type { AccountStatus, AccountUser, SyncStatus } from "./types";

const ANSH: AccountUser = { id: "u1", email: "learner@example.com", name: "Learner" };
const REDIRECT = "http://127.0.0.1:47615/auth/callback";

class FakeBackend implements AuthBackend {
  current: AccountUser | undefined;
  exchanged: string[] = [];
  private listener: ((user?: AccountUser) => void) | undefined;

  async user() {
    return this.current;
  }
  onUserChange(listener: (user?: AccountUser) => void) {
    this.listener = listener;
    return () => (this.listener = undefined);
  }
  async authorizeUrl(redirectTo: string) {
    return `https://project.supabase.co/auth/v1/authorize?redirect_to=${redirectTo}`;
  }
  async exchangeCode(code: string) {
    if (code === "bad") throw new Error("invalid code");
    this.exchanged.push(code);
    this.current = ANSH;
    this.listener?.(ANSH);
  }
  async signOut() {
    this.current = undefined;
    this.listener?.(undefined);
  }
}

class FakeLoopback implements Loopback {
  opened: string[] = [];
  constructor(private readonly outcome: { code?: string; error?: string }) {}
  async listen() {
    return REDIRECT;
  }
  async waitForCode() {
    if (this.outcome.error) throw new Error(this.outcome.error);
    return this.outcome.code ?? "";
  }
  async openBrowser(url: string) {
    this.opened.push(url);
  }
}

class FakeSession implements SyncSession {
  running = false;
  private listener: ((status: SyncStatus) => void) | undefined;
  start() {
    this.running = true;
    this.listener?.({ state: "idle", lastSyncedAt: "2026-10-03T10:00:00.000Z" });
  }
  stop() {
    this.running = false;
  }
  status(): SyncStatus {
    return { state: "idle" };
  }
  subscribe(listener: (status: SyncStatus) => void) {
    this.listener = listener;
    return () => (this.listener = undefined);
  }
}

function setup(loopback = new FakeLoopback({ code: "abc" }), backend: AuthBackend | "none" = new FakeBackend()) {
  const bus = new LocalBus();
  const sessions: FakeSession[] = [];
  let paused = false;
  let owner: AccountUser | undefined;
  const service = new AccountService({
    backend: backend === "none" ? undefined : backend,
    loopback,
    bus,
    session: () => {
      const session = new FakeSession();
      sessions.push(session);
      return session;
    },
    prefs: { paused: () => paused, setPaused: (next) => (paused = next), owner: () => owner, setOwner: (next) => (owner = next) },
  });
  const seen: AccountStatus[] = [];
  bus.on("account:status", (status) => seen.push(status));
  return { bus, service, sessions, seen, loopback, owner: () => owner, setOwner: (next: AccountUser) => (owner = next) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("AccountService", () => {
  it("says when this build has no account backend", async () => {
    const { bus, service, seen } = setup(undefined, "none");
    await service.start();
    bus.emit("account:status-request", {});
    expect(seen.at(-1)).toMatchObject({ configured: false, phase: "signed-out" });
  });

  it("signs in through the browser and starts syncing", async () => {
    const { bus, service, sessions, seen, loopback } = setup();
    await service.start();
    bus.emit("account:sign-in", {});
    await settle();
    expect(loopback.opened[0]).toContain(encodeURI(REDIRECT));
    expect(seen.some((s) => s.phase === "signing-in")).toBe(true);
    expect(seen.at(-1)).toMatchObject({ phase: "signed-in", user: { email: "learner@example.com" }, sync: { state: "idle" } });
    expect(sessions[0].running).toBe(true);
  });

  it("shows why sign-in failed and stays signed out", async () => {
    const { bus, service, sessions, seen } = setup(new FakeLoopback({ error: "access_denied" }));
    await service.start();
    bus.emit("account:sign-in", {});
    await settle();
    expect(seen.at(-1)).toMatchObject({ phase: "signed-out", error: "access_denied" });
    expect(sessions).toEqual([]);
  });

  it("can stop waiting for the browser, and ignores a code that arrives afterwards", async () => {
    let deliver: (code: string) => void = () => {};
    const loopback = new FakeLoopback({});
    loopback.waitForCode = () => new Promise<string>((resolve) => (deliver = resolve));
    const { bus, service, sessions, seen } = setup(loopback);
    await service.start();
    bus.emit("account:sign-in", {});
    await settle();
    bus.emit("account:cancel", {});
    expect(seen.at(-1)).toMatchObject({ phase: "signed-out" });
    deliver("late");
    await settle();
    expect(service.status().phase).toBe("signed-out");
    expect(sessions).toEqual([]);
  });

  it("pauses and resumes sync without signing out", async () => {
    const { bus, service, sessions, seen } = setup();
    await service.start();
    bus.emit("account:sign-in", {});
    await settle();
    bus.emit("account:pause", { paused: true });
    expect(sessions[0].running).toBe(false);
    expect(seen.at(-1)).toMatchObject({ phase: "signed-in", paused: true, sync: { state: "off" } });
    bus.emit("account:pause", { paused: false });
    expect(sessions[1].running).toBe(true);
  });

  it("stops syncing on sign-out", async () => {
    const { bus, service, sessions, seen } = setup();
    await service.start();
    bus.emit("account:sign-in", {});
    await settle();
    bus.emit("account:sign-out", {});
    await settle();
    expect(sessions[0].running).toBe(false);
    expect(seen.at(-1)).toMatchObject({ phase: "signed-out", sync: { state: "off" } });
  });

  it("ties this PC's data to the first account that syncs it", async () => {
    const { bus, service, owner } = setup();
    await service.start();
    bus.emit("account:sign-in", {});
    await settle();
    expect(owner()).toMatchObject({ id: "u1" });
  });

  it("never syncs this PC's data into a different account", async () => {
    const backend = new FakeBackend();
    backend.current = { id: "u2", email: "someone-else@example.com" };
    const { service, sessions, setOwner } = setup(new FakeLoopback({}), backend);
    setOwner(ANSH);
    await service.start();
    expect(sessions).toEqual([]);
    expect(service.status()).toMatchObject({ phase: "signed-in", sync: { state: "blocked", error: expect.stringContaining("learner@example.com") } });
  });

  it("resumes a saved session at boot", async () => {
    const backend = new FakeBackend();
    backend.current = ANSH;
    const { service, sessions } = setup(new FakeLoopback({}), backend);
    await service.start();
    expect(service.status().phase).toBe("signed-in");
    expect(sessions[0].running).toBe(true);
  });
});
