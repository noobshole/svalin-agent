import { fetchContractRegistry } from "@/lib/api/contracts";

export default async function ContractsPage() {
  const registry = await fetchContractRegistry();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10 md:px-10">
      <section className="rounded-[2rem] border border-border bg-white/5 p-8 shadow-glow">
        <div className="space-y-3">
          <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-primary">
            Contract registry
          </span>
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Multi-chain test contracts
          </h1>
          <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
            These are test-ready contract and program identifiers for the current
            supported chains. EVM stays on wagmi today, while Solana is now part of
            the shared chain model and contract registry.
          </p>
        </div>
      </section>

      <section className="grid gap-4">
        {registry.contracts.map((contract) => (
          <article
            className="rounded-3xl border border-border bg-card/80 p-6 backdrop-blur-xl"
            key={contract.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{contract.name}</h2>
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-primary">
                    {contract.chain}
                  </span>
                  <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {contract.family}
                  </span>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {contract.description}
                </p>
              </div>
              <span className="rounded-full border border-border bg-background/50 px-3 py-1 text-xs text-muted-foreground">
                {contract.isTestContract ? "Test contract" : "Production contract"}
              </span>
            </div>

            <div className="mt-4 rounded-2xl border border-border bg-background/60 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Address / Program ID
              </p>
              <p className="mt-2 break-all font-mono text-sm">{contract.address}</p>
              <a
                className="mt-3 inline-flex text-sm text-primary hover:underline"
                href={contract.explorerUrl}
                rel="noreferrer"
                target="_blank"
              >
                View on explorer
              </a>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
