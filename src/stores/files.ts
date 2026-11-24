// Files tab state per repo: selected branch/tag, open file, tree cursor and expanded folders.
// Directory listings are cached here by tree SHA (trees are immutable, so entries never go stale).
import { create } from "zustand";
import * as ipc from "../ipc/commands";
import type { FileEntry, RefList } from "../ipc/types";

export interface SelectedRef {
  name: string;
  kind: "branch" | "tag";
  treeSha: string;
}

export interface RepoFiles {
  /** Null: the default branch. */
  ref: SelectedRef | null;
  /** Path of the file shown in the viewer. */
  open: string | null;
  /** Tree cursor (a file or a folder path). */
  sel: string | null;
  expanded: Record<string, true>;
}

export const EMPTY_FILES: RepoFiles = { ref: null, open: null, sel: null, expanded: {} };

const DIRS_MAX = 4000;
const inflight = new Set<string>();

interface FilesState {
  byRepo: Record<number, RepoFiles>;
  refs: Record<number, RefList>;
  /** "treeSha:dir" -> entries (dirs first). */
  dirs: Record<string, FileEntry[]>;

  setRefs: (repoId: number, refs: RefList) => void;
  setRef: (repoId: number, ref: SelectedRef | null) => void;
  /** Opens a file (expands its folders). Used by the tree and the palette. */
  openFile: (repoId: number, path: string, ref?: SelectedRef | null) => void;
  /** Moves the cursor to a folder and expands it and its parents. */
  revealDir: (repoId: number, dir: string) => void;
  select: (repoId: number, path: string | null) => void;
  toggleDir: (repoId: number, dir: string, open?: boolean) => void;
  closeFile: (repoId: number) => void;
  loadDir: (treeSha: string, dir: string) => Promise<void>;
}

const parents = (path: string) => {
  const parts = path.split("/");
  const out: Record<string, true> = {};
  for (let i = 1; i < parts.length; i++) out[parts.slice(0, i).join("/")] = true;
  return out;
};

export const useFiles = create<FilesState>((set, get) => {
  const patch = (repoId: number, fn: (f: RepoFiles) => Partial<RepoFiles>) =>
    set((s) => {
      const cur = s.byRepo[repoId] ?? EMPTY_FILES;
      return { byRepo: { ...s.byRepo, [repoId]: { ...cur, ...fn(cur) } } };
    });

  return {
    byRepo: {},
    refs: {},
    dirs: {},

    setRefs: (repoId, refs) => set((s) => ({ refs: { ...s.refs, [repoId]: refs } })),
    setRef: (repoId, ref) => patch(repoId, () => ({ ref })),
    openFile: (repoId, path, ref) =>
      patch(repoId, (f) => ({
        ref: ref === undefined ? f.ref : ref,
        open: path,
        sel: path,
        expanded: { ...f.expanded, ...parents(path) },
      })),
    revealDir: (repoId, dir) =>
      patch(repoId, (f) => ({
        sel: dir || null,
        expanded: dir ? { ...f.expanded, ...parents(dir), [dir]: true } : f.expanded,
      })),
    select: (repoId, sel) => patch(repoId, () => ({ sel })),
    toggleDir: (repoId, dir, open) =>
      patch(repoId, (f) => {
        const expanded = { ...f.expanded };
        if (open ?? !expanded[dir]) expanded[dir] = true;
        else delete expanded[dir];
        return { expanded };
      }),
    closeFile: (repoId) => patch(repoId, () => ({ open: null, sel: null })),

    loadDir: async (treeSha, dir) => {
      const key = `${treeSha}:${dir}`;
      if (get().dirs[key] || inflight.has(key)) return;
      inflight.add(key);
      try {
        const entries = await ipc.filesDir(treeSha, dir);
        set((s) => {
          // Listings are cheap to re-read from SQLite; just keep the map bounded.
          const base = Object.keys(s.dirs).length > DIRS_MAX ? {} : s.dirs;
          return { dirs: { ...base, [key]: entries } };
        });
      } finally {
        inflight.delete(key);
      }
    },
  };
});
