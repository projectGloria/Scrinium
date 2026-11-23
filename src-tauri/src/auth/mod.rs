pub mod device_flow;
pub mod keyring_store;

use crate::error::Result;
use crate::github::ReadApi;

/// Loads the token from the OS credential store into the API client if it isn't there yet.
/// Returns whether a token is available.
pub async fn ensure_token(gh: &ReadApi) -> Result<bool> {
    if gh.has_token() {
        return Ok(true);
    }
    let token = tokio::task::spawn_blocking(keyring_store::load)
        .await
        .map_err(|e| crate::error::Error::Other(e.to_string()))??;
    let found = token.is_some();
    gh.set_token(token);
    Ok(found)
}
