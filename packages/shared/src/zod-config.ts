import { z } from "zod";

/**
 * Zod 4 can speed up object parsing by generating code with `new Function`. Cloudflare Workers
 * forbid that and the website's Content-Security-Policy blocks it, so Svalin always uses Zod's
 * plain parser. Zod reads this setting as each object schema is built, so it must run before any
 * schema in this package (index.ts imports it first).
 */
z.config({ jitless: true });
