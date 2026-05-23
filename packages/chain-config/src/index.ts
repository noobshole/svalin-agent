import type {
  ChainContract,
  ChainContractRegistry,
  ChainFamily,
  SupportedChainKey,
} from "@svalin-agent/shared";

export type SupportedChain = {
  id: number;
  key: SupportedChainKey;
  family: ChainFamily;
  name: string;
  rpcUrls: {
    default: {
      http: string[];
    };
  };
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  explorerUrl: string;
  features: {
    portfolio: boolean;
    analytics: boolean;
    agent: boolean;
  };
};

const ethereum: SupportedChain = {
  id: 1,
  key: "ethereum",
  family: "evm",
  name: "Ethereum",
  rpcUrls: {
    default: {
      http: ["https://eth.llamarpc.com"],
    },
  },
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  explorerUrl: "https://etherscan.io",
  features: {
    portfolio: true,
    analytics: true,
    agent: true,
  },
};

const base: SupportedChain = {
  id: 8453,
  key: "base",
  family: "evm",
  name: "Base",
  rpcUrls: {
    default: {
      http: ["https://mainnet.base.org"],
    },
  },
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  explorerUrl: "https://basescan.org",
  features: {
    portfolio: true,
    analytics: true,
    agent: true,
  },
};

const solana: SupportedChain = {
  id: 101,
  key: "solana",
  family: "solana",
  name: "Solana",
  rpcUrls: {
    default: {
      http: ["https://api.mainnet-beta.solana.com"],
    },
  },
  nativeCurrency: {
    name: "Solana",
    symbol: "SOL",
    decimals: 9,
  },
  explorerUrl: "https://solscan.io",
  features: {
    portfolio: true,
    analytics: true,
    agent: true,
  },
};

export const supportedChains = [ethereum, base, solana] as const;

export const defaultChain = ethereum;

export const evmChains = supportedChains.filter(
  (chain) => chain.family === "evm",
) as [SupportedChain, ...SupportedChain[]];

export const contractRegistry: ChainContractRegistry = {
  generatedAt: new Date("2026-05-04T00:00:00.000Z").toISOString(),
  contracts: [
    {
      id: "ethereum-svalin-agent-portfolio-lens",
      chain: "ethereum",
      family: "evm",
      name: "Svalin Agent Portfolio Lens",
      address: "0x0000000000000000000000000000000000001001",
      explorerUrl:
        "https://etherscan.io/address/0x0000000000000000000000000000000000001001",
      description:
        "Test read contract placeholder for portfolio aggregation on Ethereum.",
      isTestContract: true,
    },
    {
      id: "ethereum-svalin-agent-agent-module",
      chain: "ethereum",
      family: "evm",
      name: "Svalin Agent Agent Module",
      address: "0x0000000000000000000000000000000000001002",
      explorerUrl:
        "https://etherscan.io/address/0x0000000000000000000000000000000000001002",
      description:
        "Test agent recommendation module placeholder for Ethereum flows.",
      isTestContract: true,
    },
    {
      id: "base-svalin-agent-portfolio-lens",
      chain: "base",
      family: "evm",
      name: "Svalin Agent Portfolio Lens",
      address: "0x0000000000000000000000000000000000002001",
      explorerUrl:
        "https://basescan.org/address/0x0000000000000000000000000000000000002001",
      description:
        "Test read contract placeholder for portfolio aggregation on Base.",
      isTestContract: true,
    },
    {
      id: "base-svalin-agent-agent-module",
      chain: "base",
      family: "evm",
      name: "Svalin Agent Agent Module",
      address: "0x0000000000000000000000000000000000002002",
      explorerUrl:
        "https://basescan.org/address/0x0000000000000000000000000000000000002002",
      description:
        "Test agent recommendation module placeholder for Base flows.",
      isTestContract: true,
    },
    {
      id: "solana-svalin-agent-portfolio-program",
      chain: "solana",
      family: "solana",
      name: "Svalin Agent Portfolio Program",
      address: "VGPort111111111111111111111111111111111111",
      explorerUrl:
        "https://solscan.io/account/VGPort111111111111111111111111111111111111",
      description:
        "Test Solana program identifier placeholder for portfolio reads.",
      isTestContract: true,
    },
    {
      id: "solana-svalin-agent-agent-program",
      chain: "solana",
      family: "solana",
      name: "Svalin Agent Agent Program",
      address: "VGAgent11111111111111111111111111111111111",
      explorerUrl:
        "https://solscan.io/account/VGAgent11111111111111111111111111111111111",
      description:
        "Test Solana program identifier placeholder for recommendation flows.",
      isTestContract: true,
    },
  ] satisfies ChainContract[],
};

export function getChainById(id: number) {
  return supportedChains.find((chain) => chain.id === id);
}
