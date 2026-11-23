//! Repo reads. All of these hit SQLite only; none touch the network.

use tauri::State;

use crate::db::repos::{self, Language, RepoSummary};
use crate::db::now;
use crate::error::Result;
use crate::AppState;

#[tauri::command]
pub async fn repos_list(state: State<'_, AppState>) -> Result<Vec<RepoSummary>> {
    repos::list(&state.db.read())
}

#[tauri::command]
pub async fn repo_languages(state: State<'_, AppState>, id: i64) -> Result<Vec<Language>> {
    repos::languages(&state.db.read(), id)
}

#[tauri::command]
pub async fn repo_touch(state: State<'_, AppState>, id: i64) -> Result<()> {
    repos::touch(&state.db.write(), id, now())
}

#[tauri::command]
pub async fn repo_set_pinned(state: State<'_, AppState>, id: i64, pinned: bool) -> Result<()> {
    repos::set_pinned(&state.db.write(), id, pinned)
}
