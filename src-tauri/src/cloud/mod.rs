//! Opt-in cloud providers. Calls run here so API keys stay in Windows Credential Manager and never
//! reach the webview; the UI only learns whether a key is saved.

pub mod keys;
