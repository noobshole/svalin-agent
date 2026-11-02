import { describe, expect, it } from "vitest";

import { unsafeNodeVersion } from "../src/node-version.js";

describe("Node.js version check", () => {
  it("allows each supported line from its October 2026 security release on", () => {
    for (const version of ["v22.23.4", "v22.24.0", "v24.22.1", "v24.23.0", "v26.12.1", "v26.13.0", "v27.0.0"]) {
      expect(unsafeNodeVersion(version)).toBeNull();
    }
  });

  it("refuses older releases, end-of-life lines and odd-numbered lines", () => {
    for (const version of ["v24.15.0", "v24.22.0", "v22.23.3", "v26.12.0", "v20.19.0", "v18.20.4", "v23.11.0", "v25.9.0"]) {
      expect(unsafeNodeVersion(version)).toMatch(/CVE-2026-111497/);
    }
  });
});
