/// <reference types="vite/client" />
import { createClient, type SupabaseClient, type SupabaseClientOptions } from "@supabase/supabase-js";

/** The project's public URL and anon (publishable) key, from `.env.local`. Row Level Security protects the data. */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

interface Env {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** Undefined when this build has no Supabase project: Hodeum then stays fully local. */
export function supabaseConfig(env: Env = import.meta.env as Env): SupabaseConfig | undefined {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return undefined;
  if (!url.startsWith("https://") && !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
    console.error("VITE_SUPABASE_URL must be https (or a local Supabase on localhost); accounts are off");
    return undefined;
  }
  return { url, anonKey };
}

export function createSupabase(config: SupabaseConfig, auth: NonNullable<SupabaseClientOptions<"public">["auth"]>): SupabaseClient {
  return createClient(config.url, config.anonKey, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, ...auth } });
}