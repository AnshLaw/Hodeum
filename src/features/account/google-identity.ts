/**
 * "Sign in with Google" on Hodeum's own site (Google Identity Services), so Google's screen names
 * Hodeum rather than the Supabase project. The ID token is then handed to Supabase with
 * `signInWithIdToken`. The desktop opens the site's sign-in page, which sends the token back only
 * to this PC's loopback.
 */

const GIS_SCRIPT = "https://accounts.google.com/gsi/client";
/** Must match CALLBACK_PORT and CALLBACK_PATH in src-tauri/src/account.rs. No other address ever gets a token. */
export const DESKTOP_CALLBACK = "http://127.0.0.1:47615/auth/callback";
const NONCE_BYTES = 32;
const SIGN_IN_PAGE = "/signin.html";

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** `raw` goes to Supabase; Google signs `hashed` into the ID token, so a stolen token can't be replayed. */
export async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = hex(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return { raw, hashed: hex(new Uint8Array(digest)) };
}

/** Exactly Hodeum's listener: another port could be some other program on this PC. */
export const isLoopbackCallback = (value: string): boolean => value === DESKTOP_CALLBACK;

export interface SignInRequest {
  redirect: string;
  nonceHash: string;
  state: string;
}

export function desktopSignInUrl(site: string, request: SignInRequest): string {
  const url = new URL(SIGN_IN_PAGE, site);
  url.search = new URLSearchParams({ redirect: request.redirect, nonce: request.nonceHash, state: request.state }).toString();
  return url.toString();
}

/** The sign-in page's view of the desktop's request; anything but this PC's loopback is refused. */
export function readSignInRequest(search: string): SignInRequest | { error: string } {
  const params = new URLSearchParams(search);
  const redirect = params.get("redirect") ?? "";
  const nonceHash = params.get("nonce") ?? "";
  const state = params.get("state") ?? "";
  if (!nonceHash || !state) return { error: "This sign-in link is incomplete. Start again from the Hodeum app." };
  if (!isLoopbackCallback(redirect)) return { error: "This sign-in link doesn't lead back to the Hodeum app, so it was stopped." };
  return { redirect, nonceHash, state };
}

export function callbackUrl(redirect: string, state: string, result: { idToken: string } | { error: string }): string {
  const params: Record<string, string> = "idToken" in result ? { id_token: result.idToken, state } : { error: result.error, state };
  return `${redirect}?${new URLSearchParams(params).toString()}`;
}

/** The slice of Google Identity Services this app uses. */
interface GoogleId {
  initialize(config: { client_id: string; callback: (response: { credential?: string }) => void; nonce: string; ux_mode?: "popup" | "redirect" }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let loading: Promise<GoogleId> | undefined;

function loadGoogleIdentity(): Promise<GoogleId> {
  loading ??= new Promise<GoogleId>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google.accounts.id) : reject(new Error("Google sign-in didn't load.")));
    script.onerror = () => reject(new Error("Couldn't reach Google sign-in. Check your connection."));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/** Renders Google's own "Sign in with Google" button; `onCredential` gets the ID token. */
export async function renderGoogleButton(parent: HTMLElement, options: { clientId: string; nonceHash: string; onCredential: (idToken: string) => void; onError: (message: string) => void }): Promise<void> {
  const id = await loadGoogleIdentity();
  id.initialize({
    client_id: options.clientId,
    nonce: options.nonceHash,
    ux_mode: "popup",
    callback: ({ credential }) => (credential ? options.onCredential(credential) : options.onError("Google didn't return a sign-in.")),
  });
  id.renderButton(parent, { type: "standard", theme: "filled_black", size: "large", text: "signin_with", shape: "pill", logo_alignment: "left" });
}
