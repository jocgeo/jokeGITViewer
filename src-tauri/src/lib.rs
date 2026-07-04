// jokeGITViewer — Rust backend.
// Talks to the local `git` CLI (no native libgit2 build needed).

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
pub struct Commit {
    hash: String,
    parents: Vec<String>,
    author: String,
    email: String,
    time: i64, // unix seconds
    summary: String,
}

#[derive(Serialize)]
pub struct RefInfo {
    name: String,    // short name, e.g. "main" or "origin/main" or "v1.0"
    full: String,    // full refname, e.g. "refs/heads/main"
    target: String,  // commit hash it points to
    kind: String,    // "local" | "remote" | "tag"
    is_head: bool,
    time: i64,       // unix time of the pointed-to commit (for sorting)
}

#[derive(Serialize)]
pub struct FileChange {
    status: String, // A, M, D, R, ...
    path: String,
}

#[derive(Serialize)]
pub struct StashEntry {
    selector: String, // e.g. "stash@{0}"
    hash: String,
    parents: Vec<String>, // [base, index, (untracked)]
    time: i64,
    message: String,
}

#[derive(Serialize)]
pub struct WipStatus {
    parent: String, // HEAD hash this WIP sits on top of (empty if unborn)
    staged: u32,
    unstaged: u32,
    untracked: u32,
}

#[derive(Serialize)]
pub struct ConflictState {
    active: bool,        // an operation (merge/rebase/…) is in progress
    kind: String,        // "merge" | "rebase" | "cherry-pick" | "revert" | ""
    files: Vec<String>,  // currently unmerged (conflicted) files
}

#[derive(Serialize)]
pub struct Submodule {
    name: String,
    path: String, // relative path inside the repo
    abs: String,  // absolute path (open as its own repo)
}

#[derive(Serialize)]
pub struct RepoData {
    path: String,
    head: String,        // current commit hash (empty if none)
    head_branch: String, // current branch short name (empty if detached)
    refs: Vec<RefInfo>,
    commits: Vec<Commit>,
    stashes: Vec<StashEntry>,
    wip: Option<WipStatus>,
    conflict: ConflictState,
    describe: String, // `git describe` — nearest tag (repo "version")
    submodules: Vec<Submodule>,
    fingerprint: String, // same value repo_fingerprint returns — saves a round-trip
}

fn load_submodules(path: &str) -> Vec<Submodule> {
    // declared submodules from .gitmodules: "submodule.<name>.path <relpath>"
    let raw = git(path, &["config", "--file", ".gitmodules", "--get-regexp", "path"])
        .unwrap_or_default();
    let mut out = Vec::new();
    for line in raw.lines() {
        let mut it = line.splitn(2, ' ');
        let key = it.next().unwrap_or("");
        let rel = it.next().unwrap_or("").trim().to_string();
        if rel.is_empty() {
            continue;
        }
        let name = key
            .strip_prefix("submodule.")
            .and_then(|k| k.strip_suffix(".path"))
            .unwrap_or(&rel)
            .to_string();
        out.push(Submodule {
            name,
            abs: format!("{path}/{rel}"),
            path: rel,
        });
    }
    out
}

// Unit + record separators used in git --pretty format.
const US: char = '\u{1f}'; // field
const RS: char = '\u{1e}'; // record

// Run `git` in `repo` with args. On Windows, suppress the console window.
fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let out = cmd
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim();
        // some git messages are printed to stdout, not stderr
        let msg = if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err.to_string()
        };
        return Err(format!("git {:?} failed: {msg}", args));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// like git(), but pipes `input` to git's stdin (e.g. `apply --cached -`)
