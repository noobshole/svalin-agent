"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import { GITHUB_URL } from "@/lib/links";
import { cn } from "@/lib/utils/cn";

type NavLink = { href: string; label: string; description: string };
type NavItem = { label: string; href: string } | { label: string; links: NavLink[] };

export const NAV: NavItem[] = [
  {
    label: "Products",
    links: [
      { href: "/scan", label: "Wallet Scan", description: "A risk grade for any Solana wallet or NEAR account" },
      { href: "/check", label: "Check Before Paying", description: "Allow, caution or block before you send money" },
      { href: "/ratings", label: "Svalin Index", description: "Every NEAR token graded by the real money behind it" },
    ],
  },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  {
    label: "Resources",
    links: [
      { href: "/whitepaper", label: "Whitepaper", description: "How Svalin works, in plain words" },
      { href: "/roadmap", label: "Roadmap", description: "What is live and what comes next" },
      { href: GITHUB_URL, label: "GitHub", description: "The open-source code" },
    ],
  },
  { label: "About", href: "/about" },
];

const isExternal = (href: string) => href.startsWith("http");
const isCurrent = (pathname: string, href: string) => !isExternal(href) && !href.includes("#") && pathname === href;

/** Closes every open menu inside `root`. */
function closeAll(root: HTMLElement | null) {
  root?.querySelectorAll("details[open]").forEach((details) => details.removeAttribute("open"));
}

/**
 * The menus are <details> elements, so they open and close even before the page's scripts have
 * loaded, on a slow phone for example. Once they have, this closes them on a page change, a click
 * elsewhere or Escape, and keeps only one open at a time.
 */
function useMenuClosing(root: RefObject<HTMLElement | null>, pathname: string) {
  useEffect(() => closeAll(root.current), [root, pathname]);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      root.current?.querySelectorAll("details[open]").forEach((details) => {
        if (!details.contains(event.target as Node)) details.removeAttribute("open");
      });
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && closeAll(root.current);
    const onToggle = (event: Event) => {
      const opened = event.target as HTMLDetailsElement;
      if (!opened.open) return;
      root.current?.querySelectorAll("details[open]").forEach((details) => details !== opened && details.removeAttribute("open"));
    };
    const element = root.current;
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    element?.addEventListener("toggle", onToggle, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      element?.removeEventListener("toggle", onToggle, true);
    };
  }, [root]);
}

function ItemLink({ link, onNavigate, className, children }: { link: NavLink; onNavigate: () => void; className: string; children: ReactNode }) {
  return isExternal(link.href) ? (
    <a className={className} href={link.href} onClick={onNavigate} rel="noreferrer" target="_blank">
      {children}
    </a>
  ) : (
    <Link className={className} href={link.href} onClick={onNavigate}>
      {children}
    </Link>
  );
}

/** Hides the browser's own disclosure triangle on a <summary>. */
export const summaryReset = "cursor-pointer list-none [&::-webkit-details-marker]:hidden";

/** Desktop menu: plain links and two small dropdowns, with the current page marked. */
export function NavLinks() {
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  useMenuClosing(root, pathname);
  const close = () => closeAll(root.current);

  return (
    <div className="hidden items-center gap-1 md:flex" ref={root}>
      {NAV.map((item) => {
        if ("href" in item) {
          const active = isCurrent(pathname, item.href);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn("rounded-md px-3 py-1.5 transition-colors hover:text-foreground", active ? "text-foreground" : "text-mutedForeground")}
              href={item.href}
              key={item.label}
            >
              {item.label}
            </Link>
          );
        }
        const active = item.links.some((link) => isCurrent(pathname, link.href));
        return (
          <details className="group relative" key={item.label}>
            <summary
              className={cn(
                summaryReset,
                "inline-flex items-center gap-1 rounded-md px-3 py-1.5 transition-colors hover:text-foreground group-open:text-foreground",
                active ? "text-foreground" : "text-mutedForeground",
              )}
            >
              {item.label}
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-lg border border-border bg-surface p-1.5 shadow-lg shadow-black/10">
              {item.links.map((link) => (
                <ItemLink className="grid gap-0.5 rounded-md px-3 py-2.5 transition-colors hover:bg-surface2" key={link.href} link={link} onNavigate={close}>
                  <span className="text-sm font-medium text-foreground">{link.label}</span>
                  <span className="text-xs leading-5 text-mutedForeground">{link.description}</span>
                </ItemLink>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** Phones and small tablets: the same menu behind a button, grouped the same way. */
export function MobileMenu() {
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  useMenuClosing(root, pathname);
  const close = () => closeAll(root.current);
  const linkClass = (href: string) =>
    cn("block rounded-md px-3 py-2 text-sm transition-colors hover:bg-surface", isCurrent(pathname, href) ? "text-foreground" : "text-mutedForeground");

  return (
    <div className="md:hidden" ref={root}>
      <details className="group">
        <summary
          aria-label="Menu"
          className={cn(summaryReset, "inline-flex h-8 w-8 items-center justify-center rounded-md text-mutedForeground transition-colors hover:text-foreground")}
        >
          <Menu aria-hidden="true" className="h-4 w-4 group-open:hidden" />
          <X aria-hidden="true" className="hidden h-4 w-4 group-open:block" />
        </summary>
        <nav aria-label="Menu" className="absolute inset-x-0 top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b border-border bg-background px-4 pb-4 pt-2">
          <div className="grid gap-3">
            {NAV.map((item) =>
              "href" in item ? (
                <Link className={linkClass(item.href)} href={item.href} key={item.label} onClick={close}>
                  {item.label}
                </Link>
              ) : (
                <div className="grid gap-0.5" key={item.label}>
                  <p className="eyebrow px-3 pb-1 pt-2">{item.label}</p>
                  {item.links.map((link) => (
                    <ItemLink className={linkClass(link.href)} key={link.href} link={link} onNavigate={close}>
                      {link.label}
                    </ItemLink>
                  ))}
                </div>
              ),
            )}
          </div>
        </nav>
      </details>
    </div>
  );
}

/** Pages with a main button of their own, where the header's would be a second one. */
const OWN_BUTTON = new Set(["/", "/scan", "/check", "/pricing"]);

/** The header's one button, left out where the page already has its main button. */
export function HeaderCta() {
  if (OWN_BUTTON.has(usePathname().replace(/\/+$/, "") || "/")) return null;
  return (
    <Link
      className="ml-1 rounded-full bg-primary px-3.5 py-1.5 text-sm font-medium text-primaryForeground transition-opacity hover:opacity-90"
      href="/scan"
    >
      Scan a wallet
    </Link>
  );
}
