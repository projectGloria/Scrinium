//! GitHub OAuth device flow (https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).
//!
//! These two POSTs to github.com are the OAuth token handshake; they change no data on GitHub.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Scrinium's GitHub OAuth App (Device Flow enabled, non-expiring tokens). Client IDs are public.
const DEFAULT_CLIENT_ID: &str = "Ov23lio2UiHjogGsRawF";

/// Client ID used for device flow. `SCRINIUM_GITHUB_CLIENT_ID` at build time overrides the default.
pub const CLIENT_ID: Option<&str> = match option_env!("SCRINIUM_GITHUB_CLIENT_ID") {
    Some(id) => Some(id),
    None => Some(DEFAULT_CLIENT_ID),
};
/// `repo` is needed to read private repos (classic scopes have no read-only variant);
/// the app's write-guard is what keeps it read-only.
const SCOPES: &str = "repo read:org";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    #[serde(alias = "device_code")]
    pub device_code: String,
    #[serde(alias = "user_code")]
    pub user_code: String,
    #[serde(alias = "verification_uri")]
    pub verification_uri: String,
    #[serde(alias = "expires_in")]
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
}

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .user_agent(concat!("Scrinium/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()?)
}

fn client_id() -> Result<&'static str> {
    CLIENT_ID.ok_or_else(|| {
        Error::Other("this build has no GitHub OAuth client ID; paste a token instead".into())
    })
}

pub async fn start() -> Result<DeviceCode> {
    let resp = client()?
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", client_id()?), ("scope", SCOPES)])
        .send()
        .await?;
    if !resp.status().is_success() {
        return Err(Error::Api {
            status: resp.status().as_u16(),
            message: "could not start device sign-in (is Device Flow enabled for the OAuth app?)".into(),
        });
    }
    Ok(resp.json().await?)
}

/// Polls until the user approves, denies, the code expires, or `generation` moves past `my_gen`
/// (the user cancelled or started over).
pub async fn poll(code: &DeviceCode, generation: &AtomicU64, my_gen: u64) -> Result<String> {
    let client = client()?;
    let mut interval = code.interval.max(5);
    let deadline = std::time::Instant::now() + Duration::from_secs(code.expires_in);
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if generation.load(Ordering::SeqCst) != my_gen {
            return Err(Error::Other("sign-in cancelled".into()));
        }
        if std::time::Instant::now() > deadline {
            return Err(Error::Other("the code expired; start again".into()));
        }
        let resp: TokenResponse = client
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id()?),
                ("device_code", code.device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await?
            .json()
            .await?;
        if let Some(token) = resp.access_token {
            return Ok(token);
        }
        match resp.error.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval = resp.interval.unwrap_or(interval + 5),
            Some("expired_token") => return Err(Error::Other("the code expired; start again".into())),
            Some("access_denied") => return Err(Error::Other("sign-in was denied on GitHub".into())),
            _ => {
                return Err(Error::Other(
                    resp.error_description.or(resp.error).unwrap_or_else(|| "sign-in failed".into()),
                ))
            }
        }
    }
}
