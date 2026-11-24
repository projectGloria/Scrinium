// Quick actions on a repo: copy clone URL, open on GitHub, git clone to a folder, open in VS Code.
// Shared by the repo header's Code menu and the command palette.
import * as ipc from "../../ipc/commands";
import type { RepoSummary } from "../../ipc/types";
import { copyText } from "../../shared/lib/clipboard";
import { useRepos } from "../../stores/repos";
import { useUi } from "../../stores/ui";

const cloning = new Set<number>();

export async function copyCloneUrl(repo: RepoSummary, ssh: boolean) {
  const url = ssh ? repo.sshUrl : repo.cloneUrl;
  try {
    await copyText(url);
    useUi.getState().notify(`Copied ${url}`, "ok");
  } catch {
    useUi.getState().notify("Couldn't copy to the clipboard", "error");
  }
}

export function openOnGithub(repo: RepoSummary) {
  void ipc.openExternal(repo.htmlUrl);
}

export async function cloneToFolder(repo: RepoSummary, ssh = false) {
  if (cloning.has(repo.id)) return;
  cloning.add(repo.id);
  const ui = useUi.getState();
  try {
    const parent = await ipc.pickCloneFolder(repo.id);
    if (!parent) return;
    ui.notify(`Cloning ${repo.fullName}…`, "info", 0);
    const path = await ipc.repoClone(repo.id, parent, ssh);
    ui.notify(`Cloned into ${path}`, "ok", 4000);
    await useRepos.getState().load();
  } catch (e) {
    ui.notify(`Clone failed: ${String(e)}`, "error", 8000);
  } finally {
    cloning.delete(repo.id);
  }
}

export async function openInVscode(repo: RepoSummary) {
  try {
    await ipc.openInVscode(repo.id);
    if (!repo.clonePath) useUi.getState().notify("VS Code will ask where to clone it", "info");
  } catch (e) {
    useUi.getState().notify(String(e), "error", 6000);
  }
}
