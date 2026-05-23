import type { Address, SupportedChainKey } from "./core.js";
export type AllocationDatum = {
    label: string;
    valueUsd: number;
    allocationPct: number;
    chain: SupportedChainKey;
};
export type PerformanceDatum = {
    label: string;
    valueUsd: number;
};
export type ChainExposureDatum = {
    chain: SupportedChainKey;
    valueUsd: number;
    allocationPct: number;
};
export type PortfolioAnalytics = {
    wallet: Address;
    generatedAt: string;
    allocation: AllocationDatum[];
    performance: PerformanceDatum[];
    chainExposure: ChainExposureDatum[];
};
