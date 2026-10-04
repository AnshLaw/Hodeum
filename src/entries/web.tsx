// First, so component styles of equal specificity win in dev as they do in release builds.
import "../components/shared/base.css";
import { createSupabase, supabaseConfig } from "../features/account/config";
import { NotConfigured, WebApp } from "../web/WebApp";
import { mount } from "./mount";

const config = supabaseConfig();
// Sign-in is Google's button on this page (ID token -> Supabase), so there's no redirect to detect.
mount(config ? <WebApp client={createSupabase(config, { detectSessionInUrl: false })} /> : <NotConfigured />);
