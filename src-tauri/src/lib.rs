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
use github::{ReadApi, WriteApi};
use sync::SyncEngine;

/// Process start, for cold-start timing.
pub(crate) static START: OnceLock<Instant> = OnceLock::new();

pub struct AppState {
    pub db: Arc<Db>,
    pub gh: Arc<ReadApi>,
    /// The only GitHub writes (workflow dispatch; M5: create repo).
    pub gw: Arc<WriteApi>,
    pub sync: Arc<SyncEngine>,
    /// Bumped to cancel an in-flight device-flow poll.
    pub device_gen: AtomicU64,
}

pub fn run() {
    START.get_or_init(Instant::now);
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("scrblob", |ctx, req| blob_response(ctx.app_handle(), req.uri().path()))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = Arc::new(Db::open(&dir.join("scrinium.db"))?);
            let (gh, gw) = ReadApi::new();
            let (gh, gw) = (Arc::new(gh), Arc::new(gw));
            let sync = SyncEngine::new();
            sync.clone().spawn(app.handle().clone(), db.clone(), gh.clone());
            app.manage(AppState { db, gh, gw, sync, device_gen: AtomicU64::new(0) });

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
            commands::app::open_external,
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
            commands::content::readme_get,
            commands::content::readme_refresh,
            commands::content::repo_asset,
            commands::actions::actions_get,
            commands::actions::actions_refresh,
            commands::actions::actions_dispatch,
            commands::palette::palette_search,
            commands::files::refs_get,
            commands::files::refs_refresh,
            commands::files::files_tree,
            commands::files::files_dir,
            commands::files::files_lookup,
            commands::files::file_get,
            commands::issues::issues_list,
            commands::issues::issues_refresh,
            commands::issues::issue_get,
            commands::issues::issue_refresh,
            commands::create::repo_templates,
            commands::create::repo_create,
            commands::local::pick_clone_folder,
            commands::local::repo_clone,
            commands::local::open_in_vscode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scrinium");
}

/// Serves cached blobs (repo icons, README images) to the webview at `scrblob://localhost/<sha>`
/// (`http://scrblob.localhost/<sha>` on Windows). Reads SQLite only.
fn blob_response(app: &tauri::AppHandle, path: &str) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};
    let sha = path.trim_start_matches('/');
    let not_found = || Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
    if sha.is_empty() || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return not_found();
    }
    let Some(state) = app.try_state::<AppState>() else { return not_found() };
    let blob = db::content::get_blob(&state.db.read(), sha).ok().flatten();
    match blob.and_then(|b| b.content.map(|c| (b.mime, c))) {
        Some((mime, body)) => Response::builder()
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .header("X-Content-Type-Options", "nosniff")
            .header(header::CONTENT_SECURITY_POLICY, "default-src 'none'; style-src 'unsafe-inline'")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(body)
            .unwrap_or_else(|_| not_found()),
        None => not_found(),
    }
}
