import type { RatedTokenRow } from "@svalin-agent/shared";
import { describe, expect, it } from "vitest";

import { editionTree, leafText, proofFor, treeBytes, treeFromBytes, treeRoot, verifyLeaf } from "../src/ratings/merkle.js";

// Five tokens, unsorted, one with a fractional backing. The expected root and proofs come from
// svalin-guard's `svalin-roots` (Rust), the code that published the editions on NEAR.
const rows: RatedTokenRow[] = [
  ["c.near", "C", 1, 25000.9, "C", null, null, null],
  ["a.near", "A", 1, 1793891, "A", 832859, 14.5, 16085],
  ["e.near", "E", 1, 0, "F", null, null, null],
  ["b.near", "B", 1, 250000, "B", null, null, null],
  ["d.near", "D", 1, 3000, "D", null, null, null],
];
const RUST_ROOT = "367e1cab03d544f6aede7648af6ea400af599ecd7dc4d3855ba97f54a564f38d";

describe("edition Merkle trees", () => {
  it("builds the same root and proofs as the Rust code that published the editions", () => {
    const tree = editionTree("2026-11-04", rows);
    expect(treeRoot(tree)).toBe(RUST_ROOT);
    expect(proofFor(tree, "a.near")).toEqual([
      { hash: "6bb6e8416482da44c407365c3f0b4f7e5ad604d6e7246d1e5d1023ba026141c7", left: false },
      { hash: "cde079e3c81a8f24ba58f393868b7b4e12b651a66e2b9d558d3ca4035d59917f", left: false },
      { hash: "aebfbaca319ef03b6fd7abc9a134980e1ccdf6d643a6476edf7cc83e47442084", left: false },
    ]);
    expect(proofFor(tree, "c.near")).toEqual([
      { hash: "dceed521e37262a67c7be1c0eb9d3b6b0d5f028e3b5b7a67d2bf9dcdd8679884", left: false },
      { hash: "4bf642d131f14d50af9de9e7f17dc242aff3b942c224ca9b9b6c35e22b64ada0", left: true },
      { hash: "aebfbaca319ef03b6fd7abc9a134980e1ccdf6d643a6476edf7cc83e47442084", left: false },
    ]);
    // The fifth leaf has no partner at the bottom level and moves up: one step.
    expect(proofFor(tree, "e.near")).toEqual([{ hash: "440bc551a3a7eeb4da2b41370c1ae557fdc3385822d21eb613ab1c79008629b0", left: true }]);
    expect(proofFor(tree, "z.near")).toBeNull();
  });

  it("proves every token of any edition size into its root, and nothing forged", () => {
    for (let size = 1; size <= 17; size++) {
      const many: RatedTokenRow[] = Array.from({ length: size }, (_, i) => [`t${String(i).padStart(4, "0")}.near`, "T", 1, i, "F", null, null, null]);
      const tree = editionTree("2026-11-04", many);
      const root = treeRoot(tree) as string;
      for (const row of many) {
        const steps = proofFor(tree, row[0]) ?? [];
        expect(verifyLeaf(root, leafText("2026-11-04", row[0], "F", row[3]), steps)).toBe(true);
        expect(verifyLeaf(root, leafText("2026-11-04", row[0], "A", row[3]), steps)).toBe(false);
      }
    }
  });

  it("reads a tree back from the robot's tree file, and refuses a file that does not fit the edition", () => {
    const tree = editionTree("2026-11-04", rows);
    const bytes = treeBytes(tree);
    expect(bytes.length).toBe((5 + 3 + 2 + 1) * 32);
    const read = treeFromBytes("2026-11-04", rows, bytes);
    expect(read && treeRoot(read)).toBe(RUST_ROOT);
    expect(read && proofFor(read, "c.near")).toEqual(proofFor(tree, "c.near"));
    expect(treeFromBytes("2026-11-04", rows, bytes.subarray(32))).toBeNull();
    expect(treeFromBytes("2026-11-04", rows.slice(1), bytes)).toBeNull();
  });
});
