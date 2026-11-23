//! Palette search over repos: fuzzy match on names (nucleo) plus FTS5 trigram over
//! name/description/topics, boosted by pins and recent use.

use std::collections::HashMap;

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use rusqlite::Connection;

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
    fn fts_follows_updates() {
        let db = Db::open_in_memory().unwrap();
        insert(&db, 1, "a1", "old words", "");
        db.write().execute("UPDATE repos SET description = 'fresh text' WHERE id = 1", []).unwrap();
        let r = db.read();
        assert_eq!(repos(&r, "fresh", 10, 0).unwrap(), vec![1]);
        assert!(repos(&r, "old words", 10, 0).unwrap().is_empty());
    }
}
