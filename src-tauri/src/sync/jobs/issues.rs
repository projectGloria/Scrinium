//! Issues and pull requests (GraphQL). Lists sync incrementally: the first time, every open item
//! (capped) plus the most recently closed ones; afterwards only what was updated since the newest
//! item we hold. Comments and checks are fetched when a detail view opens.

use tauri::{AppHandle, Emitter};

use crate::db::issues::{self, Check, Comment, IssueDetail, IssueRow, Label};
use crate::db::{self, repos, state, Db};
use crate::error::{Error, Result};
use crate::events::ISSUES_CHANGED;
use crate::github::model::{parse_timestamp, IssueNode};
use crate::github::ReadApi;

const PAGE: u32 = 50;
/// First sync: at most this many pages of open items...
const OPEN_PAGES: usize = 10;
/// ...and of the most recently closed/merged ones (older ones stay a click away on GitHub).
const CLOSED_PAGES: usize = 2;
/// Incremental sync: stop after this many pages even if there is more.
const INCREMENTAL_PAGES: usize = 20;
/// Clock skew allowance when comparing against our newest `updated_at`.
const SKEW: i64 = 60;
/// Opening a list revalidates at most this often.
const LIST_TTL: i64 = 60;
/// Opening a detail view revalidates at most this often.
const DETAIL_TTL: i64 = 30;

pub fn state_key(repo_id: i64, is_pr: bool) -> String {
    format!("{}:{repo_id}", if is_pr { "prs" } else { "issues" })
}

/// Revalidates one list (when opened in the UI). Returns true if anything changed.
pub async fn refresh(db: &Db, gh: &ReadApi, repo_id: i64, is_pr: bool, force: bool) -> Result<bool> {
    let key = state_key(repo_id, is_pr);
    let last = state::sync_state(&db.read(), &key)?.last_success_at;
    if !force && last.is_some_and(|t| db::now() - t < LIST_TTL) {
        return Ok(false);
    }
    let loc = repos::locate(&db.read(), repo_id)?;
    match sync_list(db, gh, &loc.owner, &loc.name, repo_id, is_pr).await {
        Ok(changed) => {
            state::sync_success(&db.write(), &key, db::now())?;
            Ok(changed)
        }
        Err(e) => {
            let _ = state::sync_error(&db.write(), &key, &e.to_string());
            Err(e)
        }
    }
}

/// Background pass over every repo whose issues/PRs changed since we last looked.
pub async fn run(app: &AppHandle, db: &Db, gh: &ReadApi) -> Result<()> {
    let targets = issues::sync_targets(&db.read())?;
    for t in targets {
        match sync_list(db, gh, &t.owner, &t.name, t.repo_id, t.is_pr).await {
            Ok(changed) => {
                let _ = state::sync_success(&db.write(), &state_key(t.repo_id, t.is_pr), db::now());
                if changed {
                    let _ = app.emit(ISSUES_CHANGED, t.repo_id);
                }
            }
            Err(e @ (Error::RateLimited(_) | Error::Unauthorized | Error::NoToken)) => return Err(e),
            Err(e) => eprintln!("[issues] {}/{}: {e}", t.owner, t.name),
        }
    }
    Ok(())
}

async fn sync_list(db: &Db, gh: &ReadApi, owner: &str, name: &str, repo_id: i64, is_pr: bool) -> Result<bool> {
    let since = issues::local_latest(&db.read(), repo_id, is_pr)?;
    let page = |states, pages, stop| fetch(db, gh, owner, name, repo_id, is_pr, states, pages, stop);
    Ok(match since {
        None => {
            let closed: &[&str] = if is_pr { &["CLOSED", "MERGED"] } else { &["CLOSED"] };
            let a = page(Some(&["OPEN"][..]), OPEN_PAGES, None).await?;
            let b = page(Some(closed), CLOSED_PAGES, None).await?;
            a || b
        }
        Some(t) => page(None, INCREMENTAL_PAGES, Some(t - SKEW)).await?,
    })
}

/// Pages through items newest-updated first, stopping early once older than `stop_before`.
#[allow(clippy::too_many_arguments)]
async fn fetch(
    db: &Db,
    gh: &ReadApi,
    owner: &str,
    name: &str,
    repo_id: i64,
    is_pr: bool,
    states: Option<&[&str]>,
    max_pages: usize,
    stop_before: Option<i64>,
) -> Result<bool> {
    let mut cursor: Option<String> = None;
    let mut changed = false;
    for _ in 0..max_pages {
        let Some(conn) = gh.issues_page(owner, name, is_pr, states, PAGE, cursor.as_deref()).await? else {
            return Err(Error::Api { status: 404, message: "repository not found".into() });
        };
        let rows: Vec<IssueRow> = conn.nodes.into_iter().flatten().map(|n| to_row(n).0).collect();
        let done = stop_before.is_some_and(|t| rows.last().is_none_or(|r| r.updated_at < t));
        changed |= issues::upsert(&mut db.write(), repo_id, is_pr, &rows)?;
        if done || !conn.page_info.has_next_page {
            break;
        }
        cursor = conn.page_info.end_cursor;
        if cursor.is_none() {
            break;
        }
    }
    Ok(changed)
}

