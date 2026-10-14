import type { AssetCategory, ChainFamily, SupportedChainKey } from "@svalin-agent/shared";

export type SupportedChain = {
  key: SupportedChainKey;
  family: ChainFamily;
  name: string;
  explorerUrl: string;
  nativeSymbol: string;
};

export const supportedChains: readonly SupportedChain[] = [
  {
    key: "solana",
    family: "solana",
    name: "Solana",
    explorerUrl: "https://solscan.io",
    nativeSymbol: "SOL",
  },
  {
    key: "near",
    family: "near",
    name: "NEAR",
    explorerUrl: "https://nearblocks.io",
    nativeSymbol: "NEAR",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* x402 payment networks (CAIP-2)                                             */
/* -------------------------------------------------------------------------- */

export type PaymentEnvironment = "mainnet" | "testnet";

export type X402NetworkConfig = {
  family: ChainFamily;
  /** CAIP-2 network id used by x402 v2. */
  caip2: string;
  label: string;
};

export const x402Networks: Record<PaymentEnvironment, X402NetworkConfig[]> = {
  mainnet: [
    { family: "solana", caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", label: "Solana" },
    { family: "near", caip2: "near:mainnet", label: "NEAR" },
  ],
  testnet: [
    { family: "solana", caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", label: "Solana Devnet" },
    { family: "near", caip2: "near:testnet", label: "NEAR Testnet" },
  ],
};

/**
 * Default facilitator for Solana. PayAI supports exact-scheme USDC on Solana mainnet
 * without an API key; x402.org is testnet-only. Override with X402_FACILITATOR_URL.
 */
export const defaultFacilitatorUrl: Record<PaymentEnvironment, string> = {
  mainnet: "https://facilitator.payai.network",
  testnet: "https://x402.org/facilitator",
};

/**
 * Default facilitator for NEAR: the FastNEAR reference facilitator. /supported is public;
 * /verify and /settle need an API key issued per network and payee
 * (https://github.com/fastnear/x402-facilitator). Override with NEAR_FACILITATOR_URL.
 */
export const defaultNearFacilitatorUrl: Record<PaymentEnvironment, string> = {
  mainnet: "https://x402.mikedotexe.com",
  testnet: "https://test.x402.mikedotexe.com",
};

/* -------------------------------------------------------------------------- */
/* Token registry — drives risk categorisation                                */
/* -------------------------------------------------------------------------- */

export type KnownToken = {
  chain: SupportedChainKey;
  address: string;
  symbol: string;
  category: Exclude<AssetCategory, "long-tail">;
};

/** Native SOL is reported by Helius separately; this pseudo-mint keeps it addressable. */
export const SOL_NATIVE_MINT = "So11111111111111111111111111111111111111111";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** Native NEAR is an account balance, not a token; this pseudo-contract keeps it addressable. */
export const NEAR_NATIVE_TOKEN = "near";
export const WNEAR_TOKEN = "wrap.near";

export const knownTokens: readonly KnownToken[] = [
  // Solana — native & wrapped
  { chain: "solana", address: SOL_NATIVE_MINT, symbol: "SOL", category: "native" },
  { chain: "solana", address: WSOL_MINT, symbol: "wSOL", category: "native" },
  // Solana — stablecoins
  { chain: "solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", category: "stablecoin" },
  { chain: "solana", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", category: "stablecoin" },
  { chain: "solana", address: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", symbol: "PYUSD", category: "stablecoin" },
  // Solana — liquid staking tokens
  { chain: "solana", address: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL", category: "liquid-staking" },
  { chain: "solana", address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "mSOL", category: "liquid-staking" },
  { chain: "solana", address: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1", symbol: "bSOL", category: "liquid-staking" },
  { chain: "solana", address: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", symbol: "JupSOL", category: "liquid-staking" },
  { chain: "solana", address: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", symbol: "INF", category: "liquid-staking" },
  // Solana — majors
  { chain: "solana", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", category: "major" },
  { chain: "solana", address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", symbol: "JTO", category: "major" },
  { chain: "solana", address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", symbol: "PYTH", category: "major" },
  { chain: "solana", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", category: "major" },
  // Solana — large-cap memes (liquid, but still memes)
  { chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", category: "meme" },
  { chain: "solana", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", category: "meme" },
  // NEAR — native & wrapped
  { chain: "near", address: NEAR_NATIVE_TOKEN, symbol: "NEAR", category: "native" },
  { chain: "near", address: WNEAR_TOKEN, symbol: "wNEAR", category: "native" },
  // NEAR — stablecoins (native Circle USDC, Tether USDt, and the Rainbow-bridged versions)
  { chain: "near", address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", category: "stablecoin" },
  { chain: "near", address: "usdt.tether-token.near", symbol: "USDt", category: "stablecoin" },
  { chain: "near", address: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near", symbol: "USDC.e", category: "stablecoin" },
  { chain: "near", address: "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near", symbol: "USDT.e", category: "stablecoin" },
  // NEAR — liquid staking tokens
  { chain: "near", address: "meta-pool.near", symbol: "stNEAR", category: "liquid-staking" },
  { chain: "near", address: "linear-protocol.near", symbol: "LiNEAR", category: "liquid-staking" },
  { chain: "near", address: "lst.rhealab.near", symbol: "rNEAR", category: "liquid-staking" },
  // NEAR — majors (bridged BTC and ETH)
  { chain: "near", address: "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near", symbol: "WBTC", category: "major" },
  { chain: "near", address: "nbtc.bridge.near", symbol: "nBTC", category: "major" },
  { chain: "near", address: "aurora", symbol: "ETH", category: "major" },
  { chain: "near", address: "eth.bridge.near", symbol: "ETH", category: "major" },
  // NEAR — large-cap memes
  { chain: "near", address: "blackdragon.tkn.near", symbol: "BLACKDRAGON", category: "meme" },
  { chain: "near", address: "token.0xshitzu.near", symbol: "SHITZU", category: "meme" },
];

// Solana base58 and NEAR account IDs are both case-sensitive exact strings.
const tokenIndex = new Map(knownTokens.map((token) => [`${token.chain}:${token.address}`, token]));

export function lookupToken(chain: SupportedChainKey, address: string): KnownToken | undefined {
  return tokenIndex.get(`${chain}:${address}`);
}

export function categoriseToken(chain: SupportedChainKey, address: string): AssetCategory {
  return lookupToken(chain, address)?.category ?? "long-tail";
}
