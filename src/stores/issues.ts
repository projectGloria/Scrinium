// Issues and PRs: cached lists and details from SQLite, revalidated in the background.
import { create } from "zustand";
import * as ipc from "../ipc/commands";
import type { IssueDetail, IssueList, StateFilter } from "../ipc/types";

/** "repoId:0|1" (issues | PRs). */
export const listKey = (repoId: number, isPr: boolean) => `${repoId}:${isPr ? 1 : 0}`;
const detailKey = (repoId: number, number: number) => `${repoId}#${number}`;

interface IssuesState {
  /** Shown list per repo+kind (for the current filter). */
  lists: Record<string, IssueList & { filter: StateFilter }>;
  /** Filter per kind, shared across repos. */
  filter: { issues: StateFilter; prs: StateFilter };
  /** Highlighted item number per repo+kind (kept while a detail is open). */
  cursor: Record<string, number>;
  refreshing: Record<string, boolean>;
  errors: Record<string, string>;
  details: Record<string, IssueDetail>;
  detailErrors: Record<string, string>;
  detailRefreshing: Record<string, boolean>;

  /** Cached list first (instant), then a throttled revalidation. */
  load: (repoId: number, isPr: boolean) => Promise<void>;
  /** Re-reads the cached list (after a sync changed it). */
  reload: (repoId: number, isPr: boolean) => Promise<void>;
  reloadRepo: (repoId: number) => Promise<void>;
  refresh: (repoId: number, isPr: boolean, force?: boolean) => Promise<void>;
  setFilter: (repoId: number, isPr: boolean, f: StateFilter) => void;
  setCursor: (repoId: number, isPr: boolean, number: number) => void;
  loadDetail: (repoId: number, number: number, force?: boolean) => Promise<void>;
}

export const useIssues = create<IssuesState>((set, get) => ({
  lists: {},
  filter: { issues: "open", prs: "open" },
  cursor: {},
  refreshing: {},
  errors: {},
  details: {},
  detailErrors: {},
  detailRefreshing: {},

  load: async (repoId, isPr) => {
    await get().reload(repoId, isPr);
    await get().refresh(repoId, isPr);
  },

  reload: async (repoId, isPr) => {
    const filter = get().filter[isPr ? "prs" : "issues"];
    const list = await ipc.issuesList(repoId, isPr, filter).catch(() => null);
    // A filter change while this was in flight wins.
    if (list && get().filter[isPr ? "prs" : "issues"] === filter) {
      set((s) => ({ lists: { ...s.lists, [listKey(repoId, isPr)]: { ...list, filter } } }));
    }
  },

  reloadRepo: async (repoId) => {
    const { lists, details } = get();
    for (const isPr of [false, true]) if (lists[listKey(repoId, isPr)]) await get().reload(repoId, isPr);
    // Refresh cached details of this repo too (the list fields may have changed).
    for (const key of Object.keys(details)) {
      if (!key.startsWith(`${repoId}#`)) continue;
      const d = await ipc.issueGet(repoId, details[key].number).catch(() => null);
      if (d) set((s) => ({ details: { ...s.details, [key]: d } }));
    }
  },

  refresh: async (repoId, isPr, force) => {
    const key = listKey(repoId, isPr);
    if (get().refreshing[key]) return;
    set((s) => ({ refreshing: { ...s.refreshing, [key]: true } }));
    try {
      await ipc.issuesRefresh(repoId, isPr, force);
      const { [key]: _, ...errors } = get().errors;
      set({ errors });
      // Re-read even without changes: the "checked" time moved.
      await get().reload(repoId, isPr);
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, [key]: String(e) } }));
    } finally {
      set((s) => ({ refreshing: { ...s.refreshing, [key]: false } }));
    }
  },

  setFilter: (repoId, isPr, f) => {
    set((s) => ({ filter: { ...s.filter, [isPr ? "prs" : "issues"]: f } }));
    void get().reload(repoId, isPr);
  },

  setCursor: (repoId, isPr, number) => set((s) => ({ cursor: { ...s.cursor, [listKey(repoId, isPr)]: number } })),

  loadDetail: async (repoId, number, force) => {
    const key = detailKey(repoId, number);
    if (!get().details[key]) {
      const cached = await ipc.issueGet(repoId, number).catch(() => null);
      if (cached) set((s) => ({ details: { ...s.details, [key]: cached } }));
    }
    if (get().detailRefreshing[key]) return;
    set((s) => ({ detailRefreshing: { ...s.detailRefreshing, [key]: true } }));
    try {
      const fresh = await ipc.issueRefresh(repoId, number, force);
      set((s) => {
        const { [key]: _, ...detailErrors } = s.detailErrors;
        return fresh ? { details: { ...s.details, [key]: fresh }, detailErrors } : { detailErrors };
      });
    } catch (e) {
      set((s) => ({ detailErrors: { ...s.detailErrors, [key]: String(e) } }));
    } finally {
      set((s) => ({ detailRefreshing: { ...s.detailRefreshing, [key]: false } }));
    }
  },
}));

export const useDetail = (repoId: number, number: number) => {
  const key = detailKey(repoId, number);
  return {
    detail: useIssues((s) => s.details[key]),
    error: useIssues((s) => s.detailErrors[key]),
    refreshing: useIssues((s) => !!s.detailRefreshing[key]),
  };
};
