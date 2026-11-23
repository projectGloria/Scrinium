// Thin typed wrapper over Tauri invoke. One function per Rust command.
import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  Actions,
  AuthStatus,
  DeviceCode,
  Language,
  Readme,
  RepoSummary,
  SyncStatus,
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

/** Repo ids, best match first. */
export const paletteSearch = (q: string, limit?: number) => invoke<number[]>("palette_search", { q, limit });

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
