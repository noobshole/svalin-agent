import Link from "next/link";

import { Logo } from "@/components/logo";
import { HeaderCta, MobileMenu, NavLinks } from "@/components/site-nav";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    // Solid, so nothing on the page shows through it while scrolling.
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <div className="relative mx-auto grid h-16 w-full max-w-6xl grid-cols-[1fr_auto] items-center gap-6 px-4 md:grid-cols-[1fr_auto_1fr] md:px-8">
        <Link aria-label="Svalin home" className="flex w-fit items-center gap-2 text-base font-medium tracking-tight" href="/">
          <Logo />
          svalin
        </Link>
        <nav aria-label="Main" className="hidden text-sm md:block">
          <NavLinks />
        </nav>
        <div className="flex items-center justify-end gap-1">
          <ThemeToggle />
          <HeaderCta />
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
