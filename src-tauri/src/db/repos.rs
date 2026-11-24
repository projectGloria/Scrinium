//! Repository rows: sync upserts (GitHub-owned columns) and local state (pins, recent use).

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::Result;

/// A repository as fetched from GitHub, ready to upsert.
#[derive(Debug, Clone)]
pub struct RepoRow {
    pub id: i64,
    pub node_id: String,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub owner_is_org: bool,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub topics: String,
    pub primary_language: Option<String>,
    pub is_private: bool,
    pub is_fork: bool,
    pub is_archived: bool,
    pub default_branch: Option<String>,
    pub stars: i64,
    pub forks: i64,
    pub open_issues: i64,
    pub open_prs: i64,
    pub pushed_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub html_url: String,
    pub ssh_url: String,
    pub clone_url: String,
    /// Root tree of the default branch.
    pub default_tree_sha: Option<String>,
    /// updatedAt of the most recently updated issue / PR on GitHub.
    pub issues_latest_at: Option<i64>,
    pub prs_latest_at: Option<i64>,
    pub languages: Vec<Language>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Language {
    pub name: String,
    pub bytes: i64,
    pub color: Option<String>,
}

/// What the UI gets for every repo in the list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub id: i64,
    pub owner: String,
    pub name: String,
    pub full_name: String,
    pub owner_is_org: bool,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub topics: Vec<String>,
    pub primary_language: Option<String>,
    pub is_private: bool,
    pub is_fork: bool,
    pub is_archived: bool,
    pub default_branch: Option<String>,
    pub stars: i64,
    pub forks: i64,
    pub open_issues: i64,
    pub open_prs: i64,
    pub pushed_at: Option<i64>,
    pub html_url: String,
    pub pinned: bool,
    pub last_opened_at: Option<i64>,
    /// Blob SHA of the repo's own icon, if it has one (served by the `scrblob` protocol).
    pub icon_sha: Option<String>,
    /// Root tree of the default branch as of the last sync.
    pub default_tree_sha: Option<String>,
}

/// Columns sync owns, in bind order (?1..). `synced_at` and `gone` are handled separately.
const SYNC_COLS: &[&str] = &[
    "id", "node_id", "owner", "name", "full_name", "owner_is_org", "description", "homepage",
    "topics", "primary_language", "is_private", "is_fork", "is_archived", "default_branch",
    "stars", "forks", "open_issues", "open_prs", "pushed_at", "updated_at", "html_url",
    "ssh_url", "clone_url", "default_tree_sha", "issues_latest_at", "prs_latest_at",
];

/// Upsert that only writes (and only counts as a change) when some synced column differs.
fn upsert_sql() -> &'static str {
    static SQL: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SQL.get_or_init(|| {
        let n = SYNC_COLS.len();
        let placeholders: Vec<String> = (1..=n).map(|i| format!("?{i}")).collect();
        let updatable = &SYNC_COLS[1..];
        let sets: Vec<String> = updatable.iter().map(|c| format!("{c} = excluded.{c}")).collect();
        let diffs: Vec<String> =
            updatable.iter().map(|c| format!("repos.{c} IS NOT excluded.{c}")).collect();
        format!(
            "INSERT INTO repos ({cols}, synced_at, gone) VALUES ({ph}, ?{s}, 0) \
             ON CONFLICT(id) DO UPDATE SET {sets} WHERE {diffs}",
            cols = SYNC_COLS.join(", "),
            ph = placeholders.join(", "),
            s = n + 1,
            sets = sets.join(", "),
            diffs = diffs.join(" OR "),
        )
    })
}

