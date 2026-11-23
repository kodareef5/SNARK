// A shed's wall bay in corrugated sheet: steel posts and girts with a skin of eight strips. The kit has no such module yet.
// Sheet does not shatter. A strip tears along its corrugation and folds, so what leaves is whole sheets and few of them.

import { RUIN_FINISHES } from "../ruins.ts";
import { PI, detCos, detSin } from "../../shared/math/scalar.ts";
import { Rng } from "../../shared/rng.ts";
import { WALL, boxOf, partBox, partChunk, solidLess, type Chunk, type Part } from "./cut.ts";
import { seedOf, type Component, type Form } from "./forms.ts";
import { prism, type Corner, type Pt, type Rect } from "./geometry.ts";

const NAME = "sheetbay";
const METAL = 89;
/** The bay's half width and height, a strip's width, the skin's thickness. */
const HALF = 4, HIGH = 4, STRIP = 1, SKIN = 0.05;
/** A post's width and depth, a girt's height and depth, and where the girts' undersides are. */
const POST = 0.15, DEEP = 0.2, GIRT = 0.1, GIRTS = [0.6, 2, 3.4] as const;
/** A breach's strips are loose below the middle girt. */
const FOLD = GIRTS[1];

const posts: readonly Part[] = [[-HALF, -HALF + POST], [-POST / 2, POST / 2], [HALF - POST, HALF]].map(([a, b]): Part => ({ r: [a!, b!, 0, HIGH], w0: -DEEP, w1: 0, color: METAL }));
/** A half's run between its posts: the half on x < 0 is -1. */
const run = (side: number): readonly [number, number] => (side < 0 ? [-HALF + POST, -POST / 2] : [POST / 2, HALF - POST]);
const girt = (side: number, at: number, from = run(side)[0], to = run(side)[1]): Part => ({ r: [from, to, at, at + GIRT], w0: -GIRT, w1: 0, color: METAL });
/** A strip of the skin, counted from x = -4, or a part of its height or width. */
const strip = (i: number, y0 = 0, y1 = HIGH, x0 = 0, x1 = STRIP): Part => ({ r: [-HALF + i * STRIP + x0, -HALF + i * STRIP + x1, y0, y1], w0: 0, w1: SKIN });
const bay: Part = { r: [-HALF, HALF, 0, HIGH], w0: -DEEP, w1: SKIN };

/** A unit vector at `degrees`. */
const aim = (degrees: number): Pt => [detCos((degrees * PI) / 180), detSin((degrees * PI) / 180)];

/** A thin plate seen along its hinge: from `o` it runs `length` along `d`, and is `thick` to its left, or to its right if negative. */
function plate(o: Pt, length: number, thick: number, d: Pt): Pt[] {
  const far: Pt = [o[0] + length * d[0], o[1] + length * d[1]];
  return [o, far, [far[0] - thick * d[1], far[1] + thick * d[0]], [o[0] - thick * d[1], o[1] + thick * d[0]]];
}

// A plate turned about a line along x, along y or along z: its section is out and up, along and out, or along and up.
const aboutX = (section: readonly Pt[], x0: number, x1: number, color?: number): Chunk => ({ corners: prism(section, x0, x1, (u, v, w): Corner => [w, v, u]), ...(color !== undefined ? { color } : {}) });
const aboutY = (section: readonly Pt[], y0: number, y1: number): Chunk => ({ corners: prism(section, y0, y1, (u, v, w): Corner => [u, w, v]) });
const aboutZ = (section: readonly Pt[], z0: number, z1: number, color: number): Chunk => ({ corners: prism(section, z0, z1, (u, v, w): Corner => [u, v, w]), color });

/** A girt's length from `pivot` toward `toward`, its free end dropped by `d`'s fall. */
const sagged = (pivot: number, toward: number, at: number, length: number, d: Pt): Chunk =>
  aboutZ(plate([pivot, at], length, toward * GIRT, [toward * d[0], -d[1]]), -GIRT, 0, METAL);

function whole(): Form {
  const parts = [...posts, ...[-1, 1].flatMap((side) => GIRTS.map((at) => girt(side, at))), ...Array.from({ length: 8 }, (_, i) => strip(i))];
  return { name: "whole", note: "", look: { boxes: parts.map((p) => partBox(WALL, p)), chunks: [] }, walked: { boxes: [partBox(WALL, bay)], hulls: [] }, fragments: [], panes: [], bears: false };
}

/**
 * One half torn: the strip second from the end post is folded out about the middle girt, and the next one in is bent out
 * about its far edge. The way through is the folded strip's width and a little of the bent one's.
 */
