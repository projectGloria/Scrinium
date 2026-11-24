//! Ctrl+K palette search (SQLite only).

use serde::Serialize;
use tauri::State;

use crate::db::now;
use crate::db::search::{self, FileHit, IssueHit};
use crate::error::Result;
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaletteResults {
    pub repos: Vec<i64>,
    pub files: Vec<FileHit>,
    pub issues: Vec<IssueHit>,
}

#[tauri::command]
pub async fn palette_search(
    state: State<'_, AppState>,
    q: String,
    limit: Option<usize>,
    file_limit: Option<usize>,
    issue_limit: Option<usize>,
) -> Result<PaletteResults> {
    let conn = state.db.read();
    Ok(PaletteResults {
        repos: search::repos(&conn, &q, limit.unwrap_or(50).min(200), now())?,
        files: search::files(&conn, &q, file_limit.unwrap_or(20).min(100))?,
        issues: search::issues(&conn, &q, issue_limit.unwrap_or(20).min(100))?,
    })
}
