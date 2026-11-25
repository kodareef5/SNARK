// The map events' feed (shared/mapevent/wire.ts): read as it was written, parts and looks alike; a craft rounded to
// what the wire carries before the server uses it; small enough to send whole on every change.

import { expect, test } from "bun:test";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import type { ColumnLook, CraftLook, CraftSpec } from "../../shared/mapevent/parts.ts";
import { MAPEVENT_BYTES, MAPEVENT_ENDED, MAPEVENT_LIVE, MAPEVENT_NOTICE, readMapEvents, wireCraft, writeMapEvents, type CraftRow, type MapEventFeed, type MapEventRow, type SiteRow } from "../../shared/mapevent/wire.ts";
import { Rng } from "../../shared/rng.ts";
import type { PathPoint } from "../../shared/sim/craft.ts";

const DISC: CraftLook = {
  pieces: [{ mesh: "core:ufo_craft", spin: 0 }, { mesh: "core:ufo_rim", spin: 0.3 }, { mesh: "core:ufo_ring", spin: -5 }],
  fallback: "core:event_disc", wreck: "core:ufo_wreck", glow: 0x40e8ff, broken: 0xf4f8ff, ember: 0x1a5a66,
  beam: { rgb: 0x40e8ff, wide: 14, drop: 2.4 }, smoke: { rgb: 0x6a6660, height: 320, wide: 12 }, lean: 1 / 900, sound: "core:ufo",
};
const FIRE: ColumnLook = { kind: "smoke", rgb: 0x553311, height: 200, wide: 8, sound: "" };

/** A path of `n` points across a 16 km map, drawn from a seed. */
function path(n: number, seed: number): PathPoint[] {
  const rng = new Rng(seed);
  return Array.from({ length: n }, (_, i) => ({ x: rng.range(150, 16000), y: rng.range(-50, 2400), z: rng.range(150, 16000), speed: rng.range(5, 250), low: i % 3 === 1 }));
}

const spec = (points: PathPoint[]): CraftSpec => ({ name: "craft", points, hull: { radius: 11, half: 3.2 }, health: 1, look: DISC, fall: { gravity: 7.5, bleed: 0.12 } });

function craftRow(id: number, points: PathPoint[], more: Partial<CraftRow> = {}): CraftRow {
  const w = wireCraft(spec(points));
  return { type: "craft", id, look: 0, after: 0, ...w, stage: 0, shieldUntil: 0, down: 0, impact: 0, rx: 0, ry: 0, rz: 0, ...more };
}

const send = (feed: MapEventFeed): { bytes: number; read: MapEventFeed | null; overflow: boolean } => {
  const w = new BitWriter(MAPEVENT_BYTES);
  writeMapEvents(w, feed);
  const r = new BitReader(w.bytes());
  return { bytes: w.byteLength, read: w.overflow ? null : readMapEvents(r), overflow: w.overflow };
};

test("a feed is read as it was written: looks, events in each state, a craft flying, down and at rest, and a site", () => {
  const flying = craftRow(1, path(14, 1), { after: 90, stage: 2, shieldUntil: 1000 + 600 + 120 });
  const down = craftRow(2, path(5, 2), { stage: 3, down: 1000 + 600 + 400, impact: 1000 + 600 + 400 + 333, rx: 812.5, ry: -12.25, rz: 15999.96875 });
  const site: SiteRow = { type: "site", id: 3, look: 1, x: 400.5, y: 31.25, z: 7000, from: 1000 + 600 + 30, to: 1000 + 600 + 9000 };
  const forever: SiteRow = { ...site, id: 4, to: 0 };
  const rows: MapEventRow[] = [
    { id: 7, kind: "ufo", sound: "core:ufo", state: MAPEVENT_LIVE, called: 1000, start: 1600, ended: 0, parts: [flying, down, site, forever] },
    { id: 8, kind: "meteor", sound: "", state: MAPEVENT_NOTICE, called: 2_000_000_000_000, start: 2_000_000_001_350, ended: 0, parts: [] },
    { id: 65535, kind: "xp_hour", sound: "", state: MAPEVENT_ENDED, called: 10, start: 10, ended: 40, parts: [] },
  ];
  const feed: MapEventFeed = { looks: [{ type: "craft", craft: DISC }, { type: "column", column: FIRE }], rows };
  const { read } = send(feed);
  expect(read).not.toBeNull();
  // A look's numbers are 32-bit floats: as written to a float's precision.
  const look = read!.looks[0]!;
  expect(look.type).toBe("craft");
  if (look.type !== "craft") return;
  expect(look.craft.lean).toBeCloseTo(DISC.lean, 9);
  expect(look.craft.pieces[1]!.spin).toBeCloseTo(0.3, 6);
  expect({ ...look.craft, lean: 0, pieces: look.craft.pieces.map((p) => p.mesh), beam: { ...look.craft.beam!, drop: 0 } }).toEqual({ ...DISC, lean: 0, pieces: DISC.pieces.map((p) => p.mesh), beam: { ...DISC.beam!, drop: 0 } });
  expect(read!.looks[1]).toEqual({ type: "column", column: FIRE });
  // What the server simulates comes back to the bit.
  expect(read!.rows).toEqual(rows);
});

