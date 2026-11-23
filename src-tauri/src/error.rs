use serde::{Serialize, Serializer};

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("GitHub returned {status}: {message}")]
    Api { status: u16, message: String },
    #[error("GitHub rate limit reached; retrying in {0}s")]
    RateLimited(u64),
    #[error("not signed in")]
    NoToken,
    #[error("GitHub rejected the token; sign in again")]
    Unauthorized,
    #[error("credential store error: {0}")]
    Keyring(String),
    #[error("{0}")]
    Other(String),
}

impl From<keyring::Error> for Error {
    fn from(e: keyring::Error) -> Self {
        Error::Keyring(e.to_string())
    }
}

// Commands return errors to the frontend as plain strings.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
