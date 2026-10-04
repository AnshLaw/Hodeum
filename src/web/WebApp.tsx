import type { SupabaseClient } from "@supabase/supabase-js";
import { useMemo, useState, type ReactNode } from "react";
import type { Page } from "../app/App";
import { useLiveHode } from "../app/hooks";
import { HodesIcon, HomeIcon, PathIcon } from "../app/icons";
import { HodesPage } from "../app/pages/HodesPage";
import { HomePage } from "../app/pages/HomePage";
import { LearningPage } from "../app/pages/LearningPage";
import type { AppServices } from "../app/services";
import { HodeumMark } from "../components/shared/icons";
import { googleClientId } from "../features/account/config";
import { accountUser } from "../features/account/supabase-auth";
import type { DeviceRow } from "../features/sync/types";
import { isOnline, noPcMessage } from "./devices";
import { timeAgo } from "../app/view";
import { GoogleButton } from "./GoogleButton";
import { useDashboard, useSession, type Dashboard } from "./use-dashboard";
import "../app/app.css";
import "./web.css";

type WebPage = Extract<Page, "home" | "hodes" | "learning">;

const NAV: { page: WebPage; label: string; icon: ReactNode }[] = [
  { page: "home", label: "Home", icon: <HomeIcon /> },
  { page: "hodes", label: "Your Hodes", icon: <HodesIcon /> },
  { page: "learning", label: "Learning paths", icon: <PathIcon /> },
];

const NO_WINDOW: AppServices["window"] = { minimize: () => {}, toggleMaximize: () => {}, close: () => {} };

function SignIn({ client }: { client: SupabaseClient }) {
  const [error, setError] = useState<string>();
  const signIn = async (idToken: string, rawNonce?: string) => {
    setError(undefined);
    const { error: failed } = await client.auth.signInWithIdToken({ provider: "google", token: idToken, nonce: rawNonce });
    if (failed) {
      console.error("Google sign-in failed", failed);
      setError(failed.message);
    }
  };
  return (
    <main className="hweb-gate">
      <HodeumMark size={40} />
      <h1>Your Hodes, from anywhere</h1>
      <p className="hmuted">See what you've learned and start a Hode on your PC. Sign in with the Google account you use in the Hodeum app.</p>
      <GoogleButton clientId={googleClientId()} onCredential={(token, nonce) => void signIn(token, nonce)} />
      {error && (
        <p className="hchat__error" role="alert">
          Sign-in didn't start: {error}
        </p>
      )}
      <p className="hweb-gate__fine">Only your skills, Hodes, settings and chats are in your account. Screenshots and audio never leave your PC.</p>
      <a className="hlink" href="/">
        What is Hodeum?
      </a>
    </main>
  );
}

function PcPicker({ dashboard }: { dashboard: Dashboard }) {
  const { devices, target, choose } = dashboard;
  if (devices.state === "loading") return <p className="hweb-pc hmuted">{noPcMessage(devices, undefined)}</p>;
  if (devices.state === "error") return <p className="hweb-pc hchat__error">Couldn't load your PCs.</p>;
  if (devices.value.length === 0) return <p className="hweb-pc hmuted">No PC linked yet.</p>;
  const now = Date.now();
  const online = target ? isOnline(target, now) : false;
  return (
    <label className="hweb-pc">
      <span className="hweb-pc__label">Start Hodes on</span>
      <select className="field" value={target?.id} onChange={(e) => choose(e.target.value)}>
        {devices.value.map((d: DeviceRow) => (
          <option key={d.id} value={d.id}>
            {d.name} · {isOnline(d, now) ? "online" : `seen ${timeAgo(d.last_seen_at, new Date(now))}`}
          </option>
        ))}
      </select>
      {target && (
        <span className="hweb-pc__status" data-online={online || undefined}>
          {online ? "Hodeum is running there" : "Open Hodeum on that PC to start Hodes there"}
        </span>
      )}
    </label>
  );
}

function Rail({ page, onSelect, dashboard, client, email }: { page: WebPage; onSelect: (page: WebPage) => void; dashboard: Dashboard; client: SupabaseClient; email?: string }) {
  return (
    <nav className="happ__rail hweb-rail" aria-label="Hodeum">
      <span className="happ__brand hweb-brand">
        <HodeumMark size={18} />
        Hodeum
      </span>
      {NAV.map((item) => (
        <button key={item.page} type="button" className="happ__nav" aria-current={page === item.page ? "page" : undefined} onClick={() => onSelect(item.page)}>
          {item.icon}
          {item.label}
        </button>
      ))}
      <span className="happ__rail-spacer" />
      <PcPicker dashboard={dashboard} />
      <div className="hweb-user">
        <span className="hmuted">{email}</span>
        <button type="button" className="hlink" onClick={() => void client.auth.signOut().then(({ error }) => error && console.error("Sign-out failed", error))}>
          Sign out
        </button>
      </div>
    </nav>
  );
}

function Notice({ dashboard, email }: { dashboard: Dashboard; email?: string }) {
  const { feedback, target, devices } = dashboard;
  // Missing PCs are explained up front, not only after "Start a Hode" fails. An offline PC is shown, quietly,
  // under the PC picker; a Hode started there waits for it.
  const missing = !target && devices.state !== "loading" && !feedback;
  return (
    <div className="hweb-notices" aria-live="polite">
      {missing && (
        <p className="hweb-notice" data-tone="error">
          {noPcMessage(devices, email)}
        </p>
      )}
      {feedback && (
        <p className="hweb-notice" data-tone={feedback.tone}>
          {feedback.text}
        </p>
      )}
    </div>
  );
}

function Shell({ client, email }: { client: SupabaseClient; email?: string }) {
  const dashboard = useDashboard(client, email);
  const [page, setPage] = useState<WebPage>("home");
  const services = useMemo<AppServices>(() => ({ ...dashboard.services, window: NO_WINDOW, limitation: "Ask Hodey runs on your PC." }), [dashboard.services]);
  const live = useLiveHode(services.bus);
  const navigate = (next: Page) => setPage(NAV.some((n) => n.page === next) ? (next as WebPage) : "home");
  return (
    <div className="happ hweb">
      <div className="happ__body">
        <Rail page={page} onSelect={setPage} dashboard={dashboard} client={client} email={email} />
        <main className="happ__main" key={page}>
          <Notice dashboard={dashboard} email={email} />
          {page === "home" && <HomePage services={services} live={live} onNavigate={navigate} />}
          {page === "hodes" && <HodesPage services={services} />}
          {page === "learning" && <LearningPage services={services} />}
        </main>
      </div>
    </div>
  );
}

/** The web dashboard: the learner's synced progress, and a remote "Start a Hode" for their PC. */
export function WebApp({ client }: { client: SupabaseClient }) {
  const session = useSession(client);
  if (session.state === "loading") return <p className="hweb-gate hmuted">Loading…</p>;
  if (session.state === "error") return <p className="hweb-gate hchat__error">Couldn't check your sign-in: {session.message}</p>;
  if (!session.value) return <SignIn client={client} />;
  return <Shell client={client} email={accountUser(session.value.user)?.email} />;
}

export function NotConfigured() {
  return (
    <main className="hweb-gate">
      <HodeumMark size={40} />
      <h1>The dashboard isn't set up</h1>
      <p className="hmuted">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local and rebuild. See docs/accounts-setup.md.</p>
    </main>
  );
}
