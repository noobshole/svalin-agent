import Link from "next/link";

import { Logo } from "@/components/logo";

const links = [
  { href: "/about", label: "About" },
  { href: "/docs", label: "Docs" },
  { href: "/whitepaper", label: "Whitepaper" },
  { href: "https://github.com/noobshole/svalin-agent", label: "GitHub" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-mutedForeground md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex items-center gap-2">
          <Logo className="h-3.5 w-3.5 shrink-0" />
          <span>Svalin reports exposures. It is not financial advice and never moves funds.</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          {links.map((link) =>
            link.href.startsWith("http") ? (
              <a className="transition-colors hover:text-foreground" href={link.href} key={link.label} rel="noreferrer" target="_blank">
                {link.label}
              </a>
            ) : (
              <Link className="transition-colors hover:text-foreground" href={link.href} key={link.label}>
                {link.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </footer>
  );
}
