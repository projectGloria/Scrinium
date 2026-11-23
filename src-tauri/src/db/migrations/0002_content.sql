-- M2: content cache (README, icons, README images), palette search, GitHub Actions.

-- Content-addressed file bodies, shared by README, icons and (M3) the file viewer.
CREATE TABLE blobs (
  sha TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mime TEXT,
  is_binary INTEGER NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,      -- too large to store; content is NULL
  content BLOB,
  fetched_at INTEGER NOT NULL,
  last_access_at INTEGER NOT NULL
);
CREATE INDEX blobs_lru ON blobs(last_access_at);

-- path -> blob for conditional GETs: on 304 we still need to know which blob the URL holds.
ALTER TABLE http_cache ADD COLUMN blob_sha TEXT;

CREATE TABLE readmes (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,                         -- '' = default branch
  path TEXT,                                 -- NULL = repo has no README
  blob_sha TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, ref)
);

-- The image picked as a repo's icon. A row with NULL path means "looked, found none".
CREATE TABLE repo_icons (
  repo_id INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  path TEXT,
  blob_sha TEXT,
  checked_pushed_at INTEGER,                 -- repos.pushed_at when we last looked
  checked_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE repos_fts USING fts5(
  full_name, description, topics,
  content='repos', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER repos_fts_ai AFTER INSERT ON repos BEGIN
  INSERT INTO repos_fts(rowid, full_name, description, topics)
  VALUES (new.id, new.full_name, new.description, new.topics);
END;
CREATE TRIGGER repos_fts_ad AFTER DELETE ON repos BEGIN
  INSERT INTO repos_fts(repos_fts, rowid, full_name, description, topics)
  VALUES ('delete', old.id, old.full_name, old.description, old.topics);
END;
CREATE TRIGGER repos_fts_au AFTER UPDATE OF full_name, description, topics ON repos BEGIN
  INSERT INTO repos_fts(repos_fts, rowid, full_name, description, topics)
  VALUES ('delete', old.id, old.full_name, old.description, old.topics);
  INSERT INTO repos_fts(rowid, full_name, description, topics)
  VALUES (new.id, new.full_name, new.description, new.topics);
END;
INSERT INTO repos_fts(repos_fts) VALUES ('rebuild');

-- GitHub Actions: workflows on the default branch and their recent runs.
CREATE TABLE workflows (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  id INTEGER NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  state TEXT NOT NULL,                       -- active / disabled_manually / ...
  dispatchable INTEGER NOT NULL DEFAULT 0,   -- has an `on: workflow_dispatch` trigger
  inputs TEXT,                               -- JSON array of dispatch inputs
  html_url TEXT NOT NULL,
  PRIMARY KEY (repo_id, id)
);

CREATE TABLE workflow_runs (
  id INTEGER PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  workflow_id INTEGER NOT NULL,
  name TEXT,
  title TEXT,
  run_number INTEGER NOT NULL,
  event TEXT NOT NULL,
  status TEXT,
  conclusion TEXT,
  head_branch TEXT,
  actor TEXT,
  html_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX workflow_runs_repo ON workflow_runs(repo_id, created_at DESC);
