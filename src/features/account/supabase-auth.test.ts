import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseAuth } from "./supabase-auth";

const SITE = "https://hodeum.vercel.app";
const LOOPBACK = "http://127.0.0.1:47615/auth/callback";

function fakeClient() {
  const calls: { provider: string; token: string; nonce?: string }[] = [];
  const client = {
    auth: {
      signInWithIdToken: async (credentials: { provider: string; token: string; nonce?: string }) => {
        calls.push(credentials);
        return { data: {}, error: null };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("SupabaseAuth (desktop)", () => {
  it("sends the browser to Hodeum's sign-in page and signs in with the token it returns", async () => {
    const { client, calls } = fakeClient();
    const auth = new SupabaseAuth(client, SITE);
    const url = new URL(await auth.authorizeUrl(LOOPBACK));
    expect(url.origin + url.pathname).toBe(`${SITE}/signin.html`);
    expect(url.searchParams.get("redirect")).toBe(LOOPBACK);
    const state = url.searchParams.get("state") ?? "";
    await auth.finish({ idToken: "eyJ.a.b", state });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: "google", token: "eyJ.a.b" });
    // Supabase gets the raw nonce; the page (and Google) only ever saw its hash.
    expect(calls[0].nonce).not.toBe(url.searchParams.get("nonce"));
  });

  it("refuses a token that comes back with the wrong state", async () => {
    const { client, calls } = fakeClient();
    const auth = new SupabaseAuth(client, SITE);
    await auth.authorizeUrl(LOOPBACK);
    await expect(auth.finish({ idToken: "eyJ.a.b", state: "forged" })).rejects.toThrow(/didn't match/);
    expect(calls).toEqual([]);
  });

  it("uses each sign-in attempt once", async () => {
    const { client } = fakeClient();
    const auth = new SupabaseAuth(client, SITE);
    const state = new URL(await auth.authorizeUrl(LOOPBACK)).searchParams.get("state") ?? "";
    await auth.finish({ idToken: "eyJ.a.b", state });
    await expect(auth.finish({ idToken: "eyJ.a.b", state })).rejects.toThrow();
  });
});
