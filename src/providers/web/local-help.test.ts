import { describe, expect, it } from "vitest";
import { HELP_ENTRIES } from "../../task-packs/help";
import { LOCAL_HELP_PROVIDER, localHelp, matchHelp } from "./local-help";

const best = (question: string, app?: string) => matchHelp(question, app)[0]?.id;

describe("offline help index", () => {
  it("covers every demo app, each entry with an https source", () => {
    const apps = new Set(HELP_ENTRIES.map((e) => e.app));
    for (const app of ["excel", "file-explorer", "settings", "notepad", "calculator", "brave", "chrome", "whatsapp"]) expect(apps).toContain(app);
    expect(new Set(HELP_ENTRIES.map((e) => e.id)).size).toBe(HELP_ENTRIES.length);
  });
});

describe("matchHelp", () => {
  it("finds the task from the learner's own words", () => {
    expect(best("How do I make a pivot table?")).toBe("excel-pivot-table");
    expect(best("how can I keep the header row visible when I scroll", "excel")).toBe("excel-freeze-panes");
    expect(best("freeze the top row")).toBe("excel-freeze-panes");
    expect(best("add another sheet", "excel")).toBe("excel-insert-sheet");
    expect(best("how do I zip these files")).toBe("explorer-zip");
    expect(best("make a new folder", "file-explorer")).toBe("explorer-new-folder");
    expect(best("turn on dark mode")).toBe("settings-dark-mode");
    expect(best("how do I save this", "notepad")).toBe("notepad-save");
    expect(best("what's 15 percent of 80", "calculator")).toBe("calculator-percent");
    expect(best("pin this chat", "whatsapp")).toBe("whatsapp-pin-chat");
    expect(best("how do I send a pdf on whatsapp")).toBe("whatsapp-send-file");
  });

  it("uses the app in front, or the one the question names, to pick between look-alikes", () => {
    expect(best("open a new tab", "chrome")).toBe("chrome-new-tab");
    expect(best("open a new tab", "brave")).toBe("brave-new-tab");
    expect(best("bookmark this page in chrome", "brave")).toBe("chrome-bookmarks");
    expect(best("rename this sheet", "excel")).toBe("excel-insert-sheet");
    expect(best("rename a file", "file-explorer")).toBe("explorer-rename");
  });

  it("never answers from another app's help", () => {
    expect(best("how do I send a file", "excel")).toBeUndefined();
    expect(best("pin a chat", "excel")).toBeUndefined();
  });

  it("stays quiet for questions it has no help for", () => {
    expect(best("what's the weather like in Delhi")).toBeUndefined();
    expect(best("hello Hodey")).toBeUndefined();
    expect(best("how do I write a VLOOKUP formula", "excel")).toBeUndefined();
    expect(best("send an email to my boss")).toBeUndefined();
    expect(best("")).toBeUndefined();
  });
});

describe("localHelp", () => {
  it("reads like a search answer: numbered steps as the page, the help page as the source", () => {
    const found = localHelp("make a pivot table", "excel");
    expect(found?.provider).toBe(LOCAL_HELP_PROVIDER);
    expect(found?.results[0].url).toMatch(/^https:\/\/support\.microsoft\.com\//);
    expect(found?.pages?.[0].text).toMatch(/^1\. Select the cells/);
    expect(found?.pages?.[0].text).toContain("2. Select Insert > PivotTable.");
  });

  it("is undefined when nothing matches", () => {
    expect(localHelp("what's the weather")).toBeUndefined();
  });
});
