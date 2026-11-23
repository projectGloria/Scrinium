//! The only module that talks to GitHub's API.
//!
//! `ReadApi` is read-only. The only calls that change anything on GitHub live in `write.rs`
//! (`WriteApi`): dispatching a workflow run and, from M5, creating a repository. `guard_test.rs`
//! fails the tests if a mutating HTTP call or a GraphQL mutation appears anywhere else.

mod graphql;
mod http;
pub mod model;
mod rate_limit;
mod write;

#[cfg(test)]
mod guard_test;

use std::sync::Arc;

use base64::Engine;
use serde::de::DeserializeOwned;
use serde_json::json;

use crate::error::{Error, Result};
use http::{Conditional, Http};
use model::{
    ContentFile, GitBlob, RepoDirsData, ReposPage, RunList, TreeObj, User, ViewerReposData,
    WorkflowFilesData, WorkflowList,
};

pub use write::WriteApi;

/// A conditional GET result, decoded.
pub enum Cached<T> {
    NotModified,
    Fresh { etag: Option<String>, value: T },
}

/// Read-only GitHub API.
pub struct ReadApi {
    http: Arc<Http>,
}

impl ReadApi {
    /// The read API and the write API share one client (token, rate-limit state).
    pub fn new() -> (Self, WriteApi) {
        let http = Arc::new(Http::new());
        (Self { http: http.clone() }, WriteApi::new(http))
    }

    pub fn set_token(&self, token: Option<String>) {
        self.http.set_token(token);
    }

    pub fn has_token(&self) -> bool {
        self.http.has_token()
    }

    /// Validates a token and returns the user plus the token's classic OAuth scopes, if any.
    pub async fn user_for_token(&self, token: &str) -> Result<(User, Option<String>)> {
        self.http.get_json_with_token("/user", token).await
    }

    /// One page of repos the viewer owns, collaborates on, or can see through orgs.
    pub async fn repos_page(&self, cursor: Option<&str>, first: u32) -> Result<ReposPage> {
        let vars = json!({ "cursor": cursor, "first": first });
        let data: ViewerReposData = graphql::run(&self.http, &graphql::VIEWER_REPOS, vars).await?;
        Ok(data.viewer.repositories)
    }

    /// Conditional GET of a JSON resource. Pass the stored ETag only if the cached copy exists.
    pub async fn get_cached<T: DeserializeOwned>(&self, path: &str, etag: Option<&str>) -> Result<Cached<T>> {
        match self.http.get_conditional(path, etag).await? {
            Conditional::NotModified => Ok(Cached::NotModified),
            Conditional::Fresh { etag, body } => {
                let value = serde_json::from_slice(&body)
                    .map_err(|e| Error::Other(format!("unexpected response from {path}: {e}")))?;
                Ok(Cached::Fresh { etag, value })
            }
        }
    }

    /// `/repos/{o}/{r}/readme` (default branch).
    pub fn readme_path(owner: &str, name: &str) -> String {
        format!("/repos/{}/{}/readme", seg(owner), seg(name))
    }

    /// `/repos/{o}/{r}/contents/{path}` (default branch).
    pub fn contents_path(owner: &str, name: &str, path: &str) -> String {
        let p: Vec<String> = path.split('/').filter(|s| !s.is_empty()).map(seg).collect();
        format!("/repos/{}/{}/contents/{}", seg(owner), seg(name), p.join("/"))
    }

    /// Raw bytes of a git blob (any size up to GitHub's 100 MB limit). Blobs are immutable,
    /// so callers check the local cache by SHA first and never revalidate.
    pub async fn git_blob(&self, owner: &str, name: &str, sha: &str) -> Result<Vec<u8>> {
        let b: GitBlob =
            self.http.get_json(&format!("/repos/{}/{}/git/blobs/{}", seg(owner), seg(name), seg(sha))).await?;
        decode_content(&b.content, &b.encoding)
    }

    /// Lists the directories where repos usually keep their icon/logo, in one request.
    /// Keys are the aliases in `repo_dirs.graphql` (`root`, `public`, `tauri`, …).
    pub async fn repo_dirs(&self, owner: &str, name: &str) -> Result<Vec<(String, TreeObj)>> {
        let vars = json!({ "owner": owner, "name": name });
        let data: RepoDirsData = graphql::run(&self.http, &graphql::REPO_DIRS, vars).await?;
        Ok(data
            .repository
            .map(|m| m.into_iter().filter_map(|(k, v)| v.map(|t| (k, t))).collect())
            .unwrap_or_default())
    }

    /// `.github/workflows/*` on the default branch, with file text.
    pub async fn workflow_files(&self, owner: &str, name: &str) -> Result<Option<TreeObj>> {
        let vars = json!({ "owner": owner, "name": name });
        let data: WorkflowFilesData = graphql::run(&self.http, &graphql::WORKFLOW_FILES, vars).await?;
        Ok(data.repository.and_then(|r| r.object))
    }

    pub fn workflows_path(owner: &str, name: &str) -> String {
        format!("/repos/{}/{}/actions/workflows?per_page=100", seg(owner), seg(name))
    }

    pub fn runs_path(owner: &str, name: &str) -> String {
        format!("/repos/{}/{}/actions/runs?per_page=25", seg(owner), seg(name))
    }

    pub async fn workflows(&self, owner: &str, name: &str, etag: Option<&str>) -> Result<Cached<WorkflowList>> {
        self.get_cached(&Self::workflows_path(owner, name), etag).await
    }

    pub async fn runs(&self, owner: &str, name: &str, etag: Option<&str>) -> Result<Cached<RunList>> {
        self.get_cached(&Self::runs_path(owner, name), etag).await
    }
}

/// Decodes a contents/blob payload. Files over 1 MB come back from `/contents` with
/// encoding "none" and no content; callers fall back to `git_blob`.
pub fn decode_content(content: &str, encoding: &str) -> Result<Vec<u8>> {
    match encoding {
        "base64" => {
            let clean: String = content.chars().filter(|c| !c.is_ascii_whitespace()).collect();
            base64::engine::general_purpose::STANDARD
                .decode(clean)
                .map_err(|e| Error::Other(format!("bad base64 from GitHub: {e}")))
        }
        "utf-8" | "" => Ok(content.as_bytes().to_vec()),
        other => Err(Error::Other(format!("unsupported content encoding `{other}`"))),
    }
}

impl ContentFile {
    /// True when GitHub left the body out because the file is over 1 MB.
    pub fn is_omitted(&self) -> bool {
        self.encoding == "none" || (self.content.is_empty() && self.size > 0)
    }
}

/// Percent-encodes one URL path segment.
pub fn seg(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_path_segments() {
        assert_eq!(seg("my repo"), "my%20repo");
        assert_eq!(ReadApi::contents_path("o", "r", "docs/a b.png"), "/repos/o/r/contents/docs/a%20b.png");
    }

    #[test]
    fn decodes_wrapped_base64() {
        assert_eq!(decode_content("aGVs\nbG8=\n", "base64").unwrap(), b"hello");
    }
}
