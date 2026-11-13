// White or dark. Loaded before the page paints, so a saved choice never flashes the other one; with
// no saved choice the system setting applies. The same key and behaviour as the Svalin website.
(() => {
  const KEY = "svalin-theme";
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  } catch {
    // Storage can be blocked; the system setting still applies.
  }
  addEventListener("DOMContentLoaded", () => {
    document.getElementById("theme")?.addEventListener("click", () => {
      const now = root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = now === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // The switch still works for this visit.
      }
    });
  });
})();
