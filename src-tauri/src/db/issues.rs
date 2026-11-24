//! Issues and pull requests (one table; `is_pr` tells them apart), their comments and checks.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Label {
    pub name: String,
    pub color: Option<String>,
}

/// An issue or PR as fetched from GitHub, ready to upsert.
#[derive(Debug, Clone)]
pub struct IssueRow {
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub state_reason: Option<String>,
    pub is_draft: bool,
    pub author: Option<String>,
    pub author_avatar: Option<String>,
    pub comments_count: i64,
    pub labels: Vec<Label>,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    pub checks_state: Option<String>,
    pub html_url: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
    pub merged_at: Option<i64>,
}

/// One row of the Issues / Pull requests list.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSummary {
    pub number: i64,
    pub is_pr: bool,
    pub title: String,
    pub state: String,
    pub state_reason: Option<String>,
    pub is_draft: bool,
    pub author: Option<String>,
    pub comments_count: i64,
    pub labels: Vec<Label>,
    pub checks_state: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub closed_at: Option<i64>,
    pub merged_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Check {
    pub name: String,
    /// SUCCESS / FAILURE / PENDING / NEUTRAL / SKIPPED / CANCELLED / ...
    pub state: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub author: Option<String>,
    pub author_avatar: Option<String>,
    pub body: String,
    pub created_at: i64,
}

/// The detail view: the list row plus body, comments and checks.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    #[serde(flatten)]
    pub summary: IssueSummary,
    pub body: Option<String>,
    pub author_avatar: Option<String>,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    pub html_url: String,
    /// None until the detail (comments, checks) has been fetched once.
    pub detail_at: Option<i64>,
    pub comments: Vec<Comment>,
    pub checks: Vec<Check>,
}

/// Which items the list shows. For PRs, "closed" includes merged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StateFilter {
    Open,
    Closed,
    All,
}

/// GitHub-owned columns, in bind order after `repo_id` (?1) and `is_pr` (?2).
const COLS: &[&str] = &[
    "number", "title", "body", "state", "state_reason", "is_draft", "author", "author_avatar",
    "comments_count", "labels", "head_ref", "base_ref", "checks_state", "html_url", "created_at",
    "updated_at", "closed_at", "merged_at",
];

fn upsert_sql() -> &'static str {
    static SQL: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    SQL.get_or_init(|| {
        let ph: Vec<String> = (3..3 + COLS.len()).map(|i| format!("?{i}")).collect();
        let updatable = &COLS[1..];
        let sets: Vec<String> = updatable.iter().map(|c| format!("{c} = excluded.{c}")).collect();
        let diffs: Vec<String> = updatable.iter().map(|c| format!("issues.{c} IS NOT excluded.{c}")).collect();
        format!(
            "INSERT INTO issues (repo_id, is_pr, {cols}) VALUES (?1, ?2, {ph}) \
             ON CONFLICT(repo_id, number) DO UPDATE SET is_pr = excluded.is_pr, {sets} \
             WHERE issues.is_pr IS NOT excluded.is_pr OR {diffs}",
            cols = COLS.join(", "),
            ph = ph.join(", "),
            sets = sets.join(", "),
            diffs = diffs.join(" OR "),
        )
    })
}

/// Upserts in one transaction. Returns true if anything changed.
pub fn upsert(conn: &mut Connection, repo_id: i64, is_pr: bool, rows: &[IssueRow]) -> Result<bool> {
    let tx = conn.transaction()?;
    let mut changed = false;
    {
        let mut stmt = tx.prepare_cached(upsert_sql())?;
        for r in rows {
            let labels = serde_json::to_string(&r.labels).unwrap_or_else(|_| "[]".into());
            changed |= stmt.execute(params![
                repo_id, is_pr, r.number, r.title, r.body, r.state, r.state_reason, r.is_draft, r.author,
                r.author_avatar, r.comments_count, labels, r.head_ref, r.base_ref, r.checks_state,
                r.html_url, r.created_at, r.updated_at, r.closed_at, r.merged_at,
            ])? > 0;
        }
    }
    tx.commit()?;
    Ok(changed)
}

const SUMMARY_COLS: &str = "number, is_pr, title, state, state_reason, is_draft, author, comments_count, labels,
     checks_state, created_at, updated_at, closed_at, merged_at";

fn summary(r: &Row<'_>) -> rusqlite::Result<IssueSummary> {
    let labels: String = r.get(8)?;
    Ok(IssueSummary {
        number: r.get(0)?,
        is_pr: r.get(1)?,
        title: r.get(2)?,
        state: r.get(3)?,
        state_reason: r.get(4)?,
        is_draft: r.get(5)?,
        author: r.get(6)?,
        comments_count: r.get(7)?,
        labels: serde_json::from_str(&labels).unwrap_or_default(),
        checks_state: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
        closed_at: r.get(12)?,
        merged_at: r.get(13)?,
    })
}

