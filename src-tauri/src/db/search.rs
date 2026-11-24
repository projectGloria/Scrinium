//! Palette search over repos: fuzzy match on names (nucleo) plus FTS5 trigram over
//! name/description/topics, boosted by pins and recent use.

use std::collections::HashMap;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use rusqlite::Connection;
use serde::Serialize;

use crate::error::Result;

/// Score for a repo matched only through its description/topics.
const FTS_ONLY: u32 = 30;
const FTS_BONUS: u32 = 15;
const PIN_BONUS: u32 = 25;

struct Candidate {
    id: i64,
    name: String,
    full_name: String,
    pinned: bool,
    last_opened_at: Option<i64>,
    open_count: i64,
}

/// Repo ids best-first. An empty query returns the usual list order.
pub fn repos(conn: &Connection, q: &str, limit: usize, now: i64) -> Result<Vec<i64>> {
    let q = q.trim();
    let mut stmt = conn.prepare_cached(
        "SELECT r.id, r.name, r.full_name, COALESCE(l.pinned, 0), l.last_opened_at, COALESCE(l.open_count, 0)
         FROM repos r LEFT JOIN repo_local l ON l.repo_id = r.id
         WHERE r.gone = 0
         ORDER BY COALESCE(l.pinned, 0) DESC, l.pin_order, l.last_opened_at IS NULL,
                  l.last_opened_at DESC, r.pushed_at DESC",
    )?;
    let cands: Vec<Candidate> = stmt
        .query_map([], |r| {
            Ok(Candidate {
                id: r.get(0)?,
                name: r.get(1)?,
                full_name: r.get(2)?,
                pinned: r.get(3)?,
                last_opened_at: r.get(4)?,
                open_count: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    if q.is_empty() {
        return Ok(cands.into_iter().take(limit).map(|c| c.id).collect());
    }

    let fts = fts_ids(conn, q)?;
    let pattern = Pattern::parse(q, CaseMatching::Ignore, Normalization::Smart);
    let mut matcher = Matcher::new(Config::DEFAULT);
    let mut buf = Vec::new();
    let mut scored: Vec<(u32, usize, i64)> = Vec::new();
    for (order, c) in cands.iter().enumerate() {
        let on_name = pattern.score(Utf32Str::new(&c.name, &mut buf), &mut matcher).map(|s| s + s / 4);
        let on_full = pattern.score(Utf32Str::new(&c.full_name, &mut buf), &mut matcher);
        let fuzzy = on_name.max(on_full);
        let in_fts = fts.contains_key(&c.id);
        let base = match (fuzzy, in_fts) {
            (Some(s), true) => s + FTS_BONUS,
            (Some(s), false) => s,
            (None, true) => FTS_ONLY,
            (None, false) => continue,
        };
        scored.push((base + boost(c, now), order, c.id));
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    Ok(scored.into_iter().take(limit).map(|(_, _, id)| id).collect())
}

fn boost(c: &Candidate, now: i64) -> u32 {
    let mut b = if c.pinned { PIN_BONUS } else { 0 };
    if let Some(t) = c.last_opened_at {
        let days = ((now - t).max(0) / 86_400) as u32;
        b += 20u32.saturating_sub(days);
    }
    b + (c.open_count.clamp(0, 10) as u32)
}

/// Ids whose name, description or topics contain every 3+ char word of the query.
fn fts_ids(conn: &Connection, q: &str) -> Result<HashMap<i64, ()>> {
    let words: Vec<String> = q
        .split_whitespace()
        .filter(|w| w.chars().count() >= 3)
        .map(|w| format!("\"{}\"", w.replace('"', "\"\"")))
        .collect();
    if words.is_empty() {
        return Ok(HashMap::new());
    }
    let mut stmt = conn.prepare_cached("SELECT rowid FROM repos_fts WHERE repos_fts MATCH ?1 LIMIT 500")?;
    let ids = stmt
        .query_map([words.join(" ")], |r| r.get::<_, i64>(0))?
        .filter_map(|r| r.ok())
        .map(|id| (id, ()))
        .collect();
    Ok(ids)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileHit {
    pub repo_id: i64,
    pub path: String,
}

/// File paths (default branches) best-first. Trigram FTS finds candidates, nucleo ranks them,
/// preferring matches in the file name over matches in the directories.
pub fn files(conn: &Connection, q: &str, limit: usize) -> Result<Vec<FileHit>> {
    let q = q.trim();
    let words: Vec<String> = q
        .split(|c: char| c.is_whitespace() || c == '/')
        .filter(|w| w.chars().count() >= 3)
        .map(|w| format!("\"{}\"", w.replace('"', "\"\"")))
        .collect();
    if words.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare_cached(
        "SELECT f.rowid, f.path FROM files_fts f
         JOIN repos r ON r.id = (f.rowid >> 20) AND r.gone = 0
         WHERE files_fts MATCH ?1 LIMIT 400",
    )?;
    let cands: Vec<(i64, String)> =
        stmt.query_map([words.join(" ")], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let pattern = Pattern::parse(q, CaseMatching::Ignore, Normalization::Smart);
    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let mut buf = Vec::new();
    let mut scored: Vec<(u32, usize, FileHit)> = cands
        .into_iter()
        .filter_map(|(rowid, path)| {
            let file = path.rsplit('/').next().unwrap_or(&path);
            let on_file = pattern.score(Utf32Str::new(file, &mut buf), &mut matcher).map(|s| s + s / 2);
            let on_path = pattern.score(Utf32Str::new(&path, &mut buf), &mut matcher);
            // Shorter paths win ties: `src/app.ts` over `vendor/x/y/app.ts`.
            let s = on_file.max(on_path)?.saturating_sub(path.matches('/').count() as u32);
            Some((s, path.len(), FileHit { repo_id: crate::db::files::repo_of_row(rowid), path }))
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    Ok(scored.into_iter().take(limit).map(|(_, _, h)| h).collect())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IssueHit {
    pub repo_id: i64,
    pub number: i64,
    pub is_pr: bool,
    pub title: String,
    pub state: String,
}

/// Open items get this much on top of their match score.
const OPEN_BONUS: u32 = 10;

/// Issues and PRs by title (or `#123`), best-first; open and recently updated items win ties.
pub fn issues(conn: &Connection, q: &str, limit: usize) -> Result<Vec<IssueHit>> {
    let q = q.trim();
    if limit == 0 {
        return Ok(Vec::new());
    }
    let map = |r: &rusqlite::Row| -> rusqlite::Result<IssueHit> {
        Ok(IssueHit { repo_id: r.get(0)?, number: r.get(1)?, is_pr: r.get(2)?, title: r.get(3)?, state: r.get(4)? })
    };
    if let Some(n) = q.strip_prefix('#').and_then(|n| n.parse::<i64>().ok()) {
        let mut stmt = conn.prepare_cached(
            "SELECT i.repo_id, i.number, i.is_pr, i.title, i.state FROM issues i
             JOIN repos r ON r.id = i.repo_id AND r.gone = 0
             LEFT JOIN repo_local l ON l.repo_id = r.id
             WHERE i.number = ?1
             ORDER BY COALESCE(l.pinned, 0) DESC, l.last_opened_at DESC, i.updated_at DESC LIMIT ?2",
        )?;
        return Ok(stmt.query_map(rusqlite::params![n, limit as i64], map)?.collect::<rusqlite::Result<_>>()?);
    }
    let words: Vec<String> = q
        .split_whitespace()
        .filter(|w| w.chars().count() >= 3)
        .map(|w| format!("\"{}\"", w.replace('"', "\"\"")))
        .collect();
    if words.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare_cached(
        "SELECT i.repo_id, i.number, i.is_pr, i.title, i.state FROM issues_fts f
         JOIN issues i ON i.rowid = f.rowid
         JOIN repos r ON r.id = i.repo_id AND r.gone = 0
         WHERE issues_fts MATCH ?1 ORDER BY i.updated_at DESC LIMIT 400",
    )?;
    let cands: Vec<IssueHit> = stmt.query_map([words.join(" ")], map)?.collect::<rusqlite::Result<_>>()?;
    let pattern = Pattern::parse(q, CaseMatching::Ignore, Normalization::Smart);
    let mut matcher = Matcher::new(Config::DEFAULT);
    let mut buf = Vec::new();
    let mut scored: Vec<(u32, usize, IssueHit)> = cands
        .into_iter()
        .enumerate()
        .map(|(order, h)| {
            // Every candidate contains the query words; nucleo only refines the order.
            let s = pattern.score(Utf32Str::new(&h.title, &mut buf), &mut matcher).unwrap_or(0);
            let open = if h.state == "OPEN" { OPEN_BONUS } else { 0 };
            (s + open, order, h)
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    Ok(scored.into_iter().take(limit).map(|(_, _, h)| h).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn insert(db: &Db, id: i64, name: &str, desc: &str, topics: &str) {
        db.write()
            .execute(
                "INSERT INTO repos (id, node_id, owner, name, full_name, owner_is_org, description, topics,
                   is_private, is_fork, is_archived, html_url, ssh_url, clone_url, synced_at, pushed_at)
                 VALUES (?1, ?2, 'me', ?3, 'me/' || ?3, 0, ?4, ?5, 0, 0, 0, 'h', 's', 'c', 0, ?1)",
                rusqlite::params![id, format!("N{id}"), name, desc, topics],
            )
            .unwrap();
    }

    #[test]
    fn finds_by_name_description_and_topic() {
        let db = Db::open_in_memory().unwrap();
        insert(&db, 1, "scrinium", "GitHub browser", "tauri rust");
        insert(&db, 2, "dotfiles", "my shell config", "zsh");
        insert(&db, 3, "notes", "personal wiki", "markdown");
        let r = db.read();
        assert_eq!(repos(&r, "scr", 10, 0).unwrap()[0], 1);
        assert_eq!(repos(&r, "shell", 10, 0).unwrap(), vec![2]);
        assert_eq!(repos(&r, "markdown", 10, 0).unwrap(), vec![3]);
        assert_eq!(repos(&r, "", 10, 0).unwrap().len(), 3);
        assert!(repos(&r, "zzzzqq", 10, 0).unwrap().is_empty());
    }

    #[test]
    fn finds_files_by_name() {
        let db = Db::open_in_memory().unwrap();
        insert(&db, 1, "app", "", "");
        let items = [
            ("src/features/palette/Palette.tsx", "blob"),
            ("vendor/lib/palette/other/palette.js", "blob"),
            ("README.md", "blob"),
        ];
        let items: Vec<_> = items
            .iter()
            .map(|(p, k)| crate::db::files::TreeItem { path: p, kind: k, sha: p, size: None, mode: None })
            .collect();
        crate::db::files::put_tree(&db.write(), "t", false, &items, 0).unwrap();
        crate::db::files::index_files(&db.write(), 1, "t", 0).unwrap();
        let r = db.read();
        let hits = files(&r, "palette.tsx", 10).unwrap();
        assert_eq!(hits[0], FileHit { repo_id: 1, path: "src/features/palette/Palette.tsx".into() });
        assert!(files(&r, "re", 10).unwrap().is_empty());
        assert_eq!(files(&r, "readme", 10).unwrap().len(), 1);
    }

    #[test]
    fn finds_issues_by_title_and_number() {
        let db = Db::open_in_memory().unwrap();
        insert(&db, 1, "app", "", "");
        let rows = vec![
            crate::db::issues::tests::row(1, "Crash when opening palette", "CLOSED", 10),
            crate::db::issues::tests::row(2, "Palette is slow", "OPEN", 5),
            crate::db::issues::tests::row(3, "Unrelated", "OPEN", 1),
        ];
        crate::db::issues::upsert(&mut db.write(), 1, false, &rows).unwrap();
        let r = db.read();
        let hits = issues(&r, "palette", 10).unwrap();
        assert_eq!(hits.iter().map(|h| h.number).collect::<Vec<_>>(), vec![2, 1], "open first");
        assert_eq!(issues(&r, "#3", 10).unwrap()[0].title, "Unrelated");
        assert!(issues(&r, "pa", 10).unwrap().is_empty());
    }

    #[test]
    fn fts_follows_updates() {
        let db = Db::open_in_memory().unwrap();
        insert(&db, 1, "a1", "old words", "");
        db.write().execute("UPDATE repos SET description = 'fresh text' WHERE id = 1", []).unwrap();
        let r = db.read();
        assert_eq!(repos(&r, "fresh", 10, 0).unwrap(), vec![1]);
        assert!(repos(&r, "old words", 10, 0).unwrap().is_empty());
    }
}
