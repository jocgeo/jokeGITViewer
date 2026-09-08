use crate::git;
use serde::Serialize;

#[derive(Serialize)]
pub struct RemoteChoices {
    names: Vec<String>,
    preferred: Option<String>,
}

fn config(path: &str, key: &str) -> Option<String> {
    git(path, &["config", "--get", key]).ok()
        .map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn choices(path: &str) -> Result<RemoteChoices, String> {
    let names: Vec<String> = git(path, &["remote"])?.lines().map(str::to_string).collect();
    let branch = git(path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_default();
    let branch = branch.trim();
    let preferred = config(path, &format!("branch.{branch}.pushRemote"))
        .or_else(|| config(path, "remote.pushDefault"))
        .or_else(|| config(path, &format!("branch.{branch}.remote")))
        .filter(|r| r != ".");
    if let Some(ref remote) = preferred {
        if !names.contains(remote) {
            return Err(format!("Configured remote '{remote}' does not exist. Update the branch's remote configuration."));
        }
    }
    let preferred = preferred.or_else(|| (names.len() == 1).then(|| names[0].clone()));
    Ok(RemoteChoices { names, preferred })
}

pub fn select(path: &str, requested: Option<&str>) -> Result<String, String> {
    let options = choices(path)?;
    if let Some(remote) = requested {
        if options.names.iter().any(|r| r == remote) && !remote.starts_with('-') {
            return Ok(remote.to_string());
        }
        return Err("Select an existing remote.".into());
    }
    options.preferred.ok_or_else(|| if options.names.is_empty() {
        "This repository has no remotes. Add a remote first.".into()
    } else { "Choose a remote for this operation.".into() })
}

pub fn push_current(path: &str, requested: Option<&str>, force: bool) -> Result<String, String> {
    let branch = git(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .map_err(|_| "Cannot push: detached HEAD.".to_string())?;
    let branch = branch.trim();
    let remote = select(path, requested)?;
    let upstream_remote = config(path, &format!("branch.{branch}.remote"));
    let merge = config(path, &format!("branch.{branch}.merge"));
    // A triangular workflow pushes to a fork without changing the pull upstream.
    let destination = if upstream_remote.as_deref() == Some(remote.as_str()) {
        merge.clone().unwrap_or_else(|| format!("refs/heads/{branch}"))
    } else { format!("refs/heads/{branch}") };
    if !destination.starts_with("refs/heads/") {
        return Err("The upstream must be a branch.".into());
    }
    let refspec = format!("refs/heads/{branch}:{destination}");
    let mut args = vec!["push", "--porcelain"];
    if force { args.push("--force-with-lease"); }
    if upstream_remote.is_none() && merge.is_none() { args.push("--set-upstream"); }
    args.extend(["--", remote.as_str(), refspec.as_str()]);
    let target = format!("{}/{}", remote, destination.trim_start_matches("refs/heads/"));
    match git(path, &args) {
        Ok(out) => Ok(if out.contains("[up to date]") {
            format!("Nothing to push — {branch} matches {target}")
        } else { format!("{} {branch} to {target}", if force { "Force-pushed" } else { "Pushed" }) }),
        Err(e) if force && (e.contains("stale info") || e.contains("[rejected]")) => Err(format!("STALE:{target}")),
        Err(e) if !force && (e.contains("[rejected]") || e.contains("fetch first")) => Err(format!("BEHIND:{target}")),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn remote_choices(path: String) -> Result<RemoteChoices, String> {
    choices(&path)
}
