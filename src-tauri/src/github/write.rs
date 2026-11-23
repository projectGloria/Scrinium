//! The ONLY calls in the app that change anything on GitHub.
//!
//!   1. `dispatch_workflow`: POST /repos/{o}/{r}/actions/workflows/{id}/dispatches
//!   2. (M5) `create_repo`:   POST /user/repos
//!
//! `guard_test.rs` allows POST requests here (besides the read-only GraphQL transport and the OAuth
//! handshake) and checks that this file only targets the endpoints listed above.

use std::sync::Arc;

use reqwest::header;
use serde_json::{json, Map, Value};

use super::http::{Http, API};
use super::seg;
use crate::error::{Error, Result};

pub struct WriteApi {
    http: Arc<Http>,
}

impl WriteApi {
    pub(super) fn new(http: Arc<Http>) -> Self {
        Self { http }
    }

    /// Starts a `workflow_dispatch` run. GitHub answers 204 with no body (and no run id);
    /// the new run shows up in the runs list a few seconds later.
    pub async fn dispatch_workflow(
        &self,
        owner: &str,
        name: &str,
        workflow_id: i64,
        git_ref: &str,
        inputs: Map<String, Value>,
    ) -> Result<()> {
        if git_ref.trim().is_empty() {
            return Err(Error::Other("choose a branch or tag to run the workflow on".into()));
        }
        self.http.rate.wait("core").await?;
        let url = format!(
            "{API}/repos/{}/{}/actions/workflows/{workflow_id}/dispatches",
            seg(owner),
            seg(name)
        );
        let resp = self
            .http
            .client()
            .post(url)
            .header(header::AUTHORIZATION, self.http.bearer()?)
            .json(&json!({ "ref": git_ref.trim(), "inputs": inputs }))
            .send()
            .await?;
        self.http.check(resp).await.map(|_| ()).map_err(|e| match e {
            Error::Api { status: 403 | 404, message } => Error::Other(format!(
                "GitHub refused to start the run ({message}). Your token needs write access to \
                 Actions on this repository."
            )),
            Error::Api { status: 422, message } => Error::Other(format!("GitHub rejected the inputs: {message}")),
            other => other,
        })
    }
}
