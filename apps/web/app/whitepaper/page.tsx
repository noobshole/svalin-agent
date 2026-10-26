import type { Metadata } from "next";
import Link from "next/link";

import { DocPage, Status } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "Whitepaper — Svalin",
  description:
    "Svalin: verifiable risk ratings, a check before paying, and on-chain guardrails for agent money on NEAR and Solana.",
};

const contents = [
  ["problem", "The problem"],
  ["principles", "Design principles"],
  ["overview", "How Svalin fits together"],
  ["ratings", "Svalin Ratings"],
  ["registry", "Svalin Registry"],
  ["guard", "Svalin Guard"],
  ["chains", "NEAR and Solana"],
  ["security", "Security model"],
  ["limits", "Limitations"],
  ["references", "References"],
];

export default function WhitepaperPage() {
  return (
    <DocPage
      eyebrow="Whitepaper · Public edition · October 2026"
      lede="A read-only service that tells AI agents what is real before they spend, a check before every payment, and a guard contract that makes the chain enforce it."
      title="Verifiable risk ratings and on‑chain guardrails for agent money"
    >
      <nav aria-label="Contents" className="mt-8 rounded-lg border border-border bg-surface px-5 py-4">
        <p className="eyebrow mb-2">Contents</p>
        <ol className="!mb-0 grid gap-1 sm:grid-cols-2">
          {contents.map(([id, label]) => (
            <li key={id}>
              <a className="!no-underline text-mutedForeground hover:text-foreground" href={`#${id}`}>
                {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <h2>Summary</h2>
      <p>
        AI agents now hold and spend money. They can be talked into bad decisions, and the data they read can be fake: a token can carry a price with
        no money behind it, and an address can be planted to look like one the agent has paid before.
      </p>
      <p>
        Svalin is a read-only service that rates what an agent is about to touch. It grades tokens by the trusted money in their trading pools, scores
        wallets for concentration and exposure, and checks a recipient before a payment. Every token grade can be recomputed by anyone from archived
        inputs. Two planned additions follow: the <strong>Svalin Registry</strong> puts grades on-chain where contracts can read them, and{" "}
        <strong>Svalin Guard</strong> lets an owner give an agent spending power under rules the blockchain enforces. Svalin itself never holds a key to
        anyone&apos;s funds. What is live and what comes next is on the <Link href="/roadmap">roadmap</Link>.
      </p>

      <h2 id="problem">1. The problem</h2>
      <h3>Agents can be talked into things</h3>
      <p>
        In May 2026 a hidden instruction made an AI agent linked to Grok and Bankr transfer tokens reported at $150,000 to $204,000. No key and no
        contract was compromised; the model simply followed an instruction it should have refused. This is prompt injection, and it works on any agent
        that reads the open web.
      </p>
      <h3>A quoted price is only a quote</h3>
      <p>
        Anyone can create a token, give it a price and send it to a wallet. A tool that trusts the quoted price sees a fortune that cannot be sold. In
        the Svalin Index edition of 24 October 2026, only 96 of 4,419 NEAR tokens with a quoted price had enough real money behind them to grade above F.
        Several unvetted tokens borrow famous names such as NEAR or USDT, quoted like the real thing with a few dollars behind them.
      </p>
      <h3>A look-alike address steals the next payment</h3>
      <p>
        In address poisoning, an attacker sends a tiny transfer from an address with the same first and last characters as one the victim uses, so
        the victim copies the wrong one from their history. One victim lost about $50 million in USDT this way in December 2025. Agents that reuse
        recent addresses are an easy target.
      </p>
      <h3>Advice an agent can skip is not a safeguard</h3>
      <p>
        Scanners help only when the agent asks and obeys. An agent manipulated into a bad payment can also be manipulated into skipping the check.
        Limits that matter have to live outside the agent, in code it cannot change.
      </p>

      <h2 id="principles">2. Design principles</h2>
      <ul>
        <li>
          <strong>Read-only core.</strong> The rating service has no code path that signs for, approves or moves the funds of a wallet it analyses.
        </li>
        <li>
          <strong>Deterministic.</strong> The same inputs always give the same output. No language model computes a number.
        </li>
        <li>
          <strong>Verifiable.</strong> Index editions archive their inputs and fingerprints, so anyone can recompute every grade.
        </li>
        <li>
          <strong>Enforced, not advised.</strong> Where it matters, rules are checked by a contract the agent cannot bypass.
        </li>
        <li>
          <strong>Never charged for errors.</strong> Bad input is rejected before payment, and failed calls are never settled.
        </li>
      </ul>

      <h2 id="overview">3. How Svalin fits together</h2>
      <div className="mb-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {[
          { name: "Ratings", status: "live" as const, body: "Turn market data into grades, reports and a check before paying. Sold per call over x402." },
          { name: "Registry", status: "planned" as const, body: "Publishes token grades on-chain, so contracts and agents can read them." },
          { name: "Guard", status: "planned" as const, body: "Enforces an owner's rules, including a minimum grade, on whatever the agent tries to do." },
        ].map((layer) => (
          <div className="grid content-start gap-2 bg-surface p-4" key={layer.name}>
            <p className="!mb-0 font-medium text-foreground">
              {layer.name}
              <Status kind={layer.status} />
            </p>
            <p className="!mb-0 text-sm leading-6">{layer.body}</p>
          </div>
        ))}
      </div>
      <p>
        In everyday terms: the Ratings are a food-safety inspector that grades every token. The Registry is the grade sticker in the window, readable
        by anyone. The Guard is a company card with rules: the employee, here the agent, can only spend through it, and it declines F-rated places,
        purchases over the limit and payments to strangers.
      </p>

      <h2 id="ratings">4. Svalin Ratings</h2>
      <h3>
        Wallet risk reports
        <Status kind="live" />
      </h3>
      <p>
        Given a Solana wallet or a NEAR account, Svalin returns a priced portfolio and a risk report: a score from 0 (safest) to 100, a grade from A
        to F, and findings with next steps. The score looks at how much rides on a single asset, how large the stablecoin cushion is, and how much
        sits in unvetted or meme tokens. It measures how holdings are spread, not whether the owner can be trusted.
      </p>
      <p>
        On NEAR, a report also says what the wallet would actually fetch if everything were sold now. A position that is large next to the real money
        in its pools cannot be sold at its quoted price, so a wallet that looks rich may not be. A wallet with nothing Svalin can price is not rated,
        so a fresh or spam-only wallet never shows as an A.
      </p>

      <h3>
        Check Before Paying
        <Status kind="live" />
      </h3>
      <p>
        Before money moves, the check answers <strong>allow</strong>, <strong>caution</strong> or <strong>block</strong>, with reasons. It is
        deterministic: data sources gather the signals, and one function judges them.
      </p>
      <ul>
        <li>
          <strong>Block:</strong> the address is not a wallet (a token or a program), the account does not exist, or it imitates an address or
          name the payer has paid before.
        </li>
        <li>
          <strong>Caution:</strong> the address is brand new or barely used, runs a contract, is about to receive a large first payment, or its
          history could not be read.
        </li>
        <li>
          <strong>Allow:</strong> none of the above.
        </li>
      </ul>
      <p>
        If the payer&apos;s history cannot be read, the check says so and cautions instead of guessing, because a gap could hide the very payment a
        look-alike imitates. <Link href="/check">Try the free check.</Link>
      </p>

      <h3>
        Token grades: the Svalin Index
        <Status kind="live" />
      </h3>
      <p>
        The Index grades every NEAR token that Ref Finance prices by its <strong>real backing</strong>: the money its trading pools hold in tokens
        Svalin trusts, such as NEAR and USDC. A sale can never take out more than that. The grade answers one question: how much of a $1,000 sale
        would be lost to price movement?
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Grade</th>
              <th>A $1,000 sale loses</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["A", "under 0.1%"],
              ["B", "under 1%"],
              ["C", "under 5%"],
              ["D", "25% or less"],
              ["F", "more than 25%"],
            ].map(([grade, loss]) => (
              <tr key={grade}>
                <td className="font-mono text-foreground">{grade}</td>
                <td>{loss}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Only trusted money counts, so pools where fake tokens trade against each other add nothing: fake tokens and freshly seeded pools were part of
        the April 2026 Rhea Finance exploit. New money also has to stay put before it counts, so a pool added this morning cannot lift a grade today.
        Grades describe how sellable a token is, not whether its project is good. <Link href="/ratings">See the live Index.</Link>
      </p>
      <p>
        Every token also has <strong>exit prices</strong>: what selling $1K, $10K or $100K of it would actually fetch, how much can be sold close
        to the quoted price, and the most its whole supply could fetch. A wallet can show them beside a balance, a lender can size a loan by them,
        and an agent can check them before accepting a token as payment, at any sale size, through the API. They need nothing but an
        edition&apos;s data, so anyone can recompute them.
      </p>

      <h3>
        Verifiable editions
        <Status kind="live" />
      </h3>
      <p>
        The Index is rebuilt every few hours by a public workflow. Each edition keeps the exact data it was computed from and a fingerprint of it, and
        once a day an edition is sealed and never rewritten, so anyone can check that a grade was not changed after the fact. Each edition also
        records how earlier grades moved since, building a public track record.
      </p>

      <h3>
        Tokens are not wallets
        <Status kind="live" />
      </h3>
      <p>
        A token address sent where a wallet was expected gets HTTP 422 with code <code>token_address</code> instead of a meaningless wallet score, and
        the caller is not charged. For a NEAR token, the answer carries its grade.
      </p>

      <h2 id="registry">
        5. Svalin Registry
        <Status kind="planned" />
      </h2>
      <p>
        The Registry is a NEAR contract that holds the latest token grades, so other contracts and agents can read them on-chain. Its layout follows
        the reputation and validation ideas of ERC-8004, the draft standard for trust records about AI agents.
      </p>
      <ul>
        <li>
          <strong>What it stores:</strong> for each graded token, its grade, real backing and edition; for the edition, its fingerprint, time and
          methodology.
        </li>
        <li>
          <strong>Unknown means F:</strong> a token that is not listed has no backing worth grading.
        </li>
        <li>
          <strong>Who can write:</strong> only Svalin&apos;s publishing key, a NEAR key that can publish grades and do nothing else, so even if it
          leaked it could not move money.
        </li>
        <li>
          <strong>How to check it:</strong> the fingerprint on-chain must match the public edition.
        </li>
        <li>
          <strong>Reading is free:</strong> any contract or agent can look up a token&apos;s grade.
        </li>
      </ul>

      <h2 id="guard">
        6. Svalin Guard
        <Status kind="planned" />
      </h2>
      <p>
        The Guard is a small contract an owner deploys on their own account, such as <code>vault.alice.near</code>. It holds a spending budget.
        Someone else, usually an AI agent, gets a key that can only ask the Guard to trade or pay. The Guard checks each request against the
        owner&apos;s rules and the Registry, then executes it, refuses it, or queues it for the owner.
      </p>
      <h3>Roles and keys</h3>
      <ul>
        <li>
          <strong>Owner:</strong> holds a full-access key, sets the policy, approves queued requests, freezes the Guard and withdraws at any time.
        </li>
        <li>
          <strong>Spender:</strong> holds a NEAR function-call key limited to the Guard&apos;s trade and pay methods. It cannot attach funds, call
          other contracts, add keys or withdraw. Its only power is to ask.
        </li>
        <li>
          <strong>Svalin:</strong> publishes grades to the Registry. It has no key to any Guard and no say over any owner&apos;s funds.
        </li>
      </ul>
      <h3>Rules an owner can set</h3>
      <ul>
        <li>A minimum grade for any token the agent buys.</li>
        <li>Spending limits per payment and per day.</li>
        <li>A list of approved recipients, and a waiting period before paying a new one.</li>
        <li>Owner approval above a set amount, and a freeze switch.</li>
      </ul>
      <p>
        The Guard is a general engine: one owner, one limited spender, rules the chain enforces. AI agents come first because they act fastest and are
        easiest to trick, but the same contract suits a trading bot, a team member paying contributors, or a person&apos;s own wallet in a safe mode.
        It is not custody by Svalin, not a full wallet, and not audited yet; until it is, budgets should stay small.
      </p>

      <h2 id="chains">7. NEAR and Solana</h2>
      <p>The rating method is the same on every chain. How grades are published and enforced follows each chain&apos;s own tools.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th>NEAR</th>
              <th>Solana</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Wallet reports and the check</td>
              <td>Live</td>
              <td>Live</td>
            </tr>
            <tr>
              <td>Token grades</td>
              <td>Live: the Svalin Index</td>
              <td>Planned: the same method on Solana pools</td>
            </tr>
            <tr>
              <td>Grades on-chain</td>
              <td>Planned: the Svalin Registry</td>
              <td>Planned: a grade account</td>
            </tr>
            <tr>
              <td>Enforcement</td>
              <td>Planned: Svalin Guard with function-call keys</td>
              <td>Planned: grade rules in existing smart wallets</td>
            </tr>
            <tr>
              <td>Paying Svalin</td>
              <td>x402 in USDC, on testnet today</td>
              <td>x402 in USDC, on devnet today</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <Status kind="research" /> NEAR Chain Signatures let a NEAR contract sign for other chains, including Solana. A Guard on NEAR could then be
        the only signer for an agent&apos;s Solana address: the rules live on NEAR, and the money can sit on Solana.
      </p>

      <h2 id="security">8. Security model</h2>
      <p>Rows about the Guard and the Registry describe their planned design; the rest is how Svalin works today.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Threat</th>
              <th>What limits the damage</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>The agent is tricked by a prompt</td>
              <td>Its key can only ask the Guard. Caps bound the loss; junk tokens and unknown recipients are refused.</td>
            </tr>
            <tr>
              <td>The agent&apos;s key is stolen</td>
              <td>The same limits. The owner freezes the Guard and removes the key.</td>
            </tr>
            <tr>
              <td>A token with a fake price</td>
              <td>Grades count only trusted tokens in pools. No grade means F.</td>
            </tr>
            <tr>
              <td>A pool propped up for a short time</td>
              <td>New money has to stay put before it counts.</td>
            </tr>
            <tr>
              <td>A look-alike payment address</td>
              <td>The check compares it with the payer&apos;s recent payments and blocks it.</td>
            </tr>
            <tr>
              <td>Grades go stale or Svalin goes offline</td>
              <td>The Guard refuses buys once grades pass their maximum age. Owners keep full access to their funds.</td>
            </tr>
            <tr>
              <td>Svalin&apos;s publishing key leaks</td>
              <td>It can only publish, never move money, and fingerprints can be checked against the public editions.</td>
            </tr>
            <tr>
              <td>Token names that read like instructions</td>
              <td>Names are cleaned and capped, and agents are told to treat them as data, never as instructions.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="limits">9. Limitations</h2>
      <ul>
        <li>Grades measure sellability, not quality, and are not investment advice.</li>
        <li>Solana prices are used as the data provider quotes them; the pool check covers NEAR only for now.</li>
        <li>The recipient check sees recent history only, and there is no NEAR scam list yet.</li>
        <li>
          Exit value and exit prices cover NEAR for now and count only NEAR pools, so a token that also trades elsewhere could fetch more. Exit value
          assumes each position is sold on its own.
        </li>
        <li>The Registry and the Guard are designs; the Guard will not be audited at first.</li>
      </ul>

      <h2 id="references">References</h2>
      <ol className="text-sm">
        <li>
          <a href="https://github.com/noobshole/svalin-index">Svalin Index editions</a>
        </li>
        <li>
          <a href="https://metamask.io/news/crypto-security-report-may-2026">MetaMask, crypto security report, May 2026</a> (Grok and Bankr)
        </li>
        <li>
          <a href="https://blockaid.io/blog/address-poisoning-the-growing-threat-draining-millions-from-crypto-users">
            Blockaid, address poisoning
          </a>
        </li>
        <li>
          <a href="https://docs.near.org/protocol/access-keys">NEAR access keys</a> and{" "}
          <a href="https://docs.near.org/chain-abstraction/chain-signatures">Chain Signatures</a>
        </li>
        <li>
          <a href="https://eips.ethereum.org/EIPS/eip-8004">ERC-8004: Trustless Agents</a>
        </li>
        <li>
          <a href="https://www.x402.org">x402</a>
        </li>
      </ol>
    </DocPage>
  );
}
