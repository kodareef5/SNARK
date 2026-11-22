// The engine of textures made on the card (client/core/texgen/engine.ts), on a fake card: the first pass, then the
// whole, every band's every row once; a frame's share by the card's time or by the tier; the shell's word on what it
// drew; a failed link; and a job the engine was not made for.
import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import type { QueryGl } from "../../client/core/passes.ts";
import { DRAW_INTS, SLICE, SLICE_LOW, TEXGEN_COARSE, TEXGEN_RISE, Texgen, jobFragment, jobPixels, type Job, type Orders } from "../../client/core/texgen/engine.ts";
import { formworkJob } from "../../client/core/texgen/formwork.ts";
import { texgenJobs } from "../../client/core/texgen/late.ts";
import { FIELD_LAYER, FORMWORK_LAYER, MADE_LAYER, TEXGEN_BUDGET, TEXGEN_LAYERS, texgenBytes, texgenSide } from "../../client/core/texgen/layers.ts";

const high = tierOf("high"), medium = tierOf("medium");

/** A job of `layers` layers in `bands` bands, a tap costing `cost`, whose rows say its layer and band. */
const job = (layers: number, bands: number, cost = 1): Job => ({
  layers, bands, pad: 0, taps: [2, 1], cost, rows: 1, glsl: "vec4 made(vec2 at) { return vec4(at, 0.0, 1.0); }",
  fill(layer, band, out, at) {
    out[at] = layer;
    out[at + 1] = band;
  },
  made: (_layer, _band, u, v, out) => out.set([u, v, 0, 1]),
});

/** A card that times a query `ns` long, its result there a frame later, or no timer at all. */
function card(ns: () => number, timed = true) {
  let frame = 0;
  const gl: QueryGl & { tick(): void; disjoint: boolean } = {
    disjoint: false,
    tick: () => void frame++,
    getExtension: (name) => (timed && name === "EXT_disjoint_timer_query_webgl2" ? {} : null),
    getParameter: () => gl.disjoint,
    isContextLost: () => false,
    createQuery: () => ({ at: frame, ns: ns() }),
    deleteQuery: () => {},
    beginQuery: () => {},
    endQuery: () => {},
    getQueryParameter: (q, name) => ((q as { at: number }).at < frame ? (name === 0x8867 ? true : (q as { ns: number }).ns) : false),
    bindFramebuffer: () => {},
    readPixels: () => {},
  };
  return gl;
}

/** The shell's part: every draw carried out, the array made anew where its side changed. */
function shell(o: Orders, held: { side: number }, drawn = o.count): void {
  if (o.side !== held.side) {
    held.side = o.side;
    o.fresh = true;
    return;
  }
  o.begin();
  o.end(drawn);
}

test("the first pass at an eighth of the side, then the whole, every band's every row once and no draw across a band's edge; then it comes up and the finer levels ease in", () => {
  const jobs = [job(3, 2), job(2, 1, 4)], t = new Texgen(jobs), held = { side: 0 };
  const rows = new Map<string, number>();
  const passes: number[] = [];
  let frames = 0;
  for (; frames < 1000 && !t.done; frames++) {
    const o = t.frame(512, high, false);
    shell(o, held);
    for (let k = 0; k < o.drawn; k++) {
      const d = k * DRAW_INTS, [j, layer, level, row, n] = o.draws.slice(d, d + 5), wide = 512 >> level!, band = wide / jobs[j!]!.bands;
      const key = `${level} ${layer}`, at = rows.get(key) ?? 0;
      expect([row, Math.floor(row! / band), Math.floor((row! + n! - 1) / band)]).toEqual([at, Math.floor(at / band), Math.floor(row! / band)]);
      rows.set(key, at + n!);
      // The job's rows follow the engine's two: its layer and band.
      expect([o.uniforms[o.draws[d + 5]! + 8], o.uniforms[o.draws[d + 5]! + 9]]).toEqual([layer! - t.first[j!]!, Math.floor(row! / band)]);
      // The first pass takes twice the taps each way.
      expect(o.uniforms[o.draws[d + 5]! + 4]).toBe(level ? 4 : 2);
    }
    if (o.base >= 0 && o.drawn === o.count) passes.push(o.base, o.minLod);
    if (passes.length === 0) expect(t.ready).toBe(0);
  }
  expect(t.done).toBe(true);
  expect(t.first).toEqual([0, 3]);
  for (let l = 0; l < 5; l++) for (const level of [TEXGEN_COARSE, 0]) expect(rows.get(`${level} ${l}`)).toBe(512 >> level);
  // The first pass is read from its own level, the whole from the top but no finer than the first's level at first.
  expect(passes).toEqual([TEXGEN_COARSE, 0, 0, TEXGEN_COARSE]);
  expect([t.ready, t.orders.minLod, t.frame(512, high, false).count]).toEqual([1, 0, 0]);
});

