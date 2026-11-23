//! README and README images. `readme_get` reads SQLite only; `readme_refresh` and `repo_asset`
//! revalidate against GitHub (ETag, so unchanged files cost nothing).

use tauri::State;

use crate::db::content::{self, Readme};
use crate::error::Result;
use crate::sync::jobs::readme;
use crate::AppState;

#[tauri::command]
pub async fn readme_get(state: State<'_, AppState>, repo_id: i64) -> Result<Option<Readme>> {
    content::readme(&state.db.read(), repo_id)
}

#[tauri::command]
pub async fn readme_refresh(state: State<'_, AppState>, repo_id: i64) -> Result<Option<Readme>> {
    readme::refresh(&state.db, &state.gh, repo_id).await
}

/// A file on the default branch, as a blob SHA the webview loads via the `scrblob` protocol.
#[tauri::command]
pub async fn repo_asset(state: State<'_, AppState>, repo_id: i64, path: String) -> Result<Option<String>> {
    readme::asset(&state.db, &state.gh, repo_id, &path).await
}
