// The pier's break set, and the heaps and hung forms other families call (content/breaks).

import { expect, test } from "bun:test";
import { chunkVolume, formFaults, leftVolume, lookVolume } from "../../content/breaks/check.ts";
import type { Chunk } from "../../content/breaks/cut.ts";
import { VARIANTS, type Form } from "../../content/breaks/forms.ts";
import { heapForm, hungPanel, hungSlab, type HeapAsk } from "../../content/breaks/heap.ts";
import { pier } from "../../content/breaks/pier.ts";

const WHOLE = 0.9 * 0.9 * 8;
const variants = Array.from({ length: VARIANTS }, (_, v) => v);
const form = (name: string, variant: number): Form => pier().forms(variant).find((f) => f.name === name)!;
const volume = (chunks: readonly Chunk[]): number => chunks.reduce((s, c) => s + chunkVolume(c), 0);
const points = (f: Form): (readonly [number, number, number])[] => [
  ...f.look.chunks.flatMap((c) => c.corners), ...f.walked.hulls.flatMap((h) => h.corners),
  ...f.look.boxes.flatMap((b) => [-1, 1].map((s) => [b.at[0] + s * b.half[0], b.at[1] + s * b.half[1], b.at[2] + s * b.half[2]] as const)),
];

const HEAPS: readonly Omit<HeapAsk, "variant">[] = [
  { name: "wall8", kind: "wall", footprint: [-4, 4, -0.25, 0.25], floor: 0, volume: 8 * 2.8 * 0.5, finishColor: 75 },
  { name: "wall16", kind: "wall", footprint: [-0.3, 0.3, -8, 8], floor: 4, volume: 16 * 4 * 0.6 },
  { name: "floor8", kind: "slab", footprint: [-4, 4, -4, 4], floor: 0, volume: 8 * 8 * 0.4 },
  { name: "floor16", kind: "slab", footprint: [0, 8, 0, 16], floor: 8, volume: 8 * 16 * 0.4 },
  { name: "pier8", kind: "pier", footprint: [-0.45, 0.45, -0.45, 0.45], floor: 0, volume: WHOLE },
];

test("the pier has its six forms in order, and none has a fault in any variant", () => {
  for (const v of variants) {
    const forms = pier().forms(v);
    expect(forms.map((f) => f.name)).toEqual(["whole", "breach A", "breach B", "open", "hung", "heap"]);
    for (const f of forms) expect([f.name, v, formFaults(f)]).toEqual([f.name, v, []]);
  }
});

test("a necked pier still bears, is walked whole, and its cover and what stands make the pier", () => {
  for (const v of variants) for (const [name, lo, hi] of [["breach A", 0, 4], ["breach B", 4, 8]] as const) {
    const f = form(name, v);
    expect(f.bears).toBe(true);
    expect(f.walked).toEqual(form("whole", v).walked);
    expect(f.fragments.length).toBeGreaterThanOrEqual(4);
    expect(f.fragments.length).toBeLessThanOrEqual(6);
    // The bars are not counted.
    const stands = volume(f.look.chunks.filter((c) => c.color === undefined));
    expect(Math.abs(stands + leftVolume(f) - WHOLE)).toBeLessThan(WHOLE * 0.001);
    for (const p of f.fragments.flat().flatMap((c) => c.corners)) expect(p[1] > lo && p[1] < hi).toBe(true);
    expect(f.look.boxes.length + f.look.chunks.filter((c) => c.color !== undefined).length / 2).toBe(4);
  }
});

test("the stub and the shaft fill the pier with no gap or overlap, bars and chips aside", () => {
  for (const v of variants) {
    const f = form("open", v);
    const stub = f.look.chunks, shaft = f.fragments[0]!;
    expect(f.fragments.length).toBe(3);
    expect(Math.abs(volume(stub) + volume(shaft) - WHOLE)).toBeLessThan(WHOLE * 0.001);
    // With the bars and the chips in, as the sheet counts them.
    expect(Math.abs(lookVolume(f.look) + leftVolume(f) - WHOLE)).toBeLessThan(WHOLE * 0.02);
    // Each prism of the shaft stands on the head of one prism of the stub, point for point.
    expect(shaft.length).toBe(stub.length);
    shaft.forEach((prism, i) => expect(prism.corners.slice(3)).toEqual(stub[i]!.corners.slice(3)));
    const head = stub.flatMap((c) => c.corners.slice(3).map((p) => p[1]));
    expect(Math.max(...head) - Math.min(...head)).toBeLessThanOrEqual(0.32);
    expect(Math.max(...head) - Math.min(...head)).toBeGreaterThan(0.2);
    // The walked box stops at the head's lowest point.
    expect(f.walked.boxes[0]!.at[1] + f.walked.boxes[0]!.half[1]).toBeCloseTo(Math.min(...head), 3);
    expect(f.look.boxes.length).toBeGreaterThanOrEqual(3);
    expect(f.bears).toBe(false);
  }
});

test("a variant makes the same forms twice, and two variants differ", () => {
  for (const v of variants) expect(pier().forms(v)).toEqual(pier().forms(v));
  for (const name of ["breach A", "breach B", "open", "hung", "heap"]) {
    const looks = variants.map((v) => JSON.stringify([form(name, v).look, form(name, v).fragments]));
    expect(new Set(looks).size).toBe(VARIANTS);
  }
});

test("every variant of a standing form of the pier is walked alike", () => {
  for (const name of ["whole", "breach A", "breach B", "open", "hung"]) for (const v of variants) expect(form(name, v).walked).toEqual(form(name, 0).walked);
});

