//! Files tab: branches/tags, tree listing and file content. Reads come from SQLite; anything
//! missing is fetched once (trees and blobs are immutable, keyed by SHA).

use tauri::State;

use crate::db::files::{self, Entry, RefList, TreeInfo};
use crate::error::Result;
use crate::sync::jobs::files::{self as job, FileContent};
use crate::AppState;

/// Cached branches/tags (SQLite only).
#[tauri::command]
pub async fn refs_get(state: State<'_, AppState>, repo_id: i64) -> Result<RefList> {
    files::refs(&state.db.read(), repo_id)
}

#[tauri::command]
pub async fn refs_refresh(state: State<'_, AppState>, repo_id: i64, force: Option<bool>) -> Result<RefList> {
    job::refresh_refs(&state.db, &state.gh, repo_id, force.unwrap_or(false)).await
}

/// Makes sure the tree is cached (one request the first time, none after).
#[tauri::command]
pub async fn files_tree(state: State<'_, AppState>, repo_id: i64, tree_sha: String) -> Result<TreeInfo> {
    job::ensure_tree(&state.db, &state.gh, repo_id, &tree_sha).await
}

#[tauri::command]
pub async fn files_dir(state: State<'_, AppState>, tree_sha: String, dir: String) -> Result<Vec<Entry>> {
    files::list_dir(&state.db.read(), &tree_sha, dir.trim_matches('/'))
}

#[tauri::command]
pub async fn files_lookup(state: State<'_, AppState>, tree_sha: String, path: String) -> Result<Option<Entry>> {
    files::lookup(&state.db.read(), &tree_sha, &path)
}

#[tauri::command]
pub async fn file_get(
    state: State<'_, AppState>,
    repo_id: i64,
    sha: String,
    path: String,
    size: Option<i64>,
) -> Result<FileContent> {
    job::file(&state.db, &state.gh, repo_id, &sha, &path, size).await
}
