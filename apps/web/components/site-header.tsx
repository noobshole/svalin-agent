import Link from "next/link";

import { Logo } from "@/components/logo";
import { SiteMenu, SiteNav } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="page flex h-[var(--header)] items-center justify-between gap-6">
        <Link aria-label="Svalin home" className="flex items-center gap-2.5 text-xl leading-none" href="/">
          <Logo className="h-[26px] w-[26px]" />
          <span className="relative -top-0.5">svalin</span>
        </Link>
        <div className="flex items-center gap-[clamp(16px,2.4vw,36px)]">
          <SiteNav />
          <ThemeToggle />
          <SiteMenu />
        </div>
      </div>
    </header>
  );
}
