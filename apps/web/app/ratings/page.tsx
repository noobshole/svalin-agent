import type { TokenGrade } from "@svalin-agent/shared";
import type { Metadata } from "next";
import Link from "next/link";

import { TokenIndex, gradeTone } from "@/components/token-index";

export const metadata: Metadata = {
  title: "Svalin Index — is the price real? NEAR tokens, graded",
  description:
    "Every NEAR token with a Ref Finance price, graded by the real money behind it: how much of a $1,000 sale would be lost to price movement. Rebuilt every few hours.",
};

const GRADES: TokenGrade[] = ["A", "B", "C", "D", "F"];
/** What a $1,000 sale loses at each grade. */
const SALE_LOSS: Record<TokenGrade, string> = {
  A: "under 0.1%",
  B: "under 1%",
  C: "under 5%",
  D: "25% or less",
  F: "more than 25%",
};

export default function RatingsPage() {
  return (
    <main className="page main">
      <TokenIndex
        intro={
          <>
            <h1 className="display">
              <span className="dim">Is the</span> price real?
            </h1>
            <p className="lede">
              A price is just a quote. Svalin grades every NEAR token Ref Finance prices by one question: how much of a $1,000 sale would be lost to price movement, given the real money in
              its trading pools?
            </p>
          </>
        }
        story={
          <div className="grid content-start gap-4 lg:col-span-2">
            <h2 className="title">The $189 million account that wasn’t</h2>
            <p className="max-w-[34em]">
              Someone sent root.near about 3,900 of a nameless token quoted at $48,447 each. Read at face value, the account was worth $189 million. Nothing stood behind that price, so a
              wallet tool that trusts quotes, or an AI agent reading one, sees a fortune. On 8 Nov 2026, Svalin’s pool check put the account at about $93,000.
            </p>
          </div>
        }
      />

      <section className="grid4 mt-16 border-t-2 border-foreground pt-6 lg:mt-24">
        <div className="grid content-start gap-4 lg:col-span-2">
          <h2 className="title">How liquidity grades work</h2>
          <div className="grid max-w-[34em] gap-4">
            <p>
              <strong className="font-medium">Real backing</strong> is the money a token’s trading pools actually hold in tokens Svalin trusts, such as NEAR and USDC. Selling a token can
              never take out more than that, so a price cannot be propped up without real money.
            </p>
            <p>New money has to stay put before it counts, so a pool added this morning cannot lift a grade today.</p>
            <p>
              <strong className="font-medium">Exit prices</strong> turn that backing into dollars. Open any token to see what selling $1K, $10K or $100K of it would actually fetch, how much
              can be sold close to the quoted price, and the most its whole supply could fetch. Wallets, lenders and agents can get the same numbers, at any sale size, from the API.
            </p>
            <p>
              <strong className="font-medium">Market cap</strong> is the quoted price times total supply, so a token with no backing can claim any number.{" "}
              <strong className="font-medium">Top 10 own</strong> is the share held by the largest holders, leaving out exchange pools and bridges.{" "}
              <strong className="font-medium">Holders</strong> with a + is a lower bound, and a token marked <strong className="font-medium">Test token</strong> says so in its own on-chain
              name.
            </p>
            <p>
              Grades describe how sellable a token is, not whether its project is good, and they are not financial advice. The index is rebuilt every few hours and each edition is kept in
              the public{" "}
              <a className="link" href="https://github.com/noobshole/svalin-index" rel="noreferrer" target="_blank">
                svalin-index
              </a>{" "}
              repository.
            </p>
            <p>
              The same check runs inside every Svalin wallet report, so a junk token cannot make a wallet look rich, and a token’s liquidity grade sets how much it adds to the
              wallet’s portfolio risk.{" "}
              <Link className="link" href="/scan">
                Scan a wallet
              </Link>
              .
            </p>
          </div>
        </div>
        <div className="grid content-start gap-4 lg:col-span-2">
          <h2 className="title">A $1,000 sale loses</h2>
          <dl className="border-b border-border">
            {GRADES.map((grade) => (
              <div className="line" key={grade}>
                <dt className={`text-lg ${gradeTone[grade]}`}>{grade}</dt>
                <dd>{SALE_LOSS[grade]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
