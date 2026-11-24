//! Quick actions that touch the local machine: `git clone` into a chosen folder and opening a repo
//! in VS Code. Neither talks to the GitHub API; git uses the user's own credentials (the app's
//! token is never passed to it).

use std::path::{Path, PathBuf};
use std::process::Stdio;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::db::{repos, state};
use crate::error::{Error, Result};
use crate::AppState;

const CLONE_PARENT_KEY: &str = "clone:parent";

/// Native folder picker for the clone's parent folder (starts in the last one used).
/// `None` if cancelled.
#[tauri::command]
pub async fn pick_clone_folder(app: AppHandle, state: State<'_, AppState>, repo_id: i64) -> Result<Option<String>> {
    let info = repos::clone_info(&state.db.read(), repo_id)?;
    let last = state::kv_get(&state.db.read(), CLONE_PARENT_KEY)?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut picker = app.dialog().file().set_title(format!("Clone {} into…", info.name));
    if let Some(dir) = last.as_deref().filter(|d| Path::new(d).is_dir()) {
        picker = picker.set_directory(dir);
    }
    picker.pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let Some(parent) = rx.await.ok().flatten() else { return Ok(None) };
    let parent = parent.into_path().map_err(|e| Error::Other(format!("can't use that folder: {e}")))?;
    Ok(Some(parent.to_string_lossy().into_owned()))
}

/// Runs `git clone <url> <parent>/<repo name>` and remembers the folder. Returns that folder.
#[tauri::command]
pub async fn repo_clone(state: State<'_, AppState>, repo_id: i64, parent: String, ssh: bool) -> Result<String> {
    let info = repos::clone_info(&state.db.read(), repo_id)?;
    let parent = PathBuf::from(parent);
    if !parent.is_dir() {
        return Err(Error::Other(format!("{} isn't a folder", parent.display())));
    }
    let dest = parent.join(&info.name);
    if dest.exists() && dest.read_dir().map(|mut d| d.next().is_some()).unwrap_or(true) {
        return Err(Error::Other(format!("{} already exists and isn't empty", dest.display())));
    }
    let _ = state::kv_set(&state.db.write(), CLONE_PARENT_KEY, &parent.to_string_lossy());

    let url = if ssh { &info.ssh_url } else { &info.clone_url };
    git_clone(url, &dest).await?;

    let path = dest.to_string_lossy().into_owned();
    repos::set_clone_path(&state.db.write(), repo_id, Some(&path))?;
    Ok(path)
}

async fn git_clone(url: &str, dest: &PathBuf) -> Result<()> {
    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("clone").arg("--").arg(url).arg(dest);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    // Fail instead of waiting for a terminal prompt nobody can see (GUI credential helpers still work).
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd.output().await.map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Error::Other("git isn't installed (or isn't on PATH)".into()),
        _ => Error::Other(format!("couldn't run git: {e}")),
    })?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    let msg = stderr
        .lines()
        .filter(|l| l.starts_with("fatal:") || l.starts_with("error:"))
        .last()
        .or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty()))
        .unwrap_or("git clone failed")
        .trim()
        .to_owned();
    Err(Error::Other(msg))
}

/// Opens the local clone in VS Code if the app cloned it (and it's still there); otherwise asks
/// VS Code to clone the repo itself.
#[tauri::command]
pub async fn open_in_vscode(app: AppHandle, state: State<'_, AppState>, repo_id: i64) -> Result<()> {
    let info = repos::clone_info(&state.db.read(), repo_id)?;
    let local = info.clone_path.as_deref().filter(|p| Path::new(p).is_dir());
    if info.clone_path.is_some() && local.is_none() {
        // The folder was moved or deleted; forget it.
        repos::set_clone_path(&state.db.write(), repo_id, None)?;
    }
    let url = match local {
        Some(p) => format!("vscode://file/{}", encode(&p.replace('\\', "/"), b"/:")),
        None => format!("vscode://vscode.git/clone?url={}", encode(&info.clone_url, b"")),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| Error::Other(format!("couldn't open VS Code: {e}")))
}

/// Percent-encodes everything except unreserved characters and `keep`.
fn encode(s: &str, keep: &[u8]) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) || keep.contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::encode;

    #[test]
    fn vscode_urls_are_encoded() {
        assert_eq!(encode("C:/Users/me/My Repo", b"/:"), "C:/Users/me/My%20Repo");
        assert_eq!(
            encode("https://github.com/me/x.git", b""),
            "https%3A%2F%2Fgithub.com%2Fme%2Fx.git"
        );
    }
}