/// Revalidates one item with its comments and checks (when its detail view opens).
pub async fn refresh_detail(db: &Db, gh: &ReadApi, repo_id: i64, number: i64, force: bool) -> Result<Option<IssueDetail>> {
    let cached = issues::get(&db.read(), repo_id, number)?;
    if !force && cached.as_ref().and_then(|d| d.detail_at).is_some_and(|t| db::now() - t < DETAIL_TTL) {
        return Ok(cached);
    }
    let loc = repos::locate(&db.read(), repo_id)?;
    let Some(node) = gh.issue_detail(&loc.owner, &loc.name, number).await? else {
        return Ok(cached);
    };
    let is_pr = node.typename.as_deref() == Some("PullRequest");
    let comments: Vec<Comment> = node
        .comments
        .nodes
        .iter()
        .flatten()
        .map(|c| Comment {
            id: c.id.clone(),
            author: c.author.as_ref().map(|a| a.login.clone()),
            author_avatar: c.author.as_ref().and_then(|a| a.avatar_url.clone()),
            body: c.body.clone(),
            created_at: parse_timestamp(&c.created_at).unwrap_or(0),
        })
        .collect();
    let (row, checks) = to_row(node);
    issues::set_detail(&mut db.write(), repo_id, is_pr, &row, &comments, &checks, db::now())?;
    issues::get(&db.read(), repo_id, number)
}

/// Converts a GraphQL node; the check list is only filled by the detail query.
fn to_row(n: IssueNode) -> (IssueRow, Vec<Check>) {
    let rollup = n
        .commits
        .as_ref()
        .and_then(|c| c.nodes.iter().flatten().next())
        .and_then(|c| c.commit.status_check_rollup.as_ref());
    let checks: Vec<Check> = rollup
        .and_then(|r| r.contexts.as_ref())
        .map(|c| {
            c.nodes
                .iter()
                .flatten()
                .map(|x| match (&x.name, &x.context) {
                    // CheckRun
                    (Some(name), _) => Check {
                        name: name.clone(),
                        state: if x.status.as_deref() == Some("COMPLETED") {
                            x.conclusion.clone().unwrap_or_else(|| "NEUTRAL".into())
                        } else {
                            "PENDING".into()
                        },
                        url: x.details_url.clone(),
                    },
                    // StatusContext
                    (None, ctx) => Check {
                        name: ctx.clone().unwrap_or_default(),
                        state: x.state.clone().unwrap_or_else(|| "PENDING".into()),
                        url: x.target_url.clone(),
                    },
                })
                .collect()
        })
        .unwrap_or_default();
    let checks_state = rollup.map(|r| r.state.clone());
    let row = IssueRow {
        number: n.number,
        title: n.title,
        body: n.body.filter(|b| !b.trim().is_empty()),
        state: n.state,
        state_reason: n.state_reason,
        is_draft: n.is_draft,
        author: n.author.as_ref().map(|a| a.login.clone()),
        author_avatar: n.author.and_then(|a| a.avatar_url),
        comments_count: n.comments.total_count,
        labels: n
            .labels
            .map(|l| l.nodes.into_iter().flatten().map(|l| Label { name: l.name, color: l.color }).collect())
            .unwrap_or_default(),
        head_ref: n.head_ref_name,
        base_ref: n.base_ref_name,
        checks_state,
        html_url: n.url,
        created_at: parse_timestamp(&n.created_at).unwrap_or(0),
        updated_at: parse_timestamp(&n.updated_at).unwrap_or(0),
        closed_at: n.closed_at.as_deref().and_then(parse_timestamp),
        merged_at: n.merged_at.as_deref().and_then(parse_timestamp),
    };
    (row, checks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_pr_node_with_checks() {
        let json = r#"{
          "__typename": "PullRequest", "number": 7, "title": "Fix", "body": "", "state": "OPEN",
          "isDraft": true, "url": "u", "createdAt": "2024-01-01T00:00:00Z", "updatedAt": "2024-01-02T00:00:00Z",
          "closedAt": null, "mergedAt": null, "author": {"login": "me", "avatarUrl": "a"},
          "comments": {"totalCount": 3}, "labels": {"nodes": [{"name": "bug", "color": "f00"}]},
          "headRefName": "fix", "baseRefName": "main",
          "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": "FAILURE", "contexts": {"nodes": [
            {"__typename": "CheckRun", "name": "build", "status": "COMPLETED", "conclusion": "FAILURE", "detailsUrl": "d"},
            {"__typename": "CheckRun", "name": "lint", "status": "IN_PROGRESS", "conclusion": null, "detailsUrl": null},
            {"__typename": "StatusContext", "context": "ci/legacy", "state": "SUCCESS", "targetUrl": "t"}
          ]}}}}]}
        }"#;
        let node: IssueNode = serde_json::from_str(json).unwrap();
        assert_eq!(node.typename.as_deref(), Some("PullRequest"));
        let (row, checks) = to_row(node);
        assert!(row.is_draft);
        assert_eq!(row.body, None, "blank bodies are dropped");
        assert_eq!(row.comments_count, 3);
        assert_eq!(row.checks_state.as_deref(), Some("FAILURE"));
        let states: Vec<_> = checks.iter().map(|c| (c.name.as_str(), c.state.as_str())).collect();
        assert_eq!(states, vec![("build", "FAILURE"), ("lint", "PENDING"), ("ci/legacy", "SUCCESS")]);
    }

    #[test]
    fn maps_issue_list_node() {
        let json = r#"{"number": 1, "title": "Bug", "body": "x", "state": "CLOSED", "stateReason": "NOT_PLANNED",
          "url": "u", "createdAt": "2024-01-01T00:00:00Z", "updatedAt": "2024-01-01T00:00:00Z",
          "closedAt": "2024-01-01T00:00:00Z", "author": null, "comments": {"totalCount": 0}, "labels": {"nodes": []}}"#;
        let (row, checks) = to_row(serde_json::from_str(json).unwrap());
        assert_eq!(row.state_reason.as_deref(), Some("NOT_PLANNED"));
        assert!(row.author.is_none() && checks.is_empty() && row.checks_state.is_none());
    }
}
