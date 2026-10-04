//! Where the local AI files (`models/`, `runtime/`) live, resolved when Hodeum is built.
//! Shared by build.rs (which bakes the answer into the binary) and the library's tests.

use std::fs;
use std::path::{Path, PathBuf};

const MODELS_DIR: &str = "models";
const GIT_POINTER_PREFIX: &str = "gitdir:";
/// A linked worktree's `.git` file points at `<main>/.git/worktrees/<name>`.
const WORKTREES_SUFFIX: [&str; 2] = [".git", "worktrees"];

/// The main checkout behind a linked git worktree, read from the worktree's `.git` file.
fn main_checkout(checkout: &Path) -> Option<PathBuf> {
    let pointer = fs::read_to_string(checkout.join(".git")).ok()?;
    let gitdir = PathBuf::from(pointer.trim().strip_prefix(GIT_POINTER_PREFIX)?.trim());
    let worktrees = gitdir.parent()?;
    let dot_git = worktrees.parent()?;
    let named = |p: &Path, name: &str| p.file_name().is_some_and(|n| n == name);
    if !named(worktrees, WORKTREES_SUFFIX[1]) || !named(dot_git, WORKTREES_SUFFIX[0]) {
        return None;
    }
    dot_git.parent().map(Path::to_path_buf)
}

/// This checkout when it has `models/`; otherwise, for a worktree, the main checkout's, which is
/// where scripts/setup-local-ai.ps1 put them. Falls back to this checkout so errors name it.
pub fn resolve(checkout: &Path) -> PathBuf {
    if checkout.join(MODELS_DIR).is_dir() {
        return checkout.to_path_buf();
    }
    match main_checkout(checkout) {
        Some(main) if main.join(MODELS_DIR).is_dir() => main,
        _ => checkout.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("hodeum-ai-root-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temp dir");
        root
    }

    fn worktree_of(main: &Path, name: &str) -> PathBuf {
        let tree = main.join(".claude").join("worktrees").join(name);
        fs::create_dir_all(&tree).expect("worktree dir");
        let gitdir = main.join(".git").join("worktrees").join(name);
        fs::write(tree.join(".git"), format!("gitdir: {}\n", gitdir.display())).expect("pointer");
        tree
    }

    #[test]
    fn uses_its_own_models_when_present() {
        let main = temp("own");
        fs::create_dir_all(main.join("models")).unwrap();
        assert_eq!(resolve(&main), main);
    }

    #[test]
    fn a_worktree_without_models_uses_the_main_checkouts() {
        let main = temp("shared");
        fs::create_dir_all(main.join("models")).unwrap();
        let tree = worktree_of(&main, "ws-x");
        assert_eq!(resolve(&tree), main);
    }

    #[test]
    fn stays_put_when_nobody_has_models_or_the_pointer_is_odd() {
        let main = temp("none");
        let tree = worktree_of(&main, "ws-y");
        assert_eq!(resolve(&tree), tree);
        fs::write(tree.join(".git"), "gitdir: C:/elsewhere/not-a-worktree\n").unwrap();
        fs::create_dir_all(main.join("models")).unwrap();
        assert_eq!(resolve(&tree), tree);
    }
}
