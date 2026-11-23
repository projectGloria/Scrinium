//! The only reqwest client that talks to api.github.com.
//!
//! Its public surface is GET-only. `graphql.rs` (read-only queries) and `write.rs` (the only
//! calls that change anything on GitHub) reach the raw client through `pub(super)` accessors; nothing
//! outside the `github` module can. `guard_test.rs` enforces this at test time.

use std::sync::RwLock;
use std::time::Duration;

use reqwest::header::{self, HeaderMap, HeaderValue};
use reqwest::{Response, StatusCode};
use serde::de::DeserializeOwned;

use super::rate_limit::RateLimiter;
use crate::error::{Error, Result};

pub const API: &str = "https://api.github.com";
const USER_AGENT: &str = concat!("Scrinium/", env!("CARGO_PKG_VERSION"));

/// Result of a conditional GET.
pub enum Conditional {
    /// 304: the cached copy is still current (costs no rate limit).
    NotModified,
    Fresh { etag: Option<String>, body: Vec<u8> },
}

pub struct Http {
    client: reqwest::Client,
    token: RwLock<Option<String>>,
    pub(super) rate: RateLimiter,
}

impl Http {
    pub fn new() -> Self {
        let mut headers = HeaderMap::new();
        headers.insert(header::ACCEPT, HeaderValue::from_static("application/vnd.github+json"));
        headers.insert("X-GitHub-Api-Version", HeaderValue::from_static("2022-11-28"));
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .default_headers(headers)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .expect("failed to build HTTP client");
        Self { client, token: RwLock::new(None), rate: RateLimiter::default() }
    }

    pub fn set_token(&self, token: Option<String>) {
        *self.token.write().unwrap_or_else(|e| e.into_inner()) = token;
    }

    pub fn has_token(&self) -> bool {
        self.token.read().unwrap_or_else(|e| e.into_inner()).is_some()
    }

    pub(super) fn bearer(&self) -> Result<String> {
        self.token
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|t| format!("Bearer {t}"))
            .ok_or(Error::NoToken)
    }

    pub(super) fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// GET a JSON resource with the stored token.
    pub async fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        self.rate.wait("core").await?;
        let resp = self
            .client
            .get(format!("{API}{path}"))
            .header(header::AUTHORIZATION, self.bearer()?)
            .send()
            .await?;
        Ok(self.check(resp).await?.json().await?)
    }

    /// GET a JSON resource with an explicit token (used to validate a token before storing it).
    /// Returns the body and the `X-OAuth-Scopes` header (absent for fine-grained tokens).
    pub async fn get_json_with_token<T: DeserializeOwned>(
        &self,
        path: &str,
        token: &str,
    ) -> Result<(T, Option<String>)> {
        let resp = self
            .client
            .get(format!("{API}{path}"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .send()
            .await?;
        let resp = self.check(resp).await?;
        let scopes = resp
            .headers()
            .get("x-oauth-scopes")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        Ok((resp.json().await?, scopes))
    }

    /// Conditional GET with `If-None-Match`. A 304 does not count against the rate limit.
    pub async fn get_conditional(&self, path: &str, etag: Option<&str>) -> Result<Conditional> {
        self.rate.wait("core").await?;
        let mut req = self
            .client
            .get(format!("{API}{path}"))
            .header(header::AUTHORIZATION, self.bearer()?);
        if let Some(etag) = etag {
            req = req.header(header::IF_NONE_MATCH, etag);
        }
        let resp = req.send().await?;
        if resp.status() == StatusCode::NOT_MODIFIED {
            self.rate.observe(resp.headers());
            return Ok(Conditional::NotModified);
        }
        let resp = self.check(resp).await?;
        let etag = resp
            .headers()
            .get(header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        Ok(Conditional::Fresh { etag, body: resp.bytes().await?.to_vec() })
    }

    /// Records rate-limit headers and maps error statuses.
    pub(super) async fn check(&self, resp: Response) -> Result<Response> {
        self.rate.observe(resp.headers());
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        if let Some(secs) = RateLimiter::retry_after(status, resp.headers()) {
            return Err(Error::RateLimited(secs));
        }
        if status == StatusCode::UNAUTHORIZED {
            return Err(Error::Unauthorized);
        }
        let message = resp
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_owned))
            .unwrap_or_else(|| status.canonical_reason().unwrap_or("error").to_owned());
        Err(Error::Api { status: status.as_u16(), message })
    }
}
