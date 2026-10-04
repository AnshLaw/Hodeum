import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = import.meta.dirname;

/**
 * The public site (hodeum.vercel.app): home page and privacy policy (site/public, copied as-is),
 * the web dashboard, and the sign-in page the desktop app opens.
 */
export default defineConfig({
  plugins: [react()],
  publicDir: resolve(root, "site/public"),
  build: {
    outDir: resolve(root, "dist-site"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        web: resolve(root, "web.html"),
        signin: resolve(root, "signin.html"),
      },
    },
  },
});
