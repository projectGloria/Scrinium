//! README and README-linked files, revalidated on demand with ETags (304s are free).

use crate::db::{self, content, repos, Db};
use crate::error::{Error, Result};
use crate::github::model::ContentFile;
use crate::github::{decode_content, Cached, ReadApi};

/// Don't revalidate the same README more often than this.
const README_TTL: i64 = 30;
/// README images rarely change; revalidate at most hourly.
const ASSET_TTL: i64 = 3600;

/// Revalidates the README of the default branch and returns what's now cached.
pub async fn refresh(db: &Db, gh: &ReadApi, repo_id: i64) -> Result<Option<content::Readme>> {
    let loc = repos::locate(&db.read(), repo_id)?;
    let url = ReadApi::readme_path(&loc.owner, &loc.name);
    let cached = content::readme(&db.read(), repo_id)?;
    let entry = content::cache_entry(&db.read(), &url)?;
    if let (Some(c), Some(e)) = (&cached, &entry) {
        if db::now() - e.fetched_at.max(c.checked_at) < README_TTL {
            return Ok(cached);
        }
    }
    // Only send the ETag when we still hold the body it describes.
    let etag = cached.as_ref().and(entry.as_ref()).and_then(|e| e.etag.as_deref());
    match gh.get_cached::<ContentFile>(&url, etag).await {
        Ok(Cached::NotModified) => {
            let w = db.write();
            content::mark_cache_fresh(&w, &url, db::now())?;
            content::touch_readme(&w, repo_id, db::now())?;
        }
        Ok(Cached::Fresh { etag, value }) => {
            store_file(db, gh, &loc.owner, &loc.name, &value).await?;
            let w = db.write();
            content::set_readme(&w, repo_id, Some(&value.path), Some(&value.sha), db::now())?;
            content::set_cache_entry(&w, &url, etag.as_deref(), Some(&value.sha), db::now())?;
        }
        Err(Error::Api { status: 404, .. }) => {
            let w = db.write();
            content::set_readme(&w, repo_id, None, None, db::now())?;
            content::set_cache_entry(&w, &url, None, None, db::now())?;
        }
        Err(e) => return Err(e),
    }
    content::readme(&db.read(), repo_id)
}

/// A file from the default branch (a README image), as a cached blob SHA. None if it doesn't
/// exist or is a directory.
pub async fn asset(db: &Db, gh: &ReadApi, repo_id: i64, path: &str) -> Result<Option<String>> {
    let path = path.trim_start_matches("./").trim_start_matches('/');
    if path.is_empty() || path.split('/').any(|s| s == "..") {
        return Ok(None);
    }
    let loc = repos::locate(&db.read(), repo_id)?;
    let url = ReadApi::contents_path(&loc.owner, &loc.name, path);
    let entry = content::cache_entry(&db.read(), &url)?;
    let held = match entry.as_ref().and_then(|e| e.blob_sha.clone()) {
        Some(sha) if content::has_blob(&db.read(), &sha)? => Some(sha),
        _ => None,
    };
    if let (Some(sha), Some(e)) = (&held, &entry) {
        if db::now() - e.fetched_at < ASSET_TTL {
            content::touch_blob(&db.write(), sha, db::now())?;
            return Ok(held);
        }
    }
    let etag = held.as_ref().and(entry.as_ref()).and_then(|e| e.etag.as_deref());
    match gh.get_cached::<ContentFile>(&url, etag).await {
        Ok(Cached::NotModified) => {
            content::mark_cache_fresh(&db.write(), &url, db::now())?;
            Ok(held)
        }
        Ok(Cached::Fresh { etag, value }) => {
            store_file(db, gh, &loc.owner, &loc.name, &value).await?;
            content::set_cache_entry(&db.write(), &url, etag.as_deref(), Some(&value.sha), db::now())?;
            Ok(Some(value.sha))
        }
        // 404, or a directory listing that doesn't parse as a file.
        Err(Error::Api { status: 404, .. }) | Err(Error::Other(_)) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Makes sure the file's blob is cached (bodies over 1 MB come via the git blobs API).
async fn store_file(db: &Db, gh: &ReadApi, owner: &str, name: &str, f: &ContentFile) -> Result<()> {
    if content::has_blob(&db.read(), &f.sha)? {
        content::touch_blob(&db.write(), &f.sha, db::now())?;
        return Ok(());
    }
    let bytes = if f.is_omitted() {
        gh.git_blob(owner, name, &f.sha).await?
    } else {
        decode_content(&f.content, &f.encoding)?
    };
    content::put_blob(&db.write(), &f.sha, &bytes, &f.path, db::now())
}
