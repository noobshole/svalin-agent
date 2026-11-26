import Link from "next/link";
import type { ReactNode } from "react";

import { Seal } from "@/components/seal";
import { HeroSeal, IndexCount, IndexDots, SealStage } from "@/components/seal-stage";
import { API_BASE_URL } from "@/lib/api";

const QUESTIONS: { question: string; answer: ReactNode }[] = [
  {
    question: "What does a scan tell me?",
    answer: (
      <>
        Paste a Solana address or a NEAR account. Svalin tells you whether it is safe to pay (allow, caution or block, with the reasons) and grades the money it
        holds from A to F. A means the money is well spread, with some in stablecoins. F means most of it sits in one token or in tokens that are hard to
        sell. On NEAR, a scan also shows what the holdings would really sell for.{" "}
        <Link className="link" href="/scan">
          Scan an address
        </Link>
      </>
    ),
  },
  {
    question: "How does Svalin catch a look-alike address?",
    answer: (
      <>
        Scammers pick names that differ by a character, like intent5.near for intents.near. Every scan compares the name with well-known NEAR accounts, so
        intent5.near gets a block. With Svalin Pro, a scan also compares the address with wallets you paid recently, which catches an address planted in your
        own history.
      </>
    ),
  },
  {
    question: "What is the Svalin Index?",
    answer: (
      <>
        A grade for every NEAR token that Rhea Finance (formerly Ref Finance) prices, based on the real money in its trading pools. The grade says how much a $1,000 sale would lose,
        and most tokens get an F because almost nothing stands behind their price. It is rebuilt every few hours, and Solana tokens are planned for early
        2027.{" "}
        <Link className="link" href="/ratings">
          See every grade
        </Link>
      </>
    ),
  },
  {
    question: "What is Svalin Guard?",
    answer: (
      <>
        A vault on NEAR for an AI agent’s money. The agent’s key can only ask to pay, and the vault pays, holds the payment for you, or refuses it by the rules
        you set. It can pay on Solana too. For now it runs on test networks with test money.{" "}
        <Link className="link" href="/guard">
          See how it works
        </Link>
      </>
    ),
  },
  {
    question: "Can Svalin move my money?",
    answer:
      "No. Scan and the Index only read public chain data, and they never ask for a key, a signature or a wallet connection. A Guard vault belongs to you, and Svalin has no key to it.",
  },
  {
    question: "Can my AI agent scan an address before it pays?",
    answer: (
      <>
        Yes. Add the Svalin MCP server to Claude, Cursor or any MCP client, and the agent can run the same scan before every payment. It pays per call from a
        wallet you control, with a limit per call and per session. Before the agent pays any other x402 service, the server can also check that the payee and
        price haven’t changed.{" "}
        <Link className="link" href="/docs/mcp">
          Set it up
        </Link>
      </>
    ),
  },
  {
    question: "What does Svalin Pro add?",
    answer: (
      <>
        Scanning is free for 10 addresses a day, with no account. Svalin Pro is $9 a month or $90 a year, paid in USDC from your own wallet. It gives you 100
        scans or API calls a day, every next step, exit prices at any sale size, and the look-alike check against wallets you paid.{" "}
        <Link className="link" href="/pricing">
          See pricing
        </Link>
      </>
    ),
  },
  {
    question: "Can I check a grade myself?",
    answer: (
      <>
        Yes. Every Index edition is on GitHub with the data it was built from, so anyone can recompute the grades. Once a day an edition is sealed, and its
        fingerprint goes into the Svalin Registry on NEAR’s test network, where any contract can check a grade. The data comes from Helius for Solana, and
        from FastNEAR and Rhea Finance for NEAR.
      </>
    ),
  },
];

export default function HomePage() {
  return (
    <SealStage>
      <main>
        <section className="hero page">
          <h1>
            <span className="hero__top">
              <span className="hero__side hero__left">
                Two <br />
                addresses
              </span>{" "}
              <span className="hero__side hero__right">
                look <br />
                alike.
              </span>
            </span>{" "}
            <span className="hero__last">Their seals can’t.</span>
          </h1>
          <div className="hero__seal">
            <HeroSeal />
          </div>
          <div className="hero__foot">
            <p>Svalin grades wallets, tokens and payments on NEAR and Solana. It only reads public data, so it can never move your money.</p>
            <Link className="btn justify-self-start" href="/scan">
              Scan an address free
            </Link>
          </div>
        </section>

        <section className="beat">
          <div className="page">
            <div className="beat__seal">
              <Seal address="intent5.near" tone="red">
                <span className="grid gap-1 text-riskHigh">
                  <span className="text-[9cqw] leading-none">Block</span>
                  <span className="text-[3.6cqw] leading-none">intent5.near</span>
                </span>
              </Seal>
            </div>
            <div className="beat__text" data-beat="">
              <h2 className="title">
                <span className="dim">intent5.near is</span> not intents.near.
              </h2>
              <p>The names differ by one character, but their seals look nothing alike. Paste an address before you pay it and Svalin answers allow, caution or block.</p>
              <Link className="link justify-self-start" href="/scan?address=intent5.near">
                Scan intent5.near
              </Link>
            </div>
          </div>
        </section>

        <section className="beat beat--blue">
          <div className="page">
            <div className="beat__seal">
              <Seal address="root.near" tone="pale">
                <span className="text-[20cqw] font-light leading-none text-pale">C</span>
              </Seal>
            </div>
            <div className="beat__text" data-beat="">
              <h2 className="title">
                <span className="dim">root.near looks like $189 million.</span> It holds about $93,000.
              </h2>
              <p>
                Someone sent it a nameless token quoted at $48,447 each, with nothing behind that price. Svalin counts real money only, and graded the
                wallet C on 8 Nov 2026.
              </p>
              <Link className="link justify-self-start" href="/scan?address=root.near">
                Scan root.near
              </Link>
            </div>
          </div>
        </section>

        <section className="beat beat--blue">
          <div className="page">
            <div className="beat__seal">
              <IndexDots />
            </div>
            <div className="beat__text" data-beat="">
              <h2 className="title">
                <IndexCount part="failing" /> of <IndexCount part="total" /> <span className="dim">NEAR tokens fail a $1,000 sale.</span>
              </h2>
              <p>
                Each dot is one token. Only the <IndexCount part="passing" /> lit in the middle can take that sale and lose a quarter or less.
              </p>
              <Link className="link justify-self-start" href="/ratings">
                See every grade
              </Link>
            </div>
          </div>
        </section>

        <section className="beat beat--blue">
          <div className="page">
            <div className="beat__text" data-beat="">
              <h2 className="title">
                <span className="dim">Agents pay</span> $0.002 a call.
              </h2>
              <p>
                Agents get the same checks over HTTP or MCP, as JSON. They pay in USDC over x402 on Solana or NEAR with no account, and a call that fails is
                never charged.
              </p>
              <pre tabIndex={0}>
                <code>{`curl ${API_BASE_URL}/v1/demo/scan/root.near`}</code>
              </pre>
              <Link className="link justify-self-start" href="/docs">
                Read the docs
              </Link>
            </div>
          </div>
        </section>

        <section className="faq">
          <div className="page grid4 items-start">
            <h2 className="title lg:col-span-2">Questions</h2>
            <div className="border-b border-border lg:col-span-2">
              {QUESTIONS.map((entry) => (
                <details className="faq__item" key={entry.question}>
                  <summary>{entry.question}</summary>
                  <p>{entry.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
    </SealStage>
  );
}
