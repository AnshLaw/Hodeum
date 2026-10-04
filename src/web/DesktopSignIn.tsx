import { useState } from "react";
import { HodeumMark } from "../components/shared/icons";
import { googleClientId } from "../features/account/config";
import { callbackUrl, readSignInRequest } from "../features/account/google-identity";
import { GoogleButton } from "./GoogleButton";

/**
 * Opened by the Hodeum app on this PC. Signs in with Google, then hands the ID token back to the
 * app's loopback (and nowhere else). The app checks the state and the nonce before using it.
 */
export function DesktopSignIn({ search }: { search: string }) {
  const request = readSignInRequest(search);
  const [sent, setSent] = useState(false);
  if ("error" in request) {
    return (
      <main className="hweb-gate">
        <HodeumMark size={40} />
        <h1>This sign-in link doesn't work</h1>
        <p className="hchat__error" role="alert">
          {request.error}
        </p>
      </main>
    );
  }
  const back = (result: { idToken: string } | { error: string }) => {
    setSent(true);
    location.replace(callbackUrl(request.redirect, request.state, result));
  };
  return (
    <main className="hweb-gate">
      <HodeumMark size={40} />
      <h1>Sign in to Hodeum</h1>
      <p className="hmuted">Signing in turns on sync for the Hodeum app on this PC: your skills, Hodes, settings and chats go to your Hodeum account. Screenshots and audio never leave your PC.</p>
      {sent ? <p className="hmuted">Going back to Hodeum…</p> : <GoogleButton clientId={googleClientId()} nonceHash={request.nonceHash} onCredential={(idToken) => back({ idToken })} />}
      {!sent && (
        <button type="button" className="hlink" onClick={() => back({ error: "You cancelled sign-in." })}>
          Cancel
        </button>
      )}
    </main>
  );
}
