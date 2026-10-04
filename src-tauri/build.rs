#[path = "src/ai_root.rs"]
mod ai_root;
#[path = "src/build_stamp.rs"]
mod build_stamp;

use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Runs git in the checkout; None (with a build warning) when git is missing or fails.
fn git(checkout: &Path, args: &[&str]) -> Option<String> {
    match Command::new("git").arg("-C").arg(checkout).args(args).output() {
        Ok(out) if out.status.success() => Some(String::from_utf8_lossy(&out.stdout).into_owned()),
        Ok(out) => {
            println!("cargo:warning=git {} failed: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
            None
        }
        Err(error) => {
            println!("cargo:warning=couldn't run git for the build stamp: {error}");
            None
        }
    }
}

/// HODEUM_BUILD: which commit (and whether it had local changes) and when this build was made.
fn build_stamp(checkout: &Path) -> String {
    let sha = git(checkout, &["rev-parse", "--short", "HEAD"]);
    let dirty = git(checkout, &["status", "--porcelain", "--untracked-files=no"]).is_some_and(|out| !out.trim().is_empty());
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or_default();
    build_stamp::stamp(sha.as_deref(), dirty, now)
}

/// Bakes in where `models/` and `runtime/` are, so a build from a git worktree still finds the
/// models installed in the main checkout. Fixed at build time: nothing at runtime can redirect it.
fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let checkout = Path::new(&manifest).join("..");
    let root = ai_root::resolve(&checkout);
    println!("cargo:rustc-env=HODEUM_LOCAL_AI_ROOT={}", root.display());
    println!("cargo:rustc-env=HODEUM_BUILD={}", build_stamp(&checkout));
    println!("cargo:rerun-if-changed=../models");
    println!("cargo:rerun-if-changed=../.git");
    // A worktree's .git is a file; a missing path would rerun this (and restamp) on every build.
    if checkout.join(".git/HEAD").is_file() {
        println!("cargo:rerun-if-changed=../.git/HEAD");
    }
    tauri_build::build()
}
