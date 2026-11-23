// Theme preference: "system" follows the OS; stored in localStorage so it applies before first paint.
export type ThemePref = "system" | "dark" | "light";

const KEY = "scrinium.theme";
const media = window.matchMedia("(prefers-color-scheme: light)");

export function loadThemePref(): ThemePref {
  const v = localStorage.getItem(KEY);
  return v === "dark" || v === "light" ? v : "system";
}

export function saveThemePref(p: ThemePref) {
  localStorage.setItem(KEY, p);
}

export function applyTheme(p: ThemePref) {
  const resolved = p === "system" ? (media.matches ? "light" : "dark") : p;
  document.documentElement.dataset.theme = resolved;
}

/** Call once at startup: applies the stored theme and tracks OS changes while on "system". */
export function initTheme() {
  applyTheme(loadThemePref());
  media.addEventListener("change", () => {
    if (loadThemePref() === "system") applyTheme("system");
  });
}
