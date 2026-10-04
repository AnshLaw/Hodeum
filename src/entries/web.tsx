import { createSupabase, supabaseConfig } from "../features/account/config";
import { NotConfigured, WebApp } from "../web/WebApp";
import { mount } from "./mount";

const config = supabaseConfig();
// The Google redirect lands back here with ?code=…; supabase-js exchanges it (PKCE).
mount(config ? <WebApp client={createSupabase(config, { detectSessionInUrl: true })} /> : <NotConfigured />);
