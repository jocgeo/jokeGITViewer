use std::path::Path;

// Resolve through Git so linked worktrees use their own index lock.
#[tauri::command]
pub fn remove_index_lock(path: String, expected_lock: String) -> Result<bool, String> {
    let dir = crate::git_ro(&path, &["rev-parse", "--absolute-git-dir"])?;
    remove_verified_lock(Path::new(dir.trim()), Path::new(&expected_lock))
}

fn remove_verified_lock(git_dir: &Path, reported: &Path) -> Result<bool, String> {
    let dir = git_dir.canonicalize().map_err(|e| e.to_string())?;
    if reported.file_name().and_then(|v| v.to_str()) != Some("index.lock")
        || reported.parent().and_then(|p| p.canonicalize().ok()).as_ref() != Some(&dir) {
        return Err("The reported lock does not belong to this repository/worktree. Open the affected repository and retry.".into());
    }
    let lock = dir.join("index.lock");
    match std::fs::symlink_metadata(&lock) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
        Ok(meta) if !meta.file_type().is_file() => return Err("Refusing to remove an index lock that is not a regular file.".into()),
        _ => {}
    }
    std::fs::remove_file(lock).map_err(|e| format!("Could not remove Git index lock: {e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn removes_only_the_reported_repository_index_lock() {
        let root = std::env::temp_dir().join(format!("jkt-lock-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();
        let lock = root.join("index.lock");
        let index = root.join("index");
        std::fs::write(&lock, b"stale").unwrap();
        std::fs::write(&index, b"preserve").unwrap();
        assert!(remove_verified_lock(&root, &index).is_err());
        assert!(remove_verified_lock(&root, &root.join("other/index.lock")).is_err());
        assert!(lock.exists());
        assert!(remove_verified_lock(&root, &lock).unwrap());
        assert!(!remove_verified_lock(&root, &lock).unwrap());
        assert_eq!(std::fs::read(&index).unwrap(), b"preserve");
        std::fs::create_dir(&lock).unwrap();
        assert!(remove_verified_lock(&root, &lock).is_err());
        std::fs::remove_dir(&lock).unwrap();
        std::fs::remove_file(index).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
