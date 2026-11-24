// Typed subscriptions to backend events.
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SyncStatus } from "./types";

export const onReposChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen("sync://repos-changed", () => cb());

export const onSyncStatus = (cb: (s: SyncStatus) => void): Promise<UnlistenFn> =>
  listen<SyncStatus>("sync://status", (e) => cb(e.payload));

/** Issues/PRs of one repo changed in SQLite (background sync). */
export const onIssuesChanged = (cb: (repoId: number) => void): Promise<UnlistenFn> =>
  listen<number>("sync://issues-changed", (e) => cb(e.payload));
