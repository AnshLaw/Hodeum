import type { Rect, UiElement } from "../../lib/types";
import type { MockApp, MockScene, MouseButton } from "../../providers/mock-perception";
import { element, splitId } from "./layout";

/** The practice iPhone, portrait, centred on the stage desktop. */
export const PHONE_FRAME: Rect = { x: 500, y: 96, width: 280, height: 600 };
const PAD = 16;
const STATUS_BAR = 44;
const ROW_HEIGHT = 44;
const VISIBLE_ROWS = 6;
const SCROLL_STEP = 3;
const ICON = { size: 56, gap: 10, label: 16 };
const HOME_APPS = ["Clock", "Settings", "Maps", "Photos"];
const SETTINGS_ROWS = ["Airplane Mode", "Wi-Fi", "Bluetooth", "Battery", "General", "Accessibility", "Camera", "Display & Brightness", "Wallpaper"];
const DISPLAY_ROWS = ["Text Size", "Bold Text"];

type Screen = "home" | "settings" | "display" | "wallpaper" | "textsize";

interface PhoneState {
  screen: Screen;
  scroll: number;
  dark: boolean;
}

const initialPhoneState = (): PhoneState => ({ screen: "home", scroll: 0, dark: false });

function row(index: number): Rect {
  return { x: PHONE_FRAME.x + PAD, y: PHONE_FRAME.y + STATUS_BAR + ROW_HEIGHT * (index + 1), width: PHONE_FRAME.width - PAD * 2, height: ROW_HEIGHT - 4 };
}

function title(text: string): UiElement {
  return element(`title:${text}`, text, "text", { x: PHONE_FRAME.x + PAD, y: PHONE_FRAME.y + STATUS_BAR, width: 160, height: ROW_HEIGHT - 8 });
}

function backButton(): UiElement {
  return element("nav:back", "Settings", "text", { x: PHONE_FRAME.x + PAD, y: PHONE_FRAME.y + STATUS_BAR - 30, width: 80, height: 26 });
}

function homeElements(): UiElement[] {
  return HOME_APPS.map((label, i) => {
    const x = PHONE_FRAME.x + PAD + i * (ICON.size + ICON.gap);
    return element(`app:${label}`, label, "text", { x, y: PHONE_FRAME.y + STATUS_BAR + ICON.size, width: ICON.size, height: ICON.label });
  });
}

function settingsElements(scroll: number): UiElement[] {
  const rows = SETTINGS_ROWS.slice(scroll, scroll + VISIBLE_ROWS).map((label, i) => element(`row:${label}`, label, "text", row(i)));
  const more = element("list:scroll", "Scroll", "scroll bar", { ...row(VISIBLE_ROWS), height: ROW_HEIGHT / 2 });
  return [title("Settings"), ...rows, more];
}

function displayElements(): UiElement[] {
  const half = (PHONE_FRAME.width - PAD * 2) / 2;
  const option = (label: string, i: number) => element(`option:${label}`, label, "text", { ...row(1), x: PHONE_FRAME.x + PAD + i * half, width: half - 4 });
  const rows = DISPLAY_ROWS.map((label, i) => element(`row:${label}`, label, "text", row(i + 3)));
  return [backButton(), title("Display & Brightness"), element("header:Appearance", "APPEARANCE", "text", row(0)), option("Light", 0), option("Dark", 1), ...rows];
}

function screenElements(state: PhoneState): UiElement[] {
  switch (state.screen) {
    case "home":
      return homeElements();
    case "settings":
      return settingsElements(state.scroll);
    case "display":
      return displayElements();
    case "wallpaper":
      return [backButton(), title("Wallpaper"), element("row:add", "+ Add New Wallpaper", "text", row(0))];
    case "textsize":
      return [backButton(), title("Text Size"), element("row:hint", "Apps that support Dynamic Type will adjust to your preferred reading size below.", "text", row(0))];
  }
}

const ROW_TARGETS: Record<string, Screen> = { "Display & Brightness": "display", Wallpaper: "wallpaper", "Text Size": "textsize" };

/** Practice iPhone: Home Screen → Settings (scrollable) → Display & Brightness → Dark. */
export class IphoneScene implements MockApp {
  readonly id = "iphone";
  readonly label = "iPhone";
  private state = initialPhoneState();

  snapshot(): MockScene {
    return { app: "iPhone", windowTitle: "", elements: screenElements(this.state), tone: this.state.dark ? "dark" : "light" };
  }

  press(elementId: string, _button: MouseButton): void {
    const [kind, name] = splitId(elementId);
    const s = this.state;
    if (kind === "app" && name === "Settings") this.state = { ...s, screen: "settings", scroll: 0 };
    else if (kind === "list") this.state = { ...s, scroll: s.scroll === 0 ? SCROLL_STEP : 0 };
    else if (kind === "row" && ROW_TARGETS[name]) this.state = { ...s, screen: ROW_TARGETS[name] };
    else if (kind === "nav") this.state = { ...s, screen: s.screen === "textsize" ? "display" : "settings" };
    else if (kind === "option") this.state = { ...s, dark: name === "Dark" };
  }

  reset(): void {
    this.state = initialPhoneState();
  }
}
