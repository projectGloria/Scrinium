//! GitHub Actions cache: workflows on the default branch and recent runs.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::Result;

/// One `workflow_dispatch` input, as declared in the workflow file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchInput {
    pub name: String,
    pub description: Option<String>,
    pub required: bool,
    pub default: Option<String>,
    /// string / choice / boolean / number / environment
    pub kind: String,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub state: String,
    pub dispatchable: bool,
    pub inputs: Vec<DispatchInput>,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: i64,
    pub workflow_id: i64,
    pub name: Option<String>,
    pub title: Option<String>,
    pub run_number: i64,
    pub event: String,
    pub status: Option<String>,
    pub conclusion: Option<String>,
    pub head_branch: Option<String>,
    pub actor: Option<String>,
    pub html_url: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Actions {
    pub workflows: Vec<Workflow>,
    pub runs: Vec<Run>,
    /// None: never fetched for this repo.
    pub checked_at: Option<i64>,
}

pub fn state_key(repo_id: i64) -> String {
    format!("actions:{repo_id}")
}

pub fn get(conn: &Connection, repo_id: i64) -> Result<Actions> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, name, path, state, dispatchable, inputs, html_url FROM workflows
         WHERE repo_id = ?1 ORDER BY dispatchable DESC, name COLLATE NOCASE",
    )?;
    let workflows = stmt
        .query_map([repo_id], |r| {
            let inputs: Option<String> = r.get(5)?;
            Ok(Workflow {
                id: r.get(0)?,
                name: r.get(1)?,
                path: r.get(2)?,
                state: r.get(3)?,
                dispatchable: r.get(4)?,
                inputs: inputs.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default(),
                html_url: r.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut stmt = conn.prepare_cached(
        "SELECT id, workflow_id, name, title, run_number, event, status, conclusion, head_branch,
                actor, html_url, created_at, updated_at
         FROM workflow_runs WHERE repo_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 50",
    )?;
    let runs = stmt
        .query_map([repo_id], |r| {
            Ok(Run {
                id: r.get(0)?,
                workflow_id: r.get(1)?,
                name: r.get(2)?,
                title: r.get(3)?,
                run_number: r.get(4)?,
                event: r.get(5)?,
                status: r.get(6)?,
                conclusion: r.get(7)?,
                head_branch: r.get(8)?,
                actor: r.get(9)?,
                html_url: r.get(10)?,
                created_at: r.get(11)?,
                updated_at: r.get(12)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    let checked_at = super::state::sync_state(conn, &state_key(repo_id))?.last_success_at;
    Ok(Actions { workflows, runs, checked_at })
}

/// Replaces the repo's workflow list.
pub fn set_workflows(conn: &mut Connection, repo_id: i64, rows: &[Workflow]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM workflows WHERE repo_id = ?1", [repo_id])?;
    {
        let mut ins = tx.prepare_cached(
            "INSERT INTO workflows (repo_id, id, name, path, state, dispatchable, inputs, html_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for w in rows {
            let inputs = serde_json::to_string(&w.inputs).unwrap_or_else(|_| "[]".into());
            ins.execute(params![repo_id, w.id, w.name, w.path, w.state, w.dispatchable, inputs, w.html_url])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Replaces the repo's recent runs with the latest page from GitHub.
pub fn set_runs(conn: &mut Connection, repo_id: i64, runs: &[Run]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM workflow_runs WHERE repo_id = ?1", [repo_id])?;
    {
        let mut ins = tx.prepare_cached(
            "INSERT OR REPLACE INTO workflow_runs (id, repo_id, workflow_id, name, title, run_number,
               event, status, conclusion, head_branch, actor, html_url, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        )?;
        for r in runs {
            ins.execute(params![
                r.id, repo_id, r.workflow_id, r.name, r.title, r.run_number, r.event, r.status,
                r.conclusion, r.head_branch, r.actor, r.html_url, r.created_at, r.updated_at
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

