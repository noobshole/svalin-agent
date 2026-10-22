import { TOKEN_GRADE_FLOORS, type TokenGrade } from "@svalin-agent/shared";
import type { Metadata } from "next";
import Link from "next/link";

import { TokenIndex, gradeTone } from "@/components/token-index";
import { cn } from "@/lib/utils/cn";
import { formatCompactUsd } from "@/lib/utils/formatting";

export const metadata: Metadata = {
  title: "Svalin Index — is the price real? NEAR tokens, graded",
  description:
    "Every NEAR token with a Ref Finance price, graded by the real money behind it: how much of a $1,000 sale would be lost to price movement. Rebuilt every few hours.",
};

const GRADES: TokenGrade[] = ["A", "B", "C", "D", "F"];
/** What a $1,000 sale loses at each grade's backing floor (see TOKEN_GRADE_FLOORS). */
const SALE_LOSS: Record<TokenGrade, string> = {
  A: "$1K sale loses under 0.1%",
  B: "under 1%",
  C: "under 5%",
  D: "under 25%",
  F: "25% or more",
};

export default function RatingsPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-14 md:px-8 md:py-20">
      <section className="grid gap-5">
        <p className="font-mono text-xs text-mutedForeground">svalin index · near tokens</p>
        <h1 className="max-w-3xl text-4xl font-medium leading-[1.08] tracking-tight md:text-[3.25rem]">Is the price real?</h1>
        <p className="max-w-2xl text-base leading-7 text-mutedForeground">
          A price is just a quote. Svalin grades every NEAR token Ref Finance prices by one question: how much of a $1,000 sale would be lost to
          price movement, given the real money in its trading pools?
        </p>
      </section>

      <TokenIndex
        story={
          <div className="grid content-start gap-3 rounded-lg border border-border bg-surface p-6">
            <p className="font-mono text-xs text-mutedForeground">why it matters</p>
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
            <span className="text-foreground">Real backing</span> is the money in a token&apos;s Ref Finance pools, classic and concentrated
            liquidity, held in tokens Svalin trusts: NEAR, USDC, USDT and liquid-staked NEAR. Selling a token can never take out more than that.
            Two unvetted tokens paired with each other add nothing, so the backing cannot be faked without real money.
          </p>
          <p>
            Backing has to hold for 24 hours before it counts, and a token is graded on its lowest backing in that time. A pool added this
            morning cannot lift a grade today, and a pool pulled for an hour still lowers it.
          </p>
          <p>
            <span className="text-foreground">Market cap</span> is the quoted price times total supply, so a token with no backing can claim any
            number. <span className="text-foreground">Top 10 own</span> leaves out exchange pools, bridges and NEAR Intents, which hold tokens for
            many people, and burned tokens. Project treasuries and vesting contracts still count. Holder counts come from NearBlocks.
          </p>
          <p>
            The trusted tokens are the yardstick and are not graded. Grades describe how sellable a token is, not whether its project is good, and
            they are not financial advice. Only Ref Finance pools are counted so far. The index is rebuilt every few hours and each edition
            is kept in the public{" "}
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
          {GRADES.map((grade, position) => {
            const floor = TOKEN_GRADE_FLOORS.find((entry) => entry.grade === grade);
            return (
              <div className={cn("grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3", position > 0 && "border-t border-border")} key={grade}>
                <span className={cn("font-mono text-lg font-medium", gradeTone[grade])}>{grade}</span>
                <span className="font-mono text-sm">{floor ? `${formatCompactUsd(floor.backingUsd)}+ backing` : "under $3K backing"}</span>
                <span className="font-mono text-xs text-mutedForeground">{SALE_LOSS[grade]}</span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
