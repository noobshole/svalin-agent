export const THEME_KEY = "svalin-theme";

export type Theme = "light" | "dark";

/**
 * Runs before the page paints (inlined in <head>), so a visitor who picked a theme never sees a
 * flash of the other one. Without a saved choice the system setting applies.
 */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const CHANGED = "svalin-theme-changed";

export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toggleTheme() {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage can be blocked; the switch still works for this visit.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Calls `listener` when the visitor flips the switch or the system setting changes. Returns the way to stop. */
export function onThemeChange(listener: () => void) {
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(CHANGED, listener);
  system.addEventListener("change", listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    system.removeEventListener("change", listener);
  };
}
