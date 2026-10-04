import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const root = import.meta.dirname;
/** The dashboard and sign-in page can't work without these; they're public (a URL and a publishable key). */
const REQUIRED_ON_VERCEL = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

/**
 * Vercel builds every push to main: without the Supabase settings it would replace the live site with a
 * dashboard that can't sign in. Failing the production build keeps the live site as it is and says what's
 * missing. Branch previews (where the settings may be Production-only) build anyway, with a warning.
 */
function requireVercelEnv(mode: string): void {
  if (!process.env.VERCEL) return;
  const env = { ...loadEnv(mode, root, "VITE_"), ...process.env };
  const missing = REQUIRED_ON_VERCEL.filter((name) => !env[name]);
  if (missing.length === 0) return;
  const message = `Set ${missing.join(" and ")} in the Vercel project's Environment Variables (Settings › Environment Variables), then redeploy.`;
  // The live site must be able to sign in; a branch preview without them still builds, with sign-in off.
  if (process.env.VERCEL_ENV === "production") throw new Error(message);
  console.warn(`${message} This preview builds without sign-in.`);
}

/**
 * The public site (hodeum.vercel.app): home page and privacy policy (site/public, copied as-is),
 * the web dashboard, and the sign-in page the desktop app opens.
 */
const config = {
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
};

export default defineConfig(({ mode }) => {
  requireVercelEnv(mode);
  return config;
});
