import { describe, expect, it } from "vitest";
import excelPivot from "./excel-pivot.json";
import { TASK_PACKS, appFromGoal, matchGoal } from "./index";
import { loadTaskPack } from "./schema";

type RawPack = { steps: Array<{ skill: string; target: Record<string, unknown> }> };
const clone = (): RawPack => JSON.parse(JSON.stringify(excelPivot)) as RawPack;

describe("loadTaskPack", () => {
  it("loads every shipped pack", () => {
    expect(TASK_PACKS.map((p) => p.id)).toEqual([
      "excel-pivot",
      "windows-zip",
      "iphone-dark-mode",
      "windows-dark-mode",
      "windows-light-mode",
      "notepad-save-note",
      "calculator-percent",
    ]);
  });

  it("gives every lesson the full Teach loop: an idea, a recap, a recall question and what it isn't for", () => {
    for (const id of ["windows-dark-mode", "windows-light-mode", "notepad-save-note", "calculator-percent"]) {
      const pack = TASK_PACKS.find((p) => p.id === id);
      expect(pack?.concept, id).toBeTruthy();
      expect(pack?.recap, id).toBeTruthy();
      expect(pack?.check?.options[pack.check.answer], id).toBeTruthy();
      expect(pack?.notFor?.length, id).toBeGreaterThan(0);
      expect(pack?.launch, id).toBeDefined();
    }
  });

  it("rejects coordinates in a target", () => {
    const raw = clone();
    raw.steps[0].target.bbox = [1, 2, 3, 4];
    expect(() => loadTaskPack(raw)).toThrow(/Invalid task pack/);
  });

  it("accepts a target that prefers a selected item, and nothing else there", () => {
    const raw = clone();
    raw.steps[0].target.prefer = "selected";
    expect(loadTaskPack(raw).steps[0].target.prefer).toBe("selected");
    raw.steps[0].target.prefer = "biggest";
    expect(() => loadTaskPack(raw)).toThrow(/Invalid task pack/);
  });

  it("the Zip pack's first step points at a selected file, not the whole list", () => {
    const zip = TASK_PACKS.find((p) => p.id === "windows-zip");
    expect(zip?.steps[0].target.prefer).toBe("selected");
  });

  it("rejects a pack without steps", () => {
    const raw = clone();
    raw.steps = [];
    expect(() => loadTaskPack(raw)).toThrow(/Invalid task pack/);
  });

  it("accepts a phone surface and a screen_tone signal", () => {
    const raw = JSON.parse(JSON.stringify(excelPivot)) as Record<string, unknown> & { steps: Array<Record<string, unknown>> };
    raw.surface = "phone";
    raw.steps[0].success = { kind: "screen_tone", tone: "dark" };
    expect(loadTaskPack(raw).surface).toBe("phone");
  });

  it("rejects an unknown surface", () => {
    const raw = JSON.parse(JSON.stringify(excelPivot)) as Record<string, unknown>;
    raw.surface = "android";
    expect(() => loadTaskPack(raw)).toThrow(/Invalid task pack/);
  });

  it("opens an app by program or by an allowlisted link, never both or neither", () => {
    const withLaunch = (launch: unknown) => ({ ...JSON.parse(JSON.stringify(excelPivot)), launch });
    expect(loadTaskPack(withLaunch({ uri: "ms-settings:colors" })).launch).toEqual({ uri: "ms-settings:colors" });
    expect(loadTaskPack(withLaunch({ uri: "calculator:" })).launch?.uri).toBe("calculator:");
    expect(loadTaskPack(withLaunch({ exe: "excel.exe", sample: "hodeum-sales.csv" })).launch?.sample).toBe("hodeum-sales.csv");
    expect(() => loadTaskPack(withLaunch({ exe: "notepad.exe", uri: "ms-settings:colors" }))).toThrow(/exactly one/);
    expect(() => loadTaskPack(withLaunch({ sample: "hodeum-sales.csv" }))).toThrow(/exactly one/);
    expect(() => loadTaskPack(withLaunch({ uri: "https://example.com/x" }))).toThrow(/Invalid task pack/);
    expect(() => loadTaskPack(withLaunch({ uri: "ms-settings:colors /x" }))).toThrow(/Invalid task pack/);
  });

  it("rejects a malformed skill id", () => {
    const raw = clone();
    raw.steps[0].skill = "Excel Insert";
    expect(() => loadTaskPack(raw)).toThrow(/skill ids/);
  });
});