/// Upserts one page of repos in a single transaction. Returns true if anything visible changed,
/// so the caller only notifies the UI when there is something new to show.
pub fn upsert_page(conn: &mut Connection, rows: &[RepoRow], synced_at: i64) -> Result<bool> {
    let tx = conn.transaction()?;
    let mut changed = false;
    {
        // A rename/transfer can leave an old row holding this full_name or node_id under another id.
        let mut evict = tx.prepare_cached(
            "DELETE FROM repos WHERE (full_name = ?1 OR node_id = ?2) AND id <> ?3",
        )?;
        let mut upsert = tx.prepare_cached(upsert_sql())?;
        let mut revive = tx.prepare_cached("UPDATE repos SET gone = 0 WHERE id = ?1 AND gone = 1")?;
        let mut stamp = tx.prepare_cached("UPDATE repos SET synced_at = ?2 WHERE id = ?1")?;
        let mut get_langs = tx.prepare_cached(
            "SELECT language, bytes, color FROM repo_languages WHERE repo_id = ?1 ORDER BY language",
        )?;
        let mut del_langs = tx.prepare_cached("DELETE FROM repo_languages WHERE repo_id = ?1")?;
        let mut ins_lang = tx.prepare_cached(
            "INSERT INTO repo_languages (repo_id, language, bytes, color) VALUES (?1, ?2, ?3, ?4)",
        )?;

        for r in rows {
            changed |= evict.execute(params![r.full_name, r.node_id, r.id])? > 0;
            changed |= upsert.execute(params![
                r.id, r.node_id, r.owner, r.name, r.full_name, r.owner_is_org, r.description,
                r.homepage, r.topics, r.primary_language, r.is_private, r.is_fork, r.is_archived,
                r.default_branch, r.stars, r.forks, r.open_issues, r.open_prs, r.pushed_at,
                r.updated_at, r.html_url, r.ssh_url, r.clone_url, r.default_tree_sha, r.issues_latest_at,
                r.prs_latest_at, synced_at,
            ])? > 0;
            changed |= revive.execute(params![r.id])? > 0;
            stamp.execute(params![r.id, synced_at])?;

            let mut new_langs = r.languages.clone();
            new_langs.sort_by(|a, b| a.name.cmp(&b.name));
            let old_langs: Vec<Language> = get_langs
                .query_map(params![r.id], |row| {
                    Ok(Language { name: row.get(0)?, bytes: row.get(1)?, color: row.get(2)? })
                })?
                .collect::<rusqlite::Result<_>>()?;
            if old_langs != new_langs {
                del_langs.execute(params![r.id])?;
                for l in &new_langs {
                    ins_lang.execute(params![r.id, l.name, l.bytes, l.color])?;
                }
                changed = true;
            }
        }
    }
    tx.commit()?;
    Ok(changed)
}

/// After a complete sync, hide repos that weren't seen (deleted, transferred, access lost).
pub fn mark_gone(conn: &Connection, sync_started_at: i64) -> Result<usize> {
    Ok(conn.execute(
        "UPDATE repos SET gone = 1 WHERE synced_at < ?1 AND gone = 0",
        params![sync_started_at],
    )?)
}

