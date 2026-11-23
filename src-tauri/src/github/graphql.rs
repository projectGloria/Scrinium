//! GraphQL transport. It goes over HTTP POST, but it can only run the compiled-in, read-only
//! query documents defined below; there is no way to pass an arbitrary document in.

use reqwest::header;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use super::http::Http;
use crate::error::{Error, Result};

const GRAPHQL_URL: &str = "https://api.github.com/graphql";

/// A compiled-in GraphQL query. Only this module can construct one.
pub struct Query {
    pub(super) name: &'static str,
    pub(super) doc: &'static str,
}

impl Query {
    const fn new(name: &'static str, doc: &'static str) -> Self {
        Self { name, doc }
    }
}

pub const VIEWER_REPOS: Query =
    Query::new("viewer_repos", include_str!("queries/viewer_repos.graphql"));

/// Every query the app can run (checked by the write-guard tests).
#[cfg_attr(not(test), allow(dead_code))]
pub const ALL: &[&Query] = &[&VIEWER_REPOS];

/// True if the document declares a mutation or subscription operation anywhere.
pub(super) fn is_write_operation(doc: &str) -> bool {
    doc.lines()
        .map(|l| l.split('#').next().unwrap_or(""))
        .flat_map(|l| l.split(|c: char| !(c.is_alphanumeric() || c == '_')))
        .any(|w| w == "mutation" || w == "subscription")
}

#[derive(Deserialize)]
struct Response<T> {
    data: Option<T>,
    errors: Option<Vec<GqlError>>,
}

#[derive(Deserialize)]
struct GqlError {
    message: String,
    #[serde(rename = "type")]
    kind: Option<String>,
}

pub async fn run<T: DeserializeOwned>(http: &Http, q: &'static Query, vars: Value) -> Result<T> {
    if is_write_operation(q.doc) {
        return Err(Error::Other(format!("refusing to send write operation {}", q.name)));
    }
    http.rate.wait("graphql").await?;
    let resp = http
        .client()
        .post(GRAPHQL_URL)
        .header(header::AUTHORIZATION, http.bearer()?)
        .json(&json!({ "query": q.doc, "variables": vars }))
        .send()
        .await?;
    let body: Response<T> = http.check(resp).await?.json().await?;
    let errors = body.errors.unwrap_or_default();
    if errors.iter().any(|e| e.kind.as_deref() == Some("RATE_LIMITED")) {
        return Err(Error::RateLimited(60));
    }
    match body.data {
        // Partial data (e.g. one org blocks access via SSO) is still usable.
        Some(data) => Ok(data),
        None => Err(Error::Api {
            status: 200,
            message: errors
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; "),
        }),
    }
}
