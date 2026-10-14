import { timingSafeEqual } from "node:crypto";

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/** Header the Svalin web app uses to pass the visitor's IP, alongside the shared secret. */
export const FORWARDED_CLIENT_IP_HEADER = "x-svalin-client-ip";
export const FORWARDING_SECRET_HEADER = "x-svalin-forwarding-secret";

const IP_PATTERN = /^[0-9a-fA-F:.]{2,64}$/;

/**
 * Resolves the client IP used as the free-demo rate-limit key. The first
 * X-Forwarded-For entry is chosen by the caller, so it is never trusted:
 *
 * 1. The Svalin web app, proven by the shared WEB_FORWARDING_SECRET, may name the visitor IP.
 * 2. Otherwise, the entry appended by our own hosting proxy (counted from the right).
 * 3. Otherwise, the socket's remote address.
 */
export function createClientIpResolver(options: { trustedProxyHops: number; forwardingSecret?: string }) {
  const secret = options.forwardingSecret ? Buffer.from(options.forwardingSecret) : undefined;

  return (c: Context): string => {
    if (secret) {
      const presented = Buffer.from(c.req.header(FORWARDING_SECRET_HEADER) ?? "");
      const forwarded = c.req.header(FORWARDED_CLIENT_IP_HEADER)?.trim();
      if (presented.length === secret.length && timingSafeEqual(presented, secret) && forwarded && IP_PATTERN.test(forwarded)) {
        return `web:${forwarded}`;
      }
    }

    if (options.trustedProxyHops > 0) {
      const chain = (c.req.header("x-forwarded-for") ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const fromProxy = chain[chain.length - options.trustedProxyHops];
      if (fromProxy) return fromProxy;
    }

    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      // app.request() in tests has no socket.
      return "unknown";
    }
  };
}