function breach(name: "breach A" | "breach B", side: -1 | 1, variant: number): Form {
  const rng = new Rng(seedOf(NAME, name, variant));
  const folded = side < 0 ? 1 : 6, bent = side < 0 ? 2 : 5;
  const gap: Rect = side < 0 ? [-3, -1.8, 0, FOLD] : [1.8, 3, 0, FOLD];
  const parts: Part[] = [...posts, ...[-1, 1].flatMap((s) => [girt(s, GIRTS[1]), girt(s, GIRTS[2])]), girt(-side, GIRTS[0])];
  for (let i = 0; i < 8; i++) if (i !== folded && i !== bent) parts.push(strip(i));
  const chunks: Chunk[] = [];
  // The folded strip's lower part hangs out from the girt like a flap, and the bent one's stands out like a door ajar.
  const hinge = -HALF + folded * STRIP;
  chunks.push(aboutX(plate([0, FOLD], FOLD, SKIN, aim(-90 + rng.range(62, 82))), hinge, hinge + STRIP));
  const swing = rng.range(20, 35);
  chunks.push(aboutY(plate([side, 0], STRIP, side * SKIN, aim(side < 0 ? 180 - swing : swing)), 0, FOLD));
  // The lowest girt is cut where the way through is. Its longer stub, at the middle post, sags in some variants.
  const [from, to] = run(side);
  const short = rng.range(0.05, 0.4), long = rng.range(0, 0.25), sags = rng.float() < 0.5, fall = aim(rng.range(8, 15));
  parts.push(side < 0 ? girt(side, GIRTS[0], from, gap[0] - short) : girt(side, GIRTS[0], gap[1] + short, to));
  const length = (side < 0 ? to - gap[1] : gap[0] - from) - long;
  if (sags) chunks.push(sagged(side < 0 ? to : from, side, GIRTS[0], length, fall));
  else parts.push(side < 0 ? girt(side, GIRTS[0], to - length, to) : girt(side, GIRTS[0], from, from + length));
  // The upper part of one of the two strips drops in some variants.
  const drops = [-1, folded, bent][rng.int(3)]!;
  for (const i of [folded, bent]) if (i !== drops) parts.push(strip(i, FOLD));
  const fragments = drops < 0 ? [] : [[partChunk(WALL, strip(drops, FOLD))]];
  return { name, note: "two strips torn and bent", look: { boxes: parts.map((p) => partBox(WALL, p)), chunks }, walked: { boxes: solidLess(WALL, [bay], [gap]), hulls: [] }, fragments, panes: [], bears: false };
}

/** The numbers 0 to n - 1 in a seeded order. */
function shuffled(rng: Rng, n: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = rng.int(i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

/** The skin off: a torn strip or two left hanging from the top girt, the lowest girts gone or down, and the frame. */
function open(variant: number): Form {
  const rng = new Rng(seedOf(NAME, "open", variant));
  const parts: Part[] = [...posts, ...[-1, 1].flatMap((s) => [girt(s, GIRTS[1]), girt(s, GIRTS[2])])];
  const chunks: Chunk[] = [];
  const first = rng.int(8), hung = rng.float() < 0.6 ? [first, (first + 2 + rng.int(5)) % 8] : [first];
  // What leaves of each strip: all of it, or what is left of one that hangs.
  const leaving: Chunk[][] = Array.from({ length: 8 }, (_, i) => (hung.includes(i) ? [] : [partChunk(WALL, strip(i))]));
  const top = GIRTS[2] + GIRT;
  for (const i of hung) {
    // A hanging strip keeps its head on the girt. Below, all its width or half of it hangs to a torn end, tilted out.
    const low = rng.range(1, 2.4), narrow = rng.float() < 0.5, left = rng.float() < 0.5;
    const [x0, x1] = !narrow ? [0, STRIP] : left ? [0, STRIP / 2] : [STRIP / 2, STRIP];
    parts.push(strip(i, top));
    chunks.push(aboutX(plate([0, top], top - low, SKIN, aim(-90 + rng.range(4, 11))), -HALF + i * STRIP + x0, -HALF + i * STRIP + x1));
    leaving[i]!.push(partChunk(WALL, strip(i, 0, low)));
    if (narrow) leaving[i]!.push(partChunk(WALL, left ? strip(i, low, top, STRIP / 2, STRIP) : strip(i, low, top, 0, STRIP / 2)));
  }
  for (const side of [-1, 1]) {
    if (rng.float() < 0.35) continue;
    // A lowest girt that is not gone holds at one post and lies down to the floor.
    const [from, to] = run(side), fromEnd = rng.float() < 0.5, length = to - from, fall = (GIRTS[0] - 0.03) / length;
    chunks.push(sagged(fromEnd === side < 0 ? from : to, fromEnd === side < 0 ? 1 : -1, GIRTS[0], length, [Math.sqrt(1 - fall * fall), fall]));
  }
  // Four to six sheets leave: some strips go as a pair still lapped, the second buckled out a little.
  const pairs = 2 + rng.int(3), runs = shuffled(rng, 8 - pairs).map((k) => (k < pairs ? 2 : 1));
  const fragments: Chunk[][] = [];
  let i = 0;
  for (const n of runs) {
    const sheet = [...leaving[i]!];
    if (n === 2) {
      const flat = !hung.includes(i) && !hung.includes(i + 1);
      sheet.push(...(flat ? [aboutY(plate([-HALF + (i + 1) * STRIP, 0], STRIP, SKIN, aim(rng.range(5, 12))), 0, HIGH)] : leaving[i + 1]!));
    }
    fragments.push(sheet);
    i += n;
  }
  const walked = [...posts, girt(-1, GIRTS[2]), girt(1, GIRTS[2])].map((p) => boxOf(WALL, p.r, p.w0, p.w1));
  return { name: "open", note: "the skin off its frame", look: { boxes: parts.map((p) => partBox(WALL, p)), chunks }, walked: { boxes: walked, hulls: [] }, fragments, panes: [], bears: false };
}

export function sheetBay(): Component {
  const finish = RUIN_FINISHES.rustsheet;
  return {
    name: NAME, family: "sheet cladding", material: "sheet", finish: [finish.color, finish.under], skin: [partBox(WALL, bay)], apart: [0, -0.3, 7.5],
    forms: (variant) => [whole(), breach("breach A", -1, variant), breach("breach B", 1, variant), open(variant)],
  };
}
