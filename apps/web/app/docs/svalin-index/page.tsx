import type { Metadata } from "next";
import Link from "next/link";

import { DocPage } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "Svalin Index — Svalin docs",
  description: "How the Svalin Index grades every NEAR token by the real money behind its price, and how anyone can verify a grade.",
};

export default function IndexDocsPage() {
  return (
    <DocPage
      contents={[
        ["grades", "What a grade means"],
        ["backing", "Real backing"],
        ["exit", "Exit prices"],
        ["editions", "Editions you can verify"],
        ["proofs", "Proofs on NEAR"],
        ["try", "Try it"],
      ]}
      lede="Every NEAR token Ref Finance prices, graded by the real money behind its price."
      path="/docs/svalin-index"
      title="Svalin Index"
    >
      <h2 id="grades">What a grade means</h2>
      <p>A grade answers one question: how much of a $1,000 sale would be lost to price movement?</p>
      <div className="table-wrap">
        <table className="keep">
          <thead>
            <tr>
              <th>Grade</th>
              <th>Real backing</th>
              <th>A $1,000 sale loses</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["A", "$1M or more", "under 0.1%"],
              ["B", "$100K or more", "under 1%"],
              ["C", "$20K or more", "under 5%"],
              ["D", "$3K or more", "25% or less"],
              ["F", "under $3K", "more than 25%"],
            ].map(([grade, backing, loss]) => (
              <tr key={grade}>
                <td>{grade}</td>
                <td>{backing}</td>
                <td>{loss}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>Grades describe how sellable a token is, not whether its project is good.</p>

      <h2 id="backing">Real backing</h2>
      <p>
        Real backing is the money a token’s trading pools hold in tokens Svalin trusts, such as NEAR and USDC. A sale can never take out more than that. Only
        trusted money counts, so pools where fake tokens trade against each other add nothing.
      </p>
      <p>Backing also has to hold for 24 hours. A pool added this morning cannot lift a grade today, and a pool pulled for an hour still lowers it.</p>

      <h2 id="exit">Exit prices</h2>
      <p>
        Every token also has exit prices: what selling $1K, $10K or $100K of it would actually fetch, how much can be sold close to the quoted price, and the most
        its whole supply could fetch. They need nothing but an edition’s data, so anyone can recompute them.
      </p>

      <h2 id="editions">Editions you can verify</h2>
      <p>
        The Index is rebuilt every few hours by a public workflow. Each edition keeps the exact data it was computed from and a fingerprint of it, and once a day
        an edition is sealed and never rewritten, so anyone can check that a grade was not changed after the fact. Each edition also records how earlier grades
        moved since, building a public track record. <a href="https://github.com/noobshole/svalin-index">Every edition is on GitHub.</a>
      </p>

      <h2 id="proofs">Proofs on NEAR</h2>
      <p>
        The fingerprint of each sealed edition is also published on NEAR’s test network, in the Svalin Registry. <code>GET /v1/proof/{"{address}"}</code> returns a
        token’s grade with a proof that any NEAR contract can check. It is how <Link href="/docs/guard">Svalin Guard</Link> confirms a grade before buying.
      </p>

      <h2 id="try">Try it</h2>
      <p>
        Browse every grade on the <Link href="/ratings">Index page</Link>, or read it from the API at <code>GET /v1/index/near-tokens</code>.
      </p>
    </DocPage>
  );
}
