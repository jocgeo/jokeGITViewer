use crate::git;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Serialize)]
pub struct Target { remote: String, host: String, project: String, provider: String }
#[derive(Serialize)]
pub struct Request {
    number: u64, title: String, url: String, author: String, source: String, target: String,
    draft: bool, reasons: Vec<String>,
}
#[derive(Serialize)]
pub struct RequestList { user: Option<String>, items: Vec<Request> }
static TOKENS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
fn tokens() -> &'static Mutex<HashMap<String, String>> { TOKENS.get_or_init(|| Mutex::new(HashMap::new())) }

fn parse_target(remote: &str, raw: &str) -> Option<Target> {
    let raw = raw.trim();
    let url = if raw.contains("://") { reqwest::Url::parse(raw).ok()? } else {
        let (host, project) = raw.split_once(':')?;
        if host.contains(['/', '\\']) { return None; }
        reqwest::Url::parse(&format!("ssh://{host}/{project}")).ok()?
    };
    if !matches!(url.scheme(), "https" | "http" | "ssh" | "git") { return None; }
    let hostname = url.host_str()?.to_lowercase();
    // SSH ports are transport-specific and must not become API ports.
    let host = if matches!(url.scheme(), "https" | "http") {
        url.port().map(|p| format!("{hostname}:{p}")).unwrap_or(hostname.clone())
    } else { hostname.clone() };
    let project = url.path().trim_matches('/').trim_end_matches(".git").to_string();
    if project.split('/').count() < 2 || project.contains(['?', '#']) { return None; }
    let provider = if hostname == "github.com" { "github" } else if hostname == "gitlab.com" { "gitlab" } else { "" };
    Some(Target { remote: remote.into(), host, project, provider: provider.into() })
}
fn targets(path: &str) -> Result<Vec<Target>, String> {
    let mut result = Vec::new();
    for remote in git(path, &["remote"])?.lines() {
        let url = git(path, &["remote", "get-url", "--", remote])?;
        if let Some(target) = parse_target(remote, &url) { result.push(target); }
    }
    Ok(result)
}
fn target(path: &str, remote: &str, provider: &str) -> Result<Target, String> {
    if !matches!(provider, "github" | "gitlab") { return Err("Choose GitHub or GitLab for this server.".into()); }
    let mut t = targets(path)?.into_iter().find(|t| t.remote == remote).ok_or("Remote no longer exists or has an unsupported URL.")?;
    if !t.provider.is_empty() && t.provider != provider { return Err("Provider does not match this host.".into()); }
    t.provider = provider.into();
    if provider == "github" && t.project.split('/').count() != 2 { return Err("GitHub requires an owner/repository remote URL.".into()); }
    Ok(t)
}
fn key(t: &Target) -> String { format!("{}:{}", t.provider, t.host) }
fn api(t: &Target) -> String {
    if t.provider == "github" {
        if t.host == "github.com" { "https://api.github.com".into() } else { format!("https://{}/api/v3", t.host) }
    } else { format!("https://{}/api/v4", t.host) }
}
fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent("jokeGITViewer")
        .redirect(reqwest::redirect::Policy::none()).timeout(std::time::Duration::from_secs(30))
        .build().map_err(|e| e.to_string())
}
async fn get(client: &reqwest::Client, t: &Target, token: Option<&str>, endpoint: &str) -> Result<Value, String> {
    read_json(request(client, t, token, &format!("{}{endpoint}", api(t)))).await
}
fn request(client: &reqwest::Client, t: &Target, token: Option<&str>, url: &str) -> reqwest::RequestBuilder {
    authenticated(client.get(url), t, token)
}
fn authenticated(mut req: reqwest::RequestBuilder, t: &Target, token: Option<&str>) -> reqwest::RequestBuilder {
    req = req.header("Accept", "application/json");
    if let Some(token) = token {
        req = if t.provider == "gitlab" { req.header("PRIVATE-TOKEN", token) } else { req.bearer_auth(token) };
    }
    req
}
async fn read_json(req: reqwest::RequestBuilder) -> Result<Value, String> {
    let response = req.send().await.map_err(|_| "Could not reach the hosting server. Check the connection and server address.".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => "Authentication failed. Connect with a valid personal access token.".into(),
            403 | 429 => "Access denied or API rate limit reached. Check token permissions or retry later.".into(),
            404 => "Project not found or not accessible. Check the remote and token permissions.".into(),
            405 => "This request cannot be merged. Check its state, conflicts, approvals and required checks.".into(),
            409 => "The request changed or conflicts with the operation. Refresh before trying again.".into(),
            422 => "The provider rejected this action. Check the request state, review permissions and required message.".into(),
            _ => format!("Hosting API returned HTTP {}.", status.as_u16()),
        });
    }
    response.json().await.map_err(|_| "Hosting server returned an invalid API response.".into())
}
fn string(v: &Value, field: &str) -> String { v[field].as_str().unwrap_or("").into() }
fn username(v: &Value, github: bool) -> String { string(v, if github { "login" } else { "username" }) }
fn normalize(v: &Value, t: &Target, user: Option<&str>) -> Result<Request, String> {
    let gh = t.provider == "github";
    let author = username(&v[if gh { "user" } else { "author" }], gh);
    let number = v[if gh { "number" } else { "iid" }].as_u64().ok_or("Invalid request number")?;
    let mut reasons = Vec::new();
    if let Some(user) = user {
        if author.eq_ignore_ascii_case(user) { reasons.push("Author".into()); }
        for (field, label) in [("assignees", "Assigned"), (if gh { "requested_reviewers" } else { "reviewers" }, "Review requested")] {
            if v[field].as_array().is_some_and(|a| a.iter().any(|p| username(p, gh).eq_ignore_ascii_case(user))) {
                reasons.push(label.into());
            }
        }
    }
    Ok(Request {
        number, title: string(v, "title"), author,
        url: format!("https://{}/{}/{}/{number}", t.host, t.project, if gh { "pull" } else { "-/merge_requests" }),
        source: if gh { string(&v["head"], "ref") } else { string(v, "source_branch") },
        target: if gh { string(&v["base"], "ref") } else { string(v, "target_branch") },
        draft: v["draft"].as_bool().unwrap_or(false) || v["work_in_progress"].as_bool().unwrap_or(false), reasons,
    })
}

