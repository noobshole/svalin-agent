import type { TokenGrade } from "@svalin-agent/shared";
import type { Metadata } from "next";
import Link from "next/link";

import { TokenIndex, gradeTone } from "@/components/token-index";
import { cn } from "@/lib/utils/cn";

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
    <main className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-14 md:px-8 md:py-20">
      <section className="grid gap-5">
        <p className="eyebrow">Svalin Index · NEAR tokens</p>
        <h1 className="max-w-3xl text-4xl font-medium leading-[1.08] tracking-tight md:text-[3.25rem]">Is the price real?</h1>
        <p className="max-w-2xl text-base leading-7 text-mutedForeground">
          A price is just a quote. Svalin grades every NEAR token Ref Finance prices by one question: how much of a $1,000 sale would be lost to
          price movement, given the real money in its trading pools?
        </p>
      </section>

      <TokenIndex
        story={
          <div className="grid content-start gap-3 rounded-lg border border-border bg-surface p-6">
            <p className="eyebrow">Why it matters</p>
            <h2 className="text-2xl font-medium tracking-tight">The $189 million account that wasn&apos;t.</h2>
            <p className="text-sm leading-6 text-mutedForeground">
              Someone sent <span className="font-mono text-foreground">root.near</span> about 3,900 of a nameless token quoted at $48,447 each. Read
              at face value, the account was worth $189 million. Nothing stood behind that price, so a wallet tool that trusts quotes, or an AI
              agent reading one, sees a fortune. With Svalin&apos;s pool check the account is worth about $109,000.
            </p>
          </div>
        }
      />

      <section className="grid gap-8 border-t border-border pt-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-3 text-sm leading-6 text-mutedForeground">
          <h2 className="text-2xl font-medium tracking-tight text-foreground">How grades work</h2>
          <p>
            <span className="text-foreground">Real backing</span> is the money a token&apos;s trading pools actually hold in tokens Svalin trusts,
            such as NEAR and USDC. Selling a token can never take out more than that, so a price cannot be propped up without real money.
          </p>
          <p>New money has to stay put before it counts, so a pool added this morning cannot lift a grade today.</p>
          <p>
            <span className="text-foreground">Exit prices</span> turn that backing into dollars. Open any token to see what selling $1K, $10K or
            $100K of it would actually fetch, how much can be sold close to the quoted price, and the most its whole supply could fetch. Wallets,
            lenders and agents can get the same numbers, at any sale size, from the API.
          </p>
          <p>
            <span className="text-foreground">Market cap</span> is the quoted price times total supply, so a token with no backing can claim any
            number. <span className="text-foreground">Top 10 own</span> is the share held by the largest holders, leaving out exchange pools and
            bridges.
          </p>
          <p>
            Grades describe how sellable a token is, not whether its project is good, and they are not financial advice. The index is rebuilt
            every few hours and each edition is kept in the public{" "}
            <a
              className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              href="https://github.com/noobshole/svalin-index"
              rel="noreferrer"
              target="_blank"
            >
              svalin-index
            </a>{" "}
            repository.
          </p>
          <p>
            The same check runs inside every Svalin wallet report, so a junk token cannot make a wallet look rich.{" "}
            <Link className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground" href="/#scan">
              Scan a wallet
            </Link>
            .
          </p>
        </div>
        <div className="self-start overflow-hidden rounded-lg border border-border bg-surface">
          <p className="border-b border-border px-5 py-3 font-mono text-xs text-mutedForeground">A $1,000 sale loses</p>
          {GRADES.map((grade, position) => (
            <div className={cn("grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-4 px-5 py-3", position > 0 && "border-t border-border")} key={grade}>
              <span className={cn("font-mono text-lg font-medium", gradeTone[grade])}>{grade}</span>
              <span className="font-mono text-sm">{SALE_LOSS[grade]}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
