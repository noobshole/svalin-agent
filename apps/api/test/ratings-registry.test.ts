import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { editionTree, treeBytes, verifyLeaf } from "../src/ratings/merkle.js";
import { RatingsRegistry } from "../src/sources/ratings-registry.js";
import { PAY_TO_NEAR, PAY_TO_SOLANA, decodeHeader, fakeFacilitator, testConfig } from "./helpers.js";

// The five-token edition of test/merkle.test.ts, whose root svalin-roots (Rust) computed.
const INDEX = JSON.stringify({
  rows: [
    ["c.near", "C", 1, 25000.9, "C", null, null, null],
    ["a.near", "A", 1, 1793891, "A", 832859, 14.5, 16085],
    ["e.near", "E", 1, 0, "F", null, null, null],
    ["b.near", "B", 1, 250000, "B", null, null, null],
    ["d.near", "D", 1, 3000, "D", null, null, null],
  ],
});
const ROOT = "367e1cab03d544f6aede7648af6ea400af599ecd7dc4d3855ba97f54a564f38d";
const OPTIONS = { registry: "ratings.testnet", rpcUrl: "https://rpc.example", sealedUrl: "https://sealed.example/editions" };

/** The registry's latest_usable answer over JSON-RPC, and the sealed index file. */
function fakeChain(edition: Record<string, unknown> | null, index = INDEX, calls: string[] = [], tree?: Uint8Array) {
  return (async (url: string | URL | Request) => {
    const target = String(url);
    calls.push(target);
    if (target === OPTIONS.rpcUrl) {
      return Response.json({ jsonrpc: "2.0", id: "svalin", result: { result: [...Buffer.from(JSON.stringify(edition))] } });
    }
    if (target === `${OPTIONS.sealedUrl}/2026-11-04/near-token-index.json`) return new Response(index);
    if (target === `${OPTIONS.sealedUrl}/2026-11-04/near-token-tree.bin` && tree) return new Response(tree.slice().buffer as ArrayBuffer);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

const EDITION = {
  day: "2026-11-04",
  root: ROOT,
  index_sha256: createHash("sha256").update(INDEX).digest("hex"),
  methodology: "near-token-backing-v1",
  tokens: 5,
};

describe("grade proofs against the registry on NEAR", () => {
  it("proves a token's grade against the edition the registry records, ready for a vault", async () => {
    const calls: string[] = [];
    const registry = new RatingsRegistry(OPTIONS, fakeChain(EDITION, INDEX, calls));
    const proof = await registry.proof("c.near");
    expect(proof).toMatchObject({
      token: "c.near",
      grade: { day: "2026-11-04", grade: "C", backing_usd: 25_000 },
      leaf: "svalin-index/1|2026-11-04|c.near|C|25000",
      root: ROOT,
      registry: "ratings.testnet",
      methodology: "near-token-backing-v1",
    });
    expect(verifyLeaf(ROOT, proof.leaf, proof.grade.proof)).toBe(true);
    // The edition and its files are read once.
    await registry.proof("a.near");
    expect(calls.filter((url) => url === OPTIONS.rpcUrl)).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("reads the robot's tree file instead of rebuilding, and ignores one that does not match", async () => {
    const tree = treeBytes(editionTree("2026-11-04", JSON.parse(INDEX).rows));
    const fromFile = await new RatingsRegistry(OPTIONS, fakeChain(EDITION, INDEX, [], tree)).proof("d.near");
    expect(verifyLeaf(ROOT, fromFile.leaf, fromFile.grade.proof)).toBe(true);
    const tampered = Uint8Array.from(tree);
    tampered[0] ^= 1;
    const rebuilt = await new RatingsRegistry(OPTIONS, fakeChain(EDITION, INDEX, [], tampered)).proof("a.near");
    expect(verifyLeaf(ROOT, rebuilt.leaf, rebuilt.grade.proof)).toBe(true);
  });

  it("answers 404 for a token the edition does not grade", async () => {
    const registry = new RatingsRegistry(OPTIONS, fakeChain(EDITION));
    await expect(registry.proof("z.near")).rejects.toMatchObject({ status: 404, code: "not_in_edition" });
  });

  it("gives no proof when the sealed file or its root does not match the registry, or the registry has none", async () => {
    const swapped = INDEX.replace('"F",null', '"A",null');
    await expect(new RatingsRegistry(OPTIONS, fakeChain(EDITION, swapped)).proof("e.near")).rejects.toMatchObject({ status: 503, code: "proofs_unavailable" });
    const wrongRoot = { ...EDITION, root: "0".repeat(64) };
    await expect(new RatingsRegistry(OPTIONS, fakeChain(wrongRoot)).proof("a.near")).rejects.toMatchObject({ status: 503 });
    await expect(new RatingsRegistry(OPTIONS, fakeChain(null)).proof("a.near")).rejects.toMatchObject({ status: 503 });
  });
});

describe("the proof routes", () => {
  const ratingsRegistry = new RatingsRegistry(OPTIONS, fakeChain(EDITION));
  const app = createApp(testConfig({ PAY_TO_SOLANA, PAY_TO_NEAR, X402_ENV: "testnet" }), { facilitator: fakeFacilitator(), ratingsRegistry });

  it("charges for a proof it can give, and refuses one it cannot before any payment", async () => {
    const paid = await app.request("/v1/proof/a.near");
    expect(paid.status).toBe(402);
    expect(decodeHeader(paid.headers.get("PAYMENT-REQUIRED")).accepts[0].amount).toBe("2000");
    expect((await app.request("/v1/proof/z.near")).status).toBe(404);
    expect((await app.request("/v1/proof/bad..near")).status).toBe(400);
    const trusted = await app.request("/v1/proof/wrap.near");
    expect(trusted.status).toBe(404);
    expect(await trusted.json()).toMatchObject({ code: "trusted_token" });
  });

  it("gives a free trial proof", async () => {
    const response = await app.request("/v1/demo/proof/b.near");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: "b.near", grade: { grade: "B", backing_usd: 250_000 } });
  });
});
