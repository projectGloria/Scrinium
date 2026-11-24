//! Issues and pull requests: cached lists/details (SQLite) and their on-demand revalidation.

use serde::Serialize;
use tauri::State;

use crate::db::issues::{self, IssueDetail, IssueSummary, StateFilter};
use crate::db::state as sync;
use crate::error::Result;
use crate::sync::jobs::issues as job;
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueList {
    pub items: Vec<IssueSummary>,
    /// Cached open / closed counts.
    pub open: i64,
    pub closed: i64,
    /// When the list was last revalidated (None: never).
    pub synced_at: Option<i64>,
}

#[tauri::command]
pub async fn issues_list(
    state: State<'_, AppState>,
    repo_id: i64,
    is_pr: bool,
    filter: StateFilter,
    limit: Option<usize>,
) -> Result<IssueList> {
    let conn = state.db.read();
    let (open, closed) = issues::counts(&conn, repo_id, is_pr)?;
    Ok(IssueList {
        items: issues::list(&conn, repo_id, is_pr, filter, limit.unwrap_or(2000).min(5000))?,
        open,
        closed,
        synced_at: sync::sync_state(&conn, &job::state_key(repo_id, is_pr))?.last_success_at,
    })
}

/// Revalidates a list (throttled unless `force`). Returns true if anything changed.
#[tauri::command]
pub async fn issues_refresh(state: State<'_, AppState>, repo_id: i64, is_pr: bool, force: Option<bool>) -> Result<bool> {
    job::refresh(&state.db, &state.gh, repo_id, is_pr, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn issue_get(state: State<'_, AppState>, repo_id: i64, number: i64) -> Result<Option<IssueDetail>> {
    issues::get(&state.db.read(), repo_id, number)
}

/// Fetches body, comments and checks (throttled unless `force`).
#[tauri::command]
pub async fn issue_refresh(
    state: State<'_, AppState>,
    repo_id: i64,
    number: i64,
    force: Option<bool>,
) -> Result<Option<IssueDetail>> {
    job::refresh_detail(&state.db, &state.gh, repo_id, number, force.unwrap_or(false)).await
}
