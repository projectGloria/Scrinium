-- M4: issues and pull requests (read-only).

-- updatedAt of the most recently updated issue / PR on GitHub, from the repo sync. When it is
-- newer than what we hold locally, the background job fetches what changed.
ALTER TABLE repos ADD COLUMN issues_latest_at INTEGER;
ALTER TABLE repos ADD COLUMN prs_latest_at INTEGER;

-- Issues and PRs share GitHub's numbering, so they share a table.
CREATE TABLE issues (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  is_pr INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL,                       -- OPEN / CLOSED / MERGED
  state_reason TEXT,                         -- issues: COMPLETED / NOT_PLANNED / ...
  is_draft INTEGER NOT NULL DEFAULT 0,
  author TEXT,
  author_avatar TEXT,
  comments_count INTEGER NOT NULL DEFAULT 0,
  labels TEXT NOT NULL DEFAULT '[]',         -- JSON [{name, color}]
  head_ref TEXT,                             -- PRs only
  base_ref TEXT,
  checks_state TEXT,                         -- PRs only: status check rollup of the head commit
  html_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  merged_at INTEGER,
  checks TEXT,                               -- JSON [{name, state, url}], fetched with the detail
  detail_at INTEGER,                         -- when comments/checks were last fetched
  PRIMARY KEY (repo_id, number)
);
CREATE INDEX issues_list ON issues(repo_id, is_pr, state, updated_at DESC);
CREATE INDEX issues_recent ON issues(repo_id, is_pr, updated_at DESC);

-- Fetched on demand when a detail view opens.
CREATE TABLE issue_comments (
  repo_id INTEGER NOT NULL,
  number INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  id TEXT NOT NULL,
  author TEXT,
  author_avatar TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, number, ord),
  FOREIGN KEY (repo_id, number) REFERENCES issues(repo_id, number) ON DELETE CASCADE
);

-- Titles, for the palette.
CREATE VIRTUAL TABLE issues_fts USING fts5(title, content = 'issues', content_rowid = 'rowid', tokenize = 'trigram');
CREATE TRIGGER issues_fts_ai AFTER INSERT ON issues BEGIN
  INSERT INTO issues_fts(rowid, title) VALUES (new.rowid, new.title);
END;
CREATE TRIGGER issues_fts_ad AFTER DELETE ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
END;
CREATE TRIGGER issues_fts_au AFTER UPDATE OF title ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, title) VALUES ('delete', old.rowid, old.title);
  INSERT INTO issues_fts(rowid, title) VALUES (new.rowid, new.title);
END;
