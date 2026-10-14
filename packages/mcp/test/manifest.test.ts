import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));

describe("publish metadata", () => {
  const pkg = read("package.json");
  const server = read("server.json");

  it("keeps package.json and the MCP Registry server.json in sync", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it("stays within the registry's 100-character description limit", () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it("marks wallet keys as secrets", () => {
    const keys = server.packages[0].environmentVariables.filter((variable: { name: string }) =>
      variable.name.endsWith("_PRIVATE_KEY"),
    );
    expect(keys.length).toBe(2);
    for (const key of keys) expect(key.isSecret).toBe(true);
  });
});