/// All visible repos, pinned first, then most recently opened, then most recently pushed.
pub fn list(conn: &Connection) -> Result<Vec<RepoSummary>> {
    let mut stmt = conn.prepare_cached(
        "SELECT r.id, r.owner, r.name, r.full_name, r.owner_is_org, r.description, r.homepage,
                r.topics, r.primary_language, r.is_private, r.is_fork, r.is_archived,
                r.default_branch, r.stars, r.forks, r.open_issues, r.open_prs, r.pushed_at,
                r.html_url, COALESCE(l.pinned, 0), l.last_opened_at, i.blob_sha, r.default_tree_sha
         FROM repos r LEFT JOIN repo_local l ON l.repo_id = r.id
         LEFT JOIN repo_icons i ON i.repo_id = r.id
         WHERE r.gone = 0
         ORDER BY COALESCE(l.pinned, 0) DESC, l.pin_order, l.last_opened_at IS NULL,
                  l.last_opened_at DESC, r.pushed_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let topics: Option<String> = row.get(7)?;
        Ok(RepoSummary {
            id: row.get(0)?,
            owner: row.get(1)?,
            name: row.get(2)?,
            full_name: row.get(3)?,
            owner_is_org: row.get(4)?,
            description: row.get(5)?,
            homepage: row.get(6)?,
            topics: topics
                .map(|t| t.split_whitespace().map(str::to_owned).collect())
                .unwrap_or_default(),
            primary_language: row.get(8)?,
            is_private: row.get(9)?,
            is_fork: row.get(10)?,
            is_archived: row.get(11)?,
            default_branch: row.get(12)?,
            stars: row.get(13)?,
            forks: row.get(14)?,
            open_issues: row.get(15)?,
            open_prs: row.get(16)?,
            pushed_at: row.get(17)?,
            html_url: row.get(18)?,
            pinned: row.get(19)?,
            last_opened_at: row.get(20)?,
            icon_sha: row.get(21)?,
            default_tree_sha: row.get(22)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Where a repo lives on GitHub.
pub struct Location {
    pub owner: String,
    pub name: String,
}

pub fn locate(conn: &Connection, repo_id: i64) -> Result<Location> {
    conn.query_row("SELECT owner, name FROM repos WHERE id = ?1", [repo_id], |r| {
        Ok(Location { owner: r.get(0)?, name: r.get(1)? })
    })
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => crate::error::Error::Other(format!("unknown repo {repo_id}")),
        e => e.into(),
    })
}

pub fn languages(conn: &Connection, repo_id: i64) -> Result<Vec<Language>> {
    let mut stmt = conn.prepare_cached(
        "SELECT language, bytes, color FROM repo_languages WHERE repo_id = ?1 ORDER BY bytes DESC",
    )?;
    let rows = stmt.query_map(params![repo_id], |row| {
        Ok(Language { name: row.get(0)?, bytes: row.get(1)?, color: row.get(2)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Records that the user opened a repo (drives "recent" ordering).
pub fn touch(conn: &Connection, repo_id: i64, at: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO repo_local (repo_id, last_opened_at, open_count) VALUES (?1, ?2, 1)
         ON CONFLICT(repo_id) DO UPDATE SET last_opened_at = excluded.last_opened_at,
                                            open_count = open_count + 1",
        params![repo_id, at],
    )?;
    Ok(())
}

pub fn set_pinned(conn: &Connection, repo_id: i64, pinned: bool) -> Result<()> {
    let order: Option<i64> = if pinned {
        Some(conn.query_row(
            "SELECT COALESCE(MAX(pin_order), 0) + 1 FROM repo_local",
            [],
            |r| r.get(0),
        )?)
    } else {
        None
    };
    conn.execute(
        "INSERT INTO repo_local (repo_id, pinned, pin_order) VALUES (?1, ?2, ?3)
         ON CONFLICT(repo_id) DO UPDATE SET pinned = excluded.pinned, pin_order = excluded.pin_order",
        params![repo_id, pinned, order],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn row(id: i64, name: &str) -> RepoRow {
        RepoRow {
            id,
            node_id: format!("R_{id}"),
            owner: "me".into(),
            name: name.into(),
            full_name: format!("me/{name}"),
            owner_is_org: false,
            description: Some("desc".into()),
            homepage: None,
            topics: "rust tauri".into(),
            primary_language: Some("Rust".into()),
            is_private: false,
            is_fork: false,
            is_archived: false,
            default_branch: Some("main".into()),
            stars: 1,
            forks: 0,
            open_issues: 0,
            open_prs: 0,
            pushed_at: Some(100),
            updated_at: Some(100),
            html_url: format!("https://github.com/me/{name}"),
            ssh_url: format!("git@github.com:me/{name}.git"),
            clone_url: format!("https://github.com/me/{name}.git"),
            default_tree_sha: None,
            issues_latest_at: None,
            prs_latest_at: None,
            languages: vec![Language { name: "Rust".into(), bytes: 10, color: Some("#dea584".into()) }],
        }
    }

    #[test]
    fn migrations_apply_to_empty_db() {
        let db = Db::open_in_memory().unwrap();
        let v: i64 = db.read().query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, crate::db::migrations::latest());
    }

    #[test]
    fn upsert_reports_changes_only_when_data_differs() {
        let db = Db::open_in_memory().unwrap();
        let rows = vec![row(1, "a"), row(2, "b")];
        assert!(upsert_page(&mut db.write(), &rows, 10).unwrap());
        assert!(
            !upsert_page(&mut db.write(), &rows, 20).unwrap(),
            "identical data must not count as a change"
        );
        let mut changed = rows.clone();
        changed[0].stars = 5;
        assert!(upsert_page(&mut db.write(), &changed, 30).unwrap());
    }

    #[test]
    fn sync_never_touches_local_state() {
        let db = Db::open_in_memory().unwrap();
        upsert_page(&mut db.write(), &[row(1, "a"), row(2, "b")], 10).unwrap();
        set_pinned(&db.write(), 2, true).unwrap();
        touch(&db.write(), 1, 50).unwrap();

        let mut again = vec![row(1, "a-renamed"), row(2, "b")];
        again[1].stars = 99;
        upsert_page(&mut db.write(), &again, 20).unwrap();

        let list = list(&db.read()).unwrap();
        assert_eq!(list[0].id, 2, "pinned repo stays first");
        assert!(list[0].pinned);
        assert_eq!(list[0].stars, 99);
        assert_eq!(list[1].name, "a-renamed");
        assert_eq!(list[1].last_opened_at, Some(50));
    }

    #[test]
    fn mark_gone_hides_unseen_repos() {
        let db = Db::open_in_memory().unwrap();
        upsert_page(&mut db.write(), &[row(1, "a"), row(2, "b")], 10).unwrap();
        upsert_page(&mut db.write(), &[row(1, "a")], 20).unwrap();
        assert_eq!(mark_gone(&db.write(), 20).unwrap(), 1);
        assert_eq!(list(&db.read()).unwrap().len(), 1);
        // Seen again later: it comes back, and that counts as a change.
        assert!(upsert_page(&mut db.write(), &[row(2, "b")], 30).unwrap());
        assert_eq!(list(&db.read()).unwrap().len(), 2);
    }
}
