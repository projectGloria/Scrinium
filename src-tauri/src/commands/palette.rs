//! Ctrl+K palette search (SQLite only).

use tauri::State;

use crate::db::{now, search};
use crate::error::Result;
use crate::AppState;

#[tauri::command]
pub async fn palette_search(state: State<'_, AppState>, q: String, limit: Option<usize>) -> Result<Vec<i64>> {
    search::repos(&state.db.read(), &q, limit.unwrap_or(50).min(200), now())
}
