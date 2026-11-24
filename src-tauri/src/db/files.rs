//! Branches/tags, git trees and the file-path index used by the palette.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::Result;

/// Trees nothing points at any more are dropped after this long without being opened.
const TREE_GC_SECS: i64 = 7 * 86_400;
/// Paths indexed per repo (the palette only needs the well-known part of huge repos).
pub const INDEX_CAP: i64 = 50_000;
/// `files_fts` rowids are `repo_id << ROW_BITS | n`, so one repo's rows are one rowid range.
const ROW_BITS: i64 = 20;

// ── Refs ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    pub name: String,
    pub commit_sha: Option<String>,
    pub tree_sha: Option<String>,
    pub committed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefList {
    pub branches: Vec<GitRef>,
    pub tags: Vec<GitRef>,
    pub branches_total: i64,
    pub tags_total: i64,
    /// None: never fetched (only the default branch is known, from the repo sync).
    pub checked_at: Option<i64>,
    pub default_branch: Option<String>,
    pub default_tree_sha: Option<String>,
}

pub fn refs(conn: &Connection, repo_id: i64) -> Result<RefList> {
    let (default_branch, default_tree_sha): (Option<String>, Option<String>) = conn
        .query_row("SELECT default_branch, default_tree_sha FROM repos WHERE id = ?1", [repo_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?
        .unwrap_or((None, None));
    let head: Option<(i64, i64, i64)> = conn
        .query_row(
            "SELECT branches_total, tags_total, checked_at FROM ref_lists WHERE repo_id = ?1",
            [repo_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let mut stmt = conn.prepare_cached(
        "SELECT kind, name, commit_sha, tree_sha, committed_at FROM refs WHERE repo_id = ?1 ORDER BY ord",
    )?;
    let (mut branches, mut tags) = (Vec::new(), Vec::new());
    let rows = stmt.query_map([repo_id], |r| {
        Ok((
            r.get::<_, String>(0)?,
            GitRef { name: r.get(1)?, commit_sha: r.get(2)?, tree_sha: r.get(3)?, committed_at: r.get(4)? },
        ))
    })?;
    for row in rows {
        let (kind, g) = row?;
        if kind == "tag" { tags.push(g) } else { branches.push(g) }
    }
    Ok(RefList {
        branches,
        tags,
        branches_total: head.map_or(0, |h| h.0),
        tags_total: head.map_or(0, |h| h.1),
        checked_at: head.map(|h| h.2),
        default_branch,
        default_tree_sha,
    })
}

pub fn refs_checked_at(conn: &Connection, repo_id: i64) -> Result<Option<i64>> {
    Ok(conn
        .query_row("SELECT checked_at FROM ref_lists WHERE repo_id = ?1", [repo_id], |r| r.get(0))
        .optional()?)
}

/// Replaces the stored refs of a repo. Also moves `default_tree_sha` if the default branch moved.
pub fn set_refs(
    conn: &Connection,
    repo_id: i64,
    branches: &[GitRef],
    tags: &[GitRef],
    totals: (i64, i64),
    now: i64,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM refs WHERE repo_id = ?1", [repo_id])?;
    {
        let mut ins = tx.prepare_cached(
            "INSERT OR IGNORE INTO refs (repo_id, kind, name, ord, commit_sha, tree_sha, committed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for (kind, list) in [("branch", branches), ("tag", tags)] {
            for (i, g) in list.iter().enumerate() {
                ins.execute(params![repo_id, kind, g.name, i as i64, g.commit_sha, g.tree_sha, g.committed_at])?;
            }
        }
    }
    tx.execute(
        "INSERT INTO ref_lists (repo_id, branches_total, tags_total, checked_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(repo_id) DO UPDATE SET branches_total = excluded.branches_total,
              tags_total = excluded.tags_total, checked_at = excluded.checked_at",
        params![repo_id, totals.0, totals.1, now],
    )?;
    tx.execute(
        "UPDATE repos SET default_tree_sha = (
           SELECT tree_sha FROM refs WHERE repo_id = ?1 AND kind = 'branch' AND name = repos.default_branch)
         WHERE id = ?1 AND EXISTS (
           SELECT 1 FROM refs WHERE repo_id = ?1 AND kind = 'branch' AND name = repos.default_branch
             AND tree_sha IS NOT NULL)",
        [repo_id],
    )?;
    tx.commit()?;
    Ok(())
}

// ── Trees ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeInfo {
    pub truncated: bool,
    pub entries: i64,
}

/// One item of a recursive tree listing, as stored.
pub struct TreeItem<'a> {
    pub path: &'a str,
    pub kind: &'a str,
    pub sha: &'a str,
    pub size: Option<i64>,
    pub mode: Option<&'a str>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    /// blob / tree / commit (submodule)
    pub kind: String,
    pub sha: String,
    pub size: Option<i64>,
}

/// The tree if cached (and marks it as recently used).
pub fn tree_info(conn: &Connection, sha: &str, now: i64) -> Result<Option<TreeInfo>> {
    let info = conn
        .query_row("SELECT truncated, entries FROM trees WHERE sha = ?1", [sha], |r| {
            Ok(TreeInfo { truncated: r.get(0)?, entries: r.get(1)? })
        })
        .optional()?;
    if info.is_some() {
        conn.execute("UPDATE trees SET last_access_at = ?2 WHERE sha = ?1 AND last_access_at < ?2 - 3600", params![sha, now])?;
    }
    Ok(info)
}

pub fn put_tree(conn: &Connection, sha: &str, truncated: bool, items: &[TreeItem], now: i64) -> Result<TreeInfo> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM trees WHERE sha = ?1", [sha])?;
    tx.execute(
        "INSERT INTO trees (sha, truncated, entries, fetched_at, last_access_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![sha, truncated, items.len() as i64, now],
    )?;
    {
        let mut ins = tx.prepare_cached(
            "INSERT OR IGNORE INTO tree_entries (tree_sha, dir, name, kind, sha, size, mode)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for it in items {
            let (dir, name) = it.path.rsplit_once('/').unwrap_or(("", it.path));
            ins.execute(params![sha, dir, name, it.kind, it.sha, it.size, it.mode])?;
        }
    }
    tx.commit()?;
    Ok(TreeInfo { truncated, entries: items.len() as i64 })
}

fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") }
}

/// Children of a directory: folders first, then files, each case-insensitively by name.
pub fn list_dir(conn: &Connection, tree_sha: &str, dir: &str) -> Result<Vec<Entry>> {
    let mut stmt = conn.prepare_cached("SELECT name, kind, sha, size FROM tree_entries WHERE tree_sha = ?1 AND dir = ?2")?;
    let mut out: Vec<Entry> = stmt
        .query_map(params![tree_sha, dir], |r| {
            let name: String = r.get(0)?;
            Ok(Entry { path: join(dir, &name), name, kind: r.get(1)?, sha: r.get(2)?, size: r.get(3)? })
        })?
        .collect::<rusqlite::Result<_>>()?;
    out.sort_by_cached_key(|e| (e.kind != "tree", e.name.to_lowercase(), e.name.clone()));
    Ok(out)
}

pub fn lookup(conn: &Connection, tree_sha: &str, path: &str) -> Result<Option<Entry>> {
    let path = path.trim_matches('/');
    let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
    Ok(conn
        .query_row(
            "SELECT kind, sha, size FROM tree_entries WHERE tree_sha = ?1 AND dir = ?2 AND name = ?3",
            params![tree_sha, dir, name],
            |r| {
                Ok(Entry { name: name.into(), path: path.into(), kind: r.get(0)?, sha: r.get(1)?, size: r.get(2)? })
            },
        )
        .optional()?)
}

/// Drops trees that are neither a repo's current default tree nor opened in the last week.
pub fn gc_trees(conn: &Connection, now: i64) -> Result<usize> {
    Ok(conn.execute(
        "DELETE FROM trees WHERE last_access_at < ?1
           AND sha NOT IN (SELECT default_tree_sha FROM repos WHERE default_tree_sha IS NOT NULL)",
        [now - TREE_GC_SECS],
    )?)
}

// ── File index ───────────────────────────────────────────────────────────

pub struct IndexTarget {
    pub repo_id: i64,
    pub owner: String,
    pub name: String,
    pub tree_sha: String,
}