test("the finer levels ease in over the rise, and the made textures come up over it from the first pass", () => {
  const t = new Texgen([job(1, 1)]), held = { side: 0 }, ready: number[] = [], lod: number[] = [];
  for (let f = 0; f < 400 && !t.done; f++) {
    const o = t.frame(256, high, false);
    ready.push(t.ready);
    lod.push(o.minLod);
    shell(o, held);
  }
  const up = ready.findIndex((r) => r > 0), sharp = lod.findIndex((l) => l > 0);
  expect(ready.slice(up, up + TEXGEN_RISE).every((r, i) => Math.abs(r - (i + 1) / TEXGEN_RISE) < 1e-9)).toBe(true);
  // 256 a side: its first pass is two levels down, which the whole's levels are eased in from.
  expect(lod[sharp]).toBe(2);
  for (let i = 1; i < TEXGEN_RISE; i++) expect(lod[sharp + i]!).toBeLessThan(lod[sharp + i - 1]!);
  expect(lod.at(-1)).toBe(0);
});

test("a frame draws its share: by the tier where the card has no timer, by the card's time smoothed where it has, weighed by each job's cost", () => {
  const units = (o: Orders): number => o.units[o.count - 1]!;
  const slow = new Texgen([job(4, 1)]), fast = new Texgen([job(4, 1)]), held = { side: 0 };
  slow.frame(512, medium, false);
  shell(slow.orders, held);
  expect(units(slow.frame(512, medium, false))).toBeLessThanOrEqual(SLICE_LOW);
  expect(units(fast.frame(512, high, false))).toBeLessThanOrEqual(SLICE);
  // Timed at 10 ns a unit: a millisecond is 100,000 units, which the share comes to once the first time is back.
  let planned = 0, nsPerUnit = 10;
  const gl = card(() => nsPerUnit * planned), timed = new Texgen([job(64, 1)], gl), mine = { side: 0 };
  const shares: number[] = [];
  for (let f = 0; f < 40; f++) {
    const o = timed.frame(512, high, true);
    planned = o.count ? units(o) : 0;
    if (o.count && o.draws[4]! > 1) shares.push(planned);
    shell(o, mine);
    gl.tick();
  }
  expect(shares[0]).toBeLessThanOrEqual(SLICE);
  // All but the frame that ends the first pass, which draws what is left of it.
  expect(shares.slice(2).filter((s) => s > 0.95e5 && s <= 1e5).length).toBe(shares.length - 3);
  // The card slows to 40 ns a unit: the share follows it down, smoothed, never past a millisecond's after the first.
  nsPerUnit = 40;
  const slower: number[] = [];
  for (let f = 0; f < 20; f++) {
    const o = timed.frame(512, high, true);
    planned = o.count ? units(o) : 0;
    slower.push(planned);
    shell(o, mine);
    gl.tick();
  }
  expect(slower.at(-1)).toBeLessThan(0.3e5);
  expect(slower.at(-1)).toBeGreaterThan(0.2e5);
  for (let k = 3; k < slower.length; k++) expect(slower[k]!).toBeLessThanOrEqual(slower[k - 1]! + 1);
  // A disjoint frame's time is not taken.
  gl.disjoint = true;
  nsPerUnit = 1;
  for (let f = 0; f < 6; f++) {
    const o = timed.frame(512, high, true);
    planned = o.count ? units(o) : 0;
    shell(o, mine);
    gl.tick();
  }
  expect(units(timed.frame(512, high, true))).toBeLessThan(0.3e5);
  // A job that costs four times as much draws a quarter of the rows.
  const two = new Texgen([job(1, 1, 1), job(1, 1, 4)]), both = { side: 0 };
  two.frame(512, high, false);
  shell(two.orders, both);
  const rowsOf = (o: Orders, k: number): number => o.draws[k * DRAW_INTS + 4]!;
  let o = two.frame(512, high, false);
  // The first pass is small enough to be drawn in a frame or two; the whole's rows are what tell.
  while (o.draws[2] !== 0) {
    shell(o, both);
    o = two.frame(512, high, false);
  }
  const cheap = rowsOf(o, 0);
  while (o.draws[0] !== 1) {
    shell(o, both);
    o = two.frame(512, high, false);
  }
  expect(rowsOf(o, 0)).toBe(Math.floor(cheap / 4));
});

