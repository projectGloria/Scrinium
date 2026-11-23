use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::auth::{device_flow, ensure_token, keyring_store};
use crate::db::state::{self, Account};
use crate::db::now;
use crate::error::{Error, Result};
use crate::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// Present when an account is saved and its token is in the credential store.
    pub account: Option<Account>,
    pub device_flow_available: bool,
}

#[tauri::command]
pub async fn auth_status(state: State<'_, AppState>) -> Result<AuthStatus> {
    let account = state::account(&state.db.read())?;
    let account = match account {
        Some(a) if ensure_token(&state.gh).await? => Some(a),
        _ => None,
    };
    Ok(AuthStatus { account, device_flow_available: device_flow::CLIENT_ID.is_some() })
}

/// Starts device flow and opens the verification page in the browser.
#[tauri::command]
pub async fn auth_device_start(app: AppHandle) -> Result<device_flow::DeviceCode> {
    let code = device_flow::start().await?;
    let _ = app.opener().open_url(code.verification_uri.clone(), None::<&str>);
    Ok(code)
}

/// Waits for the user to approve in the browser, then signs in.
#[tauri::command]
pub async fn auth_device_poll(
    state: State<'_, AppState>,
    code: device_flow::DeviceCode,
) -> Result<Account> {
    let my_gen = state.device_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let token = device_flow::poll(&code, &state.device_gen, my_gen).await?;
    finish_sign_in(&state, token, "device").await
}

#[tauri::command]
pub async fn auth_device_cancel(state: State<'_, AppState>) -> Result<()> {
    state.device_gen.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn auth_with_pat(state: State<'_, AppState>, token: String) -> Result<Account> {
    let token = token.trim().to_owned();
    if token.is_empty() {
        return Err(Error::Other("paste a token first".into()));
    }
    finish_sign_in(&state, token, "pat").await
}

#[tauri::command]
pub async fn auth_sign_out(state: State<'_, AppState>) -> Result<()> {
    tokio::task::spawn_blocking(keyring_store::remove)
        .await
        .map_err(|e| Error::Other(e.to_string()))??;
    state.gh.set_token(None);
    state::clear_account(&mut state.db.write())?;
    Ok(())
}

async fn finish_sign_in(state: &AppState, token: String, kind: &str) -> Result<Account> {
    let (user, scopes) = state.gh.user_for_token(&token).await?;
    let to_store = token.clone();
    tokio::task::spawn_blocking(move || keyring_store::save(&to_store))
        .await
        .map_err(|e| Error::Other(e.to_string()))??;
    state.gh.set_token(Some(token));
    let account = Account {
        login: user.login,
        user_id: user.id,
        avatar_url: user.avatar_url,
        auth_kind: kind.to_owned(),
        scopes,
    };
    state::set_account(&mut state.db.write(), &account, now())?;
    state.sync.kick();
    Ok(account)
}
