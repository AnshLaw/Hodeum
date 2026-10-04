import { describe, expect, it } from "vitest";
import type { InstalledApp } from "../../lib/types";
import catalog from "./__fixtures__/start-apps.json";
import { appNamedIn, knownAppId, pickOption, resolveApp } from "./resolve";

/**
 * A trimmed copy of `list_apps` on the dev PC, desktop apps' window names included, traps too (WSL Settings,
 * WhatsApp Web, Outlook (classic), My Dell, Click to Do, and WinRAR and Telegram, whose windows go by other names).
 */
const APPS = catalog as InstalledApp[];

const idOf = (query: string) => {
  const found = resolveApp(query, APPS);
  return found.kind === "match" ? found.app.id : found.kind;
};

describe("resolveApp", () => {
  it.each([
    ["excel", "Microsoft.Office.EXCEL.EXE.15"],
    ["Microsoft Excel", "Microsoft.Office.EXCEL.EXE.15"],
    ["word", "Microsoft.Office.WINWORD.EXE.15"],
    ["power point", "Microsoft.Office.POWERPNT.EXE.15"],
    ["whatsapp", "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"],
    ["whats app", "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"],
    ["whatsapp web", "Chrome._crx_hnpfjngllnfapefoaidbinmjnm"],
    ["settings", "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"],
    ["calc", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"],
    ["calculator", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"],
    ["calculater", "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"],
    ["brave", "Brave"],
    ["the brave browser", "Brave"],
    ["edge", "MSEdge"],
    ["chrome", "Chrome"],
    ["google chrome", "Chrome"],
    ["explorer", "Microsoft.Windows.Explorer"],
    ["file explorer", "Microsoft.Windows.Explorer"],
    ["files", "Microsoft.Windows.Explorer"],
    ["this pc", "Microsoft.Windows.Explorer"],
    ["notepad", "Microsoft.WindowsNotepad_8wekyb3d8bbwe!App"],
    ["paint", "Microsoft.Paint_8wekyb3d8bbwe!App"],
    ["vs code", "Microsoft.VisualStudioCode"],
    ["visual studio code", "Microsoft.VisualStudioCode"],
    ["discord", "com.squirrel.Discord.Discord"],
    ["snipping tool", "Microsoft.ScreenSketch_8wekyb3d8bbwe!App"],
    ["एक्सेल", "Microsoft.Office.EXCEL.EXE.15"],
    ["व्हाट्सएप", "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"],
    ["सेटिंग्स", "windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel"],
  ])("%s -> %s", (query, id) => {
    expect(idOf(query)).toBe(id);
  });

  it("asks which one when two apps fit equally well", () => {
    const found = resolveApp("outlook", APPS);
    expect(found.kind).toBe("ambiguous");
    if (found.kind === "ambiguous") expect(found.options.map((app) => app.name).sort()).toEqual(["Outlook", "Outlook (classic)"]);
  });

  it("opens the variant whose whole name was said, qualifier and all", () => {
    for (const said of ["outlook classic", "Outlook (classic)", "classic outlook", "the outlook classic app", "microsoft outlook classic"]) {
      expect(idOf(said), said).toBe("Microsoft.Office.OUTLOOK.EXE.15");
    }
  });

  it("finds nothing for names that aren't apps", () => {
    expect(idOf("insert tab")).toBe("none");
    expect(idOf("photoshop")).toBe("none");
    expect(idOf("a new tab")).toBe("none");
    expect(idOf("")).toBe("none");
  });

  it("finds nothing in an empty catalog", () => {
    expect(resolveApp("excel", []).kind).toBe("none");
  });
});

describe("pickOption", () => {
  const OUTLOOKS = ["Outlook", "Outlook (classic)"];

  it("picks an offered app by its name, or by the word that tells it apart", () => {
    expect(pickOption("Outlook classic", OUTLOOKS)).toBe(1);
    expect(pickOption("open outlook (classic) please", OUTLOOKS)).toBe(1);
    expect(pickOption("Outlook", OUTLOOKS)).toBe(0);
    expect(pickOption("the classic one", OUTLOOKS)).toBe(1);
    expect(pickOption("classic wala", OUTLOOKS)).toBe(1);
  });

  it("picks by place, in English, Hinglish and Hindi", () => {
    for (const said of ["the first", "the first one", "first", "number one", "pehla", "pehle wala", "पहला वाला"]) {
      expect(pickOption(said, OUTLOOKS), said).toBe(0);
    }
    for (const said of ["the second one", "second", "number two", "the last one", "doosra", "dusra wala", "दूसरा वाला", "दूसरे वाला"]) {
      expect(pickOption(said, OUTLOOKS), said).toBe(1);
    }
  });

  it("picks nothing when the reply names neither, or a place past the end", () => {
    for (const said of ["the third one", "teesra", "thunderbird", "the new one", "yes", "never mind", "open excel"]) {
      expect(pickOption(said, OUTLOOKS), said).toBeUndefined();
    }
  });
});

describe("knownAppId", () => {
  it("gives the stable id for friendly names and aliases", () => {
    expect(knownAppId("File Explorer")).toBe("file-explorer");
    expect(knownAppId("Excel")).toBe("excel");
    expect(knownAppId("Google Chrome")).toBe("chrome");
    expect(knownAppId("Microsoft Edge")).toBe("edge");
    expect(knownAppId("Discord")).toBe("discord");
  });
});

describe("appNamedIn", () => {
  const app = (name: string, id: string, kind: InstalledApp["kind"] = "packaged", windowName?: string): InstalledApp => ({ id, name, kind, ...(windowName ? { windowName } : {}) });
  /** Apps that aren't in the trimmed fixture, and Hodeum's own entry (ids and window names as on the dev PC). */
  const MORE = [
    app("Microsoft To Do", "Microsoft.Todos_8wekyb3d8bbwe!App"),
    app("Phone Link", "Microsoft.YourPhone_8wekyb3d8bbwe!App"),
    app("Zoom Workplace", "zoom.us.Zoom Video Meetings", "desktop", "Zoom Meetings"),
    app("Zoom", "zoom.us.Zoom", "desktop", "Zoom"),
    app("OBS Studio (64bit)", "{6D809377-6AF0-444B-8957-A3773F02200E}\\obs-studio\\bin\\64bit\\obs64.exe", "desktop", "OBS Studio"),
    // Started through an installer stub: what its windows are called isn't known.
    app("Microsoft Teams (work or school)", "com.squirrel.Teams.Teams", "desktop"),
    app("Microsoft 365 (Office)", "Microsoft.MicrosoftOfficeHub_8wekyb3d8bbwe!Microsoft.MicrosoftOfficeHub"),
    app("Everything", "voidtools.Everything", "desktop", "Everything"),
    app("Cursor", "Anysphere.Cursor", "desktop", "Cursor"),
    app("ChatGPT", "OpenAI.Codex_2p2nqsd0c76g0!App"),
    app("ChatGPT Classic", "OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!ChatGPT"),
    app("Hodeum", "com.hodeum.app", "desktop", "Hodeum"),
  ];
  const ALL = [...APPS, ...MORE];

  it.each([
    ["How do I send a message on Discord", "Discord"],
    ["how do i send a message on discord?", "Discord"],
    ["make a discord server", "Discord"],
    ["discord pe message kaise bheju", "Discord"],
    ["how do I send a message on Discord on my computer", "Discord"],
    ["how do I make a playlist in spotify", "Spotify"],
    ["how to send a pdf on whatsapp", "WhatsApp"],
    ["व्हाट्सएप पर पीडीएफ कैसे भेजें", "WhatsApp"],
    ["नोटपैड में नोट कैसे लिखें", "Notepad"],
    ["how do I take a screenshot with snipping tool", "Snipping Tool"],
    ["how do I install an app from the microsoft store", "Microsoft Store"],
    ["how do I add a rule in cursor", "Cursor"],
  ])("%j names %s", (goal, name) => {
    expect(appNamedIn(goal, ALL)).toBe(name);
  });

  it("prefers the app whose whole name was said over one it shortens to the same words", () => {
    expect(appNamedIn("how do I ask chatgpt a question", ALL)).toBe("ChatGPT");
  });

  it("names an app as its windows report it, so a Hode can tell when it's open", () => {
    expect(appNamedIn("how do I install an extension in visual studio code", APPS)).toBe("VS Code");
    expect(appNamedIn("how do I commit in vs code", APPS)).toBe("VS Code");
    // A desktop app's windows go by its program's description: "OBS Studio", without "(64bit)".
    expect(appNamedIn("how do I record my screen with obs studio", ALL)).toBe("OBS Studio");
    // A web app's windows carry its own id, so they go by its Start-menu name, as packaged apps' do.
    expect(appNamedIn("how do I open a chat in whatsapp web", ALL)).toBe("WhatsApp Web");
  });

  it("names no app whose windows go by another name, so a Hode never waits for a name that won't appear", () => {
    // Measured: WinRAR's windows say "WinRAR archiver", Telegram's "Telegram Desktop", WSL Settings' "Windows Subsystem for Linux Settings".
    expect(appNamedIn("how do I extract a zip file with WinRAR", ALL)).toBeUndefined();
    expect(appNamedIn("how do I send a file on telegram", ALL)).toBeUndefined();
    // Still the app the goal is about: not the "Settings" or "Photos" inside its name, nor the other app beside it.
    expect(appNamedIn("how do I change wsl settings", ALL)).toBeUndefined();
    expect(appNamedIn("how do I upload to amazon photos", ALL)).toBeUndefined();
    expect(appNamedIn("how do I share a spotify song on telegram", ALL)).toBeUndefined();
  });

  it("of two apps called by the words said, names the one whose windows it can tell", () => {
    expect(appNamedIn("how do I join a meeting on teams", ALL)).toBe("Microsoft Teams");
  });

  it.each([
    ["how do I draw a circle in paint", "Paint"],
    ["how do I crop a picture in the photos app", "Photos"],
    ["how do I set an alarm on the clock app", "Clock"],
    ["how do I make Paint full screen", "Paint"],
    ["paint mein circle kaise banaye", "Paint"],
    ["वर्ड में टेबल कैसे बनाएं", "Word"],
    ["how do I use the calculator", "Calculator"],
    ["how do I add a task in to do", "Microsoft To Do"],
    ["how do I use click to do", "Click to Do"],
    ["how do I reply to a text from phone link", "Phone Link"],
    ["how do I share my screen on zoom", "Zoom"],
    ["how do I check my warranty in My Dell", "My Dell"],
    ["how do I update drivers with the my dell app", "My Dell"],
  ])("takes the everyday-word name in %j as the app it's used as", (goal, name) => {
    expect(appNamedIn(goal, ALL)).toBe(name);
  });

  it.each([
    "how do I take photos of my screen",
    "how do I set the clock",
    "how do I send mail",
    "how to do a pivot table",
    "what do I click to do a pivot table",
    "which button do I click to do this",
    "Paint the header blue",
    "how do I change my display settings",
    "be brave and click the button",
    "how do I add a link on my phone",
    "how do I open a new tab",
    "how do I zoom in",
    "how do I select everything",
    "how do I count 365 days from today",
    "how do I move the cursor",
    "how do I fix a bug in my code",
    "how do I find my files",
    "इस वर्ड का मतलब क्या है",
  ])("finds no app in %j", (goal) => {
    expect(appNamedIn(goal, ALL)).toBeUndefined();
  });

  it.each([
    "how do I turn on dark mode on my computer",
    "how do I make a pivot table on my computer",
    "how do I calculate a percentage using my computer",
    "computer pe dark mode chalu karo",
    "mere computer mein dark mode kaise lagaye",
    "how do I save a note on this PC",
    "how do I turn on dark mode on my Dell laptop",
    "how do I zip files on my dell",
  ])("takes %j as the learner's own computer, not an app", (goal) => {
    expect(appNamedIn(goal, ALL)).toBeUndefined();
  });

  it("names none when the goal names two apps", () => {
    expect(appNamedIn("how do I share a spotify song on discord", ALL)).toBeUndefined();
  });

  it("never names Hodeum itself, or anything without a catalog", () => {
    expect(appNamedIn("how do I use hodeum", ALL)).toBeUndefined();
    expect(appNamedIn("how do I send a message on discord", [])).toBeUndefined();
  });
});
