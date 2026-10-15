/**
 * Cloudflare Workers entry point. The Node server (index.ts) is unchanged; this file serves
 * the same app on Workers, where settings arrive as bindings instead of process.env.
 */
import { createApp } from "./app.js";
import { loadConfig } from "./env.js";
import { createClientIpResolver } from "./lib/client-ip.js";
import { DurableDemoLimiter, type DemoLimiterNamespace } from "./lib/durable-demo-limiter.js";
import { startupSummary } from "./startup-log.js";

export { DemoLimiterObject } from "./lib/durable-demo-limiter.js";

type Bindings = Record<string, unknown>;

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
        clientIp: createClientIpResolver({
          trustedProxyHops: 0,
          forwardingSecret: config.demo.forwardingSecret,
          cloudflare: true,
        }),
        // Without the binding, limits fall back to per-isolate memory, which Workers cannot enforce.
        demoLimiter: namespace
          ? new DurableDemoLimiter(namespace, config.demo.perHour, config.demo.perDayGlobal)
          : undefined,
        paymentInitialization: "first-paid-request",
        paymentDiscovery: false,
      });
      // Logged on the first request each isolate serves (Workers have no startup phase).
      console.log(
        JSON.stringify({
          level: "info",
          msg: "svalin_api_started",
          runtime: "cloudflare-workers",
          demoLimiter: namespace ? "durable-object" : "memory",
          ...startupSummary(config),
        }),
      );
    }
    return app.fetch(request, env, ctx as never);
  },
};
