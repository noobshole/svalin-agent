import Link from "next/link";

import { Logo } from "@/components/logo";
import { MobileMenu, NavLinks } from "@/components/site-nav";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="relative mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-4 md:px-8">
        <Link aria-label="Svalin home" className="flex items-center gap-2 text-[15px] font-medium tracking-tight" href="/">
          <Logo />
          svalin
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <NavLinks />
          <Link
            className="ml-2 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primaryForeground transition-opacity hover:opacity-90"
            href="/#scan"
          >
            Scan a wallet
          </Link>
          <MobileMenu />
        </nav>
      </div>
    </header>
  );
}
