mod auth;
mod commands;
mod db;
mod error;
mod events;
mod github;
mod sync;

use std::sync::atomic::AtomicU64;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use tauri::Manager;

use db::Db;
use github::ReadApi;
use sync::SyncEngine;

/// Process start, for cold-start timing.
pub(crate) static START: OnceLock<Instant> = OnceLock::new();

pub struct AppState {
    pub db: Arc<Db>,
    pub gh: Arc<ReadApi>,
    pub sync: Arc<SyncEngine>,
    /// Bumped to cancel an in-flight device-flow poll.
    pub device_gen: AtomicU64,
}

pub fn run() {
    START.get_or_init(Instant::now);
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = Arc::new(Db::open(&dir.join("scrinium.db"))?);
            let gh = Arc::new(ReadApi::new());
            let sync = SyncEngine::new();
            sync.clone().spawn(app.handle().clone(), db.clone(), gh.clone());
            app.manage(AppState { db, gh, sync, device_gen: AtomicU64::new(0) });

            // Safety net: show the window even if the frontend never reports its first paint.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(3)).await;
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_ready,
            commands::app::sync_now,
            commands::app::sync_status,
            commands::auth::auth_status,
            commands::auth::auth_device_start,
            commands::auth::auth_device_poll,
            commands::auth::auth_device_cancel,
            commands::auth::auth_with_pat,
            commands::auth::auth_sign_out,
            commands::repos::repos_list,
            commands::repos::repo_languages,
            commands::repos::repo_touch,
            commands::repos::repo_set_pinned,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scrinium");
}
