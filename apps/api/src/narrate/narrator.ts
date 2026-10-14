import { briefSchema, type Brief, type RiskReport } from "@svalin-agent/shared";
import { z } from "zod";

/**
 * Turns a deterministic RiskReport into a short human/agent-readable brief.
 * The LLM only writes prose; it never sees an instruction to compute anything, and
 * its output is schema-checked. Any failure falls back to the template narrator, so
 * a paid /v1/brief call always returns a valid brief.
 */
export interface Narrator {
  narrate(report: RiskReport): Promise<Brief>;
}

const chainLabel: Record<RiskReport["chain"], string> = { solana: "Solana", near: "NEAR" };

export function templateBrief(report: RiskReport, now: Date = new Date()): Brief {
  const material = report.findings.filter((finding) => finding.severity !== "info");
  const headline =
    material.length === 0
      ? `Grade ${report.grade}: no material risks flagged (${report.score}/100)`
      : `Grade ${report.grade}: ${report.level} risk (${report.score}/100). ${material[0].title}`;

  const value = report.metrics.totalValueUsd.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const parts = [
    `$${value} across ${report.metrics.pricedAssetCount} priced assets on ${chainLabel[report.chain]}.`,
    report.metrics.largestVolatilePosition
      ? `Largest volatile exposure: ${report.metrics.largestVolatilePosition.symbol} at ${report.metrics.largestVolatilePosition.pct.toFixed(1)}%.`
      : "No volatile exposure.",
    `Stablecoins: ${report.metrics.stablecoinPct.toFixed(1)}%.`,
  ];
  if (material.length > 1) {
    parts.push(`Also flagged: ${material.slice(1, 3).map((finding) => finding.title.toLowerCase()).join("; ")}.`);
  }

  return briefSchema.parse({
    wallet: report.wallet,
    headline: headline.slice(0, 200),
    summary: parts.join(" "),
    actions: report.findings.slice(0, 3).map((finding) => finding.action),
    narrator: "template",
    risk: report,
    generatedAt: now.toISOString(),
  });
}

export class TemplateNarrator implements Narrator {
  async narrate(report: RiskReport) {
    return templateBrief(report);
  }
}

const llmOutputSchema = z.object({
  headline: z.string().min(1).max(200),
  summary: z.string().min(1).max(1200),
  actions: z.array(z.string().min(1).max(300)).min(1).max(5),
});

const SYSTEM_PROMPT = `You are Svalin, a read-only crypto portfolio risk analyst writing for another AI agent or a busy human.
You receive a JSON risk report produced by a deterministic engine. Rewrite it as a brief.
Rules:
- Use ONLY numbers that appear in the report. Never invent prices, APYs, protocols, or forecasts.
- Never tell the reader to buy a specific token. You may describe categories (e.g. "a major stablecoin").
- Svalin cannot move funds; phrase actions as things the wallet owner may choose to do.
- Plain, direct English. No hype, no emojis.
Respond with ONLY a JSON object: {"headline": string (<=120 chars), "summary": string (2-4 sentences), "actions": string[] (1-3 items)}.`;

/** Structured output: the API guarantees the reply parses as this shape. Lengths are checked by llmOutputSchema. */
const BRIEF_JSON_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    actions: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "summary", "actions"],
  additionalProperties: false,
} as const;

type FetchLike = typeof fetch;

export class AnthropicNarrator implements Narrator {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs = 12_000,
  ) {}

  async narrate(report: RiskReport): Promise<Brief> {
    try {
      const response = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          // Current models think before answering and thinking counts toward max_tokens,
          // so leave room beyond the ~300-token brief.
          max_tokens: 2000,
          // Rewriting a finished report is simple work: low effort keeps thinking (and cost) small.
          output_config: { effort: "low", format: { type: "json_schema", schema: BRIEF_JSON_SCHEMA } },
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: JSON.stringify(stripForPrompt(report)) }],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new Error(`anthropic ${response.status}`);

      const body = (await response.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (body.stop_reason !== "end_turn") throw new Error(`anthropic stop_reason ${body.stop_reason}`);
      // Thinking blocks can come first, so find the answer by type, not position.
      const text = body.content?.find((block) => block.type === "text")?.text ?? "";
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      const parsed = llmOutputSchema.parse(JSON.parse(json));

      return briefSchema.parse({
        wallet: report.wallet,
        ...parsed,
        narrator: `llm:${this.model}`,
        risk: report,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.warn(JSON.stringify({ level: "warn", msg: "narrator_fallback", error: String(error) }));
      return templateBrief(report);
    }
  }
}

/** Only what the model needs to write prose. Keeps tokens (and cost) small. */
function stripForPrompt(report: RiskReport) {
  return {
    chain: report.chain,
    score: report.score,
    grade: report.grade,
    level: report.level,
    metrics: report.metrics,
    findings: report.findings.map(({ title, summary, action, severity }) => ({ title, summary, action, severity })),
    dataCoverage: report.dataCoverage,
  };
}
