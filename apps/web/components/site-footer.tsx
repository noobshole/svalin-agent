import { Logo } from "@/components/logo";
import { API_BASE_URL } from "@/lib/api";

export function SiteFooter() {
  const apiUrl = API_BASE_URL;
  const links = [
    { href: "https://github.com/noobshole/svalin-agent", label: "GitHub" },
    { href: "https://github.com/noobshole/svalin-agent/blob/main/docs/RISK_METHODOLOGY.md", label: "Methodology" },
    { href: `${apiUrl}/openapi.json`, label: "OpenAPI" },
    { href: `${apiUrl}/llms.txt`, label: "llms.txt" },
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-mutedForeground md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex items-center gap-2">
          <Logo className="h-3.5 w-3.5" />
          <span>Svalin reports exposures. It is not financial advice and never moves funds.</span>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {links.map((link) => (
            <a className="transition-colors hover:text-foreground" href={link.href} key={link.label} rel="noreferrer" target="_blank">
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
