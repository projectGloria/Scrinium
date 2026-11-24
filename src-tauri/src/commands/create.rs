//! Create-repository dialog: template lists (cached in SQLite) and the create call itself,
//! which is one of the app's two GitHub writes (see `github/write.rs`).

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::db::repos::{self, RepoRow};
use crate::db::{now, state};
use crate::error::Result;
use crate::events::REPOS_CHANGED;
use crate::github::model::{parse_timestamp, LicenseInfo, RestRepo};
use crate::github::NewRepo;
use crate::AppState;

const TEMPLATES_KEY: &str = "create:templates";
/// Template lists barely ever change; refetch them once a week.
const TEMPLATES_MAX_AGE: i64 = 7 * 24 * 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Templates {
    pub gitignore: Vec<String>,
    pub licenses: Vec<LicenseInfo>,
    pub fetched_at: i64,
}

/// .gitignore and license choices. Served from SQLite when cached; fetched (two GETs) otherwise.
#[tauri::command]
pub async fn repo_templates(state: State<'_, AppState>) -> Result<Templates> {
    let cached: Option<Templates> = state::kv_get(&state.db.read(), TEMPLATES_KEY)?
        .and_then(|s| serde_json::from_str(&s).ok());
    if let Some(t) = &cached {
        if now() - t.fetched_at < TEMPLATES_MAX_AGE {
            return Ok(t.clone());
        }
    }
    let fetched = async {
        let (gitignore, licenses) = tokio::try_join!(state.gh.gitignore_templates(), state.gh.licenses())?;
        Ok::<_, crate::error::Error>(Templates { gitignore, licenses, fetched_at: now() })
    }
    .await;
    match (fetched, cached) {
        (Ok(t), _) => {
            if let Ok(s) = serde_json::to_string(&t) {
                let _ = state::kv_set(&state.db.write(), TEMPLATES_KEY, &s);
            }
            Ok(t)
        }
        // Offline with an old copy: the old copy is fine.
        (Err(_), Some(old)) => Ok(old),
        (Err(e), None) => Err(e),
    }
}

/// Creates the repo, stores it right away so the UI can open it, and starts a full sync.
/// Returns the new repo id.
#[tauri::command]
pub async fn repo_create(app: AppHandle, state: State<'_, AppState>, repo: NewRepo) -> Result<i64> {
    let created = state.gw.create_repo(&repo).await?;
    let id = created.id;
    let row = to_row(created);
    {
        let mut conn = state.db.write();
        repos::upsert_page(&mut conn, &[row], now())?;
        repos::touch(&conn, id, now())?;
    }
    let _ = app.emit(REPOS_CHANGED, ());
    state.sync.kick();
    Ok(id)
}

fn to_row(r: RestRepo) -> RepoRow {
    RepoRow {
        id: r.id,
        node_id: r.node_id,
        owner_is_org: r.owner.kind == "Organization",
        owner: r.owner.login,
        name: r.name,
        full_name: r.full_name,
        description: r.description.filter(|d| !d.is_empty()),
        homepage: r.homepage.filter(|h| !h.is_empty()),
        topics: r.topics.join(" "),
        primary_language: r.language,
        is_private: r.private,
        is_fork: r.fork,
        is_archived: r.archived,
        default_branch: r.default_branch,
        stars: r.stargazers_count,
        forks: r.forks_count,
        open_issues: r.open_issues_count,
        open_prs: 0,
        pushed_at: r.pushed_at.as_deref().and_then(parse_timestamp),
        updated_at: r.updated_at.as_deref().and_then(parse_timestamp),
        html_url: r.html_url,
        ssh_url: r.ssh_url,
        clone_url: r.clone_url,
        // Filled in by the sync that follows.
        default_tree_sha: None,
        issues_latest_at: None,
        prs_latest_at: None,
        languages: Vec::new(),
    }
}
