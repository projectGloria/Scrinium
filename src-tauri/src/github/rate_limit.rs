//! Tracks GitHub's per-resource rate limits from response headers and backs off before hitting them.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use reqwest::header::HeaderMap;
use reqwest::StatusCode;

use crate::db::now;
use crate::error::{Error, Result};

/// Keep this many requests in reserve so interactive on-demand fetches still work during a sync.
const RESERVE: i64 = 50;
/// Waits up to this long in-line; longer waits become an error and the scheduler retries later.
const MAX_INLINE_WAIT: i64 = 60;

#[derive(Default)]
pub struct RateLimiter {
    buckets: Mutex<HashMap<String, Bucket>>,
}

#[derive(Clone, Copy)]
struct Bucket {
    remaining: i64,
    reset_at: i64,
}

fn header_i64(h: &HeaderMap, name: &str) -> Option<i64> {
    h.get(name)?.to_str().ok()?.parse().ok()
}

impl RateLimiter {
    pub fn observe(&self, h: &HeaderMap) {
        let (Some(remaining), Some(reset_at)) =
            (header_i64(h, "x-ratelimit-remaining"), header_i64(h, "x-ratelimit-reset"))
        else {
            return;
        };
        let resource = h
            .get("x-ratelimit-resource")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("core")
            .to_owned();
        self.buckets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(resource, Bucket { remaining, reset_at });
    }

    /// Call before a request against `resource` ("core" or "graphql").
    pub async fn wait(&self, resource: &str) -> Result<()> {
        let bucket = self.buckets.lock().unwrap_or_else(|e| e.into_inner()).get(resource).copied();
        let Some(b) = bucket else { return Ok(()) };
        let until_reset = b.reset_at - now();
        if b.remaining > RESERVE || until_reset <= 0 {
            return Ok(());
        }
        if until_reset > MAX_INLINE_WAIT {
            return Err(Error::RateLimited(until_reset as u64));
        }
        tokio::time::sleep(Duration::from_secs(until_reset as u64 + 1)).await;
        Ok(())
    }

    /// Seconds to wait if a response is a primary or secondary rate-limit rejection.
    pub fn retry_after(status: StatusCode, h: &HeaderMap) -> Option<u64> {
        if status != StatusCode::FORBIDDEN && status != StatusCode::TOO_MANY_REQUESTS {
            return None;
        }
        if let Some(secs) = header_i64(h, "retry-after") {
            return Some(secs.max(1) as u64);
        }
        if header_i64(h, "x-ratelimit-remaining") == Some(0) {
            let reset = header_i64(h, "x-ratelimit-reset").unwrap_or(0);
            return Some((reset - now()).max(1) as u64);
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Some(60);
        }
        None
    }
}
