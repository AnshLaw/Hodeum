import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const root = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      // The practice stage (index.html) is dev-only; the app ships the Tauri windows.
      input: {
        app: resolve(root, "app.html"),
        notch: resolve(root, "notch.html"),
        overlay: resolve(root, "overlay.html"),
        // The web dashboard; deploy dist/web.html and its assets to any static host.
        web: resolve(root, "web.html"),
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
