import { create } from "zustand";

// Route stack. Esc pops. Later milestones add file / issue / PR routes.
export type Route = { kind: "home" } | { kind: "repo"; repoId: number };

interface NavState {
  stack: Route[];
  current: () => Route;
  /** Replaces the top route when switching repos (switching is not "going deeper"). */
  openRepo: (repoId: number) => void;
  back: () => boolean;
  reset: () => void;
}

export const useNav = create<NavState>((set, get) => ({
  stack: [{ kind: "home" }],
  current: () => get().stack[get().stack.length - 1],
  openRepo: (repoId) => set({ stack: [{ kind: "home" }, { kind: "repo", repoId }] }),
  back: () => {
    const { stack } = get();
    if (stack.length <= 1) return false;
    set({ stack: stack.slice(0, -1) });
    return true;
  },
  reset: () => set({ stack: [{ kind: "home" }] }),
}));
