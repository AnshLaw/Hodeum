import { describe, expect, it } from "vitest";
import type { InstalledApp } from "../../lib/types";
import catalog from "./__fixtures__/start-apps.json";
import { knownAppId, pickOption, resolveApp } from "./resolve";

/** A trimmed copy of `Get-StartApps` on the dev PC, traps included (WSL Settings, WhatsApp Web, Outlook (classic)). */
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