/// Cached items, most recently updated first.
pub fn list(conn: &Connection, repo_id: i64, is_pr: bool, filter: StateFilter, limit: usize) -> Result<Vec<IssueSummary>> {
    let cond = match filter {
        StateFilter::Open => "AND state = 'OPEN'",
        StateFilter::Closed => "AND state <> 'OPEN'",
        StateFilter::All => "",
    };
    let sql = format!(
        "SELECT {SUMMARY_COLS} FROM issues WHERE repo_id = ?1 AND is_pr = ?2 {cond}
         ORDER BY updated_at DESC LIMIT ?3"
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt.query_map(params![repo_id, is_pr, limit as i64], summary)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// How many open / closed items are cached.
pub fn counts(conn: &Connection, repo_id: i64, is_pr: bool) -> Result<(i64, i64)> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(state = 'OPEN'), 0), COALESCE(SUM(state <> 'OPEN'), 0)
         FROM issues WHERE repo_id = ?1 AND is_pr = ?2",
        params![repo_id, is_pr],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

pub fn get(conn: &Connection, repo_id: i64, number: i64) -> Result<Option<IssueDetail>> {
    let sql = format!(
        "SELECT {SUMMARY_COLS}, body, author_avatar, head_ref, base_ref, html_url, detail_at, checks
         FROM issues WHERE repo_id = ?1 AND number = ?2"
    );
    let row = conn
        .query_row(&sql, params![repo_id, number], |r| {
            let checks: Option<String> = r.get(20)?;
            Ok(IssueDetail {
                summary: summary(r)?,
                body: r.get(14)?,
                author_avatar: r.get(15)?,
                head_ref: r.get(16)?,
                base_ref: r.get(17)?,
                html_url: r.get(18)?,
                detail_at: r.get(19)?,
                comments: Vec::new(),
                checks: checks.and_then(|c| serde_json::from_str(&c).ok()).unwrap_or_default(),
            })
        })
        .optional()?;
    let Some(mut d) = row else { return Ok(None) };
    let mut stmt = conn.prepare_cached(
        "SELECT id, author, author_avatar, body, created_at FROM issue_comments
         WHERE repo_id = ?1 AND number = ?2 ORDER BY ord",
    )?;
    d.comments = stmt
        .query_map(params![repo_id, number], |r| {
            Ok(Comment {
                id: r.get(0)?,
                author: r.get(1)?,
                author_avatar: r.get(2)?,
                body: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Some(d))
}

/// Stores a freshly fetched detail: the row itself, all comments and the checks.
pub fn set_detail(
    conn: &mut Connection,
    repo_id: i64,
    is_pr: bool,
    row: &IssueRow,
    comments: &[Comment],
    checks: &[Check],
    at: i64,
) -> Result<()> {
    upsert(conn, repo_id, is_pr, std::slice::from_ref(row))?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM issue_comments WHERE repo_id = ?1 AND number = ?2", params![repo_id, row.number])?;
    {
        let mut ins = tx.prepare_cached(
            "INSERT INTO issue_comments (repo_id, number, ord, id, author, author_avatar, body, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        for (i, c) in comments.iter().enumerate() {
            ins.execute(params![repo_id, row.number, i as i64, c.id, c.author, c.author_avatar, c.body, c.created_at])?;
        }
    }
    let checks = if is_pr { Some(serde_json::to_string(checks).unwrap_or_else(|_| "[]".into())) } else { None };
    tx.execute(
        "UPDATE issues SET checks = ?3, detail_at = ?4 WHERE repo_id = ?1 AND number = ?2",
        params![repo_id, row.number, checks, at],
    )?;
    tx.commit()?;
    Ok(())
}

/// Newest `updated_at` we hold, the watermark for incremental syncs.
pub fn local_latest(conn: &Connection, repo_id: i64, is_pr: bool) -> Result<Option<i64>> {
    Ok(conn.query_row(
        "SELECT MAX(updated_at) FROM issues WHERE repo_id = ?1 AND is_pr = ?2",
        params![repo_id, is_pr],
        |r| r.get(0),
    )?)
}

pub struct SyncTarget {
    pub repo_id: i64,
    pub owner: String,
    pub name: String,
    pub is_pr: bool,
}

/// Repos whose issues or PRs changed on GitHub since we last looked (per the repo sync),
/// pinned and recently opened first.
pub fn sync_targets(conn: &Connection) -> Result<Vec<SyncTarget>> {
    let mut stmt = conn.prepare_cached(
        "SELECT r.id, r.owner, r.name, k.is_pr FROM repos r
         LEFT JOIN repo_local l ON l.repo_id = r.id
         CROSS JOIN (SELECT 0 AS is_pr UNION ALL SELECT 1) k
         WHERE r.gone = 0
           AND (CASE k.is_pr WHEN 0 THEN r.issues_latest_at ELSE r.prs_latest_at END) >
               COALESCE((SELECT MAX(i.updated_at) FROM issues i WHERE i.repo_id = r.id AND i.is_pr = k.is_pr), 0)
         ORDER BY COALESCE(l.pinned, 0) DESC, l.last_opened_at IS NULL, l.last_opened_at DESC,
                  r.pushed_at DESC, k.is_pr",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SyncTarget { repo_id: r.get(0)?, owner: r.get(1)?, name: r.get(2)?, is_pr: r.get(3)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::db::Db;

    pub fn row(number: i64, title: &str, state: &str, updated_at: i64) -> IssueRow {
        IssueRow {
            number,
            title: title.into(),
            body: Some("body".into()),
            state: state.into(),
            state_reason: None,
            is_draft: false,
            author: Some("me".into()),
            author_avatar: None,
            comments_count: 0,
            labels: vec![Label { name: "bug".into(), color: Some("d73a4a".into()) }],
            head_ref: None,
            base_ref: None,
            checks_state: None,
            html_url: format!("https://github.com/me/a/issues/{number}"),
            created_at: 1,
            updated_at,
            closed_at: None,
            merged_at: None,
        }
    }

    pub fn repo(db: &Db, id: i64, issues_latest: Option<i64>) {
        db.write()
            .execute(
                "INSERT INTO repos (id, node_id, owner, name, full_name, owner_is_org, is_private, is_fork,
                   is_archived, html_url, ssh_url, clone_url, synced_at, issues_latest_at)
                 VALUES (?1, ?2, 'me', ?3, 'me/' || ?3, 0, 0, 0, 0, 'h', 's', 'c', 0, ?4)",
                params![id, format!("N{id}"), format!("r{id}"), issues_latest],
            )
            .unwrap();
    }

    #[test]
    fn upsert_list_and_filters() {
        let db = Db::open_in_memory().unwrap();
        repo(&db, 1, None);
        let rows = vec![row(1, "first", "OPEN", 10), row(2, "second", "CLOSED", 20)];
        assert!(upsert(&mut db.write(), 1, false, &rows).unwrap());
        assert!(!upsert(&mut db.write(), 1, false, &rows).unwrap(), "same data is not a change");
        let r = db.read();
        assert_eq!(list(&r, 1, false, StateFilter::All, 50).unwrap()[0].number, 2);
        assert_eq!(list(&r, 1, false, StateFilter::Open, 50).unwrap().len(), 1);
        assert_eq!(list(&r, 1, false, StateFilter::Closed, 50).unwrap()[0].labels[0].name, "bug");
        assert!(list(&r, 1, true, StateFilter::All, 50).unwrap().is_empty());
        assert_eq!(counts(&r, 1, false).unwrap(), (1, 1));
        assert_eq!(local_latest(&r, 1, false).unwrap(), Some(20));
    }

    #[test]
    fn detail_replaces_comments() {
        let db = Db::open_in_memory().unwrap();
        repo(&db, 1, None);
        let c = |id: &str| Comment { id: id.into(), author: None, author_avatar: None, body: "hi".into(), created_at: 1 };
        set_detail(&mut db.write(), 1, false, &row(5, "t", "OPEN", 1), &[c("a"), c("b")], &[], 9).unwrap();
        set_detail(&mut db.write(), 1, false, &row(5, "t2", "OPEN", 2), &[c("c")], &[], 10).unwrap();
        let d = get(&db.read(), 1, 5).unwrap().unwrap();
        assert_eq!(d.summary.title, "t2");
        assert_eq!(d.comments.len(), 1);
        assert_eq!(d.detail_at, Some(10));
        assert!(get(&db.read(), 1, 6).unwrap().is_none());
    }

    #[test]
    fn targets_follow_watermark() {
        let db = Db::open_in_memory().unwrap();
        repo(&db, 1, Some(50));
        repo(&db, 2, None);
        let t = sync_targets(&db.read()).unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!((t[0].repo_id, t[0].is_pr), (1, false));
        upsert(&mut db.write(), 1, false, &[row(1, "x", "OPEN", 50)]).unwrap();
        assert!(sync_targets(&db.read()).unwrap().is_empty());
    }
}
