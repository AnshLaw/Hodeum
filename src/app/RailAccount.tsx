import type { Bus } from "../lib/bus";
import { ACCOUNT_COPY, railNote } from "../features/account/copy";
import type { AccountStatus } from "../features/account/types";

const initialOf = (status: AccountStatus) => (status.user?.name ?? status.user?.email ?? "?").trim().charAt(0).toUpperCase();

/** Signed out: sign in right here, no digging through Settings. */
function SignIn({ status, bus }: { status: AccountStatus; bus: Bus }) {
  if (status.phase === "signing-in") {
    return (
      <div className="happ__account">
        <p className="happ__account-line">{ACCOUNT_COPY.waiting}</p>
        <button type="button" className="btn" onClick={() => bus.emit("account:cancel", {})}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="happ__account">
      <button type="button" className="btn btn--primary happ__sign-in" onClick={() => bus.emit("account:sign-in", {})}>
        {ACCOUNT_COPY.signInLabel}
      </button>
      <p className="happ__account-line">{status.error ? ACCOUNT_COPY.signInFailed : ACCOUNT_COPY.railSignInHint}</p>
    </div>
  );
}

/**
 * The learner's account at the foot of the rail on every page: a sign-in button while signed out,
 * then who's signed in and how sync is doing; clicking it opens Settings › Account.
 */
export function RailAccount({ status, bus, onOpen }: { status: AccountStatus | undefined; bus: Bus; onOpen: () => void }) {
  if (!status || !status.configured) return <p className="happ__local">{railNote(status)}</p>;
  if (status.phase !== "signed-in") return <SignIn status={status} bus={bus} />;
  const tone = status.paused ? "paused" : status.sync.state;
  return (
    <button type="button" className="happ__account happ__account--in" onClick={onOpen} title={ACCOUNT_COPY.manageAccount}>
      <span className="happ__avatar" aria-hidden="true">
        {initialOf(status)}
      </span>
      <span className="happ__account-text">
        <strong>{status.user?.name ?? status.user?.email ?? "Signed in"}</strong>
        <span className="happ__account-line" data-tone={tone}>
          {railNote(status)}
        </span>
      </span>
    </button>
  );
}
