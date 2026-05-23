"use client";

import { LoaderCircle, LogOut, Wallet } from "lucide-react";
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";

import { Button } from "@/components/ui/button";
import { formatAddress } from "@/lib/utils/formatting";

export function ConnectWalletButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const injectedConnector = connectors[0];

  if (isConnected && address) {
    return (
      <Button className="gap-2" onClick={() => disconnect()} variant="ghost">
        <LogOut className="h-4 w-4" />
        {formatAddress(address)} - {chainId}
      </Button>
    );
  }

  return (
    <Button
      className="gap-2"
      disabled={!injectedConnector || isPending}
      onClick={() => {
        if (injectedConnector) {
          connect({ connector: injectedConnector });
        }
      }}
    >
      {isPending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : (
        <Wallet className="h-4 w-4" />
      )}
      {isPending ? "Connecting..." : "Connect wallet"}
    </Button>
  );
}
