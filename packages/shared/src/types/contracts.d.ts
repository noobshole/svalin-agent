import type { ChainFamily, SupportedChainKey } from "./core.js";
export type ChainContract = {
    id: string;
    chain: SupportedChainKey;
    family: ChainFamily;
    name: string;
    address: string;
    explorerUrl: string;
    description: string;
    isTestContract: boolean;
};
export type ChainContractRegistry = {
    generatedAt: string;
    contracts: ChainContract[];
};
