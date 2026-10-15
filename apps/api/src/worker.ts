/**
 * Cloudflare Workers entry point. The Node server (index.ts) is unchanged; this file serves
 * the same app on Workers, where settings arrive as bindings instead of process.env.
 */
import { timingSafeEqual } from "node:crypto";

import type { Context } from "hono";

import { createApp } from "./app.js";
import { loadConfig } from "./env.js";
import { FORWARDED_CLIENT_IP_HEADER, FORWARDING_SECRET_HEADER } from "./lib/client-ip.js";
import { DurableDemoLimiter, type DemoLimiterNamespace } from "./lib/durable-demo-limiter.js";

export { DemoLimiterObject } from "./lib/durable-demo-limiter.js";

type Bindings = Record<string, unknown>;

const IP_PATTERN = /^[0-9a-fA-F:.]{2,64}$/;

/**
 * On Workers, Cloudflare sets CF-Connecting-IP to the address that actually connected, and a
 * caller cannot override it. The web app may still name the visitor IP with the shared secret.
 */
function cloudflareClientIp(forwardingSecret?: string) {
  const secret = forwardingSecret ? Buffer.from(forwardingSecret) : undefined;
  return (c: Context): string => {
    if (secret) {
      const presented = Buffer.from(c.req.header(FORWARDING_SECRET_HEADER) ?? "");
      const forwarded = c.req.header(FORWARDED_CLIENT_IP_HEADER)?.trim();
      if (presented.length === secret.length && timingSafeEqual(presented, secret) && forwarded && IP_PATTERN.test(forwarded)) {
        return `web:${forwarded}`;
      }
    }
    return c.req.header("cf-connecting-ip") ?? "unknown";
  };
}

let app: ReturnType<typeof createApp> | undefined;

function stringBindings(env: Bindings) {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export default {
  fetch(request: Request, env: Bindings, ctx: unknown) {
    if (!app) {
      const config = loadConfig(stringBindings(env));
      const namespace = env.DEMO_LIMITER as DemoLimiterNamespace | undefined;
      if (!namespace) {
        console.error(JSON.stringify({ level: "error", msg: "demo_limiter_binding_missing" }));
      }
      app = createApp(config, {
        clientIp: cloudflareClientIp(config.demo.forwardingSecret),
        // Without the binding, limits fall back to per-isolate memory, which Workers cannot enforce.
        demoLimiter: namespace
          ? new DurableDemoLimiter(namespace, config.demo.perHour, config.demo.perDayGlobal)
          : undefined,
        paymentInitialization: "first-paid-request",
        paymentDiscovery: false,
      });
    }
    return app.fetch(request, env, ctx as never);
  },
};
