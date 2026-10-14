import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/env.js";
import { AnthropicNarrator } from "../src/narrate/narrator.js";
import { buildRiskReport } from "../src/risk/engine.js";
import { MockPortfolioSource } from "../src/sources/mock-source.js";
import { SOLANA_WALLET } from "./helpers.js";

async function sampleReport() {
  return buildRiskReport(await new MockPortfolioSource().getOverview(SOLANA_WALLET));
}

function fakeAnthropic(reply: { status?: number; body: unknown }) {
  const requests: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const brief = {
  headline: "Grade C: moderate risk (49/100)",
  summary: "SOL is most of the wallet. Stablecoins are thin.",
  actions: ["Consider capping SOL near 40%."],
};

describe("AnthropicNarrator", () => {
  it("defaults to the current Haiku model", () => {
    expect(loadConfig({ NODE_ENV: "test", PORTFOLIO_SOURCE: "mock" }).narrator.model).toBe("claude-haiku-5-5");
  });

  it("asks for a structured brief at low effort, without sampling parameters", async () => {
    const { fetchImpl, requests } = fakeAnthropic({
      body: {
        stop_reason: "end_turn",
        content: [
          { type: "thinking", thinking: "" },
          { type: "text", text: JSON.stringify(brief) },
        ],
      },
    });
    const result = await new AnthropicNarrator("test-key", "claude-haiku-5-5", fetchImpl).narrate(await sampleReport());

    expect(result.narrator).toBe("llm:claude-haiku-5-5");
    expect(result.headline).toBe(brief.headline);
    expect(result.risk.wallet).toBe(SOLANA_WALLET);

    const request = requests[0];
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("top_p");
  });

  it.each([
    ["an API error", { status: 500, body: { type: "error" } }],
    ["a refusal", { body: { stop_reason: "refusal", content: [] } }],
    ["a reply cut off while thinking", { body: { stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "" }] } }],
    ["a malformed brief", { body: { stop_reason: "end_turn", content: [{ type: "text", text: '{"headline": ""}' }] } }],
  ])("falls back to the template brief on %s", async (_label, reply) => {
    const { fetchImpl } = fakeAnthropic(reply);
    const result = await new AnthropicNarrator("test-key", "claude-haiku-5-5", fetchImpl).narrate(await sampleReport());
    expect(result.narrator).toBe("template");
    expect(result.actions.length).toBeGreaterThan(0);
  });
});
