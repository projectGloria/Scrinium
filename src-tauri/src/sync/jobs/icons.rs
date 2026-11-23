//! Finds each repo's own icon/logo image and caches it as a blob.
//!
//! One GraphQL request per repo lists the usual icon directories; the best-scoring image is
//! fetched once by SHA. Repos are only re-checked after a push.

use tauri::{AppHandle, Emitter};

use crate::db::{self, content, Db};
use crate::error::{Error, Result};
use crate::events::REPOS_CHANGED;
use crate::github::model::TreeObj;
use crate::github::ReadApi;

const MIN_BYTES: i64 = 64;
const MAX_BYTES: i64 = 512 * 1024;
/// Notify the UI after this many icons changed, so icons trickle in without a re-render per repo.
const EMIT_EVERY: usize = 6;

pub async fn run(app: &AppHandle, db: &Db, gh: &ReadApi) -> Result<()> {
    let targets = content::icon_targets(&db.read())?;
    let mut pending = 0;
    let mut result = Ok(());
    for t in targets {
        match one(db, gh, &t).await {
            Ok(true) => {
                pending += 1;
                if pending >= EMIT_EVERY {
                    let _ = app.emit(REPOS_CHANGED, ());
                    pending = 0;
                }
            }
            Ok(false) => {}
            Err(e @ (Error::RateLimited(_) | Error::Unauthorized | Error::NoToken)) => {
                result = Err(e);
                break;
            }
            // Retried on the next sync; one broken repo must not stop the rest.
            Err(e) => eprintln!("[icons] {}/{}: {e}", t.owner, t.name),
        }
    }
    if pending > 0 {
        let _ = app.emit(REPOS_CHANGED, ());
    }
    let _ = content::evict(&db.write());
    result
}

async fn one(db: &Db, gh: &ReadApi, t: &content::IconTarget) -> Result<bool> {
    let dirs = gh.repo_dirs(&t.owner, &t.name).await?;
    let Some(pick) = pick_icon(&t.name, &dirs) else {
        return content::set_icon(&db.write(), t.repo_id, None, None, t.pushed_at, db::now());
    };
    if !content::has_blob(&db.read(), &pick.sha)? {
        let bytes = gh.git_blob(&t.owner, &t.name, &pick.sha).await?;
        content::put_blob(&db.write(), &pick.sha, &bytes, &pick.path, db::now())?;
    }
    content::set_icon(&db.write(), t.repo_id, Some(&pick.path), Some(&pick.sha), t.pushed_at, db::now())
}

#[derive(Debug, PartialEq)]
pub struct Pick {
    pub path: String,
    pub sha: String,
}

/// Chooses the image that most likely is the repo's icon, or None.
/// `dirs` are (alias from `repo_dirs.graphql`, listing) pairs.
pub fn pick_icon(repo_name: &str, dirs: &[(String, TreeObj)]) -> Option<Pick> {
    let repo = repo_name.to_ascii_lowercase();
    let mut best: Option<(i32, Pick)> = None;
    for (alias, tree) in dirs {
        let icon_dir = matches!(alias.as_str(), "icons" | "tauri" | "android");
        for e in &tree.entries {
            if e.kind != "blob" {
                continue;
            }
            let size = e.object.as_ref().and_then(|o| o.byte_size).unwrap_or(0);
            if !(MIN_BYTES..=MAX_BYTES).contains(&size) {
                continue;
            }
            let Some(score) = score(&e.name, &repo, icon_dir) else { continue };
            let score = score + dir_bonus(alias);
            if best.as_ref().map_or(true, |(s, _)| score > *s) {
                let path = e.path.clone().unwrap_or_else(|| e.name.clone());
                best = Some((score, Pick { path, sha: e.oid.clone() }));
            }
        }
    }
    best.map(|(_, p)| p)
}

