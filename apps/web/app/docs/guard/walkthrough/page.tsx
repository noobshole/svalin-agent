import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "Make your first vault — Svalin docs",
  description: "Give your agent a key, create a Svalin Guard vault from your wallet, and connect your agent to it.",
};

const VAULT_PAGE = "https://svalin-guard.noobshole.workers.dev";
const AGENT_MJS = "https://github.com/noobshole/svalin-agent/blob/main/guard/examples/demo-agent/agent.mjs";

/** A picture of the vault page, with what to look for in it. */
function Shot({ name, width, height, alt, children }: { name: string; width: number; height: number; alt: string; children: ReactNode }) {
  return (
    <figure>
      <img alt={alt} decoding="async" height={height} loading="lazy" src={`/docs/guard/${name}.webp`} width={width} />
      <figcaption>{children}</figcaption>
    </figure>
  );
}

const PAY = `import { homedir } from "node:os";
import { call, loadKey } from "./near.mjs";

const vault = "yourname-vault.testnet";
const key = loadKey(\`\${homedir()}/.svalin/my-agent.json\`, vault);

// Ask the vault to pay 0.25 USDC (6 decimals, so 250000).
const tx = await call(key, vault, "request_payment", {
  payee: "seller-account.testnet",
  amount: "250000",
  memo: "one weather report",
});
console.log("https://testnet.nearblocks.io/txns/" + tx);`;

export default function GuardWalkthroughPage() {
  return (
    <DocPage
      contents={[
        ["key", "1. Make the agent’s key"],
        ["connect", "2. Connect your wallet"],
        ["rules", "3. Set the rules"],
        ["approve", "4. Approve once"],
        ["fund", "5. Put money in"],
        ["agent", "6. Connect your agent"],
        ["watch", "7. Watch and decide"],
      ]}
      lede={
        <>
          From your wallet to an agent that can only ask. How the vault decides is in <Link href="/docs/guard">Svalin Guard</Link>.
        </>
      }
      note="NEAR testnet. You need a testnet wallet with a little over 6 test NEAR, and Node 22 or newer."
      path="/docs/guard/walkthrough"
      title="Make your first vault"
    >
      <h2 id="key">1. Make the agent’s key</h2>
      <p>
        In the <a href="https://github.com/noobshole/svalin-agent">repository</a>’s <code>guard/examples/demo-agent</code> folder:
      </p>
      <pre>
        <code>node new-key.mjs ~/.svalin/my-agent.json</code>
      </pre>
      <p>It prints the agent’s public key. Copy that for step 3. The file keeps the private key and never leaves the agent’s computer.</p>

      <h2 id="connect">2. Connect your wallet</h2>
      <p>
        Open the <a href={VAULT_PAGE}>vault page</a> and connect your wallet. That wallet owns the vault. Choose <strong>Create a vault</strong>.
      </p>
      <Shot alt="Open your vault. Or make a new one. The connected wallet, its vaults, a Create a vault button, and a box to open a vault by name" height={722} name="w2-your-vaults" width={1600}>
        Connect the same wallet later to see your vaults again.
      </Shot>

      <h2 id="rules">3. Set the rules</h2>
      <p>Name the vault, set three limits, and paste the agent’s public key. A guardian is optional.</p>
      <Shot alt="The vault form: name, three limits, the wait for riskier changes, a guardian, and the agent’s public key" height={1460} name="w4-form" width={1600}>
        Raising a limit, unfreezing or taking money out waits for the time you set here, and you can cancel it in that time.
      </Shot>

      <h2 id="approve">4. Approve once</h2>
      <p>
        Choose <strong>Create the vault</strong> and approve 6 test NEAR in your wallet. The page builds the vault in under a minute.
      </p>
      <Shot alt="Your vault is locked. You own it. With the vault’s name, its code on NEAR and an Open your vault button" height={814} name="w6-done" width={1600}>
        Done. No key can replace the vault’s code or empty it.
      </Shot>

      <h2 id="fund">5. Put money in</h2>
      <p>
        Send test USDC to the vault’s name, from <a href="https://faucet.circle.com">Circle’s faucet</a> or your wallet. The agent’s key needs no
        money.
      </p>

      <h2 id="agent">6. Connect your agent</h2>
      <p>
        Your agent needs the key file from step 1 and the vault’s name. When it wants to pay, it asks the vault. Saved as <code>pay.mjs</code> in
        the same folder:
      </p>
      <pre>
        <code>{PAY}</code>
      </pre>
      <p>
        The vault pays, holds the payment for you, or refuses it, by your rules. The agent’s key can only ask, so a tricked agent cannot empty
        the vault.
      </p>
      <p>
        Any agent can make this call: one on Claude, GPT, Grok or Hermes, an agent framework, or a coding assistant such as Claude Code or Codex.{" "}
        <a href={AGENT_MJS}>agent.mjs</a> shows the same call answering a seller’s 402 price, and paying on Solana.
      </p>

      <h2 id="watch">7. Watch and decide</h2>
      <Shot alt="A vault page: what the agent asked for, what was paid and stopped, and what waits for the owner" height={1308} name="w7-vault" width={1600}>
        Every request shows here: paid, held or refused, with the reason.
      </Shot>
      <p>Held payments wait for you. Connect your wallet on the vault’s page to approve or reject each one.</p>
    </DocPage>
  );
}
