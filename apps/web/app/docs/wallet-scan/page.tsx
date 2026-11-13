import type { Metadata } from "next";
import Link from "next/link";

import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "Wallet Scan — Svalin docs",
  description: "How Svalin grades a Solana wallet or NEAR account from A to F: what the score measures and what a grade does not say.",
};

export default function WalletScanPage() {
  return (
    <DocPage
      contents={[
        ["get", "What you get"],
        ["score", "How the score is built"],
        ["grades", "What each grade means"],
        ["not-rated", "Wallets that are not rated"],
        ["limits", "What a grade does not say"],
        ["try", "Try it"],
      ]}
      lede="A risk grade for any Solana wallet or NEAR account, from how its money is spread."
      path="/docs/wallet-scan"
      title="Wallet Scan"
    >
      <h2 id="get">What you get</h2>
      <p>Svalin returns a priced portfolio and a risk report: a score from 0, the safest, to 100, a grade from A to F, and findings with next steps.</p>
      <p>
        On NEAR, a report also says what the wallet would actually fetch if everything were sold now. A position that is large next to the real money in its
        pools cannot be sold at its quoted price, so a wallet that looks rich may not be.
      </p>

      <h2 id="score">How the score is built</h2>
      <p>The score adds three parts. The same holdings always get the same score.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th>Points</th>
              <th>What it looks at</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Concentration</td>
              <td data-label="Points">Up to 45</td>
              <td data-label="What it looks at">The largest bet outside stablecoins, from 30% of the wallet up to 80%. A token and its staked forms count as one bet.</td>
            </tr>
            <tr>
              <td>Stablecoin cushion</td>
              <td data-label="Points">Up to 20</td>
              <td data-label="What it looks at">Added when stablecoins are under 15% of the wallet, and highest at none.</td>
            </tr>
            <tr>
              <td>Long tail</td>
              <td data-label="Points">Up to 35</td>
              <td data-label="What it looks at">
                Tokens outside Svalin’s curated list, and memecoins at 60% of their value, up to 50% of the wallet. On NEAR, each long-tail token counts by its
                liquidity grade: less for real backing, in full for none.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 id="grades">What each grade means</h2>
      <div className="table-wrap">
        <table className="keep">
          <thead>
            <tr>
              <th>Grade</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["A", "20 or less"],
              ["B", "40 or less"],
              ["C", "60 or less"],
              ["D", "80 or less"],
              ["F", "above 80"],
            ].map(([grade, score]) => (
              <tr key={grade}>
                <td>{grade}</td>
                <td>{score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        A means the money is spread out, with some in stablecoins and little in tokens that are hard to sell. F means most of it sits in one token or in tokens
        that are hard to sell, with almost nothing in stablecoins.
      </p>

      <h2 id="not-rated">Wallets that are not rated</h2>
      <p>A wallet with nothing Svalin can price is not rated, so a fresh or spam-only wallet never shows as an A.</p>

      <h2 id="limits">What a grade does not say</h2>
      <ul>
        <li>It measures how holdings are spread, not whether the owner can be trusted.</li>
        <li>
          It is not a token’s grade. The <Link href="/docs/svalin-index">Svalin Index</Link> grades how sellable one token is; a wallet full of B-grade tokens
          can still carry high risk if one of them is 80% of it.
        </li>
        <li>Positions inside DeFi protocols are seen only if they are held as tokens with a price.</li>
        <li>Solana prices are used as the data provider quotes them; the check of real pool money covers NEAR only for now.</li>
      </ul>

      <h2 id="try">Try it</h2>
      <p>
        Free on the <Link href="/scan">Scan page</Link>, or over the API at <code>GET /v1/risk/{"{address}"}</code>. See <Link href="/docs/routes">Routes</Link>.
      </p>
    </DocPage>
  );
}
