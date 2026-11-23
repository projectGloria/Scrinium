//! Token storage in the OS credential store (Windows Credential Manager, macOS Keychain,
//! Secret Service on Linux). The token is never written to disk by the app.

use keyring::Entry;

use crate::error::Result;

const SERVICE: &str = "dev.scrinium.app";
const ACCOUNT: &str = "github-token";

fn entry() -> Result<Entry> {
    Ok(Entry::new(SERVICE, ACCOUNT)?)
}

pub fn load() -> Result<Option<String>> {
    match entry()?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn save(token: &str) -> Result<()> {
    Ok(entry()?.set_password(token)?)
}

pub fn remove() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