test("the shell's word: draws it could not carry out are asked for again, a new array begins again, and a failed link turns the making off for good", () => {
  const t = new Texgen([job(2, 2)]), held = { side: 0 };
  shell(t.frame(256, high, false), held);
  const o = t.frame(256, high, false), first = o.draws.slice(0, DRAW_INTS * o.count);
  // A program still linking: nothing drawn, the same again.
  shell(o, held, 0);
  expect(t.frame(256, high, false).draws.slice(0, first.length)).toEqual(first);
  // A new side, or the array made anew (a lost context): from the first pass again.
  shell(t.orders, held);
  t.frame(128, high, false);
  expect(t.orders.side).toBe(128);
  shell(t.orders, held);
  expect(t.frame(128, high, false).draws[3]).toBe(0);
  t.orders.broken = true;
  expect([t.frame(128, high, false).side, t.frame(128, high, false).count, t.ready]).toEqual([0, 0, 0]);
});

test("the warming draws a pixel with each job's program into an array a pixel wide, and the first frame after it begins at its own side", () => {
  const t = new Texgen([job(2, 2), job(1, 1, 4)]), held = { side: 0 }, o = t.warm();
  expect([o.side, o.count, [...o.draws.slice(0, 2 * DRAW_INTS)], o.base, o.mipmap]).toEqual([1, 2, [0, 0, 0, 0, 1, 0, 8, 1, 2, 0, 0, 1, 0, 8], -1, false]);
  shell(o, held);
  shell(o, held);
  expect(o.drawn).toBe(2);
  const first = t.frame(256, high, false);
  expect([first.side, first.count]).toEqual([256, first.count]);
  shell(first, held);
  expect(t.frame(256, high, false).draws[3]).toBe(0);
  const none = new Texgen([job(1, 1)]);
  none.warm();
  expect(none.frame(0, high, false).side).toBe(0);
});

test("the weathering's three jobs at 512 on a card with no timer: its first pass comes up within twelve frames, and all of it is made and eased in within two hundred", () => {
  const t = new Texgen(texgenJobs()), held = { side: 0 };
  let up = -1, frames = 0;
  for (; frames < 800 && !t.done; frames++) {
    shell(t.frame(512, high, false), held);
    if (up < 0 && t.ready > 0) up = frames;
  }
  expect([t.orders.layers, t.first]).toEqual([TEXGEN_LAYERS, [0, FIELD_LAYER, FORMWORK_LAYER, MADE_LAYER]]);
  expect(up).toBeLessThanOrEqual(12);
  // The slots' eight layers are left by the first pass and made whole after the weathering's.
  expect(frames).toBeLessThan(200 + 8 * 40);
  expect(Array.from(t.holds)).toEqual(Array.from({ length: TEXGEN_LAYERS }, () => 1));
});

