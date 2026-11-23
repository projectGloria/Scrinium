import { create } from "zustand";
import * as ipc from "../ipc/commands";
import type { Language, RepoSummary } from "../ipc/types";

interface ReposState {
  /** Order as stored: pinned, then recently opened, then recently pushed. */
  repos: RepoSummary[];
  byId: Map<number, RepoSummary>;
  loaded: boolean;
  languages: Record<number, Language[]>;
  load: () => Promise<void>;
  loadLanguages: (id: number) => Promise<void>;
  setPinned: (id: number, pinned: boolean) => Promise<void>;
  /** Marks a repo as opened now. Updates local data without reordering the sidebar. */
  touch: (id: number) => void;
  clear: () => void;
}

const index = (repos: RepoSummary[]) => new Map(repos.map((r) => [r.id, r]));

export const useRepos = create<ReposState>((set, get) => ({
  repos: [],
  byId: new Map(),
  loaded: false,
  languages: {},
  load: async () => {
    const repos = await ipc.reposList();
    // Languages may have changed during sync; drop the cache so it is re-read from SQLite.
    set({ repos, byId: index(repos), loaded: true, languages: {} });
  },
  loadLanguages: async (id) => {
    if (get().languages[id]) return;
    const langs = await ipc.repoLanguages(id);
    set((s) => ({ languages: { ...s.languages, [id]: langs } }));
  },
  setPinned: async (id, pinned) => {
    await ipc.repoSetPinned(id, pinned);
    await get().load();
  },
  touch: (id) => {
    void ipc.repoTouch(id);
    const now = Math.floor(Date.now() / 1000);
    const repos = get().repos.map((r) => (r.id === id ? { ...r, lastOpenedAt: now } : r));
    set({ repos, byId: index(repos) });
  },
  clear: () => set({ repos: [], byId: new Map(), loaded: false, languages: {} }),
}));
