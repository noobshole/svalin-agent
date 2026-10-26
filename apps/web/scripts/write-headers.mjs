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

/** Cloudflare refuses a _headers file with a line longer than this. */
const MAX_LINE = 2000;

/**
 * Each page may run only the inline scripts it was built with: their SHA-256 hashes go in a second,
 * script-only policy for that page, and browsers then ignore 'unsafe-inline' (kept only for very old
 * browsers). Browsers enforce both policies, so an injected script, which has no matching hash, is
 * blocked. A page with too many scripts to fit Cloudflare's line limit keeps the site-wide policy only.
 */
function pageRules() {
  return readdirSync(outDir)
    .filter((name) => name.endsWith(".html") && name !== "404.html")
    .sort()
    .flatMap((name) => {
      const html = readFileSync(new URL(name, outDir), "utf8");
      const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
        ([, body]) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
      );
      const route = name === "index.html" ? "/" : `/${name.slice(0, -".html".length)}`;
      const line = `  Content-Security-Policy: script-src ${["'self'", "'unsafe-inline'", ...new Set(hashes)].join(" ")}`;
      if (line.length > MAX_LINE) {
        console.warn(`${route}: ${hashes.length} inline scripts do not fit one header line; it keeps the site-wide policy only.`);
        return [];
      }
      return [route, line, ""];
    });
}

const lines = [
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
];
const tooLong = lines.filter((line) => line.length > MAX_LINE);
if (tooLong.length > 0) throw new Error(`_headers lines over ${MAX_LINE} characters would fail the deploy: ${tooLong.map((line) => line.slice(0, 60)).join(" | ")}`);
writeFileSync(new URL("_headers", outDir), lines.join("\n"));
console.log(`Wrote out/_headers (API ${apiOrigin})`);
