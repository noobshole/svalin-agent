// Writes out/_headers (Cloudflare static assets format) after `next build`. The browser may only
// connect to this site and to the Svalin API set in NEXT_PUBLIC_API_BASE_URL.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const outDir = new URL("../out/", import.meta.url);
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").origin;

const policy = (scriptSrc) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc}`,
    `connect-src 'self' ${apiOrigin}`,
  ].join("; ");

/**
 * Each page may run only the inline scripts it was built with: their SHA-256 hashes go in that
 * page's policy, and browsers then ignore 'unsafe-inline' (kept only for very old browsers). A script
 * injected into a page has no matching hash and is blocked. Cloudflare applies both this rule and the
 * site-wide one, so a page must pass both.
 */
function pageRules() {
  return readdirSync(outDir)
    .filter((name) => name.endsWith(".html") && name !== "404.html")
    .sort()
    .map((name) => {
      const html = readFileSync(new URL(name, outDir), "utf8");
      const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
        ([, body]) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
      );
      const route = name === "index.html" ? "/" : `/${name.slice(0, -".html".length)}`;
      return [route, `  Content-Security-Policy: ${policy(["'self'", "'unsafe-inline'", ...new Set(hashes)].join(" "))}`, ""];
    })
    .flat();
}

writeFileSync(
  new URL("_headers", outDir),
  [
    "/*",
    `  Content-Security-Policy: ${policy("'self' 'unsafe-inline'")}`,
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "  Strict-Transport-Security: max-age=31536000",
    "",
    // Script and style files carry a content hash in their names, so browsers can keep them: a
    // second page then opens without fetching them again.
    "/_next/static/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    ...pageRules(),
  ].join("\n"),
);
console.log(`Wrote out/_headers (API ${apiOrigin})`);
