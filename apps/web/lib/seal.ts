/** Drawing for Svalin's seals. The address alone fixes the drawing, so the same address always gets the same seal. */

import type { Theme } from "@/lib/theme";

export type SealTone = "blue" | "red" | "pale" | "green" | "amber" | "soft";
type Grade = "A" | "B" | "C" | "D" | "F";

const TAU = Math.PI * 2;

const INKS: Record<Theme, Record<SealTone, string[]>> = {
  light: {
    blue: ["#465c88", "#2c3c5c", "#ff7a30", "#465c88"],
    red: ["#e4601a", "#ff7a30", "#c2410c", "#e4601a"],
    pale: ["#f3eeeb", "#c7d3e8", "#ffffff", "#f3eeeb"],
    green: ["#2f6f5a", "#4a8f78", "#465c88", "#2f6f5a"],
    amber: ["#a8620f", "#d98a25", "#b9701a", "#a8620f"],
    soft: ["#aeb6c4", "#c3c9d3", "#aeb6c4", "#aeb6c4"],
  },
  dark: {
    blue: ["#97add3", "#e9e3df", "#ff7a30", "#97add3"],
    red: ["#ff7a30", "#ffa060", "#ff5f2e", "#ff7a30"],
    pale: ["#f3eeeb", "#c7d3e8", "#ffffff", "#f3eeeb"],
    green: ["#7fc8a9", "#a6dcc4", "#97add3", "#7fc8a9"],
    amber: ["#f2b56b", "#ffcc8f", "#e89a45", "#f2b56b"],
    soft: ["#4a5262", "#5b6476", "#4a5262", "#4a5262"],
  },
};

/** The ink that goes with a grade. A wallet with no grade stays blue. */
export function gradeSealTone(grade: Grade | null | undefined): SealTone {
  if (!grade) return "blue";
  return grade === "A" || grade === "B" ? "green" : grade === "C" ? "amber" : "red";
}

function fnv(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function randomFrom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paints the seal for `address`, filling a square of side 2R. */
export function paintSeal(g: CanvasRenderingContext2D, R: number, address: string, tone: SealTone, theme: Theme) {
  const random = randomFrom(fnv(address));
  const gradient = g.createConicGradient(random() * TAU, R, R);
  INKS[theme][tone].forEach((ink, index, inks) => gradient.addColorStop(index / (inks.length - 1), ink));
  g.strokeStyle = gradient;
  g.lineWidth = R > 200 ? 0.8 : 0.6;
  g.lineJoin = "round";

  const inner = 0.4;
  const count = random() < 0.5 ? 2 : 3;
  const weights = Array.from({ length: count }, () => 0.7 + random() * 0.6);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = inner;
  for (const weight of weights) {
    const depth = ((0.985 - inner) * weight) / total;
    const centre = at + depth / 2;
    const lobes = 8 + 2 * Math.floor(random() * 9);
    const overtone = 2 + Math.floor(random() * 3);
    const blend = 0.1 + random() * 0.22;
    const direction = random() < 0.5 ? 1 : -1;
    const copies = 18 + Math.floor(random() * 16);
    const steps = lobes * 28;
    for (let copy = 0; copy < copies; copy += 1) {
      const phase = (copy / copies) * TAU;
      g.beginPath();
      for (let step = 0; step <= steps; step += 1) {
        const angle = (step / steps) * TAU;
        const wave = (1 - blend) * Math.sin(lobes * angle + phase) + blend * Math.sin(lobes * overtone * angle - direction * phase * overtone);
        const radius = R * (centre + (depth / 2) * wave);
        const x = R + radius * Math.cos(angle);
        const y = R + radius * Math.sin(angle);
        if (step === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.stroke();
    }
    at += depth;
  }
  for (const ring of [inner - 0.018, 0.993]) {
    g.beginPath();
    g.arc(R, R, R * ring, 0, TAU);
    g.stroke();
  }
}

/** One dot per token, packed like a sunflower head, with the `lit` tokens in the middle. */
export function paintDots(g: CanvasRenderingContext2D, R: number, total: number, lit: number, on: "band" | Theme) {
  const spacing = R * Math.sqrt(Math.PI / Math.max(total, 1));
  const size = Math.max(0.75, spacing * 0.3);
  const pass = (from: number, to: number, radius: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    for (let i = from; i < to; i += 1) {
      const distance = R * 0.985 * Math.sqrt((i + 0.5) / total);
      const angle = i * 2.39996323;
      const x = R + distance * Math.cos(angle);
      const y = R + distance * Math.sin(angle);
      g.moveTo(x + radius, y);
      g.arc(x, y, radius, 0, TAU);
    }
    g.fill();
  };
  pass(lit, total, size, on === "light" ? "rgba(22,25,29,.22)" : on === "dark" ? "rgba(233,227,223,.28)" : "rgba(243,238,235,.34)");
  pass(0, lit, size * 1.55, on === "light" ? "#e4601a" : on === "dark" ? "#ff7a30" : "#ffffff");
}

/** A square off-screen canvas of radius R. */
export function offscreen(R: number, pixelRatio: number, paint: (g: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil(2 * R * pixelRatio);
  const g = canvas.getContext("2d");
  if (g) {
    g.scale(pixelRatio, pixelRatio);
    paint(g);
  }
  return canvas;
}

/** Index counts as the dots need them: every token, and those graded better than F. */
export type IndexCounts = { total: number; failing: number; passing: number };

export function indexCounts(counts: Record<Grade, number>): IndexCounts {
  const passing = counts.A + counts.B + counts.C + counts.D;
  return { total: passing + counts.F, failing: counts.F, passing };
}

/** The edition of 8 Nov 2026, shown until the live numbers arrive. */
export const INDEX_COUNTS_FALLBACK: IndexCounts = { total: 4745, failing: 4660, passing: 85 };
