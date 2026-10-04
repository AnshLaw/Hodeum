import { describe, expect, it } from "vitest";
import { ExcelScene } from "./excel";
import { ExplorerScene } from "./explorer";
import { IphoneScene } from "./iphone";

const names = (scene: { snapshot(): { elements: { name: string }[] } }) => scene.snapshot().elements.map((e) => e.name);
const find = (scene: ExcelScene | ExplorerScene, name: string) => scene.snapshot().elements.find((e) => e.name === name);

describe("ExcelScene", () => {
  it("switches tabs and shows that tab's ribbon", () => {
    const excel = new ExcelScene();
    expect(find(excel, "Home")?.selected).toBe(true);
    excel.press("tab:Insert", "left");
    expect(find(excel, "Insert")?.selected).toBe(true);
    expect(names(excel)).toContain("PivotTable");
  });

  it("opens a modal PivotTable dialog that blocks other clicks", () => {
    const excel = new ExcelScene();
    excel.press("tab:Insert", "left");
    excel.press("ribbon:PivotTable", "left");
    expect(names(excel)).toContain("PivotTable from table or range");
    excel.press("tab:Data", "left");
    expect(find(excel, "Insert")?.selected).toBe(true);
    excel.press("dialog:ok", "left");
    expect(names(excel)).toContain("PivotTable Fields");
    expect(names(excel)).not.toContain("PivotTable from table or range");
  });

  it("builds a live pivot summary from ticked fields", () => {
    const excel = new ExcelScene();
    excel.press("tab:Insert", "left");
    excel.press("ribbon:PivotTable", "left");
    excel.press("dialog:ok", "left");
    excel.press("field:Region", "left");
    excel.press("field:Sales", "left");
    expect(find(excel, "Sales")?.selected).toBe(true);
    expect(excel.sheet().pivot?.at(-1)).toEqual(["Grand Total", "72,800"]);
    excel.reset();
    expect(excel.sheet().pivot).toBeUndefined();
  });
});

describe("ExplorerScene", () => {
  it("opens the context menu on right-click and keeps the selection", () => {
    const explorer = new ExplorerScene();
    explorer.press("item:budget.xlsx", "right");
    expect(names(explorer)).toContain("Compress to...");
    expect(explorer.snapshot().elements.filter((e) => e.selected).map((e) => e.name)).toEqual(["report.docx", "budget.xlsx", "photo.jpg"]);
  });

  it("zips via Compress to… → ZIP File", () => {
    const explorer = new ExplorerScene();
    explorer.press("item:report.docx", "right");
    explorer.press("menu:Compress to...", "left");
    expect(names(explorer)).toContain("ZIP File");
    explorer.press("submenu:ZIP File", "left");
    expect(find(explorer, "report.zip")?.selected).toBe(true);
    expect(names(explorer)).not.toContain("Compress to...");
  });

  it("closes the menu on other menu items", () => {
    const explorer = new ExplorerScene();
    explorer.press("list", "right");
    explorer.press("menu:Open", "left");
    expect(names(explorer)).not.toContain("Open");
  });
});

describe("IphoneScene", () => {
  it("goes Home → Settings → Display & Brightness → Dark", () => {
    const phone = new IphoneScene();
    phone.press("app:Settings", "left");
    expect(phone.snapshot().elements.some((e) => e.name === "Display & Brightness")).toBe(false);
    phone.press("list:scroll", "left");
    phone.press("row:Display & Brightness", "left");
    expect(phone.snapshot().elements.some((e) => e.name === "APPEARANCE")).toBe(true);
    phone.press("option:Dark", "left");
    expect(phone.snapshot().tone).toBe("dark");
  });
});
