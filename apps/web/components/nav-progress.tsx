"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Pages that load faster than this get no bar, so quick clicks do not flash. */
const SHOW_AFTER_MS = 150;
/** Never spin forever if a navigation is cancelled. */
const GIVE_UP_MS = 10_000;

/**
 * A thin bar at the top while the next page loads, so a click on a link always gets a visible
 * answer. It lives only in the browser: the page's own HTML stays complete and visible without
 * scripts, which a loading.tsx boundary would hide until they ran.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    clear();
    setLoading(false);
  }, [pathname]);

  useEffect(() => {
    // Capture phase: Next's links cancel the browser's own navigation before a bubbling listener runs.
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.origin !== window.location.origin) return;
      if (link.pathname.replace(/\/$/, "") === window.location.pathname.replace(/\/$/, "")) return;
      clear();
      timers.current.push(
        setTimeout(() => setLoading(true), SHOW_AFTER_MS),
        setTimeout(() => setLoading(false), GIVE_UP_MS),
      );
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      clear();
    };
  }, []);

  if (!loading) return null;
  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-border">
      <div className="loading-bar h-full w-1/3 bg-foreground/60" />
    </div>
  );
}
