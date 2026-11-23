//! Events the backend emits to the frontend.

use serde::Serialize;

/// Repo rows changed in SQLite; the frontend re-reads its list. No payload.
pub const REPOS_CHANGED: &str = "sync://repos-changed";
/// Sync started/finished/failed. Payload: [`SyncStatus`].
pub const SYNC_STATUS: &str = "sync://status";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub running: bool,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
}
