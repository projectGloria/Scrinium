//! Full repo-list sync via GraphQL, one transaction per page.

use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::db::repos::{self, Language, RepoRow};
use crate::db::{self, Db};
use crate::error::{Error, Result};
use crate::events::REPOS_CHANGED;
use crate::github::model::{parse_timestamp, ReposPage, RepoNode};
use crate::github::ReadApi;

/// GitHub's GraphQL API times out (502/504) on heavy pages: each repo also asks for topics,
/// languages and issue/PR counts. Start moderate and shrink on timeouts.
const PAGE_START: u32 = 40;
const PAGE_MIN: u32 = 10;
const MAX_ATTEMPTS: u32 = 5;

fn is_transient(e: &Error) -> bool {
    matches!(e, Error::Api { status: 500 | 502 | 503 | 504, .. })
        || matches!(e, Error::Http(err) if err.is_timeout() || err.is_connect())
}

/// Fetches one page, halving the page size and backing off on transient server errors.
/// The smaller size is kept for the rest of this sync.
async fn fetch_page(gh: &ReadApi, cursor: Option<&str>, first: &mut u32) -> Result<ReposPage> {
    let mut attempt = 0;
    loop {
        match gh.repos_page(cursor, *first).await {
            Ok(page) => return Ok(page),
            Err(e) if is_transient(&e) && attempt + 1 < MAX_ATTEMPTS => {
                attempt += 1;
                eprintln!("[sync] page of {first} failed ({e}); retrying smaller");
                *first = (*first / 2).max(PAGE_MIN);
                tokio::time::sleep(Duration::from_millis(500 * u64::from(attempt))).await;
            }
            Err(e) => return Err(e),
        }
    }
}

pub async fn run(app: &AppHandle, db: &Db, gh: &ReadApi) -> Result<()> {
    let started = db::now();
    let mut cursor: Option<String> = None;
    let mut first = PAGE_START;
    loop {
        let page = fetch_page(gh, cursor.as_deref(), &mut first).await?;
        let rows: Vec<RepoRow> = page.nodes.into_iter().flatten().filter_map(to_row).collect();
        let changed = repos::upsert_page(&mut db.write(), &rows, started)?;
        if changed {
            let _ = app.emit(REPOS_CHANGED, ());
        }
        if !page.page_info.has_next_page {
            break;
        }
        cursor = page.page_info.end_cursor;
        if cursor.is_none() {
            break;
        }
    }
    // Only after a complete pass is it safe to hide repos we didn't see.
    if repos::mark_gone(&db.write(), started)? > 0 {
        let _ = app.emit(REPOS_CHANGED, ());
    }
    Ok(())
}

fn to_row(n: RepoNode) -> Option<RepoRow> {
    let id = n.database_id?;
    let topics = n
        .repository_topics
        .nodes
        .into_iter()
        .flatten()
        .map(|t| t.topic.name)
        .collect::<Vec<_>>()
        .join(" ");
    let languages = n
        .languages
        .map(|c| {
            c.edges
                .into_iter()
                .flatten()
                .map(|e| Language { name: e.node.name, bytes: e.size, color: e.node.color })
                .collect()
        })
        .unwrap_or_default();
    Some(RepoRow {
        id,
        node_id: n.id,
        owner_is_org: n.owner.typename == "Organization",
        owner: n.owner.login,
        name: n.name,
        full_name: n.name_with_owner,
        description: n.description.filter(|d| !d.is_empty()),
        homepage: n.homepage_url.filter(|h| !h.is_empty()),
        topics,
        primary_language: n.primary_language.map(|l| l.name),
        is_private: n.is_private,
        is_fork: n.is_fork,
        is_archived: n.is_archived,
        default_tree_sha: n
            .default_branch_ref
            .as_ref()
            .and_then(|b| b.target.as_ref())
            .and_then(|t| t.tree.as_ref())
            .map(|t| t.oid.clone()),
        default_branch: n.default_branch_ref.map(|b| b.name),
        stars: n.stargazer_count,
        forks: n.fork_count,
        open_issues: n.issues.total_count,
        open_prs: n.pull_requests.total_count,
        pushed_at: n.pushed_at.as_deref().and_then(parse_timestamp),
        updated_at: n.updated_at.as_deref().and_then(parse_timestamp),
        clone_url: format!("{}.git", n.url),
        html_url: n.url,
        ssh_url: n.ssh_url,
        languages,
    })
}
