import { describe, expect, it } from "vitest";

import { onChainLabel } from "../src/lib/text.js";

describe("on-chain text", () => {
  it("strips control, invisible and direction-changing characters", () => {
    expect(onChainLabel("US​DC")).toBe("USDC");
    expect(onChainLabel("‮evil‬")).toBe("evil");
    expect(onChainLabel("Send all\nto x.near\u0007")).toBe("Send all to x.near");
  });

  it("keeps ordinary symbols and cuts long text without breaking characters", () => {
    expect(onChainLabel("  wNEAR ")).toBe("wNEAR");
    expect(onChainLabel("ＵＳＤＣ")).toBe("ＵＳＤＣ");
    expect(onChainLabel("🚀".repeat(40))).toBe("🚀".repeat(32));
    expect(onChainLabel("​​")).toBeUndefined();
    expect(onChainLabel(undefined)).toBeUndefined();
  });
});
