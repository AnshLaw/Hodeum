import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../components/shared/base.css";

export function mount(node: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root element is missing");
  createRoot(root).render(<StrictMode>{node}</StrictMode>);
}
