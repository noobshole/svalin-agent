import Link from "next/link";

import { Logo } from "@/components/logo";
import { API_BASE_URL } from "@/lib/api";
import { GITHUB_URL } from "@/lib/links";

const columns = [
  {
    title: "Product",
    links: [
      { href: "/scan", label: "Wallet Scan" },
      { href: "/check", label: "Check Before Paying" },
      { href: "/ratings", label: "Svalin Index" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Docs" },
      { href: `${API_BASE_URL}/openapi.json`, label: "OpenAPI" },
      { href: `${API_BASE_URL}/llms.txt`, label: "llms.txt" },
      { href: GITHUB_URL, label: "GitHub" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/whitepaper", label: "Whitepaper" },
      { href: "/roadmap", label: "Roadmap" },
      { href: "/about", label: "About" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 pb-8 pt-12 md:px-8">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
          <div className="grid content-start gap-3">
            <Link aria-label="Svalin home" className="flex items-center gap-2 text-[15px] font-medium tracking-tight" href="/">
              <Logo />
              svalin
            </Link>
            <p className="max-w-xs text-sm leading-6 text-mutedForeground">Read-only risk ratings for agent money on NEAR and Solana.</p>
          </div>
          {columns.map((column) => (
            <nav aria-label={column.title} className="grid content-start gap-2.5 text-sm" key={column.title}>
              <p className="eyebrow">{column.title}</p>
              {column.links.map((link) =>
                link.href.startsWith("http") ? (
                  <a className="w-fit text-mutedForeground transition-colors hover:text-foreground" href={link.href} key={link.label} rel="noreferrer" target="_blank">
                    {link.label}
                  </a>
                ) : (
                  <Link className="w-fit text-mutedForeground transition-colors hover:text-foreground" href={link.href} key={link.label}>
                    {link.label}
                  </Link>
                ),
              )}
            </nav>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-6 text-xs text-subtleForeground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Svalin</span>
          <span className="flex items-center gap-2">
            <Logo className="h-3 w-3 shrink-0" />
            Svalin reports exposures. It is not financial advice and never moves funds.
          </span>
        </div>
      </div>
    </footer>
  );
}
