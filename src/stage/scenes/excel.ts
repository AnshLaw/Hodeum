import type { Rect, UiElement } from "../../lib/types";
import type { MockApp, MockScene, MouseButton } from "../../providers/mock-perception";
import { APP_WINDOW, TITLE_BAR_HEIGHT, element, splitId, toggle } from "./layout";

const TABS = ["File", "Home", "Insert", "Draw", "Page Layout", "Formulas", "Data", "Review", "View"];
const RIBBON_COMMANDS: Record<string, string[]> = {
  Home: ["Paste", "Bold", "Merge & Center", "Conditional Formatting", "Sort & Filter"],
  Insert: ["PivotTable", "Recommended PivotTables", "Table", "Pictures", "Recommended Charts"],
  Formulas: ["Insert Function", "AutoSum", "Lookup & Reference"],
  Data: ["Get Data", "Refresh All", "Sort", "Filter"],
};
export const PIVOT_FIELDS = ["Region", "Product", "Sales"];
export const SALES_TABLE: string[][] = [
  ["Region", "Product", "Sales"],
  ["North", "Laptops", "12400"],
  ["North", "Phones", "8300"],
  ["South", "Laptops", "9100"],
  ["South", "Phones", "7600"],
  ["East", "Laptops", "11200"],
  ["East", "Phones", "6900"],
  ["West", "Laptops", "10100"],
  ["West", "Phones", "7200"],
];

const TAB_TOP = APP_WINDOW.y + TITLE_BAR_HEIGHT;
const TAB = { width: 92, height: 30, gap: 2, inset: 8 };
const RIBBON_TOP = TAB_TOP + TAB.height;
const RIBBON_HEIGHT = 96;
const RIBBON_BUTTON = { width: 92, height: 80, gap: 6, inset: 12, top: 8 };
const SHEET_TOP = RIBBON_TOP + RIBBON_HEIGHT;
const DIALOG = { width: 420, height: 200, top: 220, padding: 16 };
const DIALOG_BUTTON = { width: 80, height: 30, gap: 8 };
const PANE_WIDTH = 260;
const FIELD_ROW = { top: 44, height: 26, pitch: 32, inset: 16 };

const dialogRect: Rect = {
  x: APP_WINDOW.x + (APP_WINDOW.width - DIALOG.width) / 2,
  y: APP_WINDOW.y + DIALOG.top,
  width: DIALOG.width,
  height: DIALOG.height,
};

export const EXCEL_LAYOUT = {
  ribbon: { x: APP_WINDOW.x, y: RIBBON_TOP, width: APP_WINDOW.width, height: RIBBON_HEIGHT },
  sheet: { x: APP_WINDOW.x, y: SHEET_TOP, width: APP_WINDOW.width, height: APP_WINDOW.y + APP_WINDOW.height - SHEET_TOP },
  pane: { x: APP_WINDOW.x + APP_WINDOW.width - PANE_WIDTH, y: SHEET_TOP, width: PANE_WIDTH, height: APP_WINDOW.y + APP_WINDOW.height - SHEET_TOP },
  dialog: dialogRect,
} satisfies Record<string, Rect>;

interface ExcelState {
  tab: string;
  dialogOpen: boolean;
  paneOpen: boolean;
  checked: string[];
}

const initialExcelState = (): ExcelState => ({ tab: "Home", dialogOpen: false, paneOpen: false, checked: [] });

function dialogButton(index: number): Rect {
  const { x, y, width, height } = dialogRect;
  const fromRight = (2 - index) * DIALOG_BUTTON.width + (1 - index) * DIALOG_BUTTON.gap;
  return { x: x + width - DIALOG.padding - fromRight, y: y + height - DIALOG.padding - DIALOG_BUTTON.height, width: DIALOG_BUTTON.width, height: DIALOG_BUTTON.height };
}

