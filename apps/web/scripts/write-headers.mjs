// Writes out/_headers (Cloudflare static assets format) after `next build`. The browser may only
// connect to this site and to the Svalin API set in NEXT_PUBLIC_API_BASE_URL.
import { writeFileSync } from "node:fs";

const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000").origin;

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${apiOrigin}`,
].join("; ");

writeFileSync(
  new URL("../out/_headers", import.meta.url),
  [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "",
  ].join("\n"),
);
console.log(`Wrote out/_headers (API ${apiOrigin})`);
