/**
 * The oldest safe release of each supported Node.js line: the 21 October 2026 security release.
 * Earlier ones carry a Brotli decoder flaw (CVE-2026-111497) that a malicious server can reach
 * through fetch(), and svalin-mcp fetches from paid services it does not control while it holds a
 * wallet key. Node.js 20 and the odd-numbered lines get no fixes at all.
 */
const SAFE_FROM: Record<number, [minor: number, patch: number]> = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };
const NEWEST_KNOWN_LINE = 26;

/** Why svalin-mcp must not run on this Node.js version, or null when it may. */
export function unsafeNodeVersion(version: string): string | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1, 4).map(Number) as [number, number, number];
  if (major > NEWEST_KNOWN_LINE) return null;
  const floor = SAFE_FROM[major];
  const safe = floor !== undefined && (minor > floor[0] || (minor === floor[0] && patch >= floor[1]));
  if (safe) return null;
  return (
    `Node.js ${version} has a flaw (CVE-2026-111497) that a malicious server could use to run code on this computer, ` +
    "and svalin-mcp holds a wallet key. Install Node.js 22.23.4, 24.22.1, 26.12.1 or newer."
  );
}
