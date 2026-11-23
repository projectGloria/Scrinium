import { create } from "zustand";
import type { SyncStatus } from "../ipc/types";
import { applyTheme, loadThemePref, saveThemePref, type ThemePref } from "../shared/theme";

export type Tri = "all" | "only" | "hide";

export interface SwitcherFilters {
  owner: string; // "" = any
  language: string; // "" = any
  visibility: "all" | "public" | "private";
  forks: Tri;
  archived: Tri;
}

interface UiState {
  theme: ThemePref;
  cycleTheme: () => void;

  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
  switcherFilters: SwitcherFilters;
  setSwitcherFilters: (f: Partial<SwitcherFilters>) => void;

  /** Sidebar keyboard cursor (index into the filtered sidebar list). */
  sidebarCursor: number;
  setSidebarCursor: (i: number) => void;
  sidebarFilter: string;
  setSidebarFilter: (q: string) => void;

  sync: SyncStatus;
  setSync: (s: SyncStatus) => void;
}

const ORDER: ThemePref[] = ["system", "dark", "light"];

export const useUi = create<UiState>((set, get) => ({
  theme: loadThemePref(),
  cycleTheme: () => {
    const next = ORDER[(ORDER.indexOf(get().theme) + 1) % ORDER.length];
    saveThemePref(next);
    applyTheme(next);
    set({ theme: next });
  },

  switcherOpen: false,
  setSwitcherOpen: (switcherOpen) => set({ switcherOpen }),
  switcherFilters: { owner: "", language: "", visibility: "all", forks: "all", archived: "all" },
  setSwitcherFilters: (f) => set((s) => ({ switcherFilters: { ...s.switcherFilters, ...f } })),

  sidebarCursor: 0,
  setSidebarCursor: (sidebarCursor) => set({ sidebarCursor }),
  sidebarFilter: "",
  setSidebarFilter: (sidebarFilter) => set({ sidebarFilter, sidebarCursor: 0 }),

  sync: { running: false, lastSuccessAt: null, lastError: null },
  setSync: (sync) => set({ sync }),
}));
