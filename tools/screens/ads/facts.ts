// What each ad page says of itself, the sizes each screen type is written at, and the sheet `bun run screens add` reads.

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export type AdType = "billboard" | "tv" | "laptop";

export interface AdFacts {
  name: string;
  title: string;
  type: AdType;
  kind: "image" | "clip";
  seconds?: number;
  /** The second of a clip its poster is taken at. */
  poster?: number;
  /** It flashes, so no default channel may hold it. */
  flashes?: boolean;
}

/** A creature photographed for the ads by creatures.ts, into art/<name>.png. */
export interface Cut {
  /** The file's name in art/, without .png; a cut of every frame writes <name>-NN.png. */
  name: string;
  id: string;
  clip: string;
  /** The frame, or "all" for every frame of the clip. */
  frame: number | "all";
  /** Degrees around from its front and above, as the review sheet takes them. 270 shows its right side, facing right. */
  around: number;
  above: number;
  width: number;
  height: number;
}

// The raptor, rex and trike are Grab3D and Patch sculpts under CC0, and the dodo is the game's own.
export const CUTS: Cut[] = [
  { name: "raptor-run", id: "core:raptor", clip: "run", frame: "all", around: 270, above: 4, width: 360, height: 180 },
  { name: "raptor-pounce", id: "core:raptor", clip: "jump", frame: 14, around: 285, above: 6, width: 900, height: 600 },
  { name: "rex-roar", id: "core:rex", clip: "call", frame: 45, around: 290, above: 6, width: 900, height: 600 },
  { name: "rex-walk", id: "core:rex", clip: "walk", frame: 0, around: 270, above: 4, width: 900, height: 520 },
  { name: "dodo", id: "core:dodo", clip: "idle", frame: 0, around: 300, above: 8, width: 600, height: 600 },
  { name: "dodo-run", id: "core:dodo", clip: "run", frame: "all", around: 270, above: 4, width: 240, height: 240 },
  { name: "trike", id: "core:trike", clip: "idle", frame: 0, around: 290, above: 8, width: 900, height: 520 },
];

/** The size each type is written at, still and moving, and a clip's top rate in kbit/s. */
export const SIZES: Record<AdType, { image: [number, number]; clip: [number, number]; kbps: number }> = {
  billboard: { image: [1280, 420], clip: [854, 280], kbps: 900 },
  tv: { image: [1280, 720], clip: [854, 480], kbps: 1200 },
  laptop: { image: [1280, 800], clip: [854, 534], kbps: 1200 },
};

/** How long a clip of each type may run, in seconds. */
export const LENGTHS: Record<AdType, [number, number]> = { billboard: [6, 10], tv: [10, 15], laptop: [6, 15] };

export const CHANNELS: Record<AdType, string> = { billboard: "Billboard ads", tv: "TV spots", laptop: "Laptop screens" };

/** Reads and checks the facts in a page's <script type="application/json" id="ad">. */
export function factsOf(file: string): AdFacts {
  const m = readFileSync(file, "utf8").match(/<script type="application\/json" id="ad">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${file}: no ad facts`);
  const f = JSON.parse(m[1]!) as AdFacts;
  const fail = (why: string): never => {
    throw new Error(`${basename(file)}: ${why}`);
  };
  if (`${f.name}.html` !== basename(file)) fail(`its name is ${f.name}`);
  if (!f.title) fail("it has no title");
  if (!SIZES[f.type]) fail(`no screen type ${f.type}`);
  if (f.kind !== "image" && f.kind !== "clip") fail(`no kind ${f.kind}`);
  if (f.kind === "clip") {
    const [lo, hi] = LENGTHS[f.type];
    if (!(f.seconds! >= lo && f.seconds! <= hi)) fail(`a ${f.type} clip runs ${lo} to ${hi} s, not ${f.seconds}`);
    if (f.poster !== undefined && !(f.poster >= 0 && f.poster < f.seconds!)) fail(`its poster at ${f.poster} s is outside it`);
  }
  return f;
}

/** Every ad page in `dir`, in name order. */
export function adsIn(dir: string): { file: string; facts: AdFacts }[] {
  return readdirSync(dir).filter((f) => f.endsWith(".html")).sort().map((f) => ({ file: join(dir, f), facts: factsOf(join(dir, f)) }));
}

const csv = (v: string | number): string => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** The sheet: one row a file, in the columns `bun run screens add` takes. */
export function sheetOf(ads: readonly AdFacts[]): string {
  const head = "file,name,title,kind,types,channels,rights,licence,by,year,poster,audio,flashes";
  const rows = ads.map((f) => [
    `${f.name}.${f.kind === "image" ? "png" : "mp4"}`, f.name, f.title, f.kind, f.type, f.flashes ? "" : CHANNELS[f.type],
    "Made for SNARK, 2026", "Made for the game and given to it under CC0 1.0.", "SNARK", 2026,
    f.kind === "clip" ? (f.poster ?? 0) : "", f.kind === "clip" ? "no" : "", f.flashes ? "yes" : "no",
  ].map(csv).join(","));
  return `${[head, ...rows].join("\n")}\n`;
}