fn git_stdin(repo: &str, args: &[&str], input: &str) -> Result<String, String> {
    use std::io::Write;
    use std::process::Stdio;
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(args)
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("failed to run git: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())?; // stdin drops here -> pipe closes
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim();
        let msg = if err.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            err.to_string()
        };
        return Err(format!("git {:?} failed: {msg}", args));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// like git(), but with no interactive editor (for --continue style commands)
fn git_no_editor(repo: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(args)
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let out = cmd
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// like git(), but returns raw stdout bytes (for binary blobs)
fn git_bytes(repo: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| format!("failed to run git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(out.stdout)
}

fn mime_for(file: &str) -> &'static str {
    let f = file.to_ascii_lowercase();
    if f.ends_with(".png") {
        "image/png"
    } else if f.ends_with(".jpg") || f.ends_with(".jpeg") {
        "image/jpeg"
    } else if f.ends_with(".gif") {
        "image/gif"
    } else if f.ends_with(".webp") {
        "image/webp"
    } else if f.ends_with(".bmp") {
        "image/bmp"
    } else if f.ends_with(".ico") {
        "image/x-icon"
    } else if f.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}

fn base64(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

// Return a file's contents as a data: URL for <img>.
// rev = "" -> working-tree file; otherwise a git revspec (e.g. "<hash>", "<hash>^", "HEAD").
// Empty string result means the blob doesn't exist at that rev (added/deleted).
#[tauri::command]
async fn blob_data_url(path: String, rev: String, file: String) -> Result<String, String> {
    let bytes = if rev.is_empty() {
        std::fs::read(format!("{path}/{file}")).unwrap_or_default()
    } else {
        git_bytes(&path, &["show", &format!("{rev}:{file}")]).unwrap_or_default()
    };
    if bytes.is_empty() {
        return Ok(String::new());
    }
    Ok(format!("data:{};base64,{}", mime_for(&file), base64(&bytes)))
}

fn is_repo(path: &str) -> bool {
    git(path, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

fn load_conflict(path: &str) -> ConflictState {
    let gitdir = git(path, &["rev-parse", "--git-dir"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| ".git".to_string());
    let base = if Path::new(&gitdir).is_absolute() {
        gitdir
    } else {
        format!("{path}/{gitdir}")
    };
    let has = |p: &str| Path::new(&format!("{base}/{p}")).exists();

    let kind = if has("MERGE_HEAD") {
        "merge"
    } else if has("rebase-merge") || has("rebase-apply") {
        "rebase"
    } else if has("CHERRY_PICK_HEAD") {
        "cherry-pick"
    } else if has("REVERT_HEAD") {
        "revert"
    } else {
        ""
    };

    let files: Vec<String> = git(path, &["diff", "--name-only", "--diff-filter=U"])
        .map(|s| s.lines().map(|l| l.to_string()).collect())
        .unwrap_or_default();

    ConflictState {
        active: !kind.is_empty() || !files.is_empty(),
        kind: kind.to_string(),
        files,
    }
}

fn load_refs(repo: &str) -> Result<Vec<RefInfo>, String> {
    // committerdate works for branches + lightweight tags; taggerdate covers
    // annotated tags. We pick whichever is present.
    let fmt = format!(
        "%(refname){US}%(objectname){US}%(HEAD){US}%(committerdate:unix){US}%(taggerdate:unix)"
    );
    let raw = git(
        repo,
        &[
            "for-each-ref",
            "--format",
            &fmt,
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;

    let mut refs = Vec::new();
    for line in raw.lines() {
        let parts: Vec<&str> = line.split(US).collect();
        if parts.len() < 5 {
            continue;
        }
        let full = parts[0].to_string();
        let target = parts[1].to_string();
        let is_head = parts[2] == "*";
        let time = parts[3]
            .trim()
            .parse::<i64>()
            .or_else(|_| parts[4].trim().parse::<i64>())
            .unwrap_or(0);

        let (kind, name) = if let Some(n) = full.strip_prefix("refs/heads/") {
            ("local", n.to_string())
        } else if let Some(n) = full.strip_prefix("refs/remotes/") {
            ("remote", n.to_string())
        } else if let Some(n) = full.strip_prefix("refs/tags/") {
            ("tag", n.to_string())
        } else {
            ("other", full.clone())
        };

        // Skip the symbolic origin/HEAD pointer.
        if kind == "remote" && name.ends_with("/HEAD") {
            continue;
        }

        refs.push(RefInfo {
            name,
            full,
            target,
            kind: kind.to_string(),
            is_head,
            time,
        });
    }
    Ok(refs)
}

fn load_commits(repo: &str, limit: u32) -> Result<Vec<Commit>, String> {
    // hash US parents US author US email US time US summary RS
    // %ct = committer date (updated by cherry-pick/rebase) so graph order matches
    // when the commit actually landed, not the original author date (%at).
    let fmt = format!("%H{US}%P{US}%an{US}%ae{US}%ct{US}%s{RS}");
    // NOTE: deliberately NOT `--all`. `--all` includes refs/stash, which pulls
    // each stash's hidden internal commits (the "index on ..." / "untracked
    // files on ..." / "WIP on ..." entries) into the graph as junk rows.
    // Stashes are shown separately as their own nodes.
    let raw = git(
        repo,
        &[
            "log",
            "--branches",
            "--tags",
            "--remotes",
            "HEAD",
            "--date-order",
            &format!("--max-count={limit}"),
            &format!("--pretty=format:{fmt}"),
        ],
    )?;

    let mut commits = Vec::new();
    for rec in raw.split(RS) {
        let rec = rec.trim_start_matches('\n');
        if rec.trim().is_empty() {
            continue;
        }
        let f: Vec<&str> = rec.split(US).collect();
        if f.len() < 6 {
            continue;
        }
        let parents = if f[1].trim().is_empty() {
            Vec::new()
        } else {
            f[1].split_whitespace().map(|s| s.to_string()).collect()
        };
        commits.push(Commit {
            hash: f[0].to_string(),
            parents,
            author: f[2].to_string(),
            email: f[3].to_string(),
            time: f[4].trim().parse().unwrap_or(0),
            summary: f[5].to_string(),
        });
    }
    Ok(commits)
}

fn load_stashes(repo: &str) -> Result<Vec<StashEntry>, String> {
    // %P gives the parents directly — no extra `rev-list` process per stash
    let fmt = format!("%gd{US}%H{US}%P{US}%ct{US}%gs");
    let raw = git(repo, &["stash", "list", &format!("--format={fmt}")])?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let f: Vec<&str> = line.split(US).collect();
        if f.len() < 5 {
            continue;
        }
        out.push(StashEntry {
            selector: f[0].to_string(),
            hash: f[1].to_string(),
            parents: f[2].split_whitespace().map(|x| x.to_string()).collect(),
            time: f[3].trim().parse().unwrap_or(0),
            message: f[4].to_string(),
        });
    }
    Ok(out)
}

// build WIP counters from already-fetched `status --porcelain` output
fn wip_from_status(raw: &str, head: &str) -> Option<WipStatus> {
    let (mut staged, mut unstaged, mut untracked) = (0u32, 0u32, 0u32);
    for line in raw.lines() {
        if line.len() < 2 {
            continue;
        }
        if line.starts_with("??") {
            untracked += 1;
            continue;
        }
        let mut ch = line.chars();
        let x = ch.next().unwrap(); // index/staged column
        let y = ch.next().unwrap(); // worktree/unstaged column
        if x != ' ' {
            staged += 1;
        }
        if y != ' ' {
            unstaged += 1;
        }
    }
    if staged + unstaged + untracked == 0 {
        return None;
    }
    Some(WipStatus {
        parent: head.to_string(),
        staged,
        unstaged,
        untracked,
    })
}

// raw inputs for the repo fingerprint (shared by open_repo + repo_fingerprint
// so both produce byte-identical strings and the poll never false-triggers)
fn fingerprint_refs(repo: &str) -> String {
    git(
        repo,
        &[
            "for-each-ref",
            "--format=%(objectname) %(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )
    .unwrap_or_default()
}
fn fingerprint_stash(repo: &str) -> String {
    git(repo, &["rev-parse", "--quiet", "--verify", "refs/stash"]).unwrap_or_default()
}

#[tauri::command]
async fn open_repo(path: String, limit: Option<u32>) -> Result<RepoData, String> {
    if !is_repo(&path) {
        return Err(format!("not a git repository: {path}"));
    }
    let p = path.as_str();
    let lim = limit.unwrap_or(2000);

    // All these git calls are independent read-only queries — run them
    // concurrently so total wall time ≈ the slowest single call (usually
    // `status` or `log`) instead of the sum of ~10 sequential process spawns.
    let (head, head_branch, refs, commits, stashes, status_raw, conflict, describe, submodules, fp_refs, fp_stash) =
        std::thread::scope(|s| {
            let head = s.spawn(move || {
                git(p, &["rev-parse", "HEAD"])
                    .map(|v| v.trim().to_string())
                    .unwrap_or_default()
            });
            let head_branch = s.spawn(move || {
                git(p, &["symbolic-ref", "--short", "HEAD"])
                    .map(|v| v.trim().to_string())
                    .unwrap_or_default()
            });
            let refs = s.spawn(move || load_refs(p));
            let commits = s.spawn(move || load_commits(p, lim));
            let stashes = s.spawn(move || load_stashes(p).unwrap_or_default());
            let status_raw = s.spawn(move || {
                git(p, &["status", "--porcelain", "--untracked-files=all"]).unwrap_or_default()
            });
            let conflict = s.spawn(move || load_conflict(p));
            let describe = s.spawn(move || {
                git(p, &["describe", "--tags", "--always", "--dirty"])
                    .map(|v| v.trim().to_string())
                    .unwrap_or_default()
            });
            let submodules = s.spawn(move || load_submodules(p));
            let fp_refs = s.spawn(move || fingerprint_refs(p));
            let fp_stash = s.spawn(move || fingerprint_stash(p));
            (
                head.join().unwrap(),
                head_branch.join().unwrap(),
                refs.join().unwrap(),
                commits.join().unwrap(),
                stashes.join().unwrap(),
                status_raw.join().unwrap(),
                conflict.join().unwrap(),
                describe.join().unwrap(),
                submodules.join().unwrap(),
                fp_refs.join().unwrap(),
                fp_stash.join().unwrap(),
            )
        });

    let wip = wip_from_status(&status_raw, &head);
    let fingerprint = format!("{}\n{}\n{}\n{}", head, status_raw, fp_refs, fp_stash.trim());

    Ok(RepoData {
        path,
        head,
        head_branch,
        refs: refs?,
        commits: commits?,
        stashes,
        wip,
        conflict,
        describe,
        submodules,
        fingerprint,
    })
}

#[derive(Serialize)]
pub struct ConflictVersions {
    ours: String,   // current branch version (stage 2)
    theirs: String, // incoming version (stage 3)
    merged: String, // working-tree file with conflict markers
}

#[tauri::command]
async fn conflict_versions(path: String, file: String) -> Result<ConflictVersions, String> {
    let ours = git(&path, &["show", &format!(":2:{file}")]).unwrap_or_default();
    let theirs = git(&path, &["show", &format!(":3:{file}")]).unwrap_or_default();
    let merged = std::fs::read_to_string(format!("{path}/{file}")).unwrap_or_default();
    Ok(ConflictVersions { ours, theirs, merged })
}

// take one whole side for a conflicted file, then mark resolved (git add)
#[tauri::command]
async fn resolve_take(path: String, file: String, side: String) -> Result<(), String> {
    let flag = match side.as_str() {
        "ours" => "--ours",
        "theirs" => "--theirs",
        _ => return Err("side must be ours/theirs".to_string()),
    };
    git(&path, &["checkout", flag, "--", &file])?;
    git(&path, &["add", "--", &file]).map(|_| ())
}

// write resolved content to the file, then mark resolved
#[tauri::command]
async fn resolve_write(path: String, file: String, content: String) -> Result<(), String> {
    std::fs::write(format!("{path}/{file}"), content).map_err(|e| e.to_string())?;
    git(&path, &["add", "--", &file]).map(|_| ())
}

#[tauri::command]
async fn merge_abort(path: String, kind: String) -> Result<(), String> {
    let cmd = match kind.as_str() {
        "rebase" => vec!["rebase", "--abort"],
        "cherry-pick" => vec!["cherry-pick", "--abort"],
        "revert" => vec!["revert", "--abort"],
        _ => vec!["merge", "--abort"],
    };
    git(&path, &cmd).map(|_| ())
}

// finish the operation once all conflicts are resolved
#[tauri::command]
async fn merge_continue(path: String, kind: String) -> Result<(), String> {
    let r = match kind.as_str() {
        "rebase" => git_no_editor(&path, &["rebase", "--continue"]),
        "cherry-pick" => git_no_editor(&path, &["cherry-pick", "--continue"]),
        "revert" => git_no_editor(&path, &["revert", "--continue"]),
        _ => git_no_editor(&path, &["commit", "--no-edit"]),
    };
    match r {
        Ok(_) => Ok(()),
        // a rebase --continue can surface the NEXT commit's conflicts; not an error
        Err(e) => {
            if load_conflict(&path).active {
                Ok(())
            } else {
                Err(e)
            }
        }
    }
}

#[tauri::command]
async fn commit_files(path: String, hash: String) -> Result<Vec<FileChange>, String> {
    // --first-parent so merge commits report their changes (a plain `show`
    // prints nothing for merges); also works for root and normal commits.
    let raw = git(
        &path,
        &[
            "show",
            "--name-status",
            "--first-parent",
            "--pretty=format:",
            "-M",
            &hash,
        ],
    )?;
    let mut files = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut it = line.split('\t');
        let status = it.next().unwrap_or("").to_string();
        // rename rows have two paths; take the last (new) one.
        let path_part = it.last().unwrap_or("").to_string();
        if path_part.is_empty() {
            continue;
        }
        files.push(FileChange {
            status,
            path: path_part,
        });
    }
    Ok(files)
}

#[tauri::command]
async fn commit_diff(path: String, hash: String, file: String) -> Result<String, String> {
    // -U100000 => effectively full-file context (whole file shown, not just hunks)
    git(
        &path,
        &[
            "show",
            "--format=",
            "--first-parent",
            "-U100000",
            "-M",
            &hash,
            "--",
            &file,
        ],
    )
}

#[derive(Serialize)]
pub struct WipFiles {
    staged: Vec<FileChange>,
    unstaged: Vec<FileChange>, // includes untracked
}

// Split working-tree changes into staged (index column) and unstaged
// (worktree column + untracked). A file can appear in both (e.g. "MM").
#[tauri::command]
async fn wip_status(path: String) -> Result<WipFiles, String> {
    let raw = git(&path, &["status", "--porcelain", "--untracked-files=all"])?;
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    for line in raw.lines() {
        if line.len() < 3 {
            continue;
        }
        let bytes = line.as_bytes();
        let x = bytes[0] as char; // index / staged
        let y = bytes[1] as char; // worktree / unstaged
        let rest = line[3..].trim();
        let p = rest.rsplit(" -> ").next().unwrap_or(rest).to_string();

        if x == '?' && y == '?' {
            unstaged.push(FileChange {
                status: "?".to_string(),
                path: p,
            });
            continue;
        }
        if x != ' ' {
            staged.push(FileChange {
                status: x.to_string(),
                path: p.clone(),
            });
        }
        if y != ' ' {
            unstaged.push(FileChange {
                status: y.to_string(),
                path: p,
            });
        }
    }
    Ok(WipFiles { staged, unstaged })
}

#[tauri::command]
async fn stage_file(path: String, file: String) -> Result<(), String> {
    git(&path, &["add", "--", &file]).map(|_| ())
}

#[tauri::command]
async fn unstage_file(path: String, file: String) -> Result<(), String> {
    // restore --staged needs HEAD; on an unborn branch (no commits) fall back
    // to removing the entry from the index.
    if git(&path, &["restore", "--staged", "--", &file]).is_ok() {
        return Ok(());
    }
    git(&path, &["rm", "--cached", "--quiet", "--", &file]).map(|_| ())
}

#[tauri::command]
async fn stage_all(path: String) -> Result<(), String> {
    git(&path, &["add", "-A"]).map(|_| ())
}

#[tauri::command]
async fn unstage_all(path: String) -> Result<(), String> {
    if git(&path, &["reset", "-q"]).is_ok() {
        return Ok(());
    }
    // unborn branch fallback: clear the index
    git(&path, &["rm", "--cached", "-r", "--quiet", "."]).map(|_| ())
}

#[tauri::command]
async fn commit(path: String, message: String, amend: bool) -> Result<(), String> {
    if message.trim().is_empty() {
        return Err("empty commit message".to_string());
    }
    let mut args = vec!["commit", "-m", &message];
    if amend {
        args.push("--amend");
    }
    git(&path, &args).map(|_| ())
}

#[tauri::command]
async fn wip_files(path: String) -> Result<Vec<FileChange>, String> {
    let raw = git(&path, &["status", "--porcelain", "--untracked-files=all"])?;
    let mut files = Vec::new();
    for line in raw.lines() {
        if line.len() < 3 {
            continue;
        }
        let code = &line[..2];
        let rest = line[3..].trim();
        // renames look like "old -> new"; keep the new path.
        let p = rest.rsplit(" -> ").next().unwrap_or(rest).to_string();
        let status = if code == "??" {
            "?".to_string()
        } else {
            code.trim().chars().next().unwrap_or('M').to_string()
        };
        files.push(FileChange { status, path: p });
    }
    Ok(files)
}

// synthesize a diff for an untracked file where every line is an addition so
// the UI renders it with line numbers + green highlighting
fn synth_untracked_diff(path: &str, file: &str) -> Result<String, String> {
    let full = format!("{path}/{file}");
    if Path::new(&full).is_dir() {
        return Ok(format!("(untracked directory: {file})"));
    }
    let raw = std::fs::read(&full).map_err(|e| e.to_string())?;
    // binary (incl. images) -> don't try to render as text
    let content = match String::from_utf8(raw) {
        Ok(s) => s,
        Err(e) => {
            return Ok(format!("(binary file — {} bytes)", e.into_bytes().len()));
        }
    };
    let n = content.lines().count().max(1);
    let mut out = format!("--- /dev/null\n+++ b/{file}\n@@ -0,0 +1,{n} @@\n");
    for line in content.lines() {
        out.push('+');
        out.push_str(line);
        out.push('\n');
    }
    Ok(out)
}

#[tauri::command]
async fn wip_diff(path: String, file: String) -> Result<String, String> {
    // All uncommitted changes for this file vs HEAD (staged + unstaged).
    // Untracked files have no HEAD blob, so fall back to showing the file.
    let tracked = git(&path, &["ls-files", "--error-unmatch", "--", &file]).is_ok();
    if tracked {
        // -U100000 => whole file shown with full context
        git(&path, &["diff", "-U100000", "HEAD", "--", &file])
    } else {
        synth_untracked_diff(&path, &file)
    }
}

// One side of the WIP only — the diffs line-level staging operates on.
//   staged=false: index -> worktree (what `git add` would stage)
//   staged=true:  HEAD  -> index   (what `git reset` would unstage)
#[tauri::command]
async fn wip_diff_split(path: String, file: String, staged: bool) -> Result<String, String> {
    if staged {
        return git(&path, &["diff", "--cached", "-U100000", "--", &file]);
    }
    let tracked = git(&path, &["ls-files", "--error-unmatch", "--", &file]).is_ok();
    if tracked {
        git(&path, &["diff", "-U100000", "--", &file])
    } else {
        synth_untracked_diff(&path, &file)
    }
}

// Apply a minimal patch to the index only (working tree untouched) — this is
// how single lines get staged (reverse=false) or unstaged (reverse=true).
// `intent_file` is set for untracked files: `add -N` creates an empty index
// entry first so `apply --cached` has something to patch.
#[tauri::command]
async fn stage_lines_patch(
    path: String,
    patch: String,
    reverse: bool,
    intent_file: Option<String>,
) -> Result<(), String> {
    if let Some(f) = intent_file {
        let _ = git(&path, &["add", "--intent-to-add", "--", &f]);
    }
    let mut args = vec!["apply", "--cached", "--whitespace=nowarn"];
    if reverse {
        args.push("--reverse");
    }
    git_stdin(&path, &args, &patch).map(|_| ())
}

// Checkout a branch / tag / commit. If the working tree is dirty, stash first
// (including untracked) so the checkout can't be blocked.
//
// `upstream` is set when checking out a REMOTE branch (e.g. "origin/foo"):
//   - no local branch yet -> create it tracking the remote (at remote tip)
//   - local branch exists  -> check it out, then fast-forward to the remote tip
//     so it reflects the latest fetched state (ff-only never loses local work).
#[tauri::command]
async fn checkout(path: String, target: String, upstream: Option<String>) -> Result<bool, String> {
    let dirty = !git(&path, &["status", "--porcelain", "--untracked-files=all"])?.trim().is_empty();
    let mut stashed = false;
    if dirty {
        git(&path, &["stash", "--include-untracked"])?;
        stashed = true;
    }

    match upstream {
        Some(up) => {
            let exists = git(
                &path,
                &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{target}")],
            )
            .is_ok();
            if exists {
                git(&path, &["checkout", &target])?;
                // best-effort: bring the local branch up to the remote tip
                let _ = git(&path, &["merge", "--ff-only", &up]);
            } else {
                git(&path, &["checkout", "-b", &target, "--track", &up])?;
            }
        }
        None => {
            git(&path, &["checkout", &target])?;
        }
    }
    Ok(stashed)
}

// Cheap signature of repo state (no full commit-log walk). Changes when HEAD
// moves, refs change, the working tree changes, or stashes change. The UI polls
// this and only reloads the graph when it differs.
#[tauri::command]
async fn repo_fingerprint(path: String) -> Result<String, String> {
    let p = path.as_str();
    // polled every 1.5s — run the four probes concurrently
    let (head, status, refs, stash) = std::thread::scope(|s| {
        let head = s.spawn(move || git(p, &["rev-parse", "HEAD"]).unwrap_or_default());
        let status = s.spawn(move || {
            git(p, &["status", "--porcelain", "--untracked-files=all"]).unwrap_or_default()
        });
        let refs = s.spawn(move || fingerprint_refs(p));
        let stash = s.spawn(move || fingerprint_stash(p));
        (
            head.join().unwrap(),
            status.join().unwrap(),
            refs.join().unwrap(),
            stash.join().unwrap(),
        )
    });
    Ok(format!(
        "{}\n{}\n{}\n{}",
        head.trim(),
        status,
        refs,
        stash.trim()
    ))
}

#[tauri::command]
async fn fetch(path: String) -> Result<String, String> {
    // --prune drops remote-tracking refs that were deleted upstream.
    git(&path, &["fetch", "--all", "--prune"])?;
    Ok("fetched".to_string())
}

// push the CURRENT branch to origin (sets upstream). Fails on detached HEAD.
#[tauri::command]
async fn push(path: String) -> Result<String, String> {
    let branch = git(&path, &["symbolic-ref", "--short", "HEAD"])
        .map_err(|_| "cannot push: detached HEAD".to_string())?;
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("cannot push: detached HEAD".to_string());
    }
    git(&path, &["push", "-u", "origin", branch])?;
    Ok(format!("Pushed {branch} to origin"))
}

#[tauri::command]
async fn pull(path: String) -> Result<bool, String> {
    let s = stash_if_dirty(&path)?;
    run_or_conflict(&path, &["pull"], s)
}

#[tauri::command]
async fn stash_push(path: String) -> Result<(), String> {
    if git(&path, &["status", "--porcelain", "--untracked-files=all"])?.trim().is_empty() {
        return Err("nothing to stash".to_string());
    }
    git(&path, &["stash", "--include-untracked"]).map(|_| ())
}

#[tauri::command]
async fn stash_pop(path: String) -> Result<(), String> {
    git(&path, &["stash", "pop"]).map(|_| ())
}

#[tauri::command]
async fn stash_apply(path: String, selector: String) -> Result<(), String> {
    git(&path, &["stash", "apply", &selector]).map(|_| ())
}

#[tauri::command]
async fn stash_pop_at(path: String, selector: String) -> Result<(), String> {
    git(&path, &["stash", "pop", &selector]).map(|_| ())
}

#[tauri::command]
async fn stash_drop(path: String, selector: String) -> Result<(), String> {
    git(&path, &["stash", "drop", &selector]).map(|_| ())
}

#[tauri::command]
async fn create_branch_checkout(path: String, name: String) -> Result<(), String> {
    git(&path, &["checkout", "-b", &name]).map(|_| ())
}

#[tauri::command]
async fn open_terminal(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        // Open a new cmd window AT the repo directory. Don't pass the path on
        // the command line at all (`start` eats a quoted arg as window title —
        // paths with spaces then silently cd nowhere); instead launch with the
        // repo as working directory — the new console inherits it.
        let win_path = path.replace('/', "\\");
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "start", "", "cmd"]).current_dir(&win_path);
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW for the launcher
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    Ok(())
}

#[tauri::command]
async fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        // explorer.exe returns non-zero even on success, so don't check status
        let _ = Command::new("explorer").arg(&path).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg(&path).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = Command::new("xdg-open").arg(&path).spawn();
    }
    Ok(())
}

#[tauri::command]
async fn open_in_vscode(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("cmd");
        cmd.args(["/C", "code", &path]);
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        Command::new("code").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// stash the working tree if dirty (used before ops that need a clean tree)
fn stash_if_dirty(path: &str) -> Result<bool, String> {
    let dirty = !git(path, &["status", "--porcelain", "--untracked-files=all"])?.trim().is_empty();
    if dirty {
        git(path, &["stash", "--include-untracked"])?;
    }
    Ok(dirty)
}

// run an op; a resulting conflict is NOT an error — the UI handles it.
fn run_or_conflict(path: &str, args: &[&str], stashed: bool) -> Result<bool, String> {
    match git(path, args) {
        Ok(_) => Ok(stashed),
        Err(e) => {
            if load_conflict(path).active {
                Ok(stashed) // conflicts -> reload into the resolver
            } else {
                Err(e)
            }
        }
    }
}

#[tauri::command]
async fn merge_ref(path: String, reference: String) -> Result<bool, String> {
    let s = stash_if_dirty(&path)?;
    run_or_conflict(&path, &["merge", "--no-edit", &reference], s)
}

#[tauri::command]
async fn rebase_onto(path: String, reference: String) -> Result<bool, String> {
    let s = stash_if_dirty(&path)?;
    run_or_conflict(&path, &["rebase", &reference], s)
}

// drag-and-drop: merge `source` branch into `target` (checks out target first)
#[tauri::command]
async fn merge_into(path: String, source: String, target: String) -> Result<bool, String> {
    let s = stash_if_dirty(&path)?;
    git(&path, &["checkout", &target])?;
    run_or_conflict(&path, &["merge", "--no-edit", &source], s)
}

// drag-and-drop: rebase `source` branch onto `target` (checks out source first)
#[tauri::command]
async fn rebase_branch_onto(path: String, source: String, target: String) -> Result<bool, String> {
    let s = stash_if_dirty(&path)?;
    git(&path, &["checkout", &source])?;
    run_or_conflict(&path, &["rebase", &target], s)
}

#[tauri::command]
async fn cherry_pick(path: String, hash: String) -> Result<bool, String> {
    let s = stash_if_dirty(&path)?;
    run_or_conflict(&path, &["cherry-pick", &hash], s)
}

#[tauri::command]
async fn revert_commit(path: String, hash: String) -> Result<bool, String> {
    let s = stash_if_dirty(&path)?;
    run_or_conflict(&path, &["revert", "--no-edit", &hash], s)
}

#[tauri::command]
async fn reset_to(path: String, hash: String, mode: String) -> Result<(), String> {
    let flag = match mode.as_str() {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => "--mixed",
    };
    git(&path, &["reset", flag, &hash]).map(|_| ())
}

#[tauri::command]
async fn create_branch(path: String, name: String, start: String) -> Result<(), String> {
    git(&path, &["branch", &name, &start]).map(|_| ())
}

#[tauri::command]
async fn create_tag(path: String, name: String, hash: String) -> Result<(), String> {
    git(&path, &["tag", &name, &hash]).map(|_| ())
}

// names of tags that exist on origin (hits the network; may be empty offline)
#[tauri::command]
async fn remote_tags(path: String) -> Result<Vec<String>, String> {
    let raw = git(&path, &["ls-remote", "--tags", "origin"])?;
    let mut set = std::collections::BTreeSet::new();
    for line in raw.lines() {
        if let Some(idx) = line.find("refs/tags/") {
            let name = line[idx + "refs/tags/".len()..].trim_end_matches("^{}");
            if !name.is_empty() {
                set.insert(name.to_string());
            }
        }
    }
    Ok(set.into_iter().collect())
}

#[tauri::command]
async fn push_tag(path: String, name: String) -> Result<String, String> {
    git(&path, &["push", "origin", &name])?;
    Ok(format!("Pushed tag {name}"))
}

#[tauri::command]
async fn delete_tag(path: String, name: String) -> Result<(), String> {
    git(&path, &["tag", "-d", &name]).map(|_| ())
}

#[tauri::command]
async fn delete_remote_tag(path: String, name: String) -> Result<(), String> {
    git(&path, &["push", "origin", "--delete", &format!("refs/tags/{name}")]).map(|_| ())
}

#[tauri::command]
async fn create_tag_annotated(
    path: String,
    name: String,
    message: String,
    hash: String,
) -> Result<(), String> {
    git(&path, &["tag", "-a", &name, "-m", &message, &hash]).map(|_| ())
}

#[tauri::command]
async fn worktree_add(path: String, dir: String, hash: String) -> Result<(), String> {
    git(&path, &["worktree", "add", &dir, &hash]).map(|_| ())
}

// Full multi-file diff of a commit vs the current working directory.
#[tauri::command]
async fn diff_commit_worktree(path: String, hash: String) -> Result<String, String> {
    git(&path, &["diff", "-U100000", &hash])
}

#[derive(Serialize)]
pub struct BlameLine {
    hash: String,
    author: String,
    time: i64,
    summary: String,
    content: String,
}

#[derive(Serialize)]
pub struct HistEntry {
    hash: String,
    author: String,
    time: i64,
    summary: String,
    added: i64,   // lines added to this file in this commit (-1 binary)
    deleted: i64,
}

// commits that touched a single file (follows renames), with +/- line counts
#[tauri::command]
async fn file_history(path: String, file: String) -> Result<Vec<HistEntry>, String> {
    // commit lines start with US; numstat lines are "added\tdeleted\tpath"
    let fmt = format!("{US}%H{US}%an{US}%ct{US}%s");
    let raw = git(
        &path,
        &[
            "log",
            "--follow",
            "--numstat",
            &format!("--pretty=format:{fmt}"),
            "--",
            &file,
        ],
    )?;
    let mut out: Vec<HistEntry> = Vec::new();
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix(US) {
            let f: Vec<&str> = rest.split(US).collect();
            if f.len() < 4 {
                continue;
            }
            out.push(HistEntry {
                hash: f[0].to_string(),
                author: f[1].to_string(),
                time: f[2].trim().parse().unwrap_or(0),
                summary: f[3].to_string(),
                added: 0,
                deleted: 0,
            });
        } else if line.contains('\t') {
            if let Some(e) = out.last_mut() {
                let mut it = line.split('\t');
                e.added = it.next().unwrap_or("").parse().unwrap_or(-1);
                e.deleted = it.next().unwrap_or("").parse().unwrap_or(-1);
            }
        }
    }
    Ok(out)
}

// per-line blame for a file (at a commit, or working tree if hash empty)
#[tauri::command]
async fn blame(path: String, hash: String, file: String) -> Result<Vec<BlameLine>, String> {
    let mut args = vec!["blame", "--porcelain"];
    if !hash.is_empty() {
        args.push(&hash);
    }
    args.push("--");
    args.push(&file);
    let raw = git(&path, &args)?;

    use std::collections::HashMap;
    let mut meta: HashMap<String, (String, i64, String)> = HashMap::new();
    let mut out = Vec::new();
    let mut sha = String::new();
    let (mut a, mut t, mut s) = (String::new(), 0i64, String::new());

    for line in raw.lines() {
        if let Some(content) = line.strip_prefix('\t') {
            meta.entry(sha.clone())
                .or_insert_with(|| (a.clone(), t, s.clone()));
            let m = meta.get(&sha).unwrap();
            out.push(BlameLine {
                hash: sha.clone(),
                author: m.0.clone(),
                time: m.1,
                summary: m.2.clone(),
                content: content.to_string(),
            });
        } else if let Some(r) = line.strip_prefix("author ") {
            a = r.to_string();
        } else if let Some(r) = line.strip_prefix("author-time ") {
            t = r.trim().parse().unwrap_or(0);
        } else if let Some(r) = line.strip_prefix("summary ") {
            s = r.to_string();
        } else {
            let first = line.split(' ').next().unwrap_or("");
            if first.len() >= 20 && first.chars().all(|c| c.is_ascii_hexdigit()) {
                sha = first.to_string();
                if let Some(m) = meta.get(&sha) {
                    a = m.0.clone();
                    t = m.1;
                    s = m.2.clone();
                } else {
                    a.clear();
                    t = 0;
                    s.clear();
                }
            }
        }
    }
    Ok(out)
}

// full contents of a file at a commit (or the working tree if hash empty)
#[tauri::command]
async fn file_at_commit(path: String, hash: String, file: String) -> Result<String, String> {
    if hash.is_empty() {
        std::fs::read_to_string(format!("{path}/{file}")).map_err(|e| e.to_string())
    } else {
        git(&path, &["show", &format!("{hash}:{file}")])
    }
}

// every file in the project at a commit (or the working tree if hash empty)
#[tauri::command]
async fn commit_tree(path: String, hash: String) -> Result<Vec<String>, String> {
    let raw = if hash.is_empty() {
        git(&path, &["ls-files"])?
    } else {
        git(&path, &["ls-tree", "-r", "--name-only", &hash])?
    };
    Ok(raw.lines().filter(|l| !l.is_empty()).map(|l| l.to_string()).collect())
}

#[derive(Serialize)]
pub struct NumStat {
    path: String,
    added: i64,   // -1 for binary
    deleted: i64, // -1 for binary
}

// added/deleted line counts per changed file for a commit (or WIP if hash empty)
#[tauri::command]
async fn commit_numstat(path: String, hash: String) -> Result<Vec<NumStat>, String> {
    let raw = if hash.is_empty() {
        git(&path, &["diff", "--numstat", "HEAD"])?
    } else {
        git(&path, &["show", "--numstat", "--format=", "--first-parent", "-M", &hash])?
    };
    let mut out = Vec::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut it = line.split('\t');
        let a = it.next().unwrap_or("");
        let d = it.next().unwrap_or("");
        let p = it.last().unwrap_or("");
        if p.is_empty() {
            continue;
        }
        out.push(NumStat {
            path: p.rsplit(" => ").next().unwrap_or(p).trim_end_matches('}').to_string(),
            added: a.parse().unwrap_or(-1),
            deleted: d.parse().unwrap_or(-1),
        });
    }
    Ok(out)
}

// files that differ between a commit and the working tree
#[tauri::command]
async fn compare_files(path: String, hash: String) -> Result<Vec<FileChange>, String> {
    let raw = git(&path, &["diff", "--name-status", "-M", &hash])?;
    let mut files = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut it = line.split('\t');
        let status = it.next().unwrap_or("").to_string();
        let p = it.last().unwrap_or("").to_string();
        if !p.is_empty() {
            files.push(FileChange { status, path: p });
        }
    }
    Ok(files)
}

// diff of one file between a commit and the working tree (full context)
#[tauri::command]
async fn diff_against_working(path: String, hash: String, file: String) -> Result<String, String> {
    git(&path, &["diff", "-U100000", &hash, "--", &file])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            open_repo,
            commit_files,
            commit_diff,
            wip_files,
            wip_diff,
            wip_diff_split,
            stage_lines_patch,
            wip_status,
            stage_file,
            unstage_file,
            stage_all,
            unstage_all,
            commit,
            checkout,
            fetch,
            repo_fingerprint,
            merge_ref,
            rebase_onto,
            cherry_pick,
            revert_commit,
            reset_to,
            create_branch,
            create_tag,
            create_tag_annotated,
            worktree_add,
            diff_commit_worktree,
            push,
            pull,
            stash_push,
            stash_pop,
            create_branch_checkout,
            open_terminal,
            stash_apply,
            stash_pop_at,
            stash_drop,
            conflict_versions,
            resolve_take,
            resolve_write,
            merge_abort,
            merge_continue,
            remote_tags,
            push_tag,
            delete_tag,
            delete_remote_tag,
            blob_data_url,
            compare_files,
            diff_against_working,
            merge_into,
            rebase_branch_onto,
            open_in_explorer,
            open_in_vscode,
            commit_tree,
            commit_numstat,
            file_at_commit,
            blame,
            file_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
