export type DocLink = { href: string; label: string };

/** Every page in the docs, in reading order. The side list and the links at the foot of each page come from this. */
export const DOC_GROUPS: { name: string; links: DocLink[] }[] = [
  {
    name: "Get started",
    links: [
      { href: "/docs", label: "What is Svalin?" },
      { href: "/docs/quick-start", label: "Quick start" },
      { href: "/docs/plans", label: "Plans and limits" },
    ],
  },
  {
    name: "Products",
    links: [
      { href: "/docs/wallet-scan", label: "Wallet Scan" },
      { href: "/docs/check", label: "Check Before Paying" },
      { href: "/docs/svalin-index", label: "Svalin Index" },
      { href: "/docs/guard", label: "Svalin Guard" },
    ],
  },
  {
    name: "API and agents",
    links: [
      { href: "/docs/routes", label: "Routes" },
      { href: "/docs/paying", label: "Paying per call" },
      { href: "/docs/passes", label: "Passes for agents" },
      { href: "/docs/errors", label: "Errors" },
      { href: "/docs/mcp", label: "MCP server" },
    ],
  },
  {
    name: "Background",
    links: [
      { href: "/whitepaper", label: "Whitepaper" },
      { href: "/roadmap", label: "Roadmap" },
      { href: "/about", label: "About" },
    ],
  },
];

const ALL_LINKS = DOC_GROUPS.flatMap((group) => group.links);

export const isDocPath = (path: string) => ALL_LINKS.some((link) => link.href === path);

export function docPlace(path: string) {
  const index = ALL_LINKS.findIndex((link) => link.href === path);
  return {
    group: DOC_GROUPS.find((group) => group.links.some((link) => link.href === path))?.name,
    previous: index > 0 ? ALL_LINKS[index - 1] : undefined,
    next: index >= 0 ? ALL_LINKS[index + 1] : undefined,
  };
}
