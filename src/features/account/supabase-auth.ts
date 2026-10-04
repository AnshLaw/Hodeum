import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createNonce, desktopSignInUrl } from "./google-identity";
import type { AuthBackend } from "./service";
import type { AccountUser, GoogleCallback, SignInAttempt } from "./types";

const STATE_BYTES = 16;

export function accountUser(user: User | undefined | null): AccountUser | undefined {
  if (!user) return undefined;
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  return { id: user.id, email: user.email, name: meta?.full_name ?? meta?.name };
}

const randomState = () => [...crypto.getRandomValues(new Uint8Array(STATE_BYTES))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Desktop sign-in: the browser signs in with Google on Hodeum's site, which hands the ID token
 * back to this PC; Supabase checks it (and the nonce inside it) with `signInWithIdToken`.
 */
export class SupabaseAuth implements AuthBackend {
  private attempt: { state: string; rawNonce: string } | undefined;

  constructor(
    private readonly client: SupabaseClient,
    private readonly siteUrl: string,
  ) {}

  async user(): Promise<AccountUser | undefined> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return accountUser(data.session?.user);
  }

  onUserChange(listener: (user?: AccountUser) => void): () => void {
    // Deferred: calling back into supabase-js from inside this callback deadlocks its auth lock.
    const { data } = this.client.auth.onAuthStateChange((_event, session) => setTimeout(() => listener(accountUser(session?.user)), 0));
    return () => data.subscription.unsubscribe();
  }

  async begin(): Promise<SignInAttempt> {
    const nonce = await createNonce();
    const state = randomState();
    this.attempt = { state, rawNonce: nonce.raw };
    return { state, url: (redirect) => desktopSignInUrl(this.siteUrl, { redirect, nonceHash: nonce.hashed, state }) };
  }

  async finish(callback: GoogleCallback): Promise<void> {
    const attempt = this.attempt;
    this.attempt = undefined;
    if (!attempt || callback.state !== attempt.state) throw new Error("The sign-in that came back didn't match this one. Try again from Hodeum.");
    const { error } = await this.client.auth.signInWithIdToken({ provider: "google", token: callback.idToken, nonce: attempt.rawNonce });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw error;
  }
}
