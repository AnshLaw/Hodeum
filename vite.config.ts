import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const root = import.meta.dirname;

/**
 * Never reload the running app for files it doesn't serve: agent worktrees, builds, models.
 * Anchored to this checkout, so a dev server run inside a worktree still watches its own files.
 */
const WATCH_IGNORED = [".claude", "dist-site", "src-tauri/target", "models", "runtime", ".playwright-mcp"].map(
  (dir) => `${resolve(root, dir).split("\\").join("/")}/**`,
);

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: WATCH_IGNORED },
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
