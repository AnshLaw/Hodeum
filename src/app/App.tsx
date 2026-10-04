import { useEffect, useState, type ReactNode } from "react";
import type { Bus, HodeSummary } from "../lib/bus";
import type { AccountStatus } from "../features/account/types";
import { RailAccount } from "./RailAccount";
import { COPY } from "../lib/copy";
import { HodeumMark } from "../components/shared/icons";
import { useAccount } from "../features/account/use-account";
import { useLiveHode } from "./hooks";
import { ChatIcon, CloseWindowIcon, GearIcon, HodesIcon, HomeIcon, MaximizeIcon, MinimizeIcon, NotchIcon, PathIcon, RestoreIcon } from "./icons";
import { ChatPage } from "./pages/ChatPage";
import { HodesPage } from "./pages/HodesPage";
import { HomePage } from "./pages/HomePage";
import { LearningPage } from "./pages/LearningPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { AppServices, AppWindowControls } from "./services";
import "./app.css";

export type Page = "home" | "hodes" | "learning" | "chat" | "settings";

const NAV: { page: Page; label: string; icon: ReactNode }[] = [
  { page: "home", label: "Home", icon: <HomeIcon /> },
  { page: "hodes", label: "Your Hodes", icon: <HodesIcon /> },
  { page: "learning", label: "Learning paths", icon: <PathIcon /> },
  { page: "chat", label: "Ask Hodey", icon: <ChatIcon /> },
  { page: "settings", label: "Settings", icon: <GearIcon /> },
];

function useMaximized(window: AppWindowControls): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => window.onMaximizedChange?.(setMaximized), [window]);
  return maximized;
}

/** Double-clicking the drag region maximizes, like any Windows title bar. */
function TitleBar({ services }: { services: AppServices }) {
  const { window } = services;
  const maximized = useMaximized(window);
  return (
    <header className="happ__titlebar" data-tauri-drag-region>
      <span className="happ__brand" data-tauri-drag-region>
        <HodeumMark size={18} />
        Hodeum
      </span>
      <span className="happ__titlebar-fill" data-tauri-drag-region />
      <button type="button" className="happ__to-notch" title={COPY.backToNotch} onClick={window.close}>
        <NotchIcon />
        {COPY.backToNotch}
      </button>
      <span className="happ__window-controls">
        <button type="button" aria-label="Minimize" title="Minimize" onClick={window.minimize}>
          <MinimizeIcon />
        </button>
        <button type="button" aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"} onClick={window.toggleMaximize}>
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button type="button" aria-label="Close" title="Close (back to the notch)" className="happ__close" onClick={window.close}>
          <CloseWindowIcon />
        </button>
      </span>
    </header>
  );
}

function LivePill({ live, onOpen }: { live?: HodeSummary; onOpen: () => void }) {
  if (!live) return null;
  return (
    <button type="button" className="happ__live" onClick={onOpen}>
      <span className="happ__live-dot" />
      <span className="happ__live-text">
        <strong>Hode in progress</strong>
        <span>{live.goal}</span>
      </span>
    </button>
  );
}

function Rail({ page, onSelect, live, account, bus }: { page: Page; onSelect: (page: Page) => void; live?: HodeSummary; account?: AccountStatus; bus: Bus }) {
  return (
    <nav className="happ__rail" aria-label="Hodeum">
      {NAV.map((item) => (
        <button key={item.page} type="button" className="happ__nav" aria-current={page === item.page ? "page" : undefined} onClick={() => onSelect(item.page)}>
          {item.icon}
          {item.label}
        </button>
      ))}
      <span className="happ__rail-spacer" />
      <LivePill live={live} onOpen={() => onSelect("home")} />
      <RailAccount status={account} bus={bus} onOpen={() => onSelect("settings")} />
    </nav>
  );
}

/** The Hodeum desktop app: dashboard, history, learning paths, chat and settings around the notch. */
export function HodeumApp({ services }: { services: AppServices }) {
  const [page, setPage] = useState<Page>("home");
  const live = useLiveHode(services.bus);
  const account = useAccount(services.bus);
  // Starting a Hode hands over to the notch, which guides it: the app folds back out of the way.
  useEffect(() => services.bus.on("hode:start", services.window.close), [services]);
  return (
    <div className="happ">
      <TitleBar services={services} />
      <div className="happ__body">
        <Rail page={page} onSelect={setPage} live={live} account={account} bus={services.bus} />
        <main className="happ__main" key={page}>
          {page === "home" && <HomePage services={services} live={live} account={account} onNavigate={setPage} />}
          {page === "hodes" && <HodesPage services={services} />}
          {page === "learning" && <LearningPage services={services} />}
          {page === "chat" && <ChatPage services={services} />}
          {page === "settings" && <SettingsPage services={services} />}
        </main>
      </div>
    </div>
  );
}
