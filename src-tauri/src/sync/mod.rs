//! Background sync: GitHub -> SQLite. The UI never waits on it; it only hears about changes.

pub mod jobs;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::db::{self, state, Db};
use crate::error::Error;
use crate::events::{SyncStatus, SYNC_STATUS};
use crate::github::ReadApi;

const DEFAULT_INTERVAL_MIN: u64 = 10;
/// After a transient failure, retry after this long instead of the full interval.
const RETRY_SECS: u64 = 60;
const REPOS_KEY: &str = "repos";

pub struct SyncEngine {
    trigger: Notify,
    running: AtomicBool,
    /// The icon scan runs detached from the repo sync; this keeps two from overlapping.
    icons_running: Arc<AtomicBool>,
}

impl SyncEngine {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            trigger: Notify::new(),
            running: AtomicBool::new(false),
            icons_running: Arc::new(AtomicBool::new(false)),
        })
    }

    /// Looks for repo icons in the background (never holds up the sync status).
    fn spawn_icons(&self, app: &AppHandle, db: &Arc<Db>, gh: &Arc<ReadApi>) {
        if self.icons_running.swap(true, Ordering::SeqCst) {
            return;
        }
        let (flag, app, db, gh) = (self.icons_running.clone(), app.clone(), db.clone(), gh.clone());
        tauri::async_runtime::spawn(async move {
            if let Err(e) = jobs::icons::run(&app, &db, &gh).await {
                eprintln!("[icons] stopped: {e}");
            }
            flag.store(false, Ordering::SeqCst);
        });
    }

    /// Ask for a sync now. The first call (from `app_ready`, after first paint) starts the loop.
    pub fn kick(&self) {
        self.trigger.notify_one();
    }

    pub fn status(&self, db: &Db) -> SyncStatus {
        let s = state::sync_state(&db.read(), REPOS_KEY).unwrap_or_default();
        SyncStatus {
            running: self.running.load(Ordering::SeqCst),
            last_success_at: s.last_success_at,
            last_error: s.last_error,
        }
    }

    /// Scheduler: waits for the first kick, then syncs on every kick and every N minutes.
    pub fn spawn(self: Arc<Self>, app: AppHandle, db: Arc<Db>, gh: Arc<ReadApi>) {
        tauri::async_runtime::spawn(async move {
            self.trigger.notified().await;
            loop {
                let outcome = self.run_once(&app, &db, &gh).await;
                let minutes = state::kv_get(&db.read(), "sync_interval_minutes")
                    .ok()
                    .flatten()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(DEFAULT_INTERVAL_MIN)
                    .max(1);
                let wait = match outcome {
                    Outcome::Retry(secs) => Duration::from_secs(secs.clamp(RETRY_SECS, minutes * 60)),
                    Outcome::Done => Duration::from_secs(minutes * 60),
                };
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {}
                    _ = self.trigger.notified() => {}
                }
            }
        });
    }

    async fn run_once(&self, app: &AppHandle, db: &Arc<Db>, gh: &Arc<ReadApi>) -> Outcome {
        match crate::auth::ensure_token(gh).await {
            Ok(true) => {}
            _ => return Outcome::Done, // signed out: nothing to sync until a kick
        }
        self.running.store(true, Ordering::SeqCst);
        let _ = app.emit(SYNC_STATUS, self.status(db));

        let result = jobs::repos::run(app, db, gh).await;
        match &result {
            Ok(()) => {
                let _ = state::sync_success(&db.write(), REPOS_KEY, db::now());
                self.spawn_icons(app, db, gh);
            }
            Err(e) => {
                eprintln!("[sync] repos failed: {e}");
                let _ = state::sync_error(&db.write(), REPOS_KEY, &e.to_string());
            }
        }

        self.running.store(false, Ordering::SeqCst);
        let _ = app.emit(SYNC_STATUS, self.status(db));

        match result {
            Ok(()) => Outcome::Done,
            // A rejected token won't fix itself; wait for the user to sign in again.
            Err(Error::Unauthorized | Error::NoToken) => Outcome::Done,
            Err(Error::RateLimited(secs)) => Outcome::Retry(secs),
            Err(_) => Outcome::Retry(RETRY_SECS),
        }
    }
}

/// What the scheduler should do after a run.
enum Outcome {
    Done,
    /// Try again sooner than the normal interval (at least `RETRY_SECS`).
    Retry(u64),
}
