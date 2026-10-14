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

export type SvalinClient = {
  apiUrl: string;
  /** Fetch that pays x402 challenges from the configured wallet, within budget. */
  fetch: typeof fetch;
  canPay: boolean;
  payers: { solana?: string; near?: string };
  budget: SpendBudget;
};

export async function createSvalinClient(config: McpConfig, baseFetch: typeof fetch = fetch): Promise<SvalinClient> {
  const budget = new SpendBudget(usdToAtomic(config.SVALIN_MAX_PRICE_USD), usdToAtomic(config.SVALIN_BUDGET_USD));
  const payers: SvalinClient["payers"] = {};

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
      secretKey: config.SVALIN_NEAR_PRIVATE_KEY as `ed25519:${string}` | `secp256k1:${string}`,
      rpcUrls: rpcUrl ? { "near:mainnet": rpcUrl, "near:testnet": rpcUrl } : undefined,
    });
    client.register("near:*", new ExactNearScheme(signer));
    payers.near = config.SVALIN_NEAR_ACCOUNT_ID;
  }

  const canPay = Boolean(payers.solana || payers.near);
  if (!canPay) {
    return { apiUrl: config.SVALIN_API_URL, fetch: baseFetch, canPay, payers, budget };
  }

  client.setSpendControls({ maxAmountPerPayment: `$${config.SVALIN_MAX_PRICE_USD}` });
  client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
    const reason = budget.check(BigInt(selectedRequirements.amount));
    return reason ? { abort: true as const, reason } : undefined;
  });
  client.onAfterPaymentCreation(async ({ selectedRequirements }) => {
    budget.commit(BigInt(selectedRequirements.amount));
  });

  return {
    apiUrl: config.SVALIN_API_URL,
    fetch: wrapFetchWithPayment(baseFetch, client),
    canPay,
    payers,
    budget,
  };
}