/** Practice Excel: Home/Insert ribbon, PivotTable dialog, and a field list that builds a live summary. */
export class ExcelScene implements MockApp {
  readonly id = "excel";
  readonly label = "Excel";
  private state = initialExcelState();

  snapshot(): MockScene {
    return { app: "Excel", windowTitle: "Sales.xlsx - Excel", elements: [...this.tabs(), ...this.ribbon(), ...this.pane(), ...this.dialog()] };
  }

  press(elementId: string, button: MouseButton): void {
    if (button !== "left") return;
    if (this.state.dialogOpen) return this.pressDialog(elementId);
    const [kind, name] = splitId(elementId);
    if (kind === "tab") this.state = { ...this.state, tab: name };
    else if (kind === "ribbon" && name === "PivotTable") this.state = { ...this.state, dialogOpen: true };
    else if (kind === "field") this.state = { ...this.state, checked: toggle(this.state.checked, name) };
  }

  reset(): void {
    this.state = initialExcelState();
  }

  sheet(): { data: string[][]; pivot?: string[][] } {
    return { data: SALES_TABLE, pivot: this.pivot() };
  }

  private pressDialog(elementId: string): void {
    if (elementId === "dialog:ok") this.state = { ...this.state, dialogOpen: false, paneOpen: true };
    else if (elementId === "dialog:cancel") this.state = { ...this.state, dialogOpen: false };
  }

  private tabs(): UiElement[] {
    return TABS.map((name, i) =>
      element(`tab:${name}`, name, "tab item", { x: APP_WINDOW.x + TAB.inset + i * (TAB.width + TAB.gap), y: TAB_TOP, width: TAB.width, height: TAB.height }, name === this.state.tab),
    );
  }

  private ribbon(): UiElement[] {
    return (RIBBON_COMMANDS[this.state.tab] ?? []).map((name, i) =>
      element(`ribbon:${name}`, name, "button", {
        x: APP_WINDOW.x + RIBBON_BUTTON.inset + i * (RIBBON_BUTTON.width + RIBBON_BUTTON.gap),
        y: RIBBON_TOP + RIBBON_BUTTON.top,
        width: RIBBON_BUTTON.width,
        height: RIBBON_BUTTON.height,
      }),
    );
  }

  private pane(): UiElement[] {
    if (!this.state.paneOpen) return [];
    const { pane } = EXCEL_LAYOUT;
    const fields = PIVOT_FIELDS.map((name, i) =>
      element(`field:${name}`, name, "check box", { x: pane.x + FIELD_ROW.inset, y: pane.y + FIELD_ROW.top + i * FIELD_ROW.pitch, width: pane.width - FIELD_ROW.inset * 2, height: FIELD_ROW.height }, this.state.checked.includes(name)),
    );
    return [element("pane", "PivotTable Fields", "pane", pane), ...fields];
  }

  private dialog(): UiElement[] {
    if (!this.state.dialogOpen) return [];
    return [
      element("dialog", "PivotTable from table or range", "window", dialogRect),
      element("dialog:ok", "OK", "button", dialogButton(0)),
      element("dialog:cancel", "Cancel", "button", dialogButton(1)),
    ];
  }

  private pivot(): string[][] | undefined {
    if (!this.state.paneOpen || !this.state.checked.includes("Region")) return undefined;
    const withSales = this.state.checked.includes("Sales");
    const totals = new Map<string, number>();
    for (const [region, , sales] of SALES_TABLE.slice(1)) totals.set(region, (totals.get(region) ?? 0) + Number(sales));
    const format = (n: number) => n.toLocaleString("en-US");
    const grand = [...totals.values()].reduce((a, b) => a + b, 0);
    const row = (label: string, value: number) => (withSales ? [label, format(value)] : [label]);
    return [withSales ? ["Row Labels", "Sum of Sales"] : ["Row Labels"], ...[...totals].map(([r, t]) => row(r, t)), row("Grand Total", grand)];
  }
}
