use serde::Serialize;

#[derive(Serialize)]
pub struct ReflogEntry {
    hash: String,
    selector: String,
    action: String,
    actor: String,
}

#[derive(Serialize)]
pub struct ReflogPage {
    entries: Vec<ReflogEntry>,
    has_more: bool,
}

fn read_reflog(path: &str, offset: u32) -> Result<ReflogPage, String> {
    const PAGE_SIZE: usize = 100;
    let raw = super::git_ro(
        path,
        &[
            "reflog",
            "show",
            "--all",
            "--date=iso-strict",
            "--format=%H%x00%gD%x00%gs%x00%gn%x00",
            &format!("--skip={offset}"),
            &format!("--max-count={}", PAGE_SIZE + 1),
        ],
    )?;
    let mut entries = Vec::new();
    for line in raw.lines().filter(|line| !line.is_empty()) {
        let fields: Vec<&str> = line.split('\0').collect();
        if fields.len() < 5 {
            return Err("Could not parse a reflog entry".to_string());
        }
        entries.push(ReflogEntry {
            hash: fields[0].to_string(),
            selector: fields[1].to_string(),
            action: fields[2].to_string(),
            actor: fields[3].to_string(),
        });
    }
    let has_more = entries.len() > PAGE_SIZE;
    entries.truncate(PAGE_SIZE);
    Ok(ReflogPage { entries, has_more })
}

