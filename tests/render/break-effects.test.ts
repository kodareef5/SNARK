// What breaking structures throw up (client/core/break-effects.ts): pieces merged a cell and tick at a time before a
// burst is asked for, what each tier is given, the share of the pool breaks may hold, and the shake of a view near.

import { expect, test } from "bun:test";
import { TIERS, tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { BULLET, BreakEffects, CELL, EVENT, HEARD_CRACK, HEARD_GLASS, HEARD_IMPACT, HEARD_RUMBLE, MOST_EMITTERS, PIECE, hearStructures, type BreakDetails, type StructureListener } from "../../client/core/break-effects.ts";
import { BREAK_CHIPS, BREAK_DUST, BREAK_GLASS, BREAK_SPARKS } from "../../client/core/details/breaks.ts";
import { Details } from "../../client/core/details/details.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { DETAIL_PUFF, FramePacket } from "../../client/core/render/packet.ts";
import { RemoteSample, type Rubble } from "../../client/core/session.ts";
import { JOLT, Jolt } from "../../client/core/sight.ts";
import { ruinKind } from "../../content/ruins.ts";
import { FORM_BREACH_A, formKind } from "../../shared/content/breaks.ts";
import { effectOf, type PackDetails } from "../../shared/pack/details.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { bodyHealth } from "../../shared/world/breaking.ts";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";
import { GONE_BLAST, GONE_DESTROYED, GONE_FELL } from "../../shared/world/structures.ts";
import { createMapWorld } from "../../server/world.ts";
import { flatMap } from "../fixtures/map.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry(), palette = defaultPalette();
const kind = (finish: "concrete" | "rose" | "steel"): number => reg.index.get(ruinKind("wall8", finish))!;
const WALL = kind("concrete"), ROSE = kind("rose"), STEEL = kind("steel");
/** A whole piece that has panes. */
const GLAZED = reg.defs.findIndex((_, k) => reg.glassHp[k]! > 0 && reg.breakSet[k] !== 0 && reg.breakForm[k] === 0);
const MEDIUM = tierOf("medium"), LOW = tierOf("lowpoly");

const piece = (x: number, y: number, z: number, tick: number, map = WALL, cause = GONE_DESTROYED): Rubble => ({ kind: map, x, y, z, yaw: 0, tw: -1, cause, ox: x, oy: y, oz: z, tick, radius: 0, into: 0, map });
/** `n` pieces a tick, spread over `across` by `deep` metres from (64, 2, 64). */
const wave = (n: number, tick: number, across: number, deep: number, map = WALL, cause = GONE_DESTROYED): Rubble[] => {
  const side = Math.ceil(Math.sqrt(n));
  return Array.from({ length: n }, (_, i) => piece(64 + ((i % side) + 0.5) * (across / side), 2, 64 + (Math.floor(i / side) + 0.5) * (deep / side), tick, map, cause));
};

interface Burst { part: number; x: number; y: number; z: number; tick: number; size: number; count: number; rgb: number }
/** What a flush asked the details for, and the sounds it asked for. */
function asked(breaks: BreakEffects, tier: Tier = MEDIUM, ex = 64, ey = 2, ez = 64): { bursts: Burst[]; heard: [what: number, level: number][]; jolts: number[] } {
  const bursts: Burst[] = [], heard: [number, number][] = [], jolts: number[] = [];
  const details: BreakDetails = { breakBurst: (part, _id, x, y, z, _floor, tick, _due, size, count, rgb) => void bursts.push({ part, x, y, z, tick, size, count, rgb }) };
  breaks.flush(details, tier, 0, ex, ey, ez, { breaking: (what, _kind, _x, _y, _z, level) => void heard.push([what, level]) }, { jolt: (amount) => void jolts.push(amount) });
  return { bursts, heard, jolts };
}
const cellOf = (b: Burst): string => `${Math.floor(b.x / CELL)} ${Math.floor(b.y / CELL)} ${Math.floor(b.z / CELL)} ${b.tick}`;
const rgb = (word: number): number[] => [word & 255, (word >>> 8) & 255, (word >>> 16) & 255];
const total = (bursts: readonly Burst[], part = -1): number => bursts.reduce((sum, b) => sum + (part < 0 || b.part === part ? b.count : 0), 0);

test("a wave of 200 pieces queues at most one dust burst an 8 m cell", () => {
  const breaks = new BreakEffects(reg, palette);
  // Three cells by two.
  breaks.take(wave(200, 100, 3 * CELL, 2 * CELL));
  const { bursts } = asked(breaks);
  const dust = bursts.filter((b) => b.part === BREAK_DUST);
  expect(dust.length).toBe(6);
  expect(new Set(dust.map(cellOf)).size).toBe(6);
  for (const part of [BREAK_CHIPS, BREAK_GLASS, BREAK_SPARKS]) expect(bursts.filter((b) => b.part === part).length).toBeLessThanOrEqual(6);
  // Flushed, they are forgotten.
  expect(asked(breaks).bursts).toEqual([]);
});

test("two breaks in one cell on different ticks are two bursts", () => {
  const breaks = new BreakEffects(reg, palette);
  breaks.take([piece(66, 2, 66, 100), piece(67, 2, 67, 100)]);
  expect(asked(breaks).bursts.filter((b) => b.part === BREAK_DUST).length).toBe(1);
  breaks.take([piece(66, 2, 66, 100), piece(67, 2, 67, 101)]);
  expect(asked(breaks).bursts.filter((b) => b.part === BREAK_DUST).map((b) => b.tick).sort()).toEqual([100, 101]);
});

test("a wave over more cells than a flush makes is made at the nearest eight", () => {
  const breaks = new BreakEffects(reg, palette);
  breaks.take(wave(400, 100, 5 * CELL, 4 * CELL));
  const { bursts, heard } = asked(breaks);
  const dust = bursts.filter((b) => b.part === BREAK_DUST);
  expect(dust.length).toBe(MOST_EMITTERS);
  expect(heard.filter(([what]) => what === HEARD_IMPACT).length).toBe(MOST_EMITTERS);
  // A cell far from every one made is left out.
  breaks.take([...wave(64, 100, CELL, CELL), piece(64 + 40 * CELL, 2, 64, 100), ...wave(64, 100, 4 * CELL, 2 * CELL)]);
  expect(asked(breaks).bursts.every((b) => b.x < 64 + 5 * CELL)).toBe(true);
  expect(breaks.dropped).toBe(1);
});

test("a piece gets its tier's particles and a rocket's cells share its event's", () => {
  TIERS.forEach((tier, row) => {
    const breaks = new BreakEffects(reg, palette);
    breaks.take([piece(66, 2, 66, 100)]);
    expect(total(asked(breaks, tier).bursts)).toBe(PIECE[row]!);
    breaks.take(wave(60, 100, 3 * CELL, 2 * CELL, WALL, GONE_BLAST));
    const blast = total(asked(breaks, tier).bursts);
    expect(blast).toBeLessThanOrEqual(EVENT[row]!);
    expect(blast).toBeGreaterThan(EVENT[row]! * 0.9);
  });
});

test("destruction holds at most a quarter of the tier's pool under a 1,024-piece wave", () => {
  const world = createMapWorld(reg, parseMap(writeMap(flatMap(2))));
  const dust: PackDetails = { atlas: { offset: 0, side: 128 }, inputs: "test", sheets: [],
    pictures: [{ id: "test:puff", cell: 0, regions: [-1, -1], grey: 1, flat: 1 }, { id: "test:shard", cell: 1, regions: [-1, -1], grey: 1, flat: 4 }],
    effects: [effectOf("test:dust", { pictures: ["puff"], count: 4, life: 0.5, size: 0.15, colour: "ground", reach: 40, pass: "blend" }, () => 0)] };
  for (const tier of TIERS) {
    const details = new Details(reg, dust, palette, () => null), breaks = new BreakEffects(reg, palette);
    const remote = new RemoteSample(), cam = new Camera(), packet = new FramePacket();
    cam.x = 76; cam.y = 3; cam.z = 60; cam.aspect = 16 / 9; cam.update();
    const quarter = tier.details.pool / 4;
    for (let tick = 0; tick < 6; tick++) {
      breaks.take(wave(1024, tick, 3 * CELL, 3 * CELL));
      breaks.flush(details, tier, tick, cam.x, cam.y, cam.z);
      remote.tick = tick;
      packet.detailCount = 0;
      details.frame(packet, cam, remote, [], [], null, world.hf, tier, (tick / 30) * 1000, world);
      expect(details.breaking).toBeGreaterThan(0);
      expect(details.breaking).toBeLessThanOrEqual(quarter);
      expect(details.pool.count).toBe(details.breaking);
    }
    // Chips are not thinned for the screen's fill, so above low poly the waves come to the whole share.
    if (tier.name !== "lowpoly") expect(details.breaking).toBe(quarter);
    // Low poly makes puffs alone.
    else for (let i = 0; i < details.pool.count; i++) expect(details.pool.flags[i]! & DETAIL_PUFF).toBe(DETAIL_PUFF);
  }
});

artTest("the pack's own dust and shard pictures draw a break", () => {
  const world = createMapWorld(reg, parseMap(writeMap(flatMap(2)))), pack = corePack(), pictures = pack.header.details!.pictures;
  const details = new Details(reg, pack.header.details, pack.palette, () => null), breaks = new BreakEffects(reg, pack.palette);
  const remote = new RemoteSample(), cam = new Camera(), packet = new FramePacket();
  cam.x = 70; cam.y = 3; cam.z = 60; cam.aspect = 16 / 9; cam.update();
  breaks.take(wave(6, 0, CELL, CELL, ROSE));
  breaks.flush(details, MEDIUM, 0, cam.x, cam.y, cam.z);
  details.frame(packet, cam, remote, [], [], null, world.hf, MEDIUM, 0, world);
  const puffs = pictures.filter((p) => p.id.includes("dust")).map((p) => p.cell), shard = pictures.find((p) => p.id.includes("shard"))!.cell;
  let chips = 0, dust = 0;
  for (let i = 0; i < details.pool.count; i++) {
    if ((details.pool.flags[i]! & DETAIL_PUFF) === 0) chips += details.pool.cell[i] === shard ? 1 : 0;
    else if (puffs.includes(details.pool.cell[i]!)) dust++;
  }
  // Half of what a cell may hold is chips; the puffs are thinned for the screen's fill this near.
  expect(chips).toBe(MEDIUM.details.pool / 4 / MOST_EMITTERS / 2);
  expect(dust).toBeGreaterThan(0);
  expect(chips + dust).toBe(details.pool.count);
});

test("the low tier makes one puff a cell and no chips", () => {
  const breaks = new BreakEffects(reg, palette);
  breaks.take([...wave(40, 100, 2 * CELL, CELL, STEEL), piece(65, 2, 65, 100, GLAZED)]);
  breaks.row(reg, 100, GLAZED, GLAZED, 70, 2, 70, reg.maxHp[GLAZED]!, bodyHealth(reg, GLAZED));
  const low = asked(breaks, LOW).bursts;
  expect(low.map((b) => b.part)).toEqual([BREAK_DUST, BREAK_DUST]);
  expect(new Set(low.map(cellOf)).size).toBe(2);
  // The same break on medium has chips, glass for the panes, and sparks for the steel.
  breaks.take([...wave(40, 100, 2 * CELL, CELL, STEEL), piece(65, 2, 65, 100, GLAZED)]);
  breaks.row(reg, 100, GLAZED, GLAZED, 70, 2, 70, reg.maxHp[GLAZED]!, bodyHealth(reg, GLAZED));
  const medium = asked(breaks).bursts;
  for (const part of [BREAK_DUST, BREAK_CHIPS, BREAK_GLASS, BREAK_SPARKS]) expect(total(medium, part)).toBeGreaterThan(0);
});

test("a burst takes its colour from the pieces' finish", () => {
  const breaks = new BreakEffects(reg, palette);
  const finish = (map: number): number[] => [...palette.slice((reg.defs[map] as { color: number }).color * 4, (reg.defs[map] as { color: number }).color * 4 + 3)];
  const colours = (map: number): { dust: number[]; chips: number[] } => {
    breaks.take([piece(66, 2, 66, 100, map), piece(67, 2, 67, 100, map)]);
    const { bursts } = asked(breaks);
    return { dust: rgb(bursts.find((b) => b.part === BREAK_DUST)!.rgb), chips: rgb(bursts.find((b) => b.part === BREAK_CHIPS)!.rgb) };
  };
  const rose = colours(ROSE), grey = colours(WALL);
  expect(rose.chips).toEqual(finish(ROSE));
  expect(grey.chips).toEqual(finish(WALL));
  // Dust is the finish taken toward pale dust: rose dust is still pinker than concrete's.
  expect(rose.dust[0]! - rose.dust[1]!).toBeGreaterThan(20);
  expect(rose.dust[1]!).toBeGreaterThan(finish(ROSE)[1]!);
  expect(Math.abs(grey.dust[0]! - grey.dust[1]!)).toBeLessThan(10);
  // Two finishes in one cell give their mean.
  breaks.take([piece(66, 2, 66, 100, ROSE), piece(67, 2, 67, 100, WALL)]);
  expect(rgb(asked(breaks).bursts.find((b) => b.part === BREAK_CHIPS)!.rgb)).toEqual(finish(ROSE).map((v, k) => Math.round((v + finish(WALL)[k]!) / 2)));
});

test("a stage step asks for one crack sound and a cell of fallen pieces one impact", () => {
  const breaks = new BreakEffects(reg, palette);
  const full = reg.maxHp[WALL]!;
  // Wear within a stage is no step; past two thirds is one, and it puffs as a bullet does.
  breaks.row(reg, 100, WALL, WALL, 66, 2, 66, full, full * 0.9);
  expect(asked(breaks)).toEqual({ bursts: [], heard: [], jolts: [] });
  breaks.row(reg, 100, WALL, WALL, 66, 2, 66, full * 0.9, full * 0.6);
  const step = asked(breaks);
  expect(step.heard).toEqual([[HEARD_CRACK, 0.9]]);
  expect(total(step.bursts)).toBe(BULLET[1]!);
  breaks.take(wave(12, 100, CELL, CELL));
  const fell = asked(breaks);
  expect(fell.heard.map(([what]) => what)).toEqual([HEARD_IMPACT]);
  // More pieces are louder.
  breaks.take([piece(66, 2, 66, 101)]);
  expect(asked(breaks).heard[0]![1]).toBeLessThan(fell.heard[0]![1]);
});

test("panes going ask for glass, and a collapse's cells for one rumble between them", () => {
  const breaks = new BreakEffects(reg, palette);
  breaks.row(reg, 100, GLAZED, GLAZED, 66, 2, 66, reg.maxHp[GLAZED]!, bodyHealth(reg, GLAZED));
  const panes = asked(breaks);
  expect(panes.heard.map(([what]) => what)).toEqual([HEARD_GLASS]);
  expect(panes.bursts.map((b) => b.part)).toEqual([BREAK_GLASS]);
  breaks.take(wave(48, 100, 3 * CELL, CELL, WALL, GONE_FELL));
  expect(asked(breaks).heard.map(([what]) => what).sort()).toEqual([HEARD_IMPACT, HEARD_IMPACT, HEARD_IMPACT, HEARD_RUMBLE]);
  // The next wave of the same collapse has no rumble of its own.
  breaks.take(wave(48, 101, 3 * CELL, CELL, WALL, GONE_FELL));
  expect(asked(breaks).heard.map(([what]) => what)).toEqual([HEARD_IMPACT, HEARD_IMPACT, HEARD_IMPACT]);
});

test("pieces breached and pieces taken by one blast in a cell are one burst", () => {
  const breaks = new BreakEffects(reg, palette);
  const breach = formKind(reg, WALL, FORM_BREACH_A, 0);
  // The rows are told at the client's guess of the tick, a little after the removal's own.
  for (let i = 0; i < 100; i++) breaks.row(reg, 104, WALL, breach, 64.5 + (i % 10) * 0.7, 2, 64.5 + Math.floor(i / 10) * 0.7, 9000, 7000);
  breaks.take(wave(10, 100, CELL, CELL, WALL, GONE_BLAST));
  const { bursts, heard } = asked(breaks);
  expect(bursts.filter((b) => b.part === BREAK_DUST).length).toBe(1);
  expect(heard.map(([what]) => what)).toEqual([HEARD_IMPACT]);
  // A door opening, a piece placed and a piece taken up are no break.
  const door = reg.index.get("core:door_wood")!;
  breaks.row(reg, 100, door, reg.index.get("core:door_open_wood")!, 66, 2, 66, 100, 100);
  breaks.row(reg, 100, 0, WALL, 66, 2, 66, 0, 100);
  breaks.row(reg, 100, WALL, 0, 66, 2, 66, 100, 0);
  expect(asked(breaks).bursts).toEqual([]);
});

test("listeners added to a session's structure rows are each told, in the order added", () => {
  const told: string[] = [];
  const session: { onStructure: StructureListener | null } = { onStructure: (was) => void told.push(`first ${was}`) };
  hearStructures(session, (was) => void told.push(`second ${was}`));
  hearStructures(session, (was) => void told.push(`third ${was}`));
  session.onStructure!(7, 0, 0, 0, 0, 1, 0, GONE_DESTROYED);
  expect(told).toEqual(["first 7", "second 7", "third 7"]);
});

test("a blast near jolts the view, a lone piece does not, and a far blast does not", () => {
  const breaks = new BreakEffects(reg, palette);
  breaks.take(wave(4, 100, CELL, CELL, WALL, GONE_BLAST));
  const near = asked(breaks, MEDIUM, 64, 2, 54).jolts;
  expect(near.length).toBe(1);
  expect(near[0]!).toBeGreaterThan(0.3);
  expect(near[0]!).toBeLessThanOrEqual(1);
  breaks.take([piece(66, 2, 66, 100)]);
  expect(asked(breaks, MEDIUM, 64, 2, 54).jolts).toEqual([]);
  breaks.take(wave(4, 100, CELL, CELL, WALL, GONE_BLAST));
  expect(asked(breaks, MEDIUM, 64, 2, 14).jolts).toEqual([]);
});

test("a jolt turns the view 0.6 degrees at most and is spent within a second", () => {
  const jolt = new Jolt(), out = new Float64Array(2);
  jolt.add(1);
  jolt.add(0.4);
  let most = 0, last = 0;
  for (let ms = 0; ms < 1000; ms += 16) {
    jolt.turn(ms, 16, JOLT, out);
    most = Math.max(most, Math.hypot(out[0]!, out[1]!));
    if (out[0] !== 0 || out[1] !== 0) last = ms;
  }
  expect(most).toBeGreaterThan(JOLT * 0.3);
  expect(most).toBeLessThanOrEqual((0.6 * Math.PI) / 180);
  expect(last).toBeLessThan(800);
  expect(jolt.trauma).toBe(0);
});
