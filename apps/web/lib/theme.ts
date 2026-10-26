export const THEME_KEY = "svalin-theme";

/**
 * Runs before the page paints (inlined in <head>), so a visitor who picked a theme never sees a
 * flash of the other one. Without a saved choice the system setting applies.
 */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
