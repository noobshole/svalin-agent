"use client";

import { serviceInfoSchema, type ServiceInfo } from "@svalin-agent/shared";
import { useEffect, useState } from "react";

import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/utils/cn";

type Network = ServiceInfo["payments"]["networks"][number];

const chainOf = (network: Network) =>
  network.network.startsWith("solana:") ? "Solana" : network.network.startsWith("near:") ? "NEAR" : network.label;
const isLive = (network: Network) =>
  network.environment ? network.environment === "mainnet" : !/testnet|devnet/i.test(network.label);

/**
 * Which chains take real USDC right now, read live from the API: each chain switches from its test
 * network to mainnet on its own, and this stays right without rebuilding the site.
 */
export function PaymentNetworks({ className }: { className?: string }) {
  const [networks, setNetworks] = useState<Network[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/`, { signal: controller.signal })
      .then((response) => response.json())
      .then((body) => setNetworks(serviceInfoSchema.parse(body).payments.networks))
      .catch(() => {
        if (!controller.signal.aborted) setNetworks([]);
      });
    return () => controller.abort();
  }, []);

  if (!networks || networks.length === 0) return null;
  const live = networks.filter(isLive).map(chainOf);
  const test = networks.filter((network) => !isLive(network)).map(chainOf);
  const list = (chains: string[]) => chains.join(" and ");
  let sentence: string;
  if (test.length === 0) sentence = `Payments are in real USDC on ${list(live)}.`;
  else if (live.length === 0) sentence = `Payments on ${list(test)} use free test USDC for now, while real USDC opens chain by chain.`;
  else sentence = `${list(live)} takes real USDC; ${list(test)} still uses free test USDC for now.`;
  return <p className={cn("text-sm text-mutedForeground", className)}>{sentence}</p>;
}
