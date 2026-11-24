-- Folder a repo was cloned into from the app (used by "Open in VS Code"). User-local state.
ALTER TABLE repo_local ADD COLUMN clone_path TEXT;
