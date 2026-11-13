import Link from "next/link";

import { Logo } from "@/components/logo";
import { GITHUB_URL } from "@/lib/links";

const linkClass = "hover:underline hover:underline-offset-4";

export function SiteFooter() {
  return (
    <footer className="relative z-[1] bg-footer text-sm text-pale">
      <div className="page grid4 items-end py-10">
        <div className="grid gap-3 lg:col-span-3">
          <Link aria-label="Svalin home" className="flex w-fit items-center gap-2.5 text-xl leading-none" href="/">
            <Logo className="h-[26px] w-[26px]" />
            <span className="relative -top-0.5">svalin</span>
          </Link>
          <p>Svalin reports exposures. It is not financial advice and never moves funds.</p>
        </div>
        <nav aria-label="Footer" className="flex gap-6 lg:justify-end">
          <Link className={linkClass} href="/docs">
            Docs
          </Link>
          <Link className={linkClass} href="/about">
            About
          </Link>
          <a className={linkClass} href={GITHUB_URL} rel="noreferrer" target="_blank">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
