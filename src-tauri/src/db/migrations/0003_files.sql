-- M3: branches/tags, git trees, file search.

-- Root tree of the default branch, from the repo sync (lets the Files tab open without a request).
ALTER TABLE repos ADD COLUMN default_tree_sha TEXT;

-- Branches and tags (most recently committed first, as GitHub returns them).
CREATE TABLE refs (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('branch', 'tag')),
  name TEXT NOT NULL,
  ord INTEGER NOT NULL,
  commit_sha TEXT,
  tree_sha TEXT,
  committed_at INTEGER,
  PRIMARY KEY (repo_id, kind, name)
);

CREATE TABLE ref_lists (
  repo_id INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  branches_total INTEGER NOT NULL,
  tags_total INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);

-- Git trees are immutable and content-addressed: fetched once, never revalidated.
CREATE TABLE trees (
  sha TEXT PRIMARY KEY,
  truncated INTEGER NOT NULL,
  entries INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  last_access_at INTEGER NOT NULL
);

-- Every entry of a recursive tree, keyed by its directory so listing a folder is one range scan.
CREATE TABLE tree_entries (
  tree_sha TEXT NOT NULL REFERENCES trees(sha) ON DELETE CASCADE,
  dir TEXT NOT NULL,                          -- '' for the root
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- blob / tree / commit (submodule)
  sha TEXT NOT NULL,
  size INTEGER,
  mode TEXT,
  PRIMARY KEY (tree_sha, dir, name)
) WITHOUT ROWID;

-- File paths of each repo's default branch, for the palette.
-- rowid = repo_id << 20 | n, so a repo's rows are one rowid range.
CREATE VIRTUAL TABLE files_fts USING fts5(path, tokenize = 'trigram');

CREATE TABLE files_indexed (
  repo_id INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  tree_sha TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);
