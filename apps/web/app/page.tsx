import Link from "next/link";
import type { ReactNode } from "react";

import { Seal } from "@/components/seal";
import { HeroSeal, IndexCount, IndexDots, SealStage } from "@/components/seal-stage";
import { API_BASE_URL } from "@/lib/api";

const QUESTIONS: { question: string; answer: ReactNode }[] = [
  {
    question: "Can Svalin move my money?",
    answer: "No. The rating service only reads public chain data. It never asks for keys, signatures or approvals, and none of its code can send funds. Svalin Guard is a separate vault that you own, and Svalin has no key to it.",
  },
  {
    question: "What does a grade mean?",
    answer: (
      <>
        A means the money is spread out, with some in stablecoins and little in tokens that are hard to sell. F means most of it sits in one token or in tokens that are hard to sell, with almost
        nothing in stablecoins. The whole method is public in the{" "}
        <Link className="link" href="/whitepaper">
          whitepaper
        </Link>
        .
      </>
    ),
  },
  {
    question: "Which chains does it cover?",
    answer: "Solana and NEAR, for wallets and payments. The Svalin Index grades NEAR tokens today; Solana tokens are planned for early 2027.",
  },
  {
    question: "What does it cost?",
    answer: (
      <>
        10 checks a day are free, with no account. Svalin Pro is $9 a month for 100 a day, and agents pay $0.002 a call in USDC. See{" "}
        <Link className="link" href="/pricing">
          pricing
        </Link>
        .
      </>
    ),
  },
  {
    question: "Where does the data come from?",
    answer: "Helius for Solana, and FastNEAR and Ref Finance for NEAR. Each Svalin Index edition is published with its inputs, so anyone can check the grades.",
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
              Scan a wallet free
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
              <p>One character apart in text. Nothing alike as seals. Paste an address before you pay it and Svalin answers allow, caution or block.</p>
              <Link className="link justify-self-start" href="/check">
                Check an address
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
              <Link className="link justify-self-start" href="/scan">
                Scan any wallet
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
              <p>The same checks over HTTP or MCP, with JSON back. USDC over x402 on Solana or NEAR, no account. A call that fails is never charged.</p>
              <pre tabIndex={0}>
                <code>{`curl ${API_BASE_URL}/v1/demo/risk/root.near`}</code>
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
