import { Shield } from "lucide-react";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 md:px-10">
      <Link className="flex items-center gap-2 font-semibold tracking-tight" href="/">
        <Shield className="h-5 w-5 text-primary" />
        Svalin
      </Link>
      <nav className="flex items-center gap-5 text-sm text-mutedForeground">
        <Link className="hover:text-foreground" href="/#pricing">
          Pricing
        </Link>
        <Link className="hover:text-foreground" href="/#agents">
          For agents
        </Link>
        <a className="hover:text-foreground" href="https://github.com/noobshole/svalin-agent" rel="noreferrer" target="_blank">
          GitHub
        </a>
      </nav>
    </header>
  );
}
