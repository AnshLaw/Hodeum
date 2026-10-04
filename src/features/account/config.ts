/// <reference types="vite/client" />
import { createClient, type SupabaseClient, type SupabaseClientOptions } from "@supabase/supabase-js";

/** Public identifiers, not secrets: Google shows the client ID to anyone signing in. `.env.local` can override both. */
const DEFAULT_SITE_URL = "https://hodeum.vercel.app";
const DEFAULT_GOOGLE_CLIENT_ID = "338229660922-5iik45pn7gllqmj3slqpip20jf5ii6me.apps.googleusercontent.com";

/** The project's public URL and anon (publishable) key, from `.env.local`. Row Level Security protects the data. */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

interface Env {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_HODEUM_SITE_URL?: string;
  VITE_GOOGLE_CLIENT_ID?: string;
}

const env = () => import.meta.env as Env;

/** Undefined when this build has no Supabase project: Hodeum then stays fully local. */
export function supabaseConfig(values: Env = env()): SupabaseConfig | undefined {
  const url = values.VITE_SUPABASE_URL?.trim();
  const anonKey = values.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return undefined;
  if (!url.startsWith("https://") && !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
    console.error("VITE_SUPABASE_URL must be https (or a local Supabase on localhost); accounts are off");
    return undefined;
  }
  return { url, anonKey };
}

/** Where Hodeum's sign-in page and dashboard live; the desktop opens its sign-in page. */
export const siteUrl = (values: Env = env()): string => values.VITE_HODEUM_SITE_URL?.trim() || DEFAULT_SITE_URL;

/** The Google OAuth (web) client that Supabase also trusts, used by "Sign in with Google". */
export const googleClientId = (values: Env = env()): string => values.VITE_GOOGLE_CLIENT_ID?.trim() || DEFAULT_GOOGLE_CLIENT_ID;

export function createSupabase(config: SupabaseConfig, auth: NonNullable<SupabaseClientOptions<"public">["auth"]>): SupabaseClient {
  return createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, ...auth } });
}
