import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientNearSigner } from "@x402/near";
import { ExactNearScheme } from "@x402/near/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";

import { SpendBudget, usdToAtomic } from "./budget.js";
import type { McpConfig } from "./config.js";
import { PayeeMemory, judgePayment, serviceOf, type PaymentOption } from "./payment-guard.js";

export type SvalinClient = {
  apiUrl: string;
  /** Fetch that pays x402 challenges from the configured wallet, within budget. */
  fetch: typeof fetch;
  /** Plain fetch that never pays: the payment guard uses it to ask a service its price. */
  probe: typeof fetch;
  /** Payees and prices first seen per service; see payment-guard.ts. */
  memory: PayeeMemory;
  canPay: boolean;
  /** A Svalin key is set: paid tools use its calls, and no wallet is needed for them. */
  hasKey: boolean;
  payers: { solana?: string; near?: string };
  budget: SpendBudget;
};

/**
 * Sends the Svalin key, if one is set, to the Svalin API and nowhere else: the payment guard's
 * probes of other x402 services go through a fetch without it.
 */
function withSvalinKey(baseFetch: typeof fetch, apiUrl: string, key: string | undefined): typeof fetch {
  if (!key) return baseFetch;
  const origin = new URL(apiUrl).origin;
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).origin !== origin) return baseFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${key}`);
    return baseFetch(input, { ...init, headers });
  };
}

export async function createSvalinClient(config: McpConfig, probe: typeof fetch = fetch): Promise<SvalinClient> {
  const baseFetch = withSvalinKey(probe, config.SVALIN_API_URL, config.SVALIN_API_KEY);
  const hasKey = Boolean(config.SVALIN_API_KEY);
  const budget = new SpendBudget(usdToAtomic(config.SVALIN_MAX_PRICE_USD), usdToAtomic(config.SVALIN_BUDGET_USD));
  const payers: SvalinClient["payers"] = {};
  const memory = new PayeeMemory(config.SVALIN_PAYEE_MEMORY);
  const service = serviceOf(config.SVALIN_API_URL);

  const preferred = `${config.SVALIN_PREFERRED_NETWORK}:`;
  const client = new x402Client((_version: number, options: PaymentRequirements[]) => {
    return options.find((option) => option.network.startsWith(preferred)) ?? options[0];
  });

  if (config.SVALIN_SOLANA_PRIVATE_KEY) {
    const signer = await createKeyPairSignerFromBytes(base58.decode(config.SVALIN_SOLANA_PRIVATE_KEY.trim()));
    client.register("solana:*", new ExactSvmScheme(signer, config.SVALIN_SOLANA_RPC_URL ? { rpcUrl: config.SVALIN_SOLANA_RPC_URL } : undefined));
    payers.solana = signer.address;
  }
  if (config.SVALIN_NEAR_ACCOUNT_ID && config.SVALIN_NEAR_PRIVATE_KEY) {
    const rpcUrl = config.SVALIN_NEAR_RPC_URL;
    const signer = createClientNearSigner({
      accountId: config.SVALIN_NEAR_ACCOUNT_ID,
      secretKey: config.SVALIN_NEAR_PRIVATE_KEY as `ed25519:${string}`,
      rpcUrls: rpcUrl ? { "near:mainnet": rpcUrl, "near:testnet": rpcUrl } : undefined,
    });
    client.register("near:*", new ExactNearScheme(signer));
    payers.near = config.SVALIN_NEAR_ACCOUNT_ID;
  }

  const canPay = Boolean(payers.solana || payers.near);
  if (!canPay) {
    return { apiUrl: config.SVALIN_API_URL, fetch: baseFetch, probe, memory, canPay, hasKey, payers, budget };
  }

  client.setSpendControls({ maxAmountPerPayment: `$${config.SVALIN_MAX_PRICE_USD}` });
  const asOption = ({ network, asset, amount, payTo }: PaymentRequirements): PaymentOption => ({ network, asset, amount: BigInt(amount), payTo });
  client.onBeforePaymentCreation(async ({ paymentRequired, selectedRequirements }) => {
    const reason = budget.check(BigInt(selectedRequirements.amount));
    if (reason) return { abort: true as const, reason };
    // The same guard as svalin_check_x402_payment, on this server's own payments to Svalin.
    const option = asOption(selectedRequirements);
    const blocked = judgePayment({
      requestedUrl: config.SVALIN_API_URL,
      request: { resourceUrl: paymentRequired.resource?.url ?? null, options: [option] },
      option,
      pin: memory.get(service, option.network),
      memoryFile: memory.file,
    }).filter((entry) => entry.severity === "block");
    return blocked.length > 0 ? { abort: true as const, reason: blocked.map((entry) => entry.message).join(" ") } : undefined;
  });
  client.onAfterPaymentCreation(async ({ selectedRequirements }) => {
    budget.commit(BigInt(selectedRequirements.amount));
    memory.remember(service, asOption(selectedRequirements));
  });

  return {
    apiUrl: config.SVALIN_API_URL,
    fetch: wrapFetchWithPayment(baseFetch, client),
    probe,
    memory,
    canPay,
    hasKey,
    payers,
    budget,
  };
}
