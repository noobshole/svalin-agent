import {
  TOKEN_SALE_USD,
  intentsQuotesSchema,
  tokenGradeFor,
  tokenGradeSchema,
  type IntentsQuote,
  type IntentsQuotes,
  type NearTokenIndex,
  type TokenGrade,
} from "@svalin-agent/shared";

/**
 * A second opinion beside the grade (near-token-backing-v2): what NEAR Intents' 1Click API would
 * pay in USDC for $1,000 of each NEAR token it lists. Only "dry" quotes are asked for: nothing is
 * signed, deposited or sent, and no key is needed. For the Index scripts only (Node).
 */

export const ONE_CLICK_URL = "https://1click.chaindefuser.com/v0";
/** USDC on NEAR, what every quote sells into. */
const USDC_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** A dry quote still names accounts. This implicit account has no known key, so it belongs to nobody. */
const NOBODY = "0".repeat(64);
const GRADES = tokenGradeSchema.options;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
type OneClickToken = { assetId: string; blockchain: string; decimals: number; price: number; symbol?: string };

/** The NEAR contract behind a 1Click asset id ("nep141:<contract>" or "1cs_v1:near:<contract>"), or null. */
export function contractOfAsset(assetId: string): string | null {
  if (assetId.startsWith("nep141:")) return assetId.slice("nep141:".length) || null;
  const omni = /^1cs_v1:near:(.+)$/.exec(assetId);
  return omni ? omni[1] : null;
}

/** The grade band a quoted loss (0 to 1) falls in: the backing that would lose that much on a $1,000 sale. */
export function impliedGrade(loss: number): TokenGrade {
  if (loss <= 0) return "A";
  if (loss >= 1) return "F";
  return tokenGradeFor((TOKEN_SALE_USD * (1 - loss)) / loss);
}

/** Two bands or more apart, or no route for a token graded C or better. */
export function quoteDisagrees(grade: TokenGrade, implied: TokenGrade | null, noRoute: boolean): boolean {
  if (implied === null) return noRoute && GRADES.indexOf(grade) <= GRADES.indexOf("C");
  return Math.abs(GRADES.indexOf(grade) - GRADES.indexOf(implied)) >= 2;
}

/** Raw units worth about `usd` at `price`, kept to 6 significant decimals so large decimals stay exact. */
function rawAmount(usd: number, price: number, decimals: number): string {
  const units = usd / price;
  if (decimals <= 6) return BigInt(Math.round(units * 10 ** decimals)).toString();
  return (BigInt(Math.round(units * 1e6)) * 10n ** BigInt(decimals - 6)).toString();
}

/**
 * Quotes every token 1Click lists that the Index grades, one at a time. A failed quote is recorded,
 * never thrown: the quotes sit beside the grades and must not hold up an edition.
 */
export async function intentsQuotes(
  index: Pick<NearTokenIndex, "rows" | "generatedAt">,
  options: { fetchImpl?: FetchLike; baseUrl?: string; spacingMs?: number; now?: () => Date } = {},
): Promise<IntentsQuotes> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? ONE_CLICK_URL;
  const spacingMs = options.spacingMs ?? 300;
  const grades = new Map(index.rows.map((row) => [row[0], row[4]] as const));

  const response = await fetchImpl(`${baseUrl}/tokens`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`1Click returned ${response.status} for its token list`);
  const listed = ((await response.json()) as OneClickToken[]).filter(
    (token) => token.blockchain === "near" && token.assetId !== USDC_ASSET && Number(token.price) > 0 && Number.isInteger(token.decimals),
  );

  const quotes: Record<string, IntentsQuote> = {};
  for (const token of listed) {
    const contract = contractOfAsset(token.assetId);
    const grade = contract ? grades.get(contract) : undefined;
    if (!contract || !grade || quotes[contract]) continue;
    if (Object.keys(quotes).length > 0) await new Promise((done) => setTimeout(done, spacingMs));
    quotes[contract] = await quoteOne(fetchImpl, baseUrl, token, grade);
  }

  return intentsQuotesSchema.parse({
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    indexGeneratedAt: index.generatedAt,
    source: "NEAR Intents 1Click API, dry quotes",
    saleUsd: TOKEN_SALE_USD,
    destination: "USDC on NEAR",
    quotes,
  });
}

async function quoteOne(fetchImpl: FetchLike, baseUrl: string, token: OneClickToken, grade: TokenGrade): Promise<IntentsQuote> {
  const body = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: token.assetId,
    depositType: "INTENTS",
    destinationAsset: USDC_ASSET,
    amount: rawAmount(TOKEN_SALE_USD, Number(token.price), token.decimals),
    refundTo: NOBODY,
    refundType: "INTENTS",
    recipient: NOBODY,
    recipientType: "INTENTS",
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const none = (error: string, noRoute: boolean): IntentsQuote => ({
    grade,
    fetchesUsd: null,
    lossPct: null,
    impliedGrade: null,
    disagrees: quoteDisagrees(grade, null, noRoute),
    error,
  });
  try {
    const response = await fetchImpl(`${baseUrl}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const reply = (await response.json().catch(() => null)) as { quote?: { amountInUsd?: string; amountOutUsd?: string }; message?: unknown } | null;
    // Too many requests, or a request refused, says nothing about the token: only other 4xx answers mean no route.
    if ([401, 403, 429].includes(response.status)) return none(`request failed (${response.status})`, false);
    if (response.status >= 400 && response.status < 500) {
      return none(`no route: ${String(reply?.message ?? response.status).slice(0, 80)}`, true);
    }
    const sold = Number(reply?.quote?.amountInUsd);
    const fetched = Number(reply?.quote?.amountOutUsd);
    if (!response.ok || !(sold > 0) || !(fetched >= 0)) return none(`request failed (${response.status})`, false);
    const loss = Math.min(1, Math.max(0, 1 - fetched / sold));
    const implied = impliedGrade(loss);
    return {
      grade,
      fetchesUsd: Math.round(TOKEN_SALE_USD * (1 - loss) * 100) / 100,
      lossPct: Math.round(loss * 10_000) / 100,
      impliedGrade: implied,
      disagrees: quoteDisagrees(grade, implied, false),
    };
  } catch (error) {
    return none(`request failed (${String(error).slice(0, 60)})`, false);
  }
}
