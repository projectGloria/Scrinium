//! Branches/tags (GraphQL, short TTL), git trees (REST, fetched once per SHA), file blobs
//! (fetched once per SHA) and the background file-path index for the palette.

use serde::Serialize;
use tauri::AppHandle;

use crate::db::{self, content, files, repos, Db};
use crate::error::{Error, Result};
use crate::github::model::{parse_timestamp, CommitTarget, RefConnection};
use crate::github::ReadApi;

/// Don't re-list branches and tags more often than this.
const REFS_TTL: i64 = 60;

/// Revalidates branches/tags if the cached list is older than `REFS_TTL` (or `force`).
pub async fn refresh_refs(db: &Db, gh: &ReadApi, repo_id: i64, force: bool) -> Result<files::RefList> {
    let checked = files::refs_checked_at(&db.read(), repo_id)?;
    if !force && checked.is_some_and(|t| db::now() - t < REFS_TTL) {
        return files::refs(&db.read(), repo_id);
    }
    let loc = repos::locate(&db.read(), repo_id)?;
    let Some(data) = gh.repo_refs(&loc.owner, &loc.name).await? else {
        return Err(Error::Api { status: 404, message: "repository not found".into() });
    };
    let (branches, tags) = (to_refs(&data.branches), to_refs(&data.tags));
    files::set_refs(
        &db.write(),
        repo_id,
        &branches,
        &tags,
        (data.branches.total_count, data.tags.total_count),
        db::now(),
    )?;
    files::refs(&db.read(), repo_id)
}

fn to_refs(conn: &RefConnection) -> Vec<files::GitRef> {
    conn.nodes
        .iter()
        .flatten()
        .map(|n| {
            // An annotated tag points at a Tag object; its own target is the commit.
            let c: Option<&CommitTarget> = n.target.as_ref().map(|t| match &t.target {
                Some(inner) if t.tree.is_none() => inner.as_ref(),
                _ => t,
            });
            files::GitRef {
                name: n.name.clone(),
                commit_sha: c.and_then(|c| c.oid.clone()),
                tree_sha: c.and_then(|c| c.tree.as_ref()).map(|t| t.oid.clone()),
                committed_at: c.and_then(|c| c.committed_date.as_deref()).and_then(parse_timestamp),
            }
        })
        .collect()
}

/// Makes sure a tree is cached. Trees are immutable: a cached one is never re-fetched.
pub async fn ensure_tree(db: &Db, gh: &ReadApi, repo_id: i64, tree_sha: &str) -> Result<files::TreeInfo> {
    if let Some(info) = files::tree_info(&db.write(), tree_sha, db::now())? {
        return Ok(info);
    }
    let loc = repos::locate(&db.read(), repo_id)?;
    let t = gh.git_tree(&loc.owner, &loc.name, tree_sha).await?;
    let items: Vec<files::TreeItem> = t
        .tree
        .iter()
        .map(|i| files::TreeItem {
            path: &i.path,
            kind: &i.kind,
            sha: &i.sha,
            size: i.size,
            mode: i.mode.as_deref(),
        })
        .collect();
    files::put_tree(&db.write(), tree_sha, t.truncated, &items, db::now())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    /// text / image / binary / large
    pub kind: &'static str,
    pub text: Option<String>,
    pub mime: String,
    pub size: i64,
}

/// A file's content by blob SHA, fetched once and then served from SQLite.
pub async fn file(db: &Db, gh: &ReadApi, repo_id: i64, sha: &str, path: &str, size: Option<i64>) -> Result<FileContent> {
    let size = size.unwrap_or(0);
    if size as usize > content::MAX_BLOB {
        return Ok(FileContent { kind: "large", text: None, mime: String::new(), size });
    }
    if !content::has_blob(&db.read(), sha)? {
        let loc = repos::locate(&db.read(), repo_id)?;
        let bytes = gh.git_blob(&loc.owner, &loc.name, sha).await?;
        content::put_blob(&db.write(), sha, &bytes, path, db::now())?;
    } else {
        content::touch_blob(&db.write(), sha, db::now())?;
    }
    let Some(blob) = content::get_blob(&db.read(), sha)? else {
        return Err(Error::Other("blob vanished from the cache".into()));
    };
    let Some(bytes) = blob.content else {
        return Ok(FileContent { kind: "large", text: None, mime: blob.mime, size });
    };
    let size = bytes.len() as i64;
    let kind = if blob.mime.starts_with("image/") {
        "image"
    } else if blob.mime.starts_with("text/") {
        "text"
    } else {
        "binary"
    };
    let text = (kind == "text" || blob.mime == "image/svg+xml").then(|| String::from_utf8_lossy(&bytes).into_owned());
    Ok(FileContent { kind, text, mime: blob.mime, size })
}

/// Indexes the default-branch file paths of every repo whose tree changed (palette search).
pub async fn index(_app: &AppHandle, db: &Db, gh: &ReadApi) -> Result<()> {
    let mut result = Ok(());
    let targets = files::index_targets(&db.read())?;
    for t in targets {
        let step = async {
            ensure_tree(db, gh, t.repo_id, &t.tree_sha).await?;
            files::index_files(&db.write(), t.repo_id, &t.tree_sha, db::now())
        };
        match step.await {
            Ok(_) => {}
            Err(e @ (Error::RateLimited(_) | Error::Unauthorized | Error::NoToken)) => {
                result = Err(e);
                break;
            }
            // Empty repos (409) and the like: try again after the next push.
            Err(e) => eprintln!("[files] {}/{}: {e}", t.owner, t.name),
        }
    }
    let _ = files::gc_trees(&db.write(), db::now());
    result
}
