use crate::git;
use serde::Serialize;

#[derive(Serialize)]
pub struct Remote {
    name: String,
    urls: Vec<String>,
    push_urls: Vec<String>,
}

#[derive(Serialize)]
pub struct RemoteSettings {
    remotes: Vec<Remote>,
    branch: String,
    upstream: String,
    upstream_config: String,
    push_remote: String,
    push_default: String,
    branches: Vec<String>,
}

fn values(path: &str, key: &str) -> Vec<String> {
    git(path, &["config", "--get-all", key])
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

fn value(path: &str, key: &str) -> String {
    values(path, key).last().cloned().unwrap_or_default()
}

fn names(path: &str) -> Result<Vec<String>, String> {
    Ok(git(path, &["remote"])?
        .lines()
        .map(str::to_string)
        .collect())
}

fn existing(path: &str, name: &str) -> Result<(), String> {
    if name.starts_with('-') || !names(path)?.iter().any(|n| n == name) {
        return Err("The selected remote no longer exists. Refresh and try again.".into());
    }
    Ok(())
}

fn valid_name(path: &str, name: &str) -> Result<(), String> {
    if name.is_empty() || name.trim() != name || name.starts_with('-') {
        return Err("Enter a valid remote name.".into());
    }
    git(
        path,
        &["check-ref-format", &format!("refs/remotes/{name}/branch")],
    )?;
    if names(path)?.iter().any(|n| n == name) {
        return Err(format!("Remote '{name}' already exists."));
    }
    Ok(())
}

fn valid_url(url: &str) -> Result<(), String> {
    if url.is_empty()
        || url.trim() != url
        || url.starts_with('-')
        || url.contains(['\n', '\r', '\0'])
    {
        return Err("Enter a nonempty remote URL or local repository path on one line.".into());
    }
    Ok(())
}

// Keep local push preferences in sync with remote rename/remove. Git itself
// updates the remote-tracking refs and branch pull configuration.
fn update_push_preferences(path: &str, old: &str, new: Option<&str>) -> Result<(), String> {
    let raw = git(
        path,
        &[
            "config",
            "--local",
            "--get-regexp",
            "^(branch\\..*\\.pushremote|remote\\.pushdefault)$",
        ],
    )
    .unwrap_or_default();
    for line in raw.lines() {
        if let Some((key, configured)) = line.split_once(' ') {
            if configured == old {
                match new {
                    Some(name) => {
                        git(path, &["config", "--local", "--replace-all", key, name])?;
                    }
                    None => {
                        git(path, &["config", "--local", "--unset-all", key])?;
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_settings(path: String) -> Result<RemoteSettings, String> {
    let mut remotes = Vec::new();
    for name in names(&path)? {
        remotes.push(Remote {
            urls: values(&path, &format!("remote.{name}.url")),
            push_urls: values(&path, &format!("remote.{name}.pushurl")),
            name,
        });
    }
    let branch = git(&path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let upstream = git(&path, &["rev-parse", "--symbolic-full-name", "@{upstream}"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let raw = git(
        &path,
        &[
            "for-each-ref",
            "--format=%(refname)%09%(symref)",
            "refs/remotes",
            "refs/heads",
        ],
    )?;
    let branches = raw
        .lines()
        .filter_map(|line| {
            let (name, symbolic) = line.split_once('\t')?;
            (symbolic.is_empty() && name != format!("refs/heads/{branch}"))
                .then(|| name.to_string())
        })
        .collect();
    Ok(RemoteSettings {
        upstream_config: format!(
            "{} {}",
            value(&path, &format!("branch.{branch}.remote")),
            value(&path, &format!("branch.{branch}.merge"))
        )
        .trim()
        .to_string(),
        push_remote: value(&path, &format!("branch.{branch}.pushRemote")),
        push_default: value(&path, "remote.pushDefault"),
        remotes,
        branch,
        upstream,
        branches,
    })
}

#[tauri::command]
pub async fn remote_manage(
    path: String,
    action: String,
    name: String,
    input: String,
) -> Result<(), String> {
    if action == "add" {
        valid_name(&path, &name)?;
        valid_url(&input)?;
        return git(&path, &["remote", "add", &name, &input]).map(|_| ());
    }
    existing(&path, &name)?;
    match action.as_str() {
        "rename" => {
            valid_name(&path, &input)?;
            git(&path, &["remote", "rename", &name, &input])?;
            update_push_preferences(&path, &name, Some(&input))
        }
        "remove" => {
            git(&path, &["remote", "remove", &name])?;
            update_push_preferences(&path, &name, None)
        }
        "url" | "push-url" => {
            let key = format!(
                "remote.{name}.{}",
                if action == "url" { "url" } else { "pushurl" }
            );
            if values(&path, &key).len() > 1 {
                return Err("This remote has multiple URLs. Edit those with Git to preserve the full configuration.".into());
            }
            if input.is_empty() && action == "push-url" {
                if !values(&path, &key).is_empty() {
                    git(&path, &["config", "--local", "--unset-all", &key])?;
                }
            } else {
                valid_url(&input)?;
                git(&path, &["config", "--local", "--replace-all", &key, &input])?;
            }
            Ok(())
        }
        _ => Err("Unknown remote action.".into()),
    }
}

#[tauri::command]
pub async fn branch_remote_setting(
    path: String,
    branch: String,
    setting: String,
    target: String,
) -> Result<(), String> {
    let current = git(&path, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    if branch.is_empty() || current.trim() != branch {
        return Err("The current branch changed. Refresh before saving branch settings.".into());
    }
    match setting.as_str() {
        "upstream" => {
            if target.is_empty() {
                git(&path, &["branch", "--unset-upstream", &branch])?;
            } else {
                if !(target.starts_with("refs/remotes/") || target.starts_with("refs/heads/"))
                    || target == format!("refs/heads/{branch}")
                {
                    return Err("Select a different local or remote-tracking branch.".into());
                }
                git(&path, &["show-ref", "--verify", &target])?;
                git(
                    &path,
                    &["branch", &format!("--set-upstream-to={target}"), &branch],
                )?;
            }
        }
        "push" => {
            let key = format!("branch.{branch}.pushRemote");
            if target.is_empty() {
                if git(&path, &["config", "--local", "--get-all", &key]).is_ok() {
                    git(&path, &["config", "--local", "--unset-all", &key])?;
                }
            } else {
                existing(&path, &target)?;
                git(
                    &path,
                    &["config", "--local", "--replace-all", &key, &target],
                )?;
            }
        }
        _ => return Err("Unknown branch setting.".into()),
    }
    Ok(())
}
