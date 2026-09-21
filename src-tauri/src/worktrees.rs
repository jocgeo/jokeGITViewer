use crate::{git, git_ro};
use serde::Serialize;
use std::path::Path;
static SWITCH: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Default, Serialize)]
pub struct Worktree {
    pub path: String,
    pub head: String,
    pub branch: String,
    pub bare: bool,
    pub locked: bool,
    pub missing: bool,
    pub dirty: Option<bool>,
    pub kept_reason: String,
}

pub fn list(path: &str) -> Result<Vec<Worktree>, String> {
    let raw = git_ro(path, &["worktree", "list", "--porcelain", "-z"])?;
    let mut result = Vec::new();
    let mut current = Worktree::default();
    for field in raw.split('\0') {
        if field.is_empty() {
            if !current.path.is_empty() {
                result.push(std::mem::take(&mut current));
            }
        } else if let Some(value) = field.strip_prefix("worktree ") {
            current.path = value.into();
        } else if let Some(value) = field.strip_prefix("HEAD ") {
            current.head = value.into();
        } else if let Some(value) = field.strip_prefix("branch ") {
            current.branch = value.trim_start_matches("refs/heads/").into();
        } else if field == "bare" {
            current.bare = true;
        } else if field == "locked" || field.starts_with("locked ") {
            current.locked = true;
        }
    }
    if !current.path.is_empty() {
        result.push(current);
    }
    let common = git_ro(path, &["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
    let storage = std::fs::canonicalize(Path::new(common.trim()).join("jkt-worktrees")).ok();
    for (index, tree) in result.iter_mut().enumerate() {
        let managed = std::fs::canonicalize(&tree.path).ok().is_some_and(|p| storage.as_ref().is_some_and(|s| p.parent() == Some(s.as_path())));
        tree.kept_reason = if tree.locked { "locked" } else if index == 0 { "main checkout" }
            else if !managed { "manual worktree" } else if tree.branch.is_empty() { "detached" } else { "" }.into();
        tree.missing = !Path::new(&tree.path).is_dir();
        if !tree.bare && !tree.missing {
            tree.dirty = git_ro(
                &tree.path,
                &[
                    "status",
                    "--porcelain",
                    "--untracked-files=normal",
                    "--ignore-submodules=none",
                ],
            )
            .ok()
            .map(|status| !status.trim().is_empty());
            if tree.dirty == Some(false) && tree.kept_reason.is_empty() {
                match git_ro(&tree.path, &["status", "--porcelain", "--ignored", "--untracked-files=all", "--ignore-submodules=none"]) {
                    Ok(status) if !status.trim().is_empty() => tree.kept_reason = "local files retained".into(),
                    Err(_) => tree.kept_reason = "cleanup check unavailable".into(),
                    _ => {},
                }
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn worktree_list(path: String) -> Result<Vec<Worktree>, String> {
    tauri::async_runtime::spawn_blocking(move || list(&path))
        .await
        .map_err(|e| e.to_string())?
}

// Stash first, then let Git remove only a verified, clean linked worktree.
fn stash_and_close(path: &str, target_path: &str) -> Result<Option<String>, String> {
    let _lock = SWITCH.lock().map_err(|_| "Worktree operation interrupted".to_string())?;
    let target = std::fs::canonicalize(target_path).map_err(|e| e.to_string())?;
    let current = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if target == current { return Err("Switch to another worktree before closing this one.".into()); }
    let trees = list(path)?;
    let (index, tree) = trees.iter().enumerate().find(|(_, t)| {
        std::fs::canonicalize(&t.path).ok().as_ref() == Some(&target)
    }).ok_or("This worktree is no longer registered in this repository.")?;
    if index == 0 || tree.bare || tree.locked || tree.missing {
        return Err("Cannot close the main checkout, a locked worktree, or a missing worktree.".into());
    }
    // Git cannot stash submodule contents; do not partially save these trees.
    if git_ro(&tree.path, &["ls-files", "--stage", "-z"])?.split('\0').any(|s| s.starts_with("160000 ")) {
        return Err("Worktrees containing submodules must be closed manually after saving their contents.".into());
    }
    let status_args = ["status", "--porcelain", "--untracked-files=all", "--ignored", "--ignore-submodules=none"];
    let mut saved = None;
    if !git_ro(&tree.path, &status_args)?.trim().is_empty() {
        let before = git_ro(&tree.path, &["rev-parse", "--verify", "refs/stash"]).ok();
        let label = if tree.branch.is_empty() { &tree.head } else { &tree.branch };
        let message = format!("Saved work — {label} (closed worktree: {})", tree.path);
        git(&tree.path, &["stash", "push", "--all", "-m", &message])
            .map_err(|e| format!("Worktree retained: could not stash all changes.\n{e}"))?;
        let after = git_ro(&tree.path, &["rev-parse", "--verify", "refs/stash"])?;
        if before.as_deref() == Some(after.as_str()) {
            return Err("Worktree retained: no new stash was created.".into());
        }
        saved = Some(after.trim().to_string());
    }
    let retained = |e: String| match &saved {
        Some(hash) => format!("Changes saved in stash {hash}, but the worktree was retained.\n{e}"),
        None => format!("Worktree retained.\n{e}"),
    };
    if !git_ro(&tree.path, &status_args).map_err(&retained)?.trim().is_empty() {
        return Err(retained("Local changes remain; removal was cancelled.".into()));
    }
    git(path, &["worktree", "remove", "--", &tree.path]).map_err(retained)?;
    Ok(saved)
}

#[tauri::command]
pub async fn worktree_stash_and_close(path: String, target_path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || stash_and_close(&path, &target_path))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn worktree_cleanup(path: String, active_path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = SWITCH.lock().map_err(|_| "Worktree operation interrupted".to_string())?;
        let canonical = |p: &str| std::fs::canonicalize(p).map_err(|e| e.to_string());
        let old = canonical(&path)?;
        if old == canonical(&active_path)? { return Ok(false); }
        let common = git_ro(&path, &["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
        let storage = match std::fs::canonicalize(Path::new(common.trim()).join("jkt-worktrees")) {
            Ok(p) => p,
            Err(_) => return Ok(false),
        };
        // Only direct children of our managed directory are eligible, never
        // the main checkout or a user-selected worktree directory.
        if old.parent() != Some(storage.as_path()) { return Ok(false); }
        let tree = list(&path)?.into_iter().find(|t| canonical(&t.path).ok().as_ref() == Some(&old));
        let Some(tree) = tree else { return Ok(false) };
        if tree.bare || tree.locked || tree.branch.is_empty() || tree.dirty != Some(false) { return Ok(false); }
        // Ignored local files can also be valuable. Keep them, too.
        if !git_ro(&path, &["status", "--porcelain", "--untracked-files=all", "--ignored", "--ignore-submodules=none"])?.trim().is_empty() {
            return Ok(false);
        }
        git(common.trim(), &["worktree", "remove", "--", &tree.path])?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}