/// Repos whose default-branch tree isn't the one indexed. Forks are skipped unless their tree
/// is already cached (they were opened), so mirrors of big projects don't cost a request each.
pub fn index_targets(conn: &Connection) -> Result<Vec<IndexTarget>> {
    let mut stmt = conn.prepare(
        "SELECT r.id, r.owner, r.name, r.default_tree_sha FROM repos r
         LEFT JOIN files_indexed f ON f.repo_id = r.id
         WHERE r.gone = 0 AND r.default_tree_sha IS NOT NULL
           AND f.tree_sha IS NOT r.default_tree_sha
           AND (r.is_fork = 0 OR EXISTS (SELECT 1 FROM trees t WHERE t.sha = r.default_tree_sha))
         ORDER BY r.pushed_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(IndexTarget { repo_id: r.get(0)?, owner: r.get(1)?, name: r.get(2)?, tree_sha: r.get(3)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Replaces a repo's indexed paths with the files of `tree_sha` (which must be cached).
pub fn index_files(conn: &Connection, repo_id: i64, tree_sha: &str, now: i64) -> Result<usize> {
    let lo = repo_id << ROW_BITS;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM files_fts WHERE rowid BETWEEN ?1 AND ?2", params![lo, lo | ((1 << ROW_BITS) - 1)])?;
    let n = tx.execute(
        "INSERT INTO files_fts (rowid, path)
         SELECT ?1 + ROW_NUMBER() OVER (ORDER BY dir, name),
                CASE dir WHEN '' THEN name ELSE dir || '/' || name END
         FROM (SELECT dir, name FROM tree_entries WHERE tree_sha = ?2 AND kind = 'blob'
               ORDER BY length(dir), dir, name LIMIT ?3)",
        params![lo, tree_sha, INDEX_CAP],
    )?;
    tx.execute(
        "INSERT INTO files_indexed (repo_id, tree_sha, indexed_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(repo_id) DO UPDATE SET tree_sha = excluded.tree_sha, indexed_at = excluded.indexed_at",
        params![repo_id, tree_sha, now],
    )?;
    tx.commit()?;
    Ok(n)
}

pub fn repo_of_row(rowid: i64) -> i64 {
    rowid >> ROW_BITS
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn repo(db: &Db, id: i64) {
        db.write()
            .execute(
                "INSERT INTO repos (id, node_id, owner, name, full_name, owner_is_org, is_private, is_fork,
                   is_archived, html_url, ssh_url, clone_url, synced_at, default_branch, default_tree_sha)
                 VALUES (?1, 'N' || ?1, 'me', 'r' || ?1, 'me/r' || ?1, 0, 0, 0, 0, 'h', 's', 'c', 0, 'main', 't1')",
                [id],
            )
            .unwrap();
    }

    fn item<'a>(path: &'a str, kind: &'a str) -> TreeItem<'a> {
        TreeItem { path, kind, sha: path, size: Some(1), mode: None }
    }

    #[test]
    fn lists_dirs_first_and_looks_up() {
        let db = Db::open_in_memory().unwrap();
        let items = [
            item("b.txt", "blob"),
            item("src", "tree"),
            item("src/main.rs", "blob"),
            item("A.md", "blob"),
            item("docs", "tree"),
            item("src/lib", "tree"),
            item("src/lib/x.rs", "blob"),
        ];
        put_tree(&db.write(), "t1", false, &items, 0).unwrap();
        let r = db.read();
        let root: Vec<String> = list_dir(&r, "t1", "").unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(root, ["docs", "src", "A.md", "b.txt"]);
        let src = list_dir(&r, "t1", "src").unwrap();
        assert_eq!(src[0].path, "src/lib");
        assert_eq!(src[1].path, "src/main.rs");
        assert_eq!(lookup(&r, "t1", "src/lib/x.rs").unwrap().unwrap().kind, "blob");
        assert!(lookup(&r, "t1", "nope").unwrap().is_none());
        assert_eq!(tree_info(&r, "t1", 0).unwrap().unwrap().entries, 7);
    }

    #[test]
    fn indexes_and_reindexes_paths() {
        let db = Db::open_in_memory().unwrap();
        repo(&db, 7);
        repo(&db, 8);
        put_tree(&db.write(), "t1", false, &[item("src", "tree"), item("src/palette.rs", "blob"), item("README.md", "blob")], 0)
            .unwrap();
        put_tree(&db.write(), "t2", false, &[item("other.rs", "blob")], 0).unwrap();
        assert_eq!(index_targets(&db.read()).unwrap().len(), 2);
        assert_eq!(index_files(&db.write(), 7, "t1", 1).unwrap(), 2);
        assert_eq!(index_files(&db.write(), 8, "t1", 1).unwrap(), 2);
        assert!(index_targets(&db.read()).unwrap().is_empty());
        // Reindexing repo 7 replaces only its rows.
        assert_eq!(index_files(&db.write(), 7, "t2", 2).unwrap(), 1);
        let r = db.read();
        let mut stmt = r.prepare("SELECT rowid, path FROM files_fts WHERE files_fts MATCH '\"palette\"'").unwrap();
        let hits: Vec<(i64, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(hits.len(), 1);
        assert_eq!(repo_of_row(hits[0].0), 8);
        assert_eq!(hits[0].1, "src/palette.rs");
    }

    #[test]
    fn refs_roundtrip_moves_default_tree() {
        let db = Db::open_in_memory().unwrap();
        repo(&db, 1);
        let g = |n: &str, t: &str| GitRef { name: n.into(), commit_sha: Some("c".into()), tree_sha: Some(t.into()), committed_at: Some(5) };
        set_refs(&db.write(), 1, &[g("dev", "td"), g("main", "t9")], &[g("v1", "tv")], (2, 1), 100).unwrap();
        let l = refs(&db.read(), 1).unwrap();
        assert_eq!(l.branches.len(), 2);
        assert_eq!(l.tags[0].name, "v1");
        assert_eq!(l.checked_at, Some(100));
        assert_eq!(l.default_tree_sha.as_deref(), Some("t9"));
    }

    #[test]
    fn gc_keeps_default_trees() {
        let db = Db::open_in_memory().unwrap();
        repo(&db, 1);
        put_tree(&db.write(), "t1", false, &[item("a", "blob")], 0).unwrap();
        put_tree(&db.write(), "old", false, &[item("a", "blob")], 0).unwrap();
        assert_eq!(gc_trees(&db.write(), TREE_GC_SECS * 2).unwrap(), 1);
        let n: i64 = db.read().query_row("SELECT COUNT(*) FROM tree_entries", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }
}
