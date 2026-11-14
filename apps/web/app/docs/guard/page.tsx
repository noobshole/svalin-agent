import type { Metadata } from "next";
import Link from "next/link";

import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "Svalin Guard — Svalin docs",
  description: "How a Svalin Guard vault decides each payment, who holds which key, and what it cannot do. On NEAR’s test network.",
};

export default function GuardDocsPage() {
  return (
    <DocPage
      contents={[
        ["open", "Open or create a vault"],
        ["keys", "Who holds which key"],
        ["agent-key", "Give your agent a key"],
        ["decisions", "How a payment is decided"],
        ["limits", "Limits"],
        ["buying", "Buying tokens"],
        ["solana", "Paying on Solana"],
        ["owner", "What the owner can do"],
        ["cannot", "What it cannot do"],
      ]}
      lede={
        <>
          A vault on NEAR for an AI agent’s money. See it stop a dishonest seller on the <Link className="link" href="/guard">Guard page</Link>.
        </>
      }
      note="On NEAR’s test network and Solana devnet, with test money."
      path="/docs/guard"
      title="Svalin Guard"
    >
      <h2 id="open">Open or create a vault</h2>
      <p>
        Both happen on the <a className="link" href="https://svalin-guard.noobshole.workers.dev">vault page</a>, from your own wallet. Step by
        step, with pictures: <Link href="/docs/guard/walkthrough">Make your first vault</Link>.
      </p>
      <ul>
        <li>
          <strong>To create one,</strong> connect your wallet, choose a name and your limits, paste your agent’s public key (see{" "}
          <a href="#agent-key">Give your agent a key</a>), and approve 6 test NEAR once. The NEAR stays in the vault to store its code.
        </li>
        <li>
          <strong>To open yours,</strong> connect your wallet: it lists the vaults you own. Anyone can open a vault by its name to read it.
        </li>
      </ul>

      <h2 id="keys">Who holds which key</h2>
      <ul>
        <li>
          <strong>The agent</strong> holds one key. It can ask for a payment or a token buy. It cannot approve, change a rule or start a withdrawal; it can
          only deliver a withdrawal the owner has already waited for, to the address the owner chose.
        </li>
        <li>
          <strong>The owner</strong> uses their own wallet, on another device than the agent, to approve what is held and to change the rules.
        </li>
        <li>
          <strong>The guardian</strong> is a second device, or someone the owner trusts. It can freeze the vault, cancel a waiting change and reject a
          held payment. It approves a large payment together with the owner, never alone. If the owner’s wallet is lost, it can start a recovery
          to a new owner; that waits, and the owner can cancel it.
        </li>
        <li>
          <strong>Svalin</strong> has no key to any vault. It publishes the grades the vault checks.
        </li>
      </ul>
      <p>Setting up a vault deletes the key that deployed it, so from then on only the code decides.</p>

      <h2 id="agent-key">Give your agent a key</h2>
      <p>
        The agent signs its requests with a key of its own. With Node 22 or newer, in the repository’s <code>guard/examples/demo-agent</code>{" "}
        folder:
      </p>
      <pre>
        <code>node new-key.mjs ~/.svalin/my-agent.json</code>
      </pre>
      <p>
        Paste the public key it prints into the vault page. Give the agent the file and the vault’s name. The file holds the private key: never
        paste it anywhere. The vault page only takes the public one.
      </p>
      <p>
        Any agent can hold the key, built on any model; Svalin runs no one’s agent. The key can only ask.{" "}
        <Link href="/docs/guard/walkthrough#agent">Connect your agent</Link> shows the call it makes.
      </p>

      <h2 id="decisions">How a payment is decided</h2>
      <p>Every request ends in one of three answers, recorded on NEAR with a reason: paid, held for the owner, or refused. No model takes part.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>The request</th>
              <th>The vault</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>A payee whose name reads like a well-known account or a past payee</td>
              <td data-label="The vault">Refused; one a letter away is held</td>
            </tr>
            <tr>
              <td>A payee it has never paid</td>
              <td data-label="The vault">Checked in secure hardware first: refused if the account does not exist, held if it is under a day old or the check cannot run</td>
            </tr>
            <tr>
              <td>Over a limit</td>
              <td data-label="The vault">Held</td>
            </tr>
            <tr>
              <td>A price or payee that changed since the first payment</td>
              <td data-label="The vault">Held</td>
            </tr>
            <tr>
              <td>A quote that has expired</td>
              <td data-label="The vault">Refused</td>
            </tr>
            <tr>
              <td>The same item again within 15 minutes</td>
              <td data-label="The vault">Held</td>
            </tr>
            <tr>
              <td>Three look-alikes or forged grades within an hour</td>
              <td data-label="The vault">The vault freezes itself</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="limits">Limits</h2>
      <p>
        A payee the vault has paid before gets the full per-payment limit; a new one gets a smaller limit. One daily limit covers both chains. With a
        guardian set, a held payment above the limits needs both the owner and the guardian.
      </p>

      <h2 id="buying">Buying tokens</h2>
      <p>
        To buy a token, the agent brings its liquidity grade from the <Link href="/ratings">Svalin Index</Link> with a Merkle proof. The vault refuses a
        grade below the owner’s minimum or from an edition older than the owner allows (D and 2 days on the test vaults), then asks the Registry on NEAR to confirm the proof. A
        forged grade is refused and counts toward the freeze. The vault writes the swap itself, so the agent cannot route the money into another token.
      </p>
      <p>The owner approves the market pools the vault may buy in, and the worst price accepted in each. Approving a pool waits, like any riskier change.</p>
      <p>Each buy pays a fee set when the vault is made, 0.1% on the test vaults and 1% at most. Payments carry no fee.</p>

      <h2 id="solana">Paying on Solana</h2>
      <p>
        The vault’s Solana address comes from NEAR Chain Signatures. Nobody holds its key, and NEAR’s signing network signs only when the vault asks. For
        a Solana x402 quote the vault runs the same limits and look-alike checks, then writes the payment itself.
      </p>

      <h2 id="owner">What the owner can do</h2>
      <ul>
        <li>
          <strong>Safer changes happen at once:</strong> lower a limit, freeze the vault, remove the agent.
        </li>
        <li>
          <strong>Riskier changes wait,</strong> 24 hours by default, and can be cancelled: raise a limit, add a payee, unfreeze, or take any money out.
          A stolen owner key cannot empty the vault in one go.
        </li>
        <li>
          <strong>A fingerprint on a phone</strong> can reject a payment or freeze the vault at any time. It can approve only a payment to someone the
          vault has already paid, within the limits, and it can never change a rule or take money out.
        </li>
      </ul>

      <h2 id="cannot">What it cannot do</h2>
      <ul>
        <li>It runs on test networks only, so it holds test money.</li>
        <li>It cannot tell good data from bad, or see whether a seller delivered.</li>
        <li>Locked terms trust the first price a service asks, unless the owner locks them first.</li>
        <li>An agent that has been taken over can leave out what it is buying. Its payments still meet the limits and the look-alike checks, but not the locked terms.</li>
        <li>In a pool the owner approved, an agent that has been taken over can still trade at the owner’s worst price, within the limits.</li>
        <li>The exam vault on the Guard page runs an earlier version, made before approved pools.</li>
        <li>The check of new payees trusts OutLayer and Intel’s hardware, and it covers NEAR accounts, not Solana addresses.</li>
        <li>Payments on Solana trust NEAR’s signing network.</li>
        <li>There is no sanctions screening yet.</li>
        <li>A stolen owner key can still take the money once the wait is over if no one is watching, so set a guardian.</li>
      </ul>
    </DocPage>
  );
}
