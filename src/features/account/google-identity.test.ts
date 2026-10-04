import { describe, expect, it } from "vitest";
import { callbackUrl, createNonce, desktopSignInUrl, isLoopbackCallback, readSignInRequest } from "./google-identity";

const SITE = "https://hodeum.vercel.app";
const LOOPBACK = "http://127.0.0.1:47615/auth/callback";

describe("google identity helpers", () => {
  it("makes a random nonce and the SHA-256 hex Google signs into the token", async () => {
    const a = await createNonce();
    const b = await createNonce();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hashed).toMatch(/^[0-9a-f]{64}$/);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(a.raw));
    expect(a.hashed).toBe([...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join(""));
  });

  it("only ever hands a token back to Hodeum's own listener on this PC", () => {
    expect(isLoopbackCallback(LOOPBACK)).toBe(true);
    expect(isLoopbackCallback("http://localhost:47615/auth/callback")).toBe(false);
    expect(isLoopbackCallback("http://127.0.0.1:8080/auth/callback")).toBe(false);
    expect(isLoopbackCallback("http://127.0.0.1/auth/callback")).toBe(false);
    expect(isLoopbackCallback("http://127.0.0.1:47615/auth/callback?x=1")).toBe(false);
    expect(isLoopbackCallback("https://evil.example/auth/callback")).toBe(false);
    expect(isLoopbackCallback("http://127.0.0.1.evil.example/auth/callback")).toBe(false);
    expect(isLoopbackCallback("http://127.0.0.1:47615/steal")).toBe(false);
    expect(isLoopbackCallback("javascript:alert(1)")).toBe(false);
    expect(isLoopbackCallback("not a url")).toBe(false);
  });

  it("round-trips the desktop's request through the sign-in page", () => {
    const url = new URL(desktopSignInUrl(SITE, { redirect: LOOPBACK, nonceHash: "abc", state: "s-1" }));
    expect(url.origin + url.pathname).toBe(`${SITE}/signin.html`);
    expect(readSignInRequest(url.search)).toEqual({ redirect: LOOPBACK, nonceHash: "abc", state: "s-1" });
  });

  it("refuses a sign-in request that would send the token anywhere else", () => {
    const url = new URL(desktopSignInUrl(SITE, { redirect: "https://evil.example/auth/callback", nonceHash: "abc", state: "s-1" }));
    expect(readSignInRequest(url.search)).toEqual({ error: expect.stringContaining("Hodeum app") });
    expect(readSignInRequest("?redirect=" + encodeURIComponent(LOOPBACK))).toEqual({ error: expect.any(String) });
  });

  it("builds the loopback URL with the token or the error, always with the state", () => {
    expect(callbackUrl(LOOPBACK, "s-1", { idToken: "eyJ.a.b" })).toBe(`${LOOPBACK}?id_token=eyJ.a.b&state=s-1`);
    expect(callbackUrl(LOOPBACK, "s-1", { error: "closed" })).toBe(`${LOOPBACK}?error=closed&state=s-1`);
  });
});