describe("matchGoal", () => {
  it.each([
    ["Teach me how to make a pivot table in Excel", "excel-pivot"],
    ["mujhe pivot table banana sikhao", "excel-pivot"],
    ["Make a PivotTable", "excel-pivot"],
    ["zip these files", "windows-zip"],
    ["how do I compress my photos", "windows-zip"],
    ["turn on dark mode on my iphone", "iphone-dark-mode"],
    ["make my phone dark mode", "iphone-dark-mode"],
  ])("matches %j to %s", (goal, id) => {
    expect(matchGoal(goal, TASK_PACKS)?.id).toBe(id);
  });

  it.each(["turn on dark mode in windows", "enable dark mode in outlook", "switch excel to dark mode", "dark mode on my laptop"])(
    "keeps the iPhone pack away from the desktop goal %j",
    (goal) => {
      expect(matchGoal(goal, TASK_PACKS)?.id).not.toBe("iphone-dark-mode");
    },
  );

  it("returns undefined for an unrelated goal", () => {
    expect(matchGoal("write a poem", TASK_PACKS)).toBeUndefined();
  });

  it.each([
    ["ye files zip karo", "windows-zip"],
    ["ये फाइलें जिप करो", "windows-zip"],
    ["make a zip of my photos", "windows-zip"],
    ["summarize my sales data in excel", "excel-pivot"],
    ["create a pivot table", "excel-pivot"],
  ])("still matches %j to %s", (goal, id) => {
    expect(matchGoal(goal, TASK_PACKS)?.id).toBe(id);
  });

  // Each of these used to start the wrong lesson; with no pack they go to an open-ended Hode instead.
  it.each([
    "make a chart in excel",
    "make a table of contents in word",
    "sort data in excel",
    "filter my data in excel",
    "compress pictures in powerpoint",
    "open a zip file",
    "sort by zip code",
  ])("starts no lesson for %j, which only shares a word or two with one", (goal) => {
    expect(matchGoal(goal, TASK_PACKS)).toBeUndefined();
  });
});

describe("matchGoal for the Windows, Notepad and Calculator lessons", () => {
  it.each([
    ["turn on dark mode", "windows-dark-mode"],
    ["turn on dark mode in windows", "windows-dark-mode"],
    ["how do I turn on dark mode on my laptop", "windows-dark-mode"],
    ["switch my pc to dark mode", "windows-dark-mode"],
    ["make windows dark", "windows-dark-mode"],
    ["dark mode on karo", "windows-dark-mode"],
    ["laptop ko dark mode mein karo", "windows-dark-mode"],
    ["डार्क मोड चालू करो", "windows-dark-mode"],
    ["turn on light mode", "windows-light-mode"],
    ["switch windows to light theme", "windows-light-mode"],
    ["turn off dark mode", "windows-light-mode"],
    ["disable dark mode on my computer", "windows-light-mode"],
    ["dark mode band karo", "windows-light-mode"],
    ["लाइट मोड चालू करो", "windows-light-mode"],
    ["डार्क मोड बंद करो", "windows-light-mode"],
    ["save a note", "notepad-save-note"],
    ["how do I save notes in notepad", "notepad-save-note"],
    ["write a shopping list note and save it", "notepad-save-note"],
    ["notepad mein note likho", "notepad-save-note"],
    ["नोटपैड में नोट सेव करना", "notepad-save-note"],
    ["calculate a percentage", "calculator-percent"],
    ["how do I find 20 percent of 50", "calculator-percent"],
    ["work out a tip", "calculator-percent"],
    ["percent in calculator", "calculator-percent"],
    ["50 ka 20 percent nikalo", "calculator-percent"],
    ["50 का 20 प्रतिशत निकालो", "calculator-percent"],
  ])("matches %j to %s", (goal, id) => {
    expect(matchGoal(goal, TASK_PACKS)?.id).toBe(id);
  });

  it.each(["turn on dark mode on my iphone", "make my phone dark mode", "iphone ko dark mode karo"])(
    "keeps the iPhone goal %j on the iPhone lesson",
    (goal) => {
      expect(matchGoal(goal, TASK_PACKS)?.id).toBe("iphone-dark-mode");
    },
  );

  it.each([
    "make a chart in excel",
    "enable dark mode in outlook",
    "switch excel to dark mode",
    "how do I save a file in word",
    "percent in excel",
    "take a sticky note",
    "open calculator",
    "turn on night light",
    "open notepad",
    "आईफोन में डार्क मोड चालू करो",
  ])("starts none of these lessons for %j", (goal) => {
    expect(["windows-dark-mode", "windows-light-mode", "notepad-save-note", "calculator-percent"]).not.toContain(matchGoal(goal, TASK_PACKS)?.id);
  });

  it("starts no lesson at all for an Excel chart", () => {
    expect(matchGoal("make a chart in excel", TASK_PACKS)).toBeUndefined();
  });
});

describe("appFromGoal", () => {
  it("finds the app a goal names", () => {
    expect(appFromGoal("add a table of contents in Word")).toBe("Word");
    expect(appFromGoal("how do I make slides in powerpoint")).toBe("PowerPoint");
    expect(appFromGoal("rename a folder in file explorer")).toBe("File Explorer");
    expect(appFromGoal("clear my chrome cache")).toBe("Chrome");
  });

  it("leaves goals without an app alone", () => {
    expect(appFromGoal("teach me keyboard shortcuts")).toBeUndefined();
    expect(appFromGoal("pick the right word for this")).toBeUndefined();
    expect(appFromGoal("open the sidebar in edge")).toBe("Edge");
  });
});

/** Words a speech engine can't pronounce right without knowing the sense ("lives" as lyves). */
const HETERONYMS = /\b(lives|reads?|wound|tears?|leads?|bass|wind|minute|object|present|record|refuse|desert|bow)\b/i;

describe("lesson speech", () => {
  it("avoids words the voice may say in the wrong sense", () => {
    const spoken = TASK_PACKS.flatMap((pack) => pack.steps.flatMap((s) => [s.objective, s.explain, ...Object.values(s.speech), ...s.mistakes.map((m) => m.correction)]));
    expect(spoken.filter((line) => HETERONYMS.test(line))).toEqual([]);
  });
});
