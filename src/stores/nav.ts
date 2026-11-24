import { create } from "zustand";

// Route stack. Esc pops.
export type Route =
  | { kind: "home" }
  | { kind: "repo"; repoId: number }
  /** An issue or PR detail, shown inside its repo's Issues / Pull requests tab. */
  | { kind: "issue"; repoId: number; number: number; isPr: boolean };

interface NavState {
  stack: Route[];
  current: () => Route;
  /** Replaces the top route when switching repos (switching is not "going deeper"). */
  openRepo: (repoId: number) => void;
  /** Opens an issue/PR detail of the open repo (replaces an open detail). */
  openIssue: (repoId: number, number: number, isPr: boolean) => void;
  back: () => boolean;
  reset: () => void;
}

export const useNav = create<NavState>((set, get) => ({
  stack: [{ kind: "home" }],
  current: () => get().stack[get().stack.length - 1],
  openRepo: (repoId) => set({ stack: [{ kind: "home" }, { kind: "repo", repoId }] }),
  openIssue: (repoId, number, isPr) => {
    const stack = get().stack.filter((r) => r.kind !== "issue");
    set({ stack: [...stack, { kind: "issue", repoId, number, isPr }] });
  },
  back: () => {
    const { stack } = get();
    if (stack.length <= 1) return false;
    set({ stack: stack.slice(0, -1) });
    return true;
  },
  reset: () => set({ stack: [{ kind: "home" }] }),
}));
