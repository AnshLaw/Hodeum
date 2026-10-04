#[path = "src/ai_root.rs"]
mod ai_root;

use std::path::Path;

/// Bakes in where `models/` and `runtime/` are, so a build from a git worktree still finds the
/// models installed in the main checkout. Fixed at build time: nothing at runtime can redirect it.
fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let checkout = Path::new(&manifest).join("..");
    let root = ai_root::resolve(&checkout);
    println!("cargo:rustc-env=HODEUM_LOCAL_AI_ROOT={}", root.display());
    println!("cargo:rerun-if-changed=../models");
    println!("cargo:rerun-if-changed=../.git");
    tauri_build::build()
}