test("a craft is rounded to the wire's steps, and what is rounded is read back exactly", () => {
  const rough = path(24, 3);
  const w = wireCraft({ ...spec(rough), hull: { radius: 10.13, half: 3.3 }, fall: { gravity: 7.4, bleed: 0.111 } });
  expect([w.radius, w.half, w.gravity, w.bleed]).toEqual([10.25, 3.25, 7.5, 28 / 255]);
  for (const [i, p] of w.points.entries()) {
    expect(p.x * 32).toBe(Math.round(rough[i]!.x * 32));
    expect(Number.isInteger(p.speed)).toBe(true);
  }
  const row = craftRow(1, rough);
  const { read } = send({ looks: [{ type: "craft", craft: DISC }], rows: [{ id: 1, kind: "ufo", sound: "", state: MAPEVENT_LIVE, called: 0, start: 0, ended: 0, parts: [row] }] });
  expect(read!.rows[0]!.parts[0]).toEqual(row);
});

test("one UFO of fourteen points with its look is under 300 bytes, and eight of them are under 2 KB", () => {
  const ufo = (id: number): MapEventRow => ({ id, kind: "ufo", sound: "core:ufo", state: MAPEVENT_LIVE, called: 5_000_000, start: 5_001_350, ended: 0, parts: [craftRow(1, path(14, id))] });
  const one = send({ looks: [{ type: "craft", craft: DISC }], rows: [ufo(1)] });
  expect(one.bytes).toBeLessThan(300);
  const eight = send({ looks: [{ type: "craft", craft: DISC }], rows: Array.from({ length: 8 }, (_, i) => ufo(i + 1)) });
  expect(eight.bytes).toBeLessThan(2048);
  expect(eight.read!.rows.length).toBe(8);
});

test("a feed past the budget overflows the writer rather than send part of a row", () => {
  const full = (id: number): MapEventRow => ({ id, kind: "ufo", sound: "core:ufo", state: MAPEVENT_LIVE, called: 0, start: 0, ended: 0, parts: Array.from({ length: 7 }, (_, k) => craftRow(k + 1, path(24, id * 10 + k))) });
  expect(send({ looks: [{ type: "craft", craft: DISC }], rows: Array.from({ length: 15 }, (_, i) => full(i)) }).overflow).toBe(true);
  expect(send({ looks: [{ type: "craft", craft: DISC }], rows: Array.from({ length: 3 }, (_, i) => full(i)) }).overflow).toBe(false);
});

test("a message cut short, one naming a look it did not carry, and one giving a craft a column's look are not read", () => {
  const row: MapEventRow = { id: 1, kind: "ufo", sound: "", state: MAPEVENT_LIVE, called: 0, start: 0, ended: 0, parts: [craftRow(1, path(4, 9))] };
  const w = new BitWriter(4096);
  writeMapEvents(w, { looks: [{ type: "craft", craft: DISC }], rows: [row] });
  expect(readMapEvents(new BitReader(w.bytes().slice(0, w.byteLength - 6)))).toBeNull();
  const lost = new BitWriter(4096);
  writeMapEvents(lost, { looks: [{ type: "craft", craft: DISC }], rows: [{ ...row, parts: [{ ...row.parts[0]!, look: 1 } as CraftRow] }] });
  expect(readMapEvents(new BitReader(lost.bytes()))).toBeNull();
  const wrong = new BitWriter(4096);
  writeMapEvents(wrong, { looks: [{ type: "column", column: FIRE }], rows: [row] });
  expect(readMapEvents(new BitReader(wrong.bytes()))).toBeNull();
});
