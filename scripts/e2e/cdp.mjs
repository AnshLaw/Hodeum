// Minimal Chrome DevTools Protocol client (Node 22: global fetch + WebSocket, no dependencies).
// Talks to Hodeum's WebView2 windows when Hodeum was launched with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
//
//   node cdp.mjs targets                                  # list pages (notch.html, overlay.html, app.html)
//   node cdp.mjs eval <urlPart> "<js expression>"         # evaluate in that page, print JSON
//   node cdp.mjs start "<goal>" [mode] [agentStyle]       # start a Hode (__hodeumDebug.start, else hode:start on the bus)
//   node cdp.mjs say "<text>"                             # what the learner says (__hodeumDebug.say)
//   node cdp.mjs state                                    # __hodeumDebug.state(): phase, step, action, observation
//   node cdp.mjs events [n]                               # __hodeumDebug.events(n): recent transitions
//   node cdp.mjs end                                      # end the Hode (__hodeumDebug.end, else hode:end)
//   node cdp.mjs quit                                     # graceful quit (debug builds): __hodeumDebug.quit / debug_quit
//   node cdp.mjs build                                    # which build is running (build_info)
//   node cdp.mjs summary                                  # ask the notch for its live hode:summary
//   node cdp.mjs arm                                      # overlay page: start recording overlay:render
//   node cdp.mjs overlay                                  # last overlay:render payload (physical screen px)
//   node cdp.mjs invoke <command> '<json args>'           # call any Tauri command from the notch (e.g. observe)
//   node cdp.mjs console <urlPart> <seconds>              # stream console.* and uncaught exceptions as JSON lines
// Env: CDP_PORT (default 9229), CDP_TIMEOUT_MS (default 15000).
const PORT = Number(process.env.CDP_PORT ?? 9229);
const TIMEOUT_MS = Number(process.env.CDP_TIMEOUT_MS ?? 15000);
const BASE = `http://127.0.0.1:${PORT}`;

async function targets() {
  const res = await fetch(`${BASE}/json/list`);
  if (!res.ok) throw new Error(`CDP ${BASE}/json/list -> HTTP ${res.status}`);
  return (await res.json()).filter((t) => t.type === "page");
}

/** The page went away mid-call: expected when the call quits the app. */
class PageClosed extends Error {}

async function evaluate(urlPart, expression) {
  const page = (await targets()).find((t) => t.url.includes(urlPart));
  if (!page) throw new Error(`no CDP page whose url contains '${urlPart}'`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error(`couldn't open ${page.webSocketDebuggerUrl}`)), { once: true });
  });
  try {
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
      ws.addEventListener("close", () => reject(new PageClosed("the page closed before replying")), { once: true });
      ws.addEventListener("message", (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id !== 1) return;
        clearTimeout(timer);
        resolve(data);
      });
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    if (reply.error) throw new Error(JSON.stringify(reply.error));
    if (reply.result.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? JSON.stringify(reply.result.exceptionDetails));
    return reply.result.result.value;
  } finally {
    ws.close();
  }
}

async function streamConsole(urlPart, seconds) {
  const page = (await targets()).find((t) => t.url.includes(urlPart));
  if (!page) throw new Error(`no CDP page whose url contains '${urlPart}'`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("websocket error")), { once: true });
  });
  ws.addEventListener("message", (msg) => {
    const { method, params } = JSON.parse(msg.data);
    if (method === "Runtime.consoleAPICalled") {
      const text = params.args.map((a) => a.value ?? a.description ?? a.type).join(" ");
      console.log(JSON.stringify({ at: new Date(params.timestamp).toISOString(), level: params.type, text }));
    } else if (method === "Runtime.exceptionThrown") {
      console.log(JSON.stringify({ at: new Date().toISOString(), level: "exception", text: params.exceptionDetails.exception?.description ?? params.exceptionDetails.text }));
    }
  });
  ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
  await new Promise((resolve) => setTimeout(resolve, Number(seconds ?? 10) * 1000));
  ws.close();
  return "done";
}