test("the leaning pier is 8 degrees out of plumb with its foot where it was", () => {
  for (const v of variants) {
    const f = form("hung", v), body = f.look.chunks[0]!.corners;
    expect(body.slice(0, 4).every((p) => p[1] === 0 && Math.abs(p[2]) === 0.45)).toBe(true);
    expect(Math.min(...body.slice(4).map((p) => p[1]))).toBeGreaterThanOrEqual(7.2);
    const solid = f.walked.hulls[0]!.corners;
    expect(Math.atan((solid[6]![2] - 0.45) / solid[6]![1]) * (180 / Math.PI)).toBeCloseTo(8, 1);
    expect(f.fragments.length).toBe(1);
    expect(f.bears).toBe(false);
  }
});

test("a heap of each kind has no fault and lies within 1.2 m of its footprint", () => {
  for (const ask of HEAPS) for (const v of variants) {
    const f = heapForm({ ...ask, variant: v });
    expect([ask.name, v, formFaults(f)]).toEqual([ask.name, v, []]);
    expect([f.name, f.bears, f.fragments.length]).toEqual(["heap", false, 0]);
    expect(f.walked.hulls.length).toBeGreaterThanOrEqual(3);
    for (const c of f.look.chunks) expect(c.corners.length).toBeGreaterThanOrEqual(6);
    const [x0, x1, z0, z1] = ask.footprint;
    for (const [x, y, z] of points(f)) {
      expect(x >= x0 - 1.201 && x <= x1 + 1.201 && z >= z0 - 1.201 && z <= z1 + 1.201).toBe(true);
      expect(y).toBeGreaterThanOrEqual(ask.floor - 0.11);
    }
  }
});

test("a slab's heap is under 1.1 m, and a heap's bulk is no more than 1.3 of its piece", () => {
  for (const ask of HEAPS) for (const v of variants) {
    const f = heapForm({ ...ask, variant: v });
    const top = Math.max(...points(f).map((p) => p[1])) - ask.floor;
    if (ask.kind === "slab") expect(top).toBeLessThan(1.1);
    expect(top).toBeGreaterThan(0.5);
    expect(volume(f.look.chunks)).toBeLessThan(ask.volume * 1.3 * 1.1);
    expect(volume(f.look.chunks)).toBeGreaterThan(ask.volume * 0.5);
  }
});

test("heaps of one piece differ by variant, and one variant is the same twice", () => {
  for (const ask of HEAPS) {
    expect(new Set(variants.map((v) => JSON.stringify(heapForm({ ...ask, variant: v }).look))).size).toBe(VARIANTS);
    expect(heapForm({ ...ask, variant: 2 })).toEqual(heapForm({ ...ask, variant: 2 }));
  }
});

test("an 8 m slab hung by each edge has no fault and turns 22 to 30 degrees about it", () => {
  for (const held of ["x0", "x1", "z0", "z1"] as const) for (const v of variants) {
    const f = hungSlab({ name: "floor8", variant: v, bounds: [-4, 4, -4, 4], y0: 3.6, y1: 4, held });
    expect([held, v, formFaults(f)]).toEqual([held, v, []]);
    expect([f.name, f.bears, f.walked.hulls.length]).toEqual(["hung", false, 1]);
    const axis = held.startsWith("x") ? 0 : 2, edge = held.endsWith("0") ? -4 : 4;
    const body = f.walked.hulls[0]!.corners;
    // The held edge's lower line has not moved from its place on the grid, and nothing is past the slab's bounds or over its top.
    expect(body.filter((p) => p[axis] === edge && p[1] === Math.round(3.6 * 4096) / 4096).length).toBe(2);
    for (const p of points(f)) expect(Math.abs(p[0]) <= 4.001 && Math.abs(p[2]) <= 4.001).toBe(true);
    for (const c of f.look.chunks) for (const p of c.corners) expect(p[1]).toBeLessThanOrEqual(4);
    // The body is 0.32 m short of the slab's 8 m, for its teeth.
    const drop = (Math.asin((3.6 - Math.min(...body.map((p) => p[1]))) / 7.68) * 180) / Math.PI;
    expect(drop).toBeGreaterThan(21.9);
    expect(drop).toBeLessThan(30.1);
    // The far edge is in teeth and three bent bars cross the hinge; a slab with no bars shows none.
    expect(f.look.chunks.length).toBeGreaterThanOrEqual(5);
    expect(f.look.boxes.length).toBe(6);
    expect(hungSlab({ name: "floor8", variant: v, bounds: [-4, 4, -4, 4], y0: 3.6, y1: 4, held, barsAt: false }).look.boxes).toEqual([]);
  }
});

test("a hung panel has no fault, one fixing, and its far end about 34 degrees down", () => {
  for (const v of variants) {
    const f = hungPanel({ name: "zpanel8", variant: v, bounds: [-4, 4, 0, 4], z0: -0.3, z1: 0.3 });
    expect([v, formFaults(f)]).toEqual([v, []]);
    expect([f.name, f.bears, f.look.boxes.length, f.look.chunks.length]).toEqual(["hung", false, 1, 1]);
    const [a, b] = f.look.chunks[0]!.corners;
    const degrees = (Math.atan2(a![1] - b![1], Math.abs(b![0] - a![0])) * 180) / Math.PI;
    expect(degrees).toBeGreaterThan(30.9);
    expect(degrees).toBeLessThan(37.1);
    // It stands off the wall line, toward +z.
    expect(Math.min(...f.look.chunks[0]!.corners.map((p) => p[2]))).toBeGreaterThan(-0.3);
  }
});
