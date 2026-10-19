import Link from "next/link";

import { Logo } from "@/components/logo";

const links = [
  { href: "/#how", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#agents", label: "For agents" },
  { href: "/ratings", label: "Ratings" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-4 md:px-8">
        <Link aria-label="Svalin home" className="flex items-center gap-2 text-[15px] font-medium tracking-tight" href="/">
          <Logo />
          svalin
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((link) => (
            <Link className="hidden rounded-md px-3 py-1.5 text-mutedForeground transition-colors hover:text-foreground md:block" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
          <a
            className="hidden rounded-md px-3 py-1.5 text-mutedForeground transition-colors hover:text-foreground sm:block"
            href="https://github.com/noobshole/svalin-agent"
            rel="noreferrer"
            target="_blank"
          >
            GitHub
          </a>
          <Link
            className="ml-2 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primaryForeground transition-opacity hover:opacity-90"
            href="/#scan"
          >
            Scan a wallet
          </Link>
        </nav>
      </div>
    </header>
  );
}
