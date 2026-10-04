import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ChatThread } from "../../data/types";
import { useLiveQuery } from "../hooks";
import { produceReply } from "../chat-reply";
import { GlobeIcon, SendIcon, WindowIcon } from "../icons";
import type { AppServices, WindowInfo } from "../services";
import { timeAgo } from "../view";

const TITLE_CHARS = 48;
const REPLY_TIMEOUT_MS = 60_000;
const LOOKING = "Hodey is looking at this screen…";

function message(chatId: string, role: ChatMessage["role"], content: string, context?: string): ChatMessage {
  return { id: crypto.randomUUID(), chatId, role, content, context, at: new Date().toISOString() };
}

function ContextPicker({ services, value, onChange }: { services: AppServices; value?: WindowInfo; onChange: (w?: WindowInfo) => void }) {
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const refresh = () => {
    services.windows?.list().then(setWindows, (error) => console.error("Couldn't list open windows", error));
  };
  if (!services.windows) return null;
  return (
    <label className="hcontext">
      <WindowIcon />
      <span className="sr-only">Window Hodey looks at</span>
      <select className="hcontext__select" value={value?.id ?? ""} onFocus={refresh} onChange={(e) => onChange(windows.find((w) => w.id === e.target.value) ?? (value?.id === e.target.value ? value : undefined))}>
        <option value="">No window attached</option>
        {value && !windows.some((w) => w.id === value.id) && <option value={value.id}>{value.title}</option>}
        {windows.map((w) => (
          <option key={w.id} value={w.id}>
            {w.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function Thread({ messages, streaming, status, onStartHode }: { messages: ChatMessage[]; streaming?: string; status: string; onStartHode: (goal: string) => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming]);
  return (
    <div className="hthread" aria-live="polite">
      {messages.length === 0 && streaming === undefined && (
        <div className="hthread__empty">
          <h2>Ask Hodey anything</h2>
          <p className="hmuted">Hodey looks at the window you were working in, explains what's going on, and can start a Hode to teach you step by step.</p>
        </div>
      )}
      {messages.map((m) => (
        <div key={m.id} className="hbubble" data-role={m.role}>
          {m.context && <span className="hbubble__context">Looking at {m.context}</span>}
          <p>{m.content}</p>
          {m.web && <WebSources web={m.web} />}
          {m.role === "user" && (
            <button type="button" className="hlink" onClick={() => onStartHode(m.content)}>
              Start a Hode for this
            </button>
          )}
        </div>
      ))}
      {streaming !== undefined && (
        <div className="hbubble" data-role="hodey" data-streaming>
          <p>{streaming || status}</p>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** What went to the web for this reply, and where the answer came from. Plain text: no links open in the app. */
function WebSources({ web }: { web: NonNullable<ChatMessage["web"]> }) {
  return (
    <p className="hbubble__web">
      <GlobeIcon /> Searched the web for “{web.query}” · {[...new Set(web.sources.map((s) => hostOf(s.url)))].join(" · ") || "nothing relevant found"}
    </p>
  );
}

/** Web search is off until the learner turns it on; the choice is saved with their settings. */
function useWebSearchSetting(services: AppServices): [boolean, () => void] {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    services.settings.load().then(
      (s) => setEnabled(s.webSearch),
      (e) => console.error("Couldn't read the web search setting", e),
    );
  }, [services]);
  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    services.settings
      .load()
      .then((s) => services.settings.save({ ...s, webSearch: next }))
      .then(
        () => services.bus.emit("settings:changed", {}),
        (e) => console.error("Couldn't save the web search setting", e),
      );
  };
  return [enabled, toggle];
}

export function ChatPage({ services }: { services: AppServices }) {
  const [chats] = useLiveQuery(services.bus, () => services.chats.listChats(), []);
  const [active, setActive] = useState<ChatThread>();
  const [history] = useLiveQuery(services.bus, () => (active ? services.chats.messages(active.id) : Promise.resolve([])), [active?.id]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState<string>();
  const [error, setError] = useState<string>();
  const [context, setContext] = useState<WindowInfo>();
  const [status, setStatus] = useState(LOOKING);
  const [webEnabled, toggleWeb] = useWebSearchSetting(services);
  useEffect(() => {
    services.windows?.lastActive().then(setContext, (e) => console.error("Couldn't find the last app window", e));
  }, [services]);

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming !== undefined) return;
    setDraft("");
    setError(undefined);
    const chat = active ?? (await services.chats.createChat(text.slice(0, TITLE_CHARS), new Date().toISOString()));
    setActive(chat);
    const mine = message(chat.id, "user", text, context?.title);
    await services.chats.append(mine);
    const past = history.state === "ready" && active ? history.value : [];
    setStreaming("");
    setStatus(LOOKING);
    try {
      if (!services.chat) throw new Error(services.limitation ?? "The local model isn't available.");
      const deps = { chat: services.chat, windows: services.windows, web: services.web };
      const options = { webEnabled, signal: AbortSignal.timeout(REPLY_TIMEOUT_MS), onText: setStreaming, onStatus: setStatus };
      const reply = await produceReply(deps, [...past, mine], context, options);
      if (reply.webError) setError(`Web search didn't work (${reply.webError}), so this answer is from Hodey alone.`);
      await services.chats.append({ ...message(chat.id, "hodey", reply.text.trim() || "I couldn't come up with an answer for that."), ...(reply.web ? { web: reply.web } : {}) });
    } catch (e) {
      console.error("Hodey couldn't answer", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(undefined);
      services.bus.emit("data:changed", {});
    }
  };

  const now = new Date();
  return (
    <div className="hchat">
      <aside className="hchat__list" aria-label="Conversations">
        <button type="button" className="btn btn--neutral" onClick={() => setActive(undefined)}>
          New chat
        </button>
        {chats.state === "ready" &&
          chats.value.map((c) => (
            <button key={c.id} type="button" className="hchat__item" aria-current={c.id === active?.id ? "true" : undefined} onClick={() => setActive(c)}>
              <strong>{c.title}</strong>
              <span className="hmuted">{timeAgo(c.updatedAt, now)}</span>
            </button>
          ))}
      </aside>
      <section className="hchat__main">
        <Thread messages={history.state === "ready" ? history.value : []} streaming={streaming} status={status} onStartHode={(goal) => services.bus.emit("hode:start", { goal })} />
        {error && <p className="hchat__error" role="alert">{error}</p>}
        {services.limitation && !services.chat && <p className="hchat__note">{services.limitation}</p>}
        <form
          className="hcomposer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <ContextPicker services={services} value={context} onChange={setContext} />
          {services.web && (
            <button type="button" className="hweb-toggle" aria-pressed={webEnabled} onClick={toggleWeb} title={webEnabled ? "Web search on: only a short generic query leaves this PC" : "Let Hodey search the web (only a short generic query leaves this PC)"}>
              <GlobeIcon />
              <span>Web</span>
            </button>
          )}
          <input className="field hcomposer__field" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Where do I change page margins?" aria-label="Message Hodey" />
          <button type="submit" className="btn btn--primary hcomposer__send" aria-label="Send" disabled={draft.trim() === "" || streaming !== undefined}>
            <SendIcon />
          </button>
        </form>
      </section>
    </div>
  );
}
