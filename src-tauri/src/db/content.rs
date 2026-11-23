//! Cached file content: blobs (by git SHA), ETags, README pointers and repo icons.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::Result;

/// Bodies above this are recorded as `truncated` and not stored.
pub const MAX_BLOB: usize = 5 << 20;
/// Total blob cache size before least-recently-used blobs are evicted.
const CACHE_CAP: i64 = 200 << 20;

pub struct Blob {
    pub mime: String,
    pub content: Option<Vec<u8>>,
}

pub fn has_blob(conn: &Connection, sha: &str) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM blobs WHERE sha = ?1 AND (content IS NOT NULL OR truncated = 1)", [sha], |_| Ok(()))
        .optional()?
        .is_some())
}

/// Stores a blob; `path` is only used to guess the MIME type.
pub fn put_blob(conn: &Connection, sha: &str, bytes: &[u8], path: &str, now: i64) -> Result<()> {
    let mime = sniff_mime(bytes, path);
    let is_binary = !mime.starts_with("text/") && mime != "image/svg+xml";
    let truncated = bytes.len() > MAX_BLOB;
    conn.execute(
        "INSERT INTO blobs (sha, size, mime, is_binary, truncated, content, fetched_at, last_access_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(sha) DO UPDATE SET last_access_at = excluded.last_access_at",
        params![sha, bytes.len() as i64, mime, is_binary, truncated, (!truncated).then_some(bytes), now],
    )?;
    Ok(())
}

pub fn get_blob(conn: &Connection, sha: &str) -> Result<Option<Blob>> {
    Ok(conn
        .query_row("SELECT mime, content FROM blobs WHERE sha = ?1", [sha], |r| {
            Ok(Blob { mime: r.get::<_, Option<String>>(0)?.unwrap_or_default(), content: r.get(1)? })
        })
        .optional()?)
}

pub fn blob_text(conn: &Connection, sha: &str) -> Result<Option<String>> {
    Ok(get_blob(conn, sha)?.and_then(|b| b.content).map(|c| String::from_utf8_lossy(&c).into_owned()))
}

/// Marks a blob as recently used (keeps it out of eviction).
pub fn touch_blob(conn: &Connection, sha: &str, now: i64) -> Result<()> {
    conn.execute("UPDATE blobs SET last_access_at = ?2 WHERE sha = ?1", params![sha, now])?;
    Ok(())
}

/// Drops least-recently-used blobs until the cache is under its cap. Blobs that are a repo's
/// current icon are kept.
pub fn evict(conn: &Connection) -> Result<usize> {
    let total: i64 = conn.query_row("SELECT COALESCE(SUM(LENGTH(content)), 0) FROM blobs", [], |r| r.get(0))?;
    if total <= CACHE_CAP {
        return Ok(0);
    }
    let mut stmt = conn.prepare(
        "SELECT sha, COALESCE(LENGTH(content), 0) FROM blobs
         WHERE sha NOT IN (SELECT blob_sha FROM repo_icons WHERE blob_sha IS NOT NULL)
         ORDER BY last_access_at",
    )?;
    let mut over = total - CACHE_CAP * 8 / 10;
    let mut victims = Vec::new();
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (sha, len) = row?;
        if over <= 0 {
            break;
        }
        over -= len;
        victims.push(sha);
    }
    for sha in &victims {
        conn.execute("DELETE FROM blobs WHERE sha = ?1", [sha])?;
    }
    Ok(victims.len())
}

// ── ETags ────────────────────────────────────────────────────────────────

pub struct CacheEntry {
    pub etag: Option<String>,
    pub blob_sha: Option<String>,
    pub fetched_at: i64,
}

pub fn cache_entry(conn: &Connection, url: &str) -> Result<Option<CacheEntry>> {
    Ok(conn
        .query_row("SELECT etag, blob_sha, fetched_at FROM http_cache WHERE url = ?1", [url], |r| {
            Ok(CacheEntry { etag: r.get(0)?, blob_sha: r.get(1)?, fetched_at: r.get(2)? })
        })
        .optional()?)
}

pub fn set_cache_entry(conn: &Connection, url: &str, etag: Option<&str>, blob_sha: Option<&str>, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO http_cache (url, etag, blob_sha, fetched_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, blob_sha = excluded.blob_sha,
                                        fetched_at = excluded.fetched_at",
        params![url, etag, blob_sha, now],
    )?;
    Ok(())
}

pub fn mark_cache_fresh(conn: &Connection, url: &str, now: i64) -> Result<()> {
    conn.execute("UPDATE http_cache SET fetched_at = ?2 WHERE url = ?1", params![url, now])?;
    Ok(())
}

// ── README ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readme {
    /// None: the repo has no README.
    pub path: Option<String>,
    pub sha: Option<String>,
    pub text: Option<String>,
    pub checked_at: i64,
}

pub fn readme(conn: &Connection, repo_id: i64) -> Result<Option<Readme>> {
    let row = conn
        .query_row(
            "SELECT path, blob_sha, checked_at FROM readmes WHERE repo_id = ?1 AND ref = ''",
            [repo_id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(2)?)),
        )
        .optional()?;
    let Some((path, sha, checked_at)) = row else { return Ok(None) };
    let text = match &sha {
        Some(s) => blob_text(conn, s)?,
        None => None,
    };
    // The pointer survived but the blob was evicted: treat as never fetched.
    if sha.is_some() && text.is_none() {
        return Ok(None);
    }
    Ok(Some(Readme { path, sha, text, checked_at }))
}

