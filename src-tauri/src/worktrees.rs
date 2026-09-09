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

#[tauri::command]
pub async fn worktree_switch(
    path: String,
    target: String,
    upstream: Option<String>,
    create: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = SWITCH
            .lock()
            .map_err(|_| "Worktree operation interrupted".to_string())?;
        if target.is_empty() || target.starts_with('-') {
            return Err("Invalid branch or commit.".into());
        }
        let branch_ref = format!("refs/heads/{target}");
        let branch_exists =
            git_ro(&path, &["show-ref", "--verify", "--quiet", &branch_ref]).is_ok();
        if create && branch_exists {
            return Err(format!("Branch {target} already exists."));
        }
        let new_branch = create || (upstream.is_some() && !branch_exists);
        if new_branch {
            git_ro(&path, &["check-ref-format", &branch_ref])?;
        }
        if branch_exists && !create {
            let matching: Vec<_> = list(&path)?
                .into_iter()
                .filter(|t| !t.bare && t.branch == target)
                .collect();
            if matching.len() > 1 {
                return Err(
                    "This branch has multiple worktrees. Choose one from the Worktrees sidebar."
                        .into(),
                );
            }
            if let Some(tree) = matching.into_iter().next() {
                if tree.missing {
                    return Err(format!(
                        "Worktree is unavailable: {}. Restore its folder before opening it.",
                        tree.path
                    ));
                }
                return Ok(tree.path);
            }
        }
        let start = if create {
            "HEAD"
        } else if branch_exists {
            &target
        } else {
            upstream.as_deref().unwrap_or(&target)
        };
        let commit = git_ro(
            &path,
            &[
                "rev-parse",
                "--verify",
                "--end-of-options",
                &format!("{start}^{{commit}}"),
            ],
        )?;
        let commit = commit.trim();
        // Detached checkouts also retain their own work when revisited.
        if !branch_exists && !new_branch {
            if let Some(tree) = list(&path)?
                .into_iter()
                .find(|t| !t.bare && !t.missing && t.branch.is_empty() && t.head == commit)
            {
                return Ok(tree.path);
            }
        }
        let common = git_ro(
            &path,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?;
        let storage = Path::new(common.trim()).join("jkt-worktrees");
        std::fs::create_dir_all(&storage).map_err(|e| e.to_string())?;
        let slug: String = target
            .chars()
            .take(35)
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let destination = storage.join(format!("wt-{slug}-{unique}"));
        let directory = destination.to_string_lossy().into_owned();
        let mut args = vec!["worktree", "add"];
        if new_branch {
            args.extend(["-b", target.as_str()]);
            if upstream.is_some() {
                args.push("--track");
            }
        } else if !branch_exists {
            args.push("--detach");
        }
        args.extend(["--", directory.as_str()]);
        // Use the branch name (not full ref) so Git attaches this worktree.
        args.push(if branch_exists {
            target.as_str()
        } else if upstream.is_some() {
            start
        } else {
            commit
        });
        git(&path, &args)?;
        Ok(directory)
    })
    .await
    .map_err(|e| e.to_string())?
}
