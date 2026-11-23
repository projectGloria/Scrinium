//! The only module that talks to GitHub's API.
//!
//! Everything here is read-only. The single write the app is allowed (POST /user/repos) will live
//! in `write.rs` (M5). `guard_test.rs` fails the build's tests if a mutating HTTP call or a
//! GraphQL mutation appears anywhere else.

mod graphql;
mod http;
pub mod model;
mod rate_limit;

#[cfg(test)]
mod guard_test;

use serde_json::json;

use crate::error::Result;
use http::Http;
use model::{ReposPage, User, ViewerReposData};

/// Read-only GitHub API.
pub struct ReadApi {
    http: Http,
}

impl ReadApi {
    pub fn new() -> Self {
        Self { http: Http::new() }
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

    #[allow(dead_code)]
    pub async fn viewer(&self) -> Result<User> {
        self.http.get_json("/user").await
    }

    /// One page of repos the viewer owns, collaborates on, or can see through orgs.
    pub async fn repos_page(&self, cursor: Option<&str>, first: u32) -> Result<ReposPage> {
        let vars = json!({ "cursor": cursor, "first": first });
        let data: ViewerReposData = graphql::run(&self.http, &graphql::VIEWER_REPOS, vars).await?;
        Ok(data.viewer.repositories)
    }
}
