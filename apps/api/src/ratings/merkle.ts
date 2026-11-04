import { createHash } from "node:crypto";

import type { RatedTokenRow } from "@svalin-agent/shared";

/**
 * Svalin Index editions as Merkle trees, exactly as the Svalin Ratings registry on NEAR reads them
 * (svalin-guard `crates/svalin-proof`; test/merkle.test.ts checks this against its outputs):
 *
 * - a leaf is `svalin-index/1|<day>|<token>|<grade>|<backing in whole dollars>`;
 * - leaves are sorted by token and hashed as SHA-256(0x00 ‖ leaf), nodes as SHA-256(0x01 ‖ left ‖ right);
 * - an odd node at the end of a level moves up unchanged.
 */
export const LEAF_VERSION = "svalin-index/1";

export type ProofStep = { hash: string; left: boolean };

export function leafText(day: string, token: string, grade: string, backingUsd: number): string {
  return `${LEAF_VERSION}|${day}|${token}|${grade}|${backingUsd}`;
}

function sha256(...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

const LEAF = Uint8Array.of(0);
const NODE = Uint8Array.of(1);

export function leafHash(leaf: string): Buffer {
  return sha256(LEAF, Buffer.from(leaf, "utf8"));
}

function levelUp(level: Buffer[]): Buffer[] {
  const next: Buffer[] = [];
  for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? sha256(NODE, level[i], level[i + 1]) : level[i]);
  return next;
}

/**
 * An edition's tree: the edition's rows sorted by token (leaf order), how many nodes each level
 * has from the leaves up, and node `i` of level `level`.
 */
export type EditionTree = { day: string; rows: RatedTokenRow[]; sizes: number[]; node: (level: number, i: number) => Uint8Array };

function byToken(rows: readonly RatedTokenRow[]): RatedTokenRow[] {
  return [...rows].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}

function levelSizes(leaves: number): number[] {
  const sizes: number[] = [];
  for (let size = leaves; size > 0; size = size === 1 ? 0 : Math.ceil(size / 2)) sizes.push(size);
  return sizes;
}

/** Builds the tree for the edition sealed on `day` from its index rows. */
export function editionTree(day: string, rows: readonly RatedTokenRow[]): EditionTree {
  const sorted = byToken(rows);
  const levels = [sorted.map((row) => leafHash(leafText(day, row[0], row[4], Math.floor(row[3]))))];
  while (levels[levels.length - 1].length > 1) levels.push(levelUp(levels[levels.length - 1]));
  return { day, rows: sorted, sizes: levels.map((level) => level.length), node: (level, i) => levels[level][i] };
}

/**
 * The tree as one file, `near-token-tree.bin`: every level from the leaves up, 32 bytes a node.
 * Building a tree of ~4,700 tokens takes ~50 ms, more CPU than a Cloudflare Worker request gets, so
 * the Index robot writes this file and the API only reads the ~13 nodes a proof needs.
 */
export function treeBytes(tree: EditionTree): Uint8Array {
  return Buffer.concat(tree.sizes.flatMap((size, level) => Array.from({ length: size }, (_, i) => tree.node(level, i))));
}

/** The tree from `treeBytes` for an edition's rows; null if the file does not fit them. */
export function treeFromBytes(day: string, rows: readonly RatedTokenRow[], bytes: Uint8Array): EditionTree | null {
  const sorted = byToken(rows);
  const sizes = levelSizes(sorted.length);
  const offsets: number[] = [];
  let offset = 0;
  for (const size of sizes) {
    offsets.push(offset);
    offset += size * 32;
  }
  if (sizes.length === 0 || offset !== bytes.length) return null;
  return { day, rows: sorted, sizes, node: (level, i) => bytes.subarray(offsets[level] + i * 32, offsets[level] + (i + 1) * 32) };
}

export function treeRoot(tree: EditionTree): string | null {
  return tree.sizes.length === 0 ? null : Buffer.from(tree.node(tree.sizes.length - 1, 0)).toString("hex");
}

/** Where a token's leaf is, by binary search over the rows sorted by token; -1 if it is not there. */
export function leafIndex(tree: EditionTree, token: string): number {
  let low = 0;
  let high = tree.rows.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const found = tree.rows[middle][0];
    if (found === token) return middle;
    if (found < token) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

/** The steps from a token's leaf to the root, or null when the token is not in the edition. */
export function proofFor(tree: EditionTree, token: string): ProofStep[] | null {
  let index = leafIndex(tree, token);
  if (index < 0) return null;
  const steps: ProofStep[] = [];
  for (const [level, size] of tree.sizes.slice(0, -1).entries()) {
    const partner = index ^ 1;
    if (partner < size) steps.push({ hash: Buffer.from(tree.node(level, partner)).toString("hex"), left: partner < index });
    index = Math.floor(index / 2);
  }
  return steps;
}

/** Whether `steps` lead from `leaf` to `root`: what the registry's `verify` checks. */
export function verifyLeaf(root: string, leaf: string, steps: readonly ProofStep[]): boolean {
  let hash = leafHash(leaf);
  for (const step of steps) {
    const sibling = Buffer.from(step.hash, "hex");
    hash = step.left ? sha256(NODE, sibling, hash) : sha256(NODE, hash, sibling);
  }
  return hash.toString("hex") === root;
}
