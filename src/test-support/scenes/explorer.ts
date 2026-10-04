import type { Point, Rect, UiElement } from "../../lib/types";
import type { MockApp, MockScene, MouseButton } from "../../providers/mock-perception";
import { APP_WINDOW, TITLE_BAR_HEIGHT, element, splitId } from "./layout";

const FILES = ["report.docx", "budget.xlsx", "photo.jpg", "notes.txt"];
const INITIALLY_SELECTED = ["report.docx", "budget.xlsx", "photo.jpg"];
const MENU_ITEMS = ["Open", "Compress to...", "Copy as path", "Delete"];
const SUBMENU_ITEMS = ["ZIP File", "7z File", "TAR File"];
const COMPRESS_INDEX = MENU_ITEMS.indexOf("Compress to...");

const COMMAND_BAR_HEIGHT = 44;
const ADDRESS_BAR_HEIGHT = 36;
const NAV_WIDTH = 200;
const LIST_HEADER_HEIGHT = 32;
const ROW = { height: 32, inset: 8 };
const MENU = { width: 220, itemHeight: 30, padding: 6, submenuOverlap: 4 };
const CONTEXT_MENU_OFFSET_X = 160;
const CONTENT_TOP = APP_WINDOW.y + TITLE_BAR_HEIGHT + COMMAND_BAR_HEIGHT + ADDRESS_BAR_HEIGHT;

export const EXPLORER_LAYOUT = {
  commandBar: { x: APP_WINDOW.x, y: APP_WINDOW.y + TITLE_BAR_HEIGHT, width: APP_WINDOW.width, height: COMMAND_BAR_HEIGHT },
  addressBar: { x: APP_WINDOW.x, y: APP_WINDOW.y + TITLE_BAR_HEIGHT + COMMAND_BAR_HEIGHT, width: APP_WINDOW.width, height: ADDRESS_BAR_HEIGHT },
  nav: { x: APP_WINDOW.x, y: CONTENT_TOP, width: NAV_WIDTH, height: APP_WINDOW.y + APP_WINDOW.height - CONTENT_TOP },
  list: { x: APP_WINDOW.x + NAV_WIDTH, y: CONTENT_TOP, width: APP_WINDOW.width - NAV_WIDTH, height: APP_WINDOW.y + APP_WINDOW.height - CONTENT_TOP },
  listHeaderHeight: LIST_HEADER_HEIGHT,
};

interface ExplorerState {
  files: string[];
  selected: string[];
  menu?: Point;
  submenuOpen: boolean;
}

const initialExplorerState = (): ExplorerState => ({ files: [...FILES], selected: [...INITIALLY_SELECTED], submenuOpen: false });

function rowRect(index: number): Rect {
  const { list } = EXPLORER_LAYOUT;
  return { x: list.x + ROW.inset, y: list.y + LIST_HEADER_HEIGHT + index * ROW.height, width: list.width - ROW.inset * 2, height: ROW.height - 2 };
}

function menuElements(id: string, name: string, anchor: Point, items: string[], prefix: string): UiElement[] {
  const frame = { x: anchor.x, y: anchor.y, width: MENU.width, height: MENU.padding * 2 + items.length * MENU.itemHeight };
  const rows = items.map((label, i) =>
    element(`${prefix}:${label}`, label, "menu item", { x: frame.x + MENU.padding, y: frame.y + MENU.padding + i * MENU.itemHeight, width: MENU.width - MENU.padding * 2, height: MENU.itemHeight }),
  );
  return [element(id, name, "menu", frame), ...rows];
}

/** Practice File Explorer: selected files, right-click menu, Compress to… → ZIP File. */
export class ExplorerScene implements MockApp {
  readonly id = "explorer";
  readonly label = "File Explorer";
  private state = initialExplorerState();

  snapshot(): MockScene {
    const items = this.state.files.map((name, i) => element(`item:${name}`, name, "list item", rowRect(i), this.state.selected.includes(name)));
    return { app: "File Explorer", windowTitle: "Q3 report - File Explorer", elements: [element("list", "Items View", "list", EXPLORER_LAYOUT.list), ...items, ...this.menus()] };
  }

  press(elementId: string, button: MouseButton): void {
    const [kind, name] = splitId(elementId);
    if (kind === "menu") return name === "Compress to..." ? this.openSubmenu() : this.closeMenu();
    if (kind === "submenu") return name === "ZIP File" ? this.zip() : this.closeMenu();
    if (kind === "item") return this.pressItem(name, button);
    if (kind === "list") this.state = { ...this.state, menu: button === "right" ? { x: EXPLORER_LAYOUT.list.x + CONTEXT_MENU_OFFSET_X, y: EXPLORER_LAYOUT.list.y + LIST_HEADER_HEIGHT } : undefined, submenuOpen: false };
  }

  reset(): void {
    this.state = initialExplorerState();
  }

  private pressItem(name: string, button: MouseButton): void {
    const keepSelection = button === "right" && this.state.selected.includes(name);
    const row = rowRect(this.state.files.indexOf(name));
    const menu = button === "right" ? { x: row.x + CONTEXT_MENU_OFFSET_X, y: row.y + row.height / 2 } : undefined;
    this.state = { ...this.state, selected: keepSelection ? this.state.selected : [name], menu, submenuOpen: false };
  }

  private openSubmenu(): void {
    this.state = { ...this.state, submenuOpen: true };
  }

  private closeMenu(): void {
    this.state = { ...this.state, menu: undefined, submenuOpen: false };
  }

  private zip(): void {
    const base = this.state.selected[0]?.replace(/\.[^.]+$/, "") ?? "Archive";
    const name = `${base}.zip`;
    const files = this.state.files.includes(name) ? this.state.files : [...this.state.files, name];
    this.state = { files, selected: [name], menu: undefined, submenuOpen: false };
  }

  private menus(): UiElement[] {
    const anchor = this.state.menu;
    if (!anchor) return [];
    const menu = menuElements("menu", "Context", anchor, MENU_ITEMS, "menu");
    if (!this.state.submenuOpen) return menu;
    const compress = menu[COMPRESS_INDEX + 1].bounds;
    const subAnchor = { x: anchor.x + MENU.width - MENU.submenuOverlap, y: compress.y - MENU.padding };
    return [...menu, ...menuElements("submenu", "Compress to", subAnchor, SUBMENU_ITEMS, "submenu")];
  }
}
