// Thin typed wrapper over Tauri invoke. One function per Rust command.
import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  Actions,
  AuthStatus,
  DeviceCode,
  FileContent,
  FileEntry,
  IssueDetail,
  IssueList,
  NewRepo,
  Language,
  PaletteResults,
  RefList,
  Readme,
  RepoSummary,
  StateFilter,
  SyncStatus,
  Templates,
  TreeInfo,
} from "./types";

export const appReady = () => invoke<number>("app_ready");
export const syncNow = () => invoke<void>("sync_now");
export const syncStatus = () => invoke<SyncStatus>("sync_status");

export const authStatus = () => invoke<AuthStatus>("auth_status");
export const authDeviceStart = () => invoke<DeviceCode>("auth_device_start");
export const authDevicePoll = (code: DeviceCode) => invoke<Account>("auth_device_poll", { code });
export const authDeviceCancel = () => invoke<void>("auth_device_cancel");
export const authWithPat = (token: string) => invoke<Account>("auth_with_pat", { token });
export const authSignOut = () => invoke<void>("auth_sign_out");

export const reposList = () => invoke<RepoSummary[]>("repos_list");
export const repoLanguages = (id: number) => invoke<Language[]>("repo_languages", { id });
export const repoTouch = (id: number) => invoke<void>("repo_touch", { id });
export const repoSetPinned = (id: number, pinned: boolean) =>
  invoke<void>("repo_set_pinned", { id, pinned });

export const openExternal = (url: string) => invoke<void>("open_external", { url });

/** Repo ids and file paths (default branches), best match first. */
export const paletteSearch = (q: string, limit?: number, fileLimit?: number, issueLimit?: number) =>
  invoke<PaletteResults>("palette_search", { q, limit, fileLimit, issueLimit });

/** Cached issues or PRs (SQLite only), most recently updated first. */
export const issuesList = (repoId: number, isPr: boolean, filter: StateFilter) =>
  invoke<IssueList>("issues_list", { repoId, isPr, filter });
/** Revalidates a list (at most once a minute unless forced). True if anything changed. */
export const issuesRefresh = (repoId: number, isPr: boolean, force?: boolean) =>
  invoke<boolean>("issues_refresh", { repoId, isPr, force });
export const issueGet = (repoId: number, number: number) => invoke<IssueDetail | null>("issue_get", { repoId, number });
/** Fetches body, comments and checks (at most every 30s unless forced). */
export const issueRefresh = (repoId: number, number: number, force?: boolean) =>
  invoke<IssueDetail | null>("issue_refresh", { repoId, number, force });

export const readmeGet = (repoId: number) => invoke<Readme | null>("readme_get", { repoId });
export const readmeRefresh = (repoId: number) => invoke<Readme | null>("readme_refresh", { repoId });
/** A file from the default branch as a cached blob SHA, or null. */
export const repoAsset = (repoId: number, path: string) => invoke<string | null>("repo_asset", { repoId, path });

export const actionsGet = (repoId: number) => invoke<Actions>("actions_get", { repoId });
export const actionsRefresh = (repoId: number) => invoke<Actions>("actions_refresh", { repoId });
export const actionsDispatch = (
  repoId: number,
  workflowId: number,
  gitRef: string,
  inputs: Record<string, string | boolean>,
) => invoke<void>("actions_dispatch", { repoId, workflowId, gitRef, inputs });

/** Cached branches/tags (SQLite only). */
export const refsGet = (repoId: number) => invoke<RefList>("refs_get", { repoId });
/** Revalidates branches/tags (at most once a minute unless forced). */
export const refsRefresh = (repoId: number, force?: boolean) => invoke<RefList>("refs_refresh", { repoId, force });
/** Makes sure a tree is cached: one request the first time, none after. */
export const filesTree = (repoId: number, treeSha: string) => invoke<TreeInfo>("files_tree", { repoId, treeSha });
export const filesDir = (treeSha: string, dir: string) => invoke<FileEntry[]>("files_dir", { treeSha, dir });
export const filesLookup = (treeSha: string, path: string) =>
  invoke<FileEntry | null>("files_lookup", { treeSha, path });
export const fileGet = (repoId: number, sha: string, path: string, size?: number | null) =>
  invoke<FileContent>("file_get", { repoId, sha, path, size: size ?? undefined });

export const repoTemplates = () => invoke<Templates>("repo_templates");
/** The app's only other GitHub write besides starting a workflow. Returns the new repo id. */
export const repoCreate = (repo: NewRepo) => invoke<number>("repo_create", { repo });
/** Native folder picker for the clone's parent folder. Null if cancelled. */
export const pickCloneFolder = (repoId: number) => invoke<string | null>("pick_clone_folder", { repoId });
/** Runs `git clone` into `<parent>/<repo name>`; returns that folder. */
export const repoClone = (repoId: number, parent: string, ssh: boolean) => invoke<string>("repo_clone", { repoId, parent, ssh });
export const openInVscode = (repoId: number) => invoke<void>("open_in_vscode", { repoId });
