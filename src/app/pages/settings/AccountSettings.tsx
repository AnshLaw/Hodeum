import type { Bus } from "../../../lib/bus";
import { ACCOUNT_COPY, syncDetail } from "../../../features/account/copy";
import type { AccountStatus } from "../../../features/account/types";
import { useAccount } from "../../../features/account/use-account";
import { Row } from "./controls";
import { SECTION_ID } from "./sections";

function SignedOut({ status, bus }: { status: AccountStatus; bus: Bus }) {
  const waiting = status.phase === "signing-in";
  return (
    <>
      <Row label={ACCOUNT_COPY.signInLabel} detail={waiting ? ACCOUNT_COPY.waiting : ACCOUNT_COPY.signInDetail}>
        {waiting ? (
          <button type="button" className="btn" onClick={() => bus.emit("account:cancel", {})}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={() => bus.emit("account:sign-in", {})}>
            Sign in
          </button>
        )}
      </Row>
      {status.error && (
        <p className="hchat__error" role="alert">
          Sign-in didn't finish: {status.error}
        </p>
      )}
    </>
  );
}

function SignedIn({ status, bus }: { status: AccountStatus; bus: Bus }) {
  const who = status.user?.name ? `${status.user.name} · ${status.user.email ?? ""}` : (status.user?.email ?? "your Google account");
  return (
    <>
      <Row label="Signed in" detail={who}>
        <button type="button" className="btn" onClick={() => bus.emit("account:sign-out", {})}>
          Sign out
        </button>
      </Row>
      <Row label={ACCOUNT_COPY.syncLabel} detail={syncDetail(status, new Date())}>
        <input type="checkbox" className="hswitch" checked={!status.paused} onChange={(e) => bus.emit("account:pause", { paused: !e.target.checked })} aria-label={ACCOUNT_COPY.syncLabel} />
      </Row>
      {status.sync.state === "error" && !status.paused && (
        <Row label={ACCOUNT_COPY.syncFailedLabel} detail={ACCOUNT_COPY.syncFailedDetail}>
          <button type="button" className="btn btn--primary" onClick={() => bus.emit("account:retry", {})}>
            {ACCOUNT_COPY.retry}
          </button>
        </Row>
      )}
      {status.error && (
        <p className="hchat__error" role="alert">
          {status.error}
        </p>
      )}
    </>
  );
}

/** Google sign-in and sync, run by the notch; this card only sends requests and shows its status. */
export function AccountSettings({ bus }: { bus: Bus }) {
  const status = useAccount(bus);
  return (
    <section className="hcard" id={SECTION_ID.account}>
      <h2>Account</h2>
      {!status && <p className="hmuted">Checking your account…</p>}
      {status && !status.configured && (
        <Row label={ACCOUNT_COPY.signInLabel} detail={ACCOUNT_COPY.notConfigured}>
          <button type="button" className="btn" disabled>
            Sign in
          </button>
        </Row>
      )}
      {status?.configured && (status.phase === "signed-in" ? <SignedIn status={status} bus={bus} /> : <SignedOut status={status} bus={bus} />)}
    </section>
  );
}
