"use client";

import { toggleTheme } from "@/lib/theme";

/** Switches between white and dark, and remembers the choice in this browser. */
export function ThemeToggle() {
  return (
    <button aria-label="Switch between white and dark" className="-m-2 p-2" onClick={toggleTheme} title="Switch between white and dark" type="button">
      <svg aria-hidden="true" className="h-[22px] w-[22px]" viewBox="0 0 24 24">
        <circle cx="12" cy="12" fill="none" r="9.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 2.5a9.5 9.5 0 0 1 0 19z" fill="currentColor" />
      </svg>
    </button>
  );
}
