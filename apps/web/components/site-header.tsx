import Link from "next/link";

import { Logo } from "@/components/logo";
import { HeaderCta, MobileMenu, NavLinks } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="relative mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-4 md:px-8">
        <div className="flex items-center gap-6">
          <Link aria-label="Svalin home" className="flex items-center gap-2 text-[15px] font-medium tracking-tight" href="/">
            <Logo />
            svalin
          </Link>
          <nav aria-label="Main" className="text-sm">
            <NavLinks />
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <HeaderCta />
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
