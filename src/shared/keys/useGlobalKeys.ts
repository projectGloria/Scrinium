// Global keyboard map. Lists register what they need here; one window listener dispatches.
//
//   Ctrl/Cmd+K  repo switcher (becomes the full command palette in M2)
//   g r         repo switcher          g i / g p   issues / PRs (M4)
//   j / k       move in the sidebar list (arrows work too)
//   Enter       open the highlighted repo
//   /           focus the sidebar filter
//   Esc         go back
import { useEffect } from "react";
import { useUi } from "../../stores/ui";
import { useNav } from "../../stores/nav";

/** Set by the sidebar so global keys can drive it without prop-drilling. */
export const sidebarNav = {
  count: 0,
  open: (_index: number) => {},
  filterInput: null as HTMLInputElement | null,
};

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export function useGlobalKeys() {
  useEffect(() => {
    let gPending = 0;

    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setSwitcherOpen(!ui.switcherOpen);
        return;
      }
      if (ui.switcherOpen || isTyping(e.target) || e.altKey || mod) return;

      // Two-key "g" sequences.
      if (gPending && Date.now() - gPending < 1000) {
        gPending = 0;
        if (e.key === "r") {
          e.preventDefault();
          ui.setSwitcherOpen(true);
        }
        // "i" and "p" are wired up with issues/PRs in M4.
        return;
      }
      gPending = 0;

      const move = (delta: number) => {
        e.preventDefault();
        const max = Math.max(0, sidebarNav.count - 1);
        ui.setSidebarCursor(Math.min(max, Math.max(0, ui.sidebarCursor + delta)));
      };

      switch (e.key) {
        case "g":
          gPending = Date.now();
          return;
        case "j":
        case "ArrowDown":
          return move(1);
        case "k":
        case "ArrowUp":
          return move(-1);
        case "Enter":
          e.preventDefault();
          sidebarNav.open(ui.sidebarCursor);
          return;
        case "/":
          e.preventDefault();
          sidebarNav.filterInput?.focus();
          return;
        case "Escape":
          e.preventDefault();
          if (!useNav.getState().back()) (document.activeElement as HTMLElement | null)?.blur();
          return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