fn recover(path: &str, name: &str, hash: &str) -> Result<(), String> {
    if name.is_empty() || name.trim() != name || name.starts_with('-') || name == "HEAD" {
        return Err("Enter a valid new branch name".to_string());
    }
    super::git_ro(path, &["check-ref-format", &format!("refs/heads/{name}")])?;
    // Accept only the immutable object IDs returned by the reflog, never options
    // or moving selectors such as HEAD@{1}.
    if !matches!(hash.len(), 40 | 64) || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Select a valid commit from the reflog".to_string());
    }
    let commit = super::git_ro(
        path,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{hash}^{{commit}}"),
        ],
    )?;
    // No -f, checkout, reset, or stash: an existing branch cannot be replaced,
    // and the index and working tree stay exactly as they were.
    super::git(path, &["branch", "--", name, commit.trim()]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Repo(PathBuf);
    impl Repo {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let stamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let repo = Self(
                std::env::temp_dir()
                    .join(format!("jkt-recovery-{}-{stamp}-{id}", std::process::id())),
            );
            std::fs::create_dir(&repo.0).unwrap();
            repo.git(&["init", "-b", "main"]);
            repo.git(&["config", "user.name", "Recovery Test"]);
            repo.git(&["config", "user.email", "recovery@example.invalid"]);
            repo.git(&["config", "commit.gpgsign", "false"]);
            repo.git(&["config", "core.autocrlf", "false"]);
            repo
        }
        fn path(&self) -> &str {
            self.0.to_str().unwrap()
        }
        fn git(&self, args: &[&str]) -> String {
            crate::git(self.path(), args).unwrap()
        }
        fn commit(&self, content: &str, message: &str) -> String {
            std::fs::write(self.0.join("file.txt"), content).unwrap();
            self.git(&["add", "--", "file.txt"]);
            self.git(&["commit", "-m", message]);
            self.git(&["rev-parse", "HEAD"]).trim().to_string()
        }
    }

    #[test]
    fn empty_repository_has_empty_history() {
        let repo = Repo::new();
        let page = read_reflog(repo.path(), 0).unwrap();
        assert!(page.entries.is_empty());
        assert!(!page.has_more);
    }

    #[test]
    fn recovers_reset_commit_without_touching_index_or_worktree() {
        let repo = Repo::new();
        let base = repo.commit("base\n", "initial");
        let lost = repo.commit("lost\n", "lost <commit> & recovery");
        repo.git(&["reset", "--hard", &base]);
        std::fs::write(repo.0.join("file.txt"), "staged\n").unwrap();
        repo.git(&["add", "file.txt"]);
        std::fs::write(repo.0.join("file.txt"), "unstaged\n").unwrap();
        let before = repo.git(&["diff", "--cached"]);
        let page = read_reflog(repo.path(), 0).unwrap();
        assert!(page
            .entries
            .iter()
            .any(|e| e.hash == lost && e.action.contains("lost <commit> & recovery")));
        recover(repo.path(), "recovered/lost", &lost).unwrap();
        assert_eq!(repo.git(&["rev-parse", "recovered/lost"]).trim(), lost);
        assert_eq!(repo.git(&["rev-parse", "HEAD"]).trim(), base);
        assert_eq!(
            repo.git(&["symbolic-ref", "--short", "HEAD"]).trim(),
            "main"
        );
        assert_eq!(repo.git(&["diff", "--cached"]), before);
        assert_eq!(
            std::fs::read_to_string(repo.0.join("file.txt")).unwrap(),
            "unstaged\n"
        );
    }

    #[test]
    fn refuses_existing_branch_invalid_names_and_invalid_objects() {
        let repo = Repo::new();
        let base = repo.commit("base\n", "base");
        let tip = repo.commit("tip\n", "tip");
        assert!(recover(repo.path(), "main", &base).is_err());
        assert_eq!(repo.git(&["rev-parse", "main"]).trim(), tip);
        for name in ["", "-f", "bad..name", "bad name", "HEAD", " leading"] {
            assert!(
                recover(repo.path(), name, &base).is_err(),
                "accepted {name}"
            );
        }
        for hash in [
            "HEAD@{1}",
            "--all",
            "0000000000000000000000000000000000000000",
        ] {
            assert!(recover(repo.path(), "recovered/invalid", hash).is_err());
        }
        let blob = repo.git(&["rev-parse", "HEAD:file.txt"]);
        assert!(recover(repo.path(), "recovered/blob", blob.trim()).is_err());
    }

    #[test]
    fn recovers_deleted_branch_from_head_history() {
        let repo = Repo::new();
        repo.commit("base\n", "base");
        repo.git(&["checkout", "-b", "temporary"]);
        let tip = repo.commit("feature\n", "feature to recover");
        repo.git(&["checkout", "main"]);
        repo.git(&["branch", "-D", "temporary"]);
        assert!(read_reflog(repo.path(), 0)
            .unwrap()
            .entries
            .iter()
            .any(|e| e.hash == tip));
        recover(repo.path(), "restored", &tip).unwrap();
        assert_eq!(repo.git(&["rev-parse", "restored"]).trim(), tip);
    }

    #[test]
    fn paginates_history_without_skipping_boundary_entries() {
        let repo = Repo::new();
        repo.commit("base\n", "base");
        // Each commit adds an entry to HEAD and to the branch's reflog.
        for i in 0..52 {
            repo.git(&["commit", "--allow-empty", "-m", &format!("event {i}")]);
        }
        let first = read_reflog(repo.path(), 0).unwrap();
        assert_eq!(first.entries.len(), 100);
        assert!(first.has_more);
        let second = read_reflog(repo.path(), 100).unwrap();
        assert!(!second.entries.is_empty());
        let shifted = read_reflog(repo.path(), 99).unwrap();
        assert_eq!(shifted.entries[0].hash, first.entries[99].hash);
        assert_eq!(shifted.entries[1].hash, second.entries[0].hash);
        assert_eq!(shifted.entries[1].selector, second.entries[0].selector);
    }
}

#[tauri::command]
pub async fn reflog(path: String, offset: Option<u32>) -> Result<ReflogPage, String> {
    tauri::async_runtime::spawn_blocking(move || read_reflog(&path, offset.unwrap_or(0)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn recover_branch(path: String, name: String, hash: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || recover(&path, &name, &hash))
        .await
        .map_err(|e| e.to_string())?
}