// Expressions run inside a Tauri page; __TAURI_INTERNALS__ exists in every Tauri 2 webview.
const T = "window.__TAURI_INTERNALS__";
const emit = (event, payload) => `${T}.invoke('plugin:event|emit', ${JSON.stringify({ event, payload })}).then(() => 'emitted ${event}')`;
const SUMMARY = `new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no hode:summary within 3s')), 3000);
  ${T}.invoke('plugin:event|listen', { event: 'hode:summary', target: { kind: 'Any' },
    handler: ${T}.transformCallback((e) => { clearTimeout(timer); resolve(e.payload); }, true) })
    .then(() => ${T}.invoke('plugin:event|emit', { event: 'hode:summary-request', payload: {} }));
})`;
const ARM = `(window.__hodeumRenders ??= [], window.__hodeumArmed ? 'already armed' :
  ${T}.invoke('plugin:event|listen', { event: 'overlay:render', target: { kind: 'Any' },
    handler: ${T}.transformCallback((e) => { window.__hodeumRenders.push({ at: Date.now(), ...e.payload }); window.__hodeumRenders.splice(0, window.__hodeumRenders.length - 20); }) })
    .then(() => (window.__hodeumArmed = true, 'armed')))`;
const OVERLAY = `(window.__hodeumRenders ?? []).at(-1) ?? null`;
// The DEV-only automation hook in the notch; bus events are the fallback for builds without it.
const D = "window.__hodeumDebug";
const debugCall = (method, ...args) =>
  `(${D} ? ${D}.${method}(${args.map((arg) => JSON.stringify(arg)).join(", ")}) : Promise.reject(new Error('no __hodeumDebug: not a dev build of the notch')))`;
const startOptions = (mode, agentStyle) => Object.fromEntries(Object.entries({ mode, agentStyle }).filter(([, value]) => value));
const START = (goal, mode, agentStyle) =>
  `(${D} ? Promise.resolve(${D}.start(${JSON.stringify(goal)}, ${JSON.stringify(startOptions(mode, agentStyle))})).then(() => 'started') : ${emit("hode:start", { goal, ...startOptions(mode, agentStyle) })})`;
const END = `(${D} ? Promise.resolve(${D}.end()).then(() => 'ended') : ${emit("hode:end", {})})`;
const QUIT = `Promise.resolve(${D}?.quit ? ${D}.quit() : ${T}.invoke('debug_quit')).then(() => 'quitting')`;

async function quit() {
  try {
    return await evaluate("notch.html", QUIT);
  } catch (error) {
    if (error instanceof PageClosed) return "quitting (the notch closed)";
    throw error;
  }
}

const [cmd, a, b, c] = process.argv.slice(2);
const run = {
  targets: async () => (await targets()).map(({ title, url }) => ({ title, url })),
  eval: () => evaluate(a, b),
  start: () => evaluate("notch.html", START(a, b, c)),
  say: () => evaluate("notch.html", debugCall("say", a)),
  state: () => evaluate("notch.html", debugCall("state")),
  events: () => evaluate("notch.html", debugCall("events", ...(a ? [Number(a)] : []))),
  end: () => evaluate("notch.html", END),
  quit,
  build: () => evaluate("notch.html", `${T}.invoke('build_info')`),
  summary: () => evaluate("notch.html", SUMMARY),
  arm: () => evaluate("overlay.html", ARM),
  overlay: () => evaluate("overlay.html", OVERLAY),
  console: () => streamConsole(a, b),
  invoke: () => evaluate("notch.html", `${T}.invoke(${JSON.stringify(a)}, ${b ?? "{}"})`),
}[cmd];
if (!run) {
  console.error("usage: node cdp.mjs targets|eval|start|say|state|events|end|quit|build|summary|arm|overlay|invoke|console ...");
  process.exit(2);
}
try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.error(`cdp ${cmd} failed: ${error.message}`);
  process.exit(1);
}
