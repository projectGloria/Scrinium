//! Account row, key/value prefs and per-job sync bookkeeping.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::Result;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub login: String,
    pub user_id: i64,
    pub avatar_url: Option<String>,
    pub auth_kind: String,
    pub scopes: Option<String>,
}

pub fn account(conn: &Connection) -> Result<Option<Account>> {
    Ok(conn
        .query_row(
            "SELECT login, user_id, avatar_url, auth_kind, scopes FROM account WHERE id = 1",
            [],
            |r| {
                Ok(Account {
                    login: r.get(0)?,
                    user_id: r.get(1)?,
                    avatar_url: r.get(2)?,
                    auth_kind: r.get(3)?,
                    scopes: r.get(4)?,
                })
            },
        )
        .optional()?)
}

/// Saves the signed-in account. If a different user signs in, the old user's cache is wiped first.
pub fn set_account(conn: &mut Connection, a: &Account, at: i64) -> Result<()> {
    let tx = conn.transaction()?;
    let prev: Option<i64> = tx
        .query_row("SELECT user_id FROM account WHERE id = 1", [], |r| r.get(0))
        .optional()?;
    if prev.is_some_and(|p| p != a.user_id) {
        wipe_user_data(&tx)?;
    }
    tx.execute(
        "INSERT INTO account (id, login, user_id, avatar_url, auth_kind, scopes, created_at)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET login = excluded.login, user_id = excluded.user_id,
           avatar_url = excluded.avatar_url, auth_kind = excluded.auth_kind, scopes = excluded.scopes",
        params![a.login, a.user_id, a.avatar_url, a.auth_kind, a.scopes, at],
    )?;
    tx.commit()?;
    Ok(())
}

/// Sign-out: removes the account and everything cached for it.
pub fn clear_account(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    wipe_user_data(&tx)?;
    tx.execute("DELETE FROM account", [])?;
    tx.commit()?;
    Ok(())
}

fn wipe_user_data(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "DELETE FROM repos; DELETE FROM repo_local; DELETE FROM sync_state; DELETE FROM http_cache;",
    )?;
    Ok(())
}

pub fn kv_get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM kv WHERE key = ?1", params![key], |r| r.get(0))
        .optional()?)
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
}

pub fn sync_state(conn: &Connection, key: &str) -> Result<SyncState> {
    Ok(conn
        .query_row(
            "SELECT last_success_at, last_error FROM sync_state WHERE key = ?1",
            params![key],
            |r| Ok(SyncState { last_success_at: r.get(0)?, last_error: r.get(1)? }),
        )
        .optional()?
        .unwrap_or_default())
}

pub fn sync_success(conn: &Connection, key: &str, at: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_state (key, last_success_at, last_error) VALUES (?1, ?2, NULL)
         ON CONFLICT(key) DO UPDATE SET last_success_at = excluded.last_success_at, last_error = NULL",
        params![key, at],
    )?;
    Ok(())
}

pub fn sync_error(conn: &Connection, key: &str, err: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_state (key, last_error) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET last_error = excluded.last_error",
        params![key, err],
    )?;
    Ok(())
}
