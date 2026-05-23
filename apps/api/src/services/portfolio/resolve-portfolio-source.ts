import { FilePortfolioSource } from "./file-portfolio-source.js";
import { MockPortfolioSource } from "./mock-portfolio-source.js";
import type { PortfolioSource } from "./portfolio-source.js";

export function resolvePortfolioSource(): PortfolioSource {
  const source = process.env.PORTFOLIO_SOURCE ?? "file";

  if (source === "mock") {
    return new MockPortfolioSource();
  }

  return new FilePortfolioSource();
}
