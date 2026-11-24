//! The ONLY calls in the app that change anything on GitHub.
//!
//!   1. `dispatch_workflow`: POST /repos/{o}/{r}/actions/workflows/{id}/dispatches
//!   2. `create_repo`:       POST /user/repos
//!
//! `guard_test.rs` allows POST requests here (besides the read-only GraphQL transport and the OAuth
//! handshake) and checks that this file only targets the endpoints listed above.

use std::sync::Arc;

use reqwest::header;
use serde_json::{json, Map, Value};

use super::http::{Http, API};
use super::model::RestRepo;
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

/// Fields of the create-repository dialog.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRepo {
    pub name: String,
    pub description: String,
    pub private: bool,
    /// Create an initial commit with a README.
    pub add_readme: bool,
    pub gitignore_template: Option<String>,
    pub license_template: Option<String>,
}

impl WriteApi {
    /// Creates a repository on the signed-in user's account.
    pub async fn create_repo(&self, repo: &NewRepo) -> Result<RestRepo> {
        let name = repo.name.trim();
        if name.is_empty() {
            return Err(Error::Other("enter a repository name".into()));
        }
        let pick = |s: &Option<String>| s.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
        let gitignore = pick(&repo.gitignore_template);
        let license = pick(&repo.license_template);
        let mut body = json!({
            "name": name,
            "private": repo.private,
            // GitHub needs an initial commit to apply a .gitignore or license template.
            "auto_init": repo.add_readme || gitignore.is_some() || license.is_some(),
        });
        let desc = repo.description.trim();
        if !desc.is_empty() {
            body["description"] = json!(desc);
        }
        if let Some(g) = gitignore {
            body["gitignore_template"] = json!(g);
        }
        if let Some(l) = license {
            body["license_template"] = json!(l);
        }

        self.http.rate.wait("core").await?;
        let url = format!("{API}/user/repos");
        let resp = self
            .http
            .client()
            .post(url)
            .header(header::AUTHORIZATION, self.http.bearer()?)
            .json(&body)
            .send()
            .await?;
        if resp.status().as_u16() == 422 {
            // "Repository creation failed." plus the useful part in errors[].message.
            let v: Value = resp.json().await.unwrap_or(Value::Null);
            let detail = v["errors"][0]["message"].as_str().or(v["message"].as_str()).unwrap_or("invalid name");
            return Err(Error::Other(format!("GitHub rejected the repository: {detail}")));
        }
        let resp = self.http.check(resp).await.map_err(|e| match e {
            Error::Api { status: 403 | 404, message } => Error::Other(format!(
                "GitHub refused to create the repository ({message}). Your token needs the `repo` scope \
                 (or Administration: write for fine-grained tokens)."
            )),
            other => other,
        })?;
        resp.json::<RestRepo>()
            .await
            .map_err(|e| Error::Other(format!("repository created, but the response was unexpected: {e}")))
    }
}
