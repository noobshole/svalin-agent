import { defaultChain, evmChains } from "@svalin-agent/chain-config";
import { injected } from "@wagmi/core";
import { createConfig, http } from "wagmi";
import type { Chain, Transport } from "viem";

const wagmiChains = evmChains.map(
  (chain): Chain => ({
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: chain.rpcUrls,
    blockExplorers: {
      default: {
        name: `${chain.name} Explorer`,
        url: chain.explorerUrl,
      },
    },
  }),
) as [Chain, ...Chain[]];

const transports = wagmiChains.reduce<Record<number, Transport>>(
  (accumulator, chain) => {
    const rpcUrl = evmChains.find(
      (supportedChain) => supportedChain.id === chain.id,
    )?.rpcUrls.default.http[0];

    accumulator[chain.id] = http(rpcUrl);

    return accumulator;
  },
  {},
);

export const wagmiConfig = createConfig({
  chains: wagmiChains,
  connectors: [injected()],
  transports,
});

export const defaultWagmiChainId = defaultChain.id;
