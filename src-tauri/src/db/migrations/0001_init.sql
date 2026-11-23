-- 0001 (M1): account, repos, local repo state, languages, sync bookkeeping.

CREATE TABLE account (                 -- single row; the token itself lives in the OS keyring
  id INTEGER PRIMARY KEY CHECK (id = 1),
  login TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  avatar_url TEXT,
  auth_kind TEXT NOT NULL CHECK (auth_kind IN ('device','pat')),
  scopes TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE repos (
  id INTEGER PRIMARY KEY,              -- GitHub databaseId
  node_id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL UNIQUE,
  owner_is_org INTEGER NOT NULL,
  description TEXT,
  homepage TEXT,
  topics TEXT,                         -- space-joined
  primary_language TEXT,
  is_private INTEGER NOT NULL,
  is_fork INTEGER NOT NULL,
  is_archived INTEGER NOT NULL,
  default_branch TEXT,
  stars INTEGER NOT NULL DEFAULT 0,
  forks INTEGER NOT NULL DEFAULT 0,
  open_issues INTEGER NOT NULL DEFAULT 0,
  open_prs INTEGER NOT NULL DEFAULT 0,
  pushed_at INTEGER,
  updated_at INTEGER,
  html_url TEXT NOT NULL,
  ssh_url TEXT NOT NULL,
  clone_url TEXT NOT NULL,
  synced_at INTEGER NOT NULL,
  gone INTEGER NOT NULL DEFAULT 0      -- not seen in the last full sync (soft delete)
);
CREATE INDEX repos_owner ON repos(owner);
CREATE INDEX repos_lang  ON repos(primary_language);

CREATE TABLE repo_local (              -- user-local state, never touched by sync
  repo_id INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  pinned INTEGER NOT NULL DEFAULT 0,
  pin_order INTEGER,
  last_opened_at INTEGER,
  open_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX repo_local_recent ON repo_local(pinned DESC, last_opened_at DESC);

CREATE TABLE repo_languages (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  color TEXT,
  PRIMARY KEY (repo_id, language)
);

CREATE TABLE http_cache (              -- ETag / conditional-request bookkeeping
  url TEXT PRIMARY KEY,
  etag TEXT,
  last_modified TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE sync_state (              -- per-job cursors and timestamps
  key TEXT PRIMARY KEY,
  cursor TEXT,
  last_success_at INTEGER,
  last_error TEXT
);

CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
