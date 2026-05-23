import { access, readFile } from "node:fs/promises";

import { portfolioOverviewSchema, type PortfolioOverview } from "@svalin-agent/shared";

type SnapshotFile = {
  wallets: PortfolioOverview[];
};

const candidateSnapshotUrls = [
  new URL("./data/portfolio-snapshots.json", import.meta.url),
  new URL(
    "../../../../../../src/adapters/db/data/portfolio-snapshots.json",
    import.meta.url,
  ),
];

async function resolveSnapshotsFileUrl() {
  for (const candidateUrl of candidateSnapshotUrls) {
    try {
      await access(candidateUrl);
      return candidateUrl;
    } catch {
      continue;
    }
  }

  throw new Error("Unable to locate portfolio snapshot data file.");
}

export async function readPortfolioSnapshots(): Promise<PortfolioOverview[]> {
  const snapshotsFileUrl = await resolveSnapshotsFileUrl();
  const raw = await readFile(snapshotsFileUrl, "utf8");
  const parsed = JSON.parse(raw) as SnapshotFile;

  return parsed.wallets.map((wallet) => portfolioOverviewSchema.parse(wallet));
}