pub fn set_readme(conn: &Connection, repo_id: i64, path: Option<&str>, sha: Option<&str>, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO readmes (repo_id, ref, path, blob_sha, checked_at) VALUES (?1, '', ?2, ?3, ?4)
         ON CONFLICT(repo_id, ref) DO UPDATE SET path = excluded.path, blob_sha = excluded.blob_sha,
                                                 checked_at = excluded.checked_at",
        params![repo_id, path, sha, now],
    )?;
    Ok(())
}

pub fn touch_readme(conn: &Connection, repo_id: i64, now: i64) -> Result<()> {
    conn.execute("UPDATE readmes SET checked_at = ?2 WHERE repo_id = ?1 AND ref = ''", params![repo_id, now])?;
    Ok(())
}

// ── Icons ────────────────────────────────────────────────────────────────

pub struct IconTarget {
    pub repo_id: i64,
    pub owner: String,
    pub name: String,
    pub pushed_at: Option<i64>,
}

/// Repos whose icon hasn't been looked for since their last push, most recently pushed first.
pub fn icon_targets(conn: &Connection) -> Result<Vec<IconTarget>> {
    let mut stmt = conn.prepare(
        "SELECT r.id, r.owner, r.name, r.pushed_at FROM repos r
         LEFT JOIN repo_icons i ON i.repo_id = r.id
         WHERE r.gone = 0 AND r.default_branch IS NOT NULL
           AND (i.repo_id IS NULL OR i.checked_pushed_at IS NOT r.pushed_at)
         ORDER BY r.pushed_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(IconTarget { repo_id: r.get(0)?, owner: r.get(1)?, name: r.get(2)?, pushed_at: r.get(3)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Records the icon (or that there is none). Returns true if what the UI shows changed.
pub fn set_icon(
    conn: &Connection,
    repo_id: i64,
    path: Option<&str>,
    sha: Option<&str>,
    pushed_at: Option<i64>,
    now: i64,
) -> Result<bool> {
    let old: Option<Option<String>> = conn
        .query_row("SELECT blob_sha FROM repo_icons WHERE repo_id = ?1", [repo_id], |r| r.get(0))
        .optional()?;
    conn.execute(
        "INSERT INTO repo_icons (repo_id, path, blob_sha, checked_pushed_at, checked_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(repo_id) DO UPDATE SET path = excluded.path, blob_sha = excluded.blob_sha,
              checked_pushed_at = excluded.checked_pushed_at, checked_at = excluded.checked_at",
        params![repo_id, path, sha, pushed_at, now],
    )?;
    Ok(old.flatten().as_deref() != sha)
}

// ── MIME ─────────────────────────────────────────────────────────────────

pub fn sniff_mime(bytes: &[u8], path: &str) -> String {
    let magic: &[(&[u8], &str)] = &[
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"\x00\x00\x01\x00", "image/x-icon"),
        (b"BM", "image/bmp"),
    ];
    for (sig, mime) in magic {
        if bytes.starts_with(sig) {
            return (*mime).into();
        }
    }
    if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "image/webp".into();
    }
    let ext = path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let by_ext = match ext.as_str() {
        "svg" => Some("image/svg+xml"),
        "ico" => Some("image/x-icon"),
        "avif" => Some("image/avif"),
        "md" | "markdown" | "mdown" | "mkd" => Some("text/markdown"),
        _ => None,
    };
    if let Some(m) = by_ext {
        return m.into();
    }
    let head = &bytes[..bytes.len().min(8000)];
    if !head.contains(&0) && std::str::from_utf8(head).is_ok() {
        "text/plain".into()
    } else {
        "application/octet-stream".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn sniffs_common_types() {
        assert_eq!(sniff_mime(b"\x89PNG\r\n\x1a\n....", "x"), "image/png");
        assert_eq!(sniff_mime(b"<svg xmlns=...>", "logo.svg"), "image/svg+xml");
        assert_eq!(sniff_mime(b"# Title", "README.md"), "text/markdown");
        assert_eq!(sniff_mime(b"\x00\x01\x02", "x.bin"), "application/octet-stream");
    }

    #[test]
    fn readme_roundtrip_and_eviction_guard() {
        let db = Db::open_in_memory().unwrap();
        let w = db.write();
        w.execute_batch(
            "INSERT INTO repos (id, node_id, owner, name, full_name, owner_is_org, is_private, is_fork,
               is_archived, html_url, ssh_url, clone_url, synced_at)
             VALUES (1, 'R1', 'me', 'a', 'me/a', 0, 0, 0, 0, 'h', 's', 'c', 0);",
        )
        .unwrap();
        put_blob(&w, "abc", b"# Hello", "README.md", 10).unwrap();
        set_readme(&w, 1, Some("README.md"), Some("abc"), 10).unwrap();
        drop(w);
        let r = readme(&db.read(), 1).unwrap().unwrap();
        assert_eq!(r.text.as_deref(), Some("# Hello"));
        assert!(has_blob(&db.read(), "abc").unwrap());
    }
}
