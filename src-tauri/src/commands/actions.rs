//! GitHub Actions: cached workflows/runs, refresh, and starting a `workflow_dispatch` run.

use serde_json::{Map, Value};
use tauri::State;

use crate::db::actions::{self, Actions};
use crate::db::repos;
use crate::error::Result;
use crate::sync::jobs::actions as job;
use crate::AppState;

#[tauri::command]
pub async fn actions_get(state: State<'_, AppState>, repo_id: i64) -> Result<Actions> {
    actions::get(&state.db.read(), repo_id)
}

#[tauri::command]
pub async fn actions_refresh(state: State<'_, AppState>, repo_id: i64) -> Result<Actions> {
    job::refresh(&state.db, &state.gh, repo_id).await
}

/// One of the app's two GitHub writes (see `github/write.rs`).
#[tauri::command]
pub async fn actions_dispatch(
    state: State<'_, AppState>,
    repo_id: i64,
    workflow_id: i64,
    git_ref: String,
    inputs: Map<String, Value>,
) -> Result<()> {
    let loc = repos::locate(&state.db.read(), repo_id)?;
    // Inputs are always strings on GitHub's side.
    let inputs = inputs
        .into_iter()
        .map(|(k, v)| {
            let s = match v {
                Value::String(s) => s,
                other => other.to_string(),
            };
            (k, Value::String(s))
        })
        .collect();
    state.gw.dispatch_workflow(&loc.owner, &loc.name, workflow_id, &git_ref, inputs).await
}