test("a job of another shape: the formwork's one band, which tiles, drawn as its twin says, its program the engine's, in the layer after the jobs before it", () => {
  const form = formworkJob(), text = jobFragment(form);
  expect(text).toContain("uniform vec4 uJob[2];");
  expect(text).toContain("vec4 made(vec2 at)");
  const px = jobPixels(form, 0, 64);
  // It tiles: its joints lie on its edges, the same either side of its wrap.
  let wrap = 0;
  for (let y = 0; y < 64; y++) wrap += Math.abs(px[(y * 64) * 4]! - px[(y * 64 + 63) * 4]!) + Math.abs(px[y * 4]! - px[(63 * 64 + y) * 4]!);
  expect(wrap).toBeLessThan(64 * 2 * 8);
  const t = new Texgen([job(6, 2), job(2, 1, 4), form]);
  expect([t.first[2], t.orders.layers, t.orders.programs.length]).toEqual([8, 9, 3]);
});

test("the array keeps to its budget: every layer at 512 on medium, high and ultra, a side halved for more layers than fit, and none where even 256 cannot hold them or nothing weathers", () => {
  const ultra = tierOf("ultra"), lowpoly = tierOf("lowpoly");
  for (const tier of [medium, high, ultra]) expect(texgenSide(tier, tier.finishes)).toBe(512);
  expect(texgenBytes(512)).toBeLessThanOrEqual(TEXGEN_BUDGET);
  expect(texgenSide(high, high.finishes, TEXGEN_LAYERS * 2)).toBe(256);
  expect(texgenSide(high, high.finishes, Math.floor(TEXGEN_BUDGET / texgenBytes(256, 1)) + 1)).toBe(0);
  expect([texgenSide(lowpoly, lowpoly.finishes), texgenSide(high, 0)]).toEqual([0, 0]);
});

test("a layer whose version changes is made again whole while the rest are held, and is not held until it is", () => {
  const t = new Texgen([job(2, 1), job(4, 1)]), held = { side: 0 }, want = Int32Array.of(1, 1, 3, 3, 0, 0);
  for (let f = 0; f < 400 && !t.done; f++) shell(t.frame(512, high, false, want), held);
  // A layer asked for at 0 is left unmade.
  expect([t.done, Array.from(t.holds)]).toEqual([true, [1, 1, 3, 3, 0, 0]]);
  want[4] = want[5] = 5;
  want[2] = 7;
  const drawn = new Set<number>();
  let frames = 0;
  for (; frames < 400 && (frames === 0 || !t.done); frames++) {
    const o = t.frame(512, high, false, want);
    for (let d = 0; d < o.count; d++) {
      drawn.add(o.draws[d * DRAW_INTS + 1]!);
      // Whole, never the first pass's level, and the finer levels are not held back again.
      expect([o.draws[d * DRAW_INTS + 2], o.minLod]).toEqual([0, 0]);
    }
    if (o.count > 0) expect([t.holds[2], t.holds[4], t.holds[5], t.holds[3]]).toEqual([0, 0, 0, 3]);
    if (frames === 0) expect(t.done).toBe(false);
    shell(o, held);
  }
  expect([...drawn].sort()).toEqual([2, 4, 5]);
  expect(Array.from(t.holds)).toEqual([1, 1, 7, 3, 5, 5]);
  expect(frames).toBeLessThan(40);
  // A version that changes while its layer is drawn is drawn again at the new one.
  want[3] = 9;
  shell(t.frame(512, high, false, want), held);
  want[3] = 11;
  for (let f = 0; f < 400 && (f === 0 || !t.done); f++) shell(t.frame(512, high, false, want), held);
  expect(t.holds[3]).toBe(11);
});
