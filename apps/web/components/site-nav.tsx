"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { isDocPath } from "@/lib/docs-nav";
import { cn } from "@/lib/utils/cn";

const MAIN = [
  { href: "/scan", label: "Scan" },
  { href: "/check", label: "Check" },
  { href: "/ratings", label: "Index" },
  { href: "/guard", label: "Guard" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
];

function isCurrent(pathname: string, href: string) {
  const path = pathname.replace(/\/+$/, "");
  return path === href || (href === "/docs" && isDocPath(path));
}

/** The menu on a wide screen: plain links with the current page underlined. */
export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-[clamp(16px,2.4vw,36px)] md:flex">
      {MAIN.map((item) => (
        <Link
          aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
          className={cn("hover:underline hover:underline-offset-4", isCurrent(pathname, item.href) && "underline underline-offset-4")}
          href={item.href}
          key={item.href}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** The same links on a phone, behind one word. It is a <details>, so it works before the page's scripts load. */
export function SiteMenu() {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => menu.current?.removeAttribute("open");

  useEffect(() => {
    menu.current?.removeAttribute("open");
  }, [pathname]);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) menu.current.removeAttribute("open");
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") menu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details className="group md:hidden" ref={menu}>
      <summary aria-label="Menu" className="leading-none">
        <span className="group-open:hidden">Menu</span>
        <span className="hidden group-open:inline">Close</span>
      </summary>
      <nav aria-label="Menu" className="absolute inset-x-0 top-[var(--header)] z-30 border-b border-border bg-background pb-4">
        <div className="page grid">
          {[...MAIN, { href: "/about", label: "About" }].map((item) => (
            <Link className="border-t border-border py-3 text-lg" href={item.href} key={item.href} onClick={close}>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </details>
  );
}
