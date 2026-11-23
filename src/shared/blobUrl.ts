import { convertFileSrc } from "@tauri-apps/api/core";

/** URL of a cached blob, served from SQLite by the `scrblob` protocol in Rust. */
export const blobUrl = (sha: string) => convertFileSrc(sha, "scrblob");
