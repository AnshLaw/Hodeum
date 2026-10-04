//! Opt-in cloud providers. Calls run here so API keys stay in Windows Credential Manager and never
//! reach the webview; the UI only learns whether a key is saved.

pub mod backboard;
pub mod catalog;
pub mod dev_env;
pub mod elevenlabs;
pub mod gemini;
pub mod gemini_guard;
pub mod keys;
