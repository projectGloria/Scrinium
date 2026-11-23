use tauri::{State, WebviewWindow};

use crate::events::SyncStatus;
use crate::AppState;

/// Called by the frontend after its first paint: shows the window (so nothing half-rendered is
/// ever visible), then starts background sync. Returns ms since process start.
#[tauri::command]
pub async fn app_ready(window: WebviewWindow, state: State<'_, AppState>) -> Result<u64, ()> {
    let _ = window.show();
    let _ = window.set_focus();
    let ms = crate::START.get().map(|s| s.elapsed().as_millis() as u64).unwrap_or(0);
    eprintln!("[startup] first paint after {ms} ms");
    state.sync.kick();
    Ok(ms)
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<(), ()> {
    state.sync.kick();
    Ok(())
}

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> Result<SyncStatus, ()> {
    Ok(state.sync.status(&state.db))
}

/// Opens an http(s) link in the system browser. Nothing else (no file paths, no custom schemes).
#[tauri::command]
pub async fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("only http(s) links can be opened".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}