fn ext_score(ext: &str) -> Option<i32> {
    Some(match ext {
        "svg" => 40,
        "png" => 36,
        "ico" => 34,
        "webp" => 30,
        "jpg" | "jpeg" => 15,
        "gif" => 10,
        _ => return None,
    })
}

fn score(file: &str, repo: &str, icon_dir: bool) -> Option<i32> {
    let lower = file.to_ascii_lowercase();
    let (stem, ext) = lower.rsplit_once('.')?;
    let ext = ext_score(ext)?;
    const SKIP: &[&str] = &["screenshot", "banner", "preview", "demo", "social", "og-", "cover"];
    if SKIP.iter().any(|s| stem.contains(s)) {
        return None;
    }
    const EXACT: &[&str] =
        &["icon", "app-icon", "app_icon", "appicon", "logo", "favicon", "app-logo", "brand"];
    let name = if EXACT.contains(&stem) || stem == repo {
        100
    } else if stem == "128x128@2x"
        || stem.starts_with("apple-touch-icon")
        || stem.starts_with("android-chrome-")
        || stem == "ic_launcher"
    {
        80
    } else if stem.contains("icon") || stem.contains("logo") || stem.contains("favicon") {
        60
    } else if is_sized(stem) {
        50
    } else if icon_dir {
        40
    } else {
        return None;
    };
    Some(name + ext)
}

/// `32x32`, `128x128@2x`.
fn is_sized(stem: &str) -> bool {
    let base = stem.split('@').next().unwrap_or(stem);
    match base.split_once('x') {
        Some((a, b)) => !a.is_empty() && !b.is_empty() && a.chars().all(|c| c.is_ascii_digit()) && b.chars().all(|c| c.is_ascii_digit()),
        None => false,
    }
}

fn dir_bonus(alias: &str) -> i32 {
    match alias {
        "root" => 12,
        "dotgithub" => 10,
        "public" => 8,
        "assets" => 6,
        "tauri" => 6,
        _ => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::model::{BlobInfo, TreeEntry};

    fn tree(files: &[(&str, i64)], dir: &str) -> TreeObj {
        TreeObj {
            entries: files
                .iter()
                .map(|(n, size)| TreeEntry {
                    name: (*n).into(),
                    path: Some(if dir.is_empty() { (*n).into() } else { format!("{dir}/{n}") }),
                    kind: "blob".into(),
                    oid: format!("sha-{n}"),
                    object: Some(BlobInfo { byte_size: Some(*size), text: None }),
                })
                .collect(),
        }
    }

    #[test]
    fn prefers_named_logo_at_root() {
        let dirs = vec![
            ("root".to_string(), tree(&[("README.md", 900), ("logo.png", 4000), ("screenshot.png", 9000)], "")),
            ("assets".to_string(), tree(&[("banner.png", 5000), ("icon.png", 3000)], "assets")),
        ];
        assert_eq!(pick_icon("x", &dirs).unwrap().path, "logo.png");
    }

    #[test]
    fn picks_tauri_icon_and_prefers_png_over_ico() {
        let dirs = vec![(
            "tauri".to_string(),
            tree(&[("32x32.png", 900), ("128x128@2x.png", 9000), ("icon.ico", 30000), ("icon.png", 40000)], "src-tauri/icons"),
        )];
        assert_eq!(pick_icon("x", &dirs).unwrap().path, "src-tauri/icons/icon.png");
    }

    #[test]
    fn repo_name_matches_and_size_limits_apply() {
        let dirs = vec![(
            "public".to_string(),
            tree(&[("myapp.svg", 2000), ("favicon.ico", 10), ("logo.png", 10_000_000)], "public"),
        )];
        assert_eq!(pick_icon("MyApp", &dirs).unwrap().path, "public/myapp.svg");
    }

    #[test]
    fn ignores_unrelated_images() {
        let dirs = vec![("docs".to_string(), tree(&[("diagram.png", 5000), ("photo.jpg", 5000)], "docs"))];
        assert_eq!(pick_icon("x", &dirs), None);
    }
}
