import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AuthBackend } from "./service";
import type { AccountUser } from "./types";

export function accountUser(user: User | undefined | null): AccountUser | undefined {
  if (!user) return undefined;
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined;
  return { id: user.id, email: user.email, name: meta?.full_name ?? meta?.name };
}

/** Google sign-in through Supabase Auth (PKCE: the verifier stays in this window's storage). */
export class SupabaseAuth implements AuthBackend {
  constructor(private readonly client: SupabaseClient) {}

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

  async authorizeUrl(redirectTo: string): Promise<string> {
    const { data, error } = await this.client.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } } });
    if (error) throw error;
    return data.url;
  }

  async exchangeCode(code: string): Promise<void> {
    const { error } = await this.client.auth.exchangeCodeForSession(code);
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw error;
  }
}
