import { timingSafeEqual } from "node:crypto";

import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/** Header the Svalin web app uses to pass the visitor's IP, alongside the shared secret. */
export const FORWARDED_CLIENT_IP_HEADER = "x-svalin-client-ip";
export const FORWARDING_SECRET_HEADER = "x-svalin-forwarding-secret";

const IP_PATTERN = /^[0-9a-fA-F:.]{2,64}$/;

/**
 * The free-demo key for an address. IPv6 addresses are grouped by their /64 network, the block a
 * single subscriber usually holds, so rotating addresses inside it does not reset the limit.
 * IPv4 addresses (including IPv4-mapped IPv6) are used as they are.
 */
export function visitorKey(address: string): string {
  const ip = address.trim().toLowerCase().split("%")[0];
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];

  const [head, tail] = ip.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? headGroups
      : [...headGroups, ...Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0"), ...tailGroups];
  const network = groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "") || "0");
  return `${network.join(":")}::/64`;
}

/**
 * Resolves the free-demo key for a request. The first X-Forwarded-For entry is chosen by the
 * caller, so it is never trusted. In order:
 *
 * 1. The Svalin web app, proven by the shared WEB_FORWARDING_SECRET, may name the visitor IP.
 * 2. On Cloudflare Workers, CF-Connecting-IP, which Cloudflare sets and callers cannot override.
 * 3. Otherwise, the entry appended by our own hosting proxy (counted from the right).
 * 4. Otherwise, the socket's remote address.
 */
export function createClientIpResolver(options: {
  trustedProxyHops: number;
  forwardingSecret?: string;
  cloudflare?: boolean;
}) {
  const secret = options.forwardingSecret ? Buffer.from(options.forwardingSecret) : undefined;

  return (c: Context): string => {
    if (secret) {
      const presented = Buffer.from(c.req.header(FORWARDING_SECRET_HEADER) ?? "");
      const forwarded = c.req.header(FORWARDED_CLIENT_IP_HEADER)?.trim();
      if (presented.length === secret.length && timingSafeEqual(presented, secret) && forwarded && IP_PATTERN.test(forwarded)) {
        return `web:${visitorKey(forwarded)}`;
      }
    }

    if (options.cloudflare) {
      const connecting = c.req.header("cf-connecting-ip");
      return connecting ? visitorKey(connecting) : "unknown";
    }

    if (options.trustedProxyHops > 0) {
      const chain = (c.req.header("x-forwarded-for") ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const fromProxy = chain[chain.length - options.trustedProxyHops];
      if (fromProxy) return visitorKey(fromProxy);
    }

    try {
      const remote = getConnInfo(c).remote.address;
      return remote ? visitorKey(remote) : "unknown";
    } catch {
      // app.request() in tests has no socket.
      return "unknown";
    }
  };
}
