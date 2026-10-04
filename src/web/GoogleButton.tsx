import { useEffect, useRef, useState } from "react";
import { createNonce, renderGoogleButton } from "../features/account/google-identity";

/**
 * Google's own "Sign in with Google" button. Makes a fresh nonce (or uses the hash it's given)
 * and hands back the ID token with the raw nonce, when it has one, for Supabase to check.
 */
export function GoogleButton({ clientId, nonceHash, onCredential }: { clientId: string; nonceHash?: string; onCredential: (idToken: string, rawNonce?: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  const latest = useRef(onCredential);
  latest.current = onCredential;

  useEffect(() => {
    let alive = true;
    const element = holder.current;
    if (!element) return;
    (async () => {
      const nonce = nonceHash ? { raw: undefined, hashed: nonceHash } : await createNonce();
      if (!alive) return;
      await renderGoogleButton(element, {
        clientId,
        nonceHash: nonce.hashed,
        onCredential: (idToken) => latest.current(idToken, nonce.raw),
        onError: setError,
      });
    })().catch((failure: unknown) => {
      console.error("Google sign-in didn't load", failure);
      if (alive) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => {
      alive = false;
      element.replaceChildren();
    };
  }, [clientId, nonceHash]);

  return (
    <div className="hweb-google">
      <div ref={holder} />
      {error && (
        <p className="hchat__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
