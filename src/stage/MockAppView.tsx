import type { CSSProperties, ReactNode } from "react";
import type { Rect, UiElement } from "../lib/types";
import type { MockApp, MouseButton } from "../providers/mock-perception";
import { APP_WINDOW } from "./scenes/layout";
import { ribbonIcon } from "./ribbon-icons";

const ELEMENT_LAYER_BASE = 10;
/** Containers whose accessible name isn't visible text in the real app. */
const UNLABELLED_ROLES = new Set(["list", "menu"]);

export function rectStyle(rect: Rect): CSSProperties {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

function MockElement({ element, layer, onPress }: { element: UiElement; layer: number; onPress: (id: string, button: MouseButton) => void }) {
  const icon = element.id.startsWith("ribbon:") ? ribbonIcon(element.name) : undefined;
  return (
    <button
      type="button"
      className={`mock-el mock-el--${element.role.replace(/\s+/g, "-")}${icon ? " mock-el--icon" : ""}`}
      style={{ ...rectStyle(element.bounds), zIndex: ELEMENT_LAYER_BASE + layer }}
      data-selected={element.selected ? "true" : undefined}
      onClick={() => onPress(element.id, "left")}
      onContextMenu={(event) => {
        event.preventDefault();
        onPress(element.id, "right");
      }}
    >
      {icon}
      {UNLABELLED_ROLES.has(element.role) ? null : <span>{element.name}</span>}
    </button>
  );
}

/** Renders a scripted app from the same element list the Hode runtime observes, so the overlay lines up exactly. */
export function MockAppView({ app, onPress, frame = APP_WINDOW, children }: { app: MockApp; onPress: (id: string, button: MouseButton) => void; frame?: Rect; children?: ReactNode }) {
  const scene = app.snapshot();
  return (
    <>
      <div className={`mock-window mock-window--${app.id}`} style={rectStyle(frame)}>
        <div className="mock-window__title">{scene.windowTitle}</div>
      </div>
      {children}
      {scene.elements.map((element, index) => (
        <MockElement key={element.id} element={element} layer={index} onPress={onPress} />
      ))}
    </>
  );
}