#[tauri::command]
pub async fn request_targets(path: String) -> Result<Vec<Target>, String> {
    tauri::async_runtime::spawn_blocking(move || targets(&path)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn request_connect(path: String, remote: String, provider: String, token: String) -> Result<String, String> {
    let t = target(&path, &remote, &provider)?;
    let token = token.trim();
    if token.is_empty() { return Err("Enter a personal access token.".into()); }
    let identity = get(&client()?, &t, Some(token), "/user").await?;
    let user = username(&identity, provider == "github");
    if user.is_empty() { return Err("Unable to identify the signed-in user.".into()); }
    tokens().lock().map_err(|_| "Session unavailable")?.insert(key(&t), token.into());
    Ok(user)
}
#[tauri::command]
pub async fn request_disconnect(path: String, remote: String, provider: String) -> Result<(), String> {
    let t = target(&path, &remote, &provider)?;
    tokens().lock().map_err(|_| "Session unavailable")?.remove(&key(&t));
    Ok(())
}
#[tauri::command]
pub async fn request_list(path: String, remote: String, provider: String) -> Result<RequestList, String> {
    let t = target(&path, &remote, &provider)?;
    let token = tokens().lock().map_err(|_| "Session unavailable")?.get(&key(&t)).cloned();
    let client = client()?;
    let user = if let Some(token) = token.as_deref() {
        let identity = get(&client, &t, Some(token), "/user").await?;
        Some(username(&identity, provider == "github"))
    } else { None };
    let encoded = crate::pct_encode(&t.project);
    let route = if provider == "github" { format!("/repos/{}/pulls?state=open&sort=updated&direction=desc", t.project) }
        else { format!("/projects/{encoded}/merge_requests?state=opened&scope=all&order_by=updated_at&sort=desc") };
    let items = list_pages(&client, &t, token.as_deref(), user.as_deref(), &format!("{}{route}", api(&t))).await?;
    Ok(RequestList { user, items })
}
async fn list_pages(client: &reqwest::Client, t: &Target, token: Option<&str>, user: Option<&str>, url: &str) -> Result<Vec<Request>, String> {
    let mut items = Vec::new();
    for page in 1..=1000 {
        let value = read_json(request(client, t, token, &format!("{url}&per_page=100&page={page}"))).await?;
        let rows = value.as_array().ok_or("Invalid request list response")?;
        for row in rows { items.push(normalize(row, t, user)?); }
        if rows.len() < 100 { return Ok(items); }
    }
    Err("Request list exceeded the pagination limit; results were not shown as a complete list.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remotes() {
        let t = parse_target("origin", "git@gitlab.example.com:group/sub/repo.git").unwrap();
        assert_eq!(t.project, "group/sub/repo"); assert_eq!(t.host, "gitlab.example.com");
        assert_eq!(parse_target("origin", "ssh://git@github.com:22/org/repo.git").unwrap().host, "github.com");
        assert_eq!(parse_target("origin", "https://user:secret@gitlab.com/a/b.git").unwrap().host, "gitlab.com");
        assert!(parse_target("origin", "C:\\repos\\test").is_none());
    }
    #[test]
    fn personal_requests() {
        for provider in ["github", "gitlab"] {
            let t = Target { remote: "origin".into(), host: "example.com".into(), project: "org/repo".into(), provider: provider.into() };
            let v = serde_json::json!({"number": 4, "iid": 4, "title": "Example", "draft": true,
                "user": {"login":"me"}, "author":{"username":"me"},
                "assignees":[{"login":"me","username":"me"}],
                "requested_reviewers":[{"login":"me"}], "reviewers":[{"username":"me"}]});
            assert_eq!(normalize(&v, &t, Some("me")).unwrap().reasons.len(), 3);
            assert!(normalize(&v, &t, Some("other")).unwrap().reasons.is_empty());
            assert!(normalize(&v, &t, None).unwrap().reasons.is_empty());
        }
    }
    #[test]
    fn self_hosted_api_and_paths() {
        let mut t = parse_target("upstream", "https://git.example.com:8443/group/sub/repo.git").unwrap();
        t.provider = "gitlab".into();
        assert_eq!(api(&t), "https://git.example.com:8443/api/v4");
        assert_eq!(crate::pct_encode(&t.project), "group%2Fsub%2Frepo");
        t.provider = "github".into();
        assert_eq!(api(&t), "https://git.example.com:8443/api/v3");
        t.host = "github.com".into();
        assert_eq!(api(&t), "https://api.github.com");
    }
    fn response(status: &str, body: &str) -> Result<Value, String> {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let raw = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = [0; 4096]; stream.read(&mut bytes).unwrap();
            stream.write_all(raw.as_bytes()).unwrap();
        });
        let result = tauri::async_runtime::block_on(read_json(client().unwrap().get(url)));
        server.join().unwrap(); result
    }
    #[test]
    fn api_errors_are_not_empty_lists_or_secret_dumps() {
        assert!(response("401 Unauthorized", "secret response body").unwrap_err().contains("Authentication"));
        assert!(!response("403 Forbidden", "secret response body").unwrap_err().contains("secret"));
        assert!(response("429 Too Many Requests", "{}").unwrap_err().contains("rate limit"));
        assert!(response("200 OK", "not json").is_err());
        assert_eq!(response("200 OK", "[]").unwrap(), serde_json::json!([]));
    }
    #[test]
    fn both_providers_fetch_every_page_and_identify_personal_requests() {
        use std::io::{Read, Write};
        for provider in ["github", "gitlab"] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/requests?state=open", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                for page in 1..=2 {
                    let (mut stream, _) = listener.accept().unwrap();
                    let mut bytes = [0; 4096]; let n = stream.read(&mut bytes).unwrap();
                    let headers = String::from_utf8_lossy(&bytes[..n]).to_lowercase();
                    assert!(headers.contains(&format!("page={page}")));
                    assert!(headers.contains(if provider == "github" { "authorization: bearer test-token" } else { "private-token: test-token" }));
                    let rows: Vec<Value> = (0..if page == 1 { 100 } else { 1 }).map(|i| serde_json::json!({
                        "number": (page - 1) * 100 + i + 1, "iid": (page - 1) * 100 + i + 1,
                        "title": "Request", "user": {"login":"me"}, "author":{"username":"me"}
                    })).collect();
                    let body = serde_json::to_string(&rows).unwrap();
                    write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
                }
            });
            let t = Target { remote: "origin".into(), host: "example.com".into(), project: "org/repo".into(), provider: provider.into() };
            let items = tauri::async_runtime::block_on(list_pages(&client().unwrap(), &t, Some("test-token"), Some("me"), &url)).unwrap();
            server.join().unwrap();
            assert_eq!(items.len(), 101);
            assert_eq!(items[100].number, 101);
            assert_eq!(items[100].reasons, vec!["Author"]);
        }
    }
}
