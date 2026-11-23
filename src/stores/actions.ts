import { create } from "zustand";
import * as ipc from "../ipc/commands";
import type { Actions } from "../ipc/types";

interface ActionsState {
  byRepo: Record<number, Actions>;
  /** Last refresh error per repo (cleared on success). */
  errors: Record<number, string>;
  refreshing: Record<number, boolean>;
  /** Cached data first (instant), then a network revalidation. */
  load: (repoId: number) => Promise<void>;
  refresh: (repoId: number) => Promise<void>;
}

export const useActions = create<ActionsState>((set, get) => ({
  byRepo: {},
  errors: {},
  refreshing: {},
  load: async (repoId) => {
    if (!get().byRepo[repoId]) {
      const cached = await ipc.actionsGet(repoId).catch(() => null);
      if (cached) set((s) => ({ byRepo: { ...s.byRepo, [repoId]: cached } }));
    }
    await get().refresh(repoId);
  },
  refresh: async (repoId) => {
    if (get().refreshing[repoId]) return;
    set((s) => ({ refreshing: { ...s.refreshing, [repoId]: true } }));
    try {
      const fresh = await ipc.actionsRefresh(repoId);
      set((s) => {
        const { [repoId]: _, ...errors } = s.errors;
        return { byRepo: { ...s.byRepo, [repoId]: fresh }, errors };
      });
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, [repoId]: String(e) } }));
    } finally {
      set((s) => ({ refreshing: { ...s.refreshing, [repoId]: false } }));
    }
  },
}));

const pollTimers = new Map<number, ReturnType<typeof setTimeout>[]>();

/** A dispatched run takes a few seconds to appear; re-check a few times. */
export function pollAfterDispatch(repoId: number) {
  pollTimers.get(repoId)?.forEach(clearTimeout);
  pollTimers.set(
    repoId,
    [2500, 6000, 11000, 20000].map((ms) => setTimeout(() => void useActions.getState().refresh(repoId), ms)),
  );
}

export const isLive = (status: string | null) => !!status && status !== "completed";
