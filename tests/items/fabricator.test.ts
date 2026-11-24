// The smithy and the fabricator (planning/reference/stations-plan.md, S2): a station that burns nothing, and a powered one
// that makes things only while its gasoline burns, whose unit under way waits with its ticks left when the fuel runs out.
// Numbers are ark.wiki.gg's (Smithy, Fabricator, Polymer, Electronics, read 2026-11-15).

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { stationRecipes } from "../../client/core/ui/station.ts";
import { CORE_PACK } from "../../content/core.ts";
import { compilePacks } from "../../shared/content/packs.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { deriveRegistry } from "../../shared/content/tuning.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_CRAFT, CMD_CRAFT_AT, CMD_CRAFT_BLUEPRINT, CMD_LEARN, CMD_MOVE, CMD_STRUCT, RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import { NO_PIN, STRUCT_LIGHT, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const core = coreRegistry();
const id = (r: Registry, name: string): number => r.index.get(name.includes(":") ? name : `core:${name}`)!;
const NOTICE = "It needs fuel and must be on.";

/** The core pack and a widget made at the fabricator in 1,000 s from one stone, so a unit outlasts one gasoline's 900 s. */
const fab = compilePacks([
  CORE_PACK,
  {
    name: "test",
    requires: ["core"],
    defs: [
      { id: "test:widget", type: "item", class: "resource", stack: 10, craft: { needs: [{ item: "core:stone", count: 1 }], seconds: 1000, xp: 10, at: "core:fabricator" } },
      { id: "test:engram-widget", type: "engram", label: "Widget", level: 1, cost: 0, item: "test:widget" },
    ],
  },
]).registry!;

/** A Harness on `reg` with ada joined, cheats on, beside a level spot, and a station of `kind` placed there. */
function workshop(reg: Registry, kind: string, host: ConstructorParameters<typeof Harness>[3] = {}) {
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, ...host }, reg);
  const s = h.join("ada");
  h.run(400);
  const at = flatGround(h, 30, 30);
  h.say(s, "enablecheats");
  h.say(s, `tp ${at.x + 10} ${at.z + 10}`);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const k = id(reg, kind);
  const ref = h.world.structs.add(k, at.x + 11.5, at.y + reg.halfY[k]!, at.z + 10, 0, me.team, reg.maxHp[k]!);
  return { h, s, me, ref, rec: h.host.fixtures.ensure(ref) };
}

/** Sends a command and returns its result code. */
function send(h: Harness, s: ClientSession, cmd: number, write: (w: BitWriter) => void): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(cmd, write);
  h.run(150);
  return code;
}
const use = (h: Harness, s: ClientSession, ref: number): number => send(h, s, CMD_STRUCT, (w) => (w.u32(ref), w.u8(STRUCT_USE), w.u16(NO_PIN)));
const light = (h: Harness, s: ClientSession, ref: number): number => send(h, s, CMD_STRUCT, (w) => (w.u32(ref), w.u8(STRUCT_LIGHT)));
const makeAt = (h: Harness, s: ClientSession, item: number, n: number): number => send(h, s, CMD_CRAFT_AT, (w) => (w.u16(item), w.u8(n)));
/** The server alone, nobody's frames: what a station does unobserved. */
const skip = (h: Harness, ticks: number): void => {
  for (let i = 0; i < ticks; i++) h.server.tick();
};

test("the smithy and the fabricator are ARK's at 1x, and the fabricator's gasoline lasts as long as the fuel setting says", () => {
  const smithy = core.defs[id(core, "smithy")]!;
  expect(smithy).toMatchObject({ class: "station", hp: 1500, slots: 75, decayDays: 16, material: "core:mat_wood", half: [0.8, 0.55, 0.4] });
  expect(core.defs[id(core, "piece_smithy")]).toMatchObject({ stack: 100, weight: 4, craft: { needs: [{ item: "core:ingot", count: 5 }, { item: "core:stone", count: 50 }, { item: "core:wood", count: 30 }, { item: "core:hide", count: 20 }], seconds: 5, xp: 25 } });
  expect(core.defs[id(core, "engram-piece_smithy")]).toMatchObject({ level: 20, cost: 18 });
  const [out, lit, gas] = [id(core, "fabricator"), id(core, "fabricator_lit"), id(core, "gasoline")];
  for (const k of [out, lit]) expect(core.defs[k]).toMatchObject({ class: "station", hp: 2500, slots: 70, decayDays: 16, material: "core:mat_wood", half: [0.85, 0.65, 0.45], powered: true, dry: true, cooks: false });
  expect([core.lights[out], core.lights[lit], core.burning[lit], core.stationBase[lit], core.powered[out], core.powered[lit]]).toEqual([lit, out, 1, out, 1, 1]);
  // Gasoline alone, 900 s a piece; wood is not its fuel. Twice the fuel time, 1,800 s.
  expect([core.stationFuel[out]![gas], core.stationFuel[lit]![gas], core.stationFuel[out]![id(core, "wood")]]).toEqual([900 * TICK_RATE, 900 * TICK_RATE, 0]);
  expect(deriveRegistry(core, { fuel: 2 }).stationFuel[out]![gas]).toBe(1800 * TICK_RATE);
  expect(core.defs[id(core, "piece_fabricator")]).toMatchObject({ stack: 1, weight: 4, craft: { needs: [{ item: "core:ingot", count: 35 }, { item: "core:paste", count: 20 }, { item: "core:sparkpowder", count: 50 }, { item: "core:crystal", count: 15 }, { item: "core:oil", count: 10 }], xp: 132 } });
  expect(core.defs[id(core, "engram-piece_fabricator")]).toMatchObject({ level: 48, cost: 24, requires: ["core:engram-piece_smithy"] });
  // What each makes: the smithy the fabricator, and since S6 the 27 recipes moved to it; the fabricator polymer and
  // electronics, lit or out, and since S6 the five moved to it (tests/items/ark-stations.test.ts).
  const made = [id(core, "polymer"), id(core, "electronics")].sort((a, b) => a - b);
  expect([stationRecipes(core, id(core, "smithy")).includes(id(core, "piece_fabricator")), made.every((k) => stationRecipes(core, out).includes(k) && stationRecipes(core, lit).includes(k))]).toEqual([true, true]);
  expect(core.defs[id(core, "polymer")]).toMatchObject({ craft: { needs: [{ item: "core:obsidian", count: 2 }, { item: "core:paste", count: 2 }], seconds: 2, xp: 2.24 } });
  expect(core.defs[id(core, "electronics")]).toMatchObject({ craft: { needs: [{ item: "core:silica_pearls", count: 3 }, { item: "core:ingot", count: 1 }], seconds: 2, xp: 3.04 } });
  expect([core.defs[id(core, "engram-polymer")], core.defs[id(core, "engram-electronics")]]).toMatchObject([{ level: 48, cost: 6 }, { level: 48, cost: 6 }]);
});

test("the smithy is made in the hand; the fabricator is made at the smithy from the smithy's slots into them, for a survivor who knows its engram, who gets the experience", () => {
  const { h, s, me, ref, rec } = workshop(core, "smithy");
  try {
    const [piece, smithyPiece] = [id(core, "piece_fabricator"), id(core, "piece_smithy")];
    // Made in the hand once its engram is learned (level 20, 18 points).
    h.say(s, "addxp 1000000");
    expect(send(h, s, CMD_LEARN, (w) => w.u16(id(core, "engram-piece_smithy")))).toBe(RESULT_OK);
    for (const [n, c] of [["ingot", 5], ["stone", 50], ["wood", 30], ["hide", 20]] as const) h.say(s, `give ${n} ${c}`);
    let xp = me.xp;
    expect(send(h, s, CMD_CRAFT, (w) => (w.u16(smithyPiece), w.u8(1)))).toBe(RESULT_OK);
    h.run(5200);
    expect([s.inventory!.total(smithyPiece), s.inventory!.total(id(core, "ingot"))]).toEqual([1, 0]);
    expect(me.xp - xp).toBeCloseTo(25, 9);

    // Open, the smithy has 75 slots, burns nothing and has nothing under way.
    expect(use(h, s, ref)).toBe(RESULT_OK);
    expect([s.open?.inventory.cap, s.station]).toEqual([75, { kind: id(core, "smithy"), ref, out: 0, lanes: [], jobs: [] }]);
    // Never made in the hand; at the smithy refused without the engram, then without the ingredients in its slots.
    expect(send(h, s, CMD_CRAFT, (w) => (w.u16(piece), w.u8(1)))).toBe(RESULT_DENIED);
    expect(makeAt(h, s, piece, 1)).toBe(RESULT_DENIED);
    expect(makeAt(h, s, id(core, "polymer"), 1)).toBe(RESULT_INVALID);
    expect(send(h, s, CMD_LEARN, (w) => w.u16(id(core, "engram-piece_fabricator")))).toBe(RESULT_OK);
    h.say(s, "give crystal 15");
    expect(makeAt(h, s, piece, 1)).toBe(RESULT_SHORT);
    const needs = [["ingot", 35], ["paste", 20], ["sparkpowder", 50], ["crystal", 15], ["oil", 10]] as const;
    for (const [n, c] of needs) h.host.items.mint(rec, id(core, n), c);
    xp = me.xp;
    expect(makeAt(h, s, piece, 1)).toBe(RESULT_OK);
    // The ingredients went at once from the smithy, not from the bag; the fabricator lands in the smithy 5 s later.
    expect([needs.map(([n]) => rec.inv!.total(id(core, n))), rec.jobs[0]!.by, s.inventory!.total(id(core, "crystal"))]).toEqual([[0, 0, 0, 0, 0], me.pid, 15]);
    expect(s.station!.jobs.map((j) => [j.item, j.left, j.rest])).toEqual([[piece, 1, 0]]);
    h.run(5200);
    expect([rec.inv!.total(piece), rec.jobs.length, s.station!.jobs, s.inventory!.total(piece)]).toEqual([1, 0, [], 0]);
    expect(me.xp - xp).toBeCloseTo(132, 9);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("the fabricator takes no job while out and never burns wood; lit on one gasoline, a 1,000 s unit pauses at 900 s with its ticks left, kept across a restart, and finishes 100 s after it is lit again, spending nothing more", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-fabricator-"));
  const dbPath = join(dir, "world.db");
  try {
    let { h, s, me, ref, rec } = workshop(fab, "fabricator", { dbPath });
    const [out, lit, widget, stone, gas] = [id(fab, "fabricator"), id(fab, "fabricator_lit"), id(fab, "test:widget"), id(fab, "stone"), id(fab, "gasoline")];
    me.engrams.push(id(fab, "test:engram-widget"));
    h.host.items.mint(rec, stone, 3);
    expect(use(h, s, ref)).toBe(RESULT_OK);
    expect(s.station).toEqual({ kind: out, ref, out: 0, lanes: [], jobs: [] });
    // Out, it takes no job and says why; with wood and no gasoline in it, it does not light.
    const log = s.logVersion;
    expect(makeAt(h, s, widget, 1)).toBe(RESULT_SHORT);
    expect([s.log.slice(-(s.logVersion - log)).map((l) => l.text), rec.jobs, rec.inv!.total(stone)]).toEqual([[NOTICE], [], 3]);
    h.host.items.mint(rec, id(fab, "wood"), 5);
    expect(light(h, s, ref)).toBe(RESULT_SHORT);
    // One gasoline: lit, and a widget queued in the same tick, a unit of 1,000 s on 900 s of fuel.
    h.host.items.mint(rec, gas, 1);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    const t0 = h.world.tick;
    expect(h.host.progression.craftAt(me, rec, widget, 2)).toBe(RESULT_OK);
    expect([rec.kind, rec.fire!.out, rec.jobs, rec.inv!.total(stone), rec.inv!.total(gas)]).toEqual([lit, t0 + 900 * TICK_RATE, [{ item: widget, left: 2, doneAt: t0 + 1000 * TICK_RATE, by: me.pid }], 2, 0]);
    h.run(200);
    expect(s.station).toEqual({ kind: lit, ref, out: t0 + 900 * TICK_RATE, lanes: [], jobs: [{ item: widget, left: 2, doneAt: t0 + 1000 * TICK_RATE, rest: 0 }] });
    // Nobody looking, it goes out at 900 s on its own deadline; the unit waits with its 100 s left, and the deadline it had
    // at 1,000 s finds nothing to finish.
    skip(h, t0 + 1100 * TICK_RATE - h.world.tick);
    expect([rec.kind, rec.fire, h.host.stations.wentOut, rec.jobs, rec.inv!.total(widget), rec.inv!.total(stone), rec.inv!.total(id(fab, "wood"))]).toEqual([out, null, 1, [{ item: widget, left: 2, doneAt: 0, by: me.pid, rest: 100 * TICK_RATE }], 0, 2, 5]);
    h.run(300);
    expect(s.station).toEqual({ kind: out, ref, out: 0, lanes: [], jobs: [{ item: widget, left: 2, doneAt: 0, rest: 100 * TICK_RATE }] });
    // Out, it takes no more, from the engram or otherwise.
    expect(makeAt(h, s, widget, 1)).toBe(RESULT_SHORT);
    expect(rec.jobs.length).toBe(1);
    expect(h.host.items.audit()).toEqual([]);

    // The paused unit and its queue are saved, and stay paused while it is out.
    h.host.shutdown();
    h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, dbPath }, fab);
    s = h.join("ada");
    h.run(600);
    rec = h.host.fixtures.find(ref)!;
    me = h.host.records.byPid.get(me.pid)!;
    skip(h, 60 * TICK_RATE);
    expect([rec.kind, rec.jobs, rec.inv!.total(widget)]).toEqual([out, [{ item: widget, left: 2, doneAt: 0, by: me.pid, rest: 100 * TICK_RATE }], 0]);
    // Lit again, the unit goes on from where it stopped and takes no more stone; it lands 100 s later, and the next starts.
    h.host.items.mint(rec, gas, 2);
    expect(light(h, s, ref)).toBe(RESULT_OK);
    const t1 = rec.fire!.at;
    expect([rec.kind, rec.jobs[0], rec.inv!.total(stone), rec.inv!.total(gas)]).toEqual([lit, { item: widget, left: 2, doneAt: t1 + 100 * TICK_RATE, by: me.pid }, 2, 1]);
    const xp = me.xp;
    skip(h, t1 + 100 * TICK_RATE - 1 - h.world.tick);
    expect(h.host.items.inv(rec).total(widget)).toBe(0);
    skip(h, 1);
    expect([rec.inv!.total(widget), rec.jobs, rec.inv!.total(stone)]).toEqual([1, [{ item: widget, left: 1, doneAt: t1 + 1100 * TICK_RATE, by: me.pid }], 1]);
    expect(me.xp - xp).toBeCloseTo(10, 9);
    // Put out by hand, it loses the gasoline it was running on (Fabricator) and the unit waits again with its time left.
    skip(h, 20 * TICK_RATE);
    expect(use(h, s, ref)).toBe(RESULT_OK);
    let t2 = -1;
    h.host.stations.onSwap((r, t) => void (r === rec && (t2 = t)));
    expect(light(h, s, ref)).toBe(RESULT_OK);
    expect([rec.kind, rec.fire, rec.inv!.total(gas), t2 > t1 + 120 * TICK_RATE, rec.jobs[0]!.rest]).toEqual([out, null, 1, true, t1 + 1100 * TICK_RATE - t2]);
    expect(s.station!.jobs[0]).toEqual({ item: widget, left: 1, doneAt: 0, rest: t1 + 1100 * TICK_RATE - t2 });
    expect(h.host.items.audit()).toEqual([]);
    h.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("polymer and electronics are made at a lit fabricator from what lies in it, and a blueprint there obeys the same power", () => {
  const { h, s, me, ref, rec } = workshop(core, "fabricator");
  try {
    const [polymer, electronics] = [id(core, "polymer"), id(core, "electronics")];
    h.say(s, "addxp 1000000");
    for (const e of ["engram-polymer", "engram-electronics"]) expect(send(h, s, CMD_LEARN, (w) => w.u16(id(core, e)))).toBe(RESULT_OK);
    for (const [n, c] of [["obsidian", 4], ["paste", 4], ["silica_pearls", 3], ["ingot", 1]] as const) h.host.items.mint(rec, id(core, n), c);
    expect(use(h, s, ref)).toBe(RESULT_OK);
    // A polymer blueprint moved into it is refused while it is out, as the engram is.
    expect(h.say(s, "give polymer 1 bp")).toEqual(["gave 1 core:polymer blueprint (primitive)"]);
    const from = s.inventory!.item.indexOf(polymer);
    const to = s.open!.inventory.free();
    expect(send(h, s, CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_OPEN, 1), w.varint(to), w.u16(1), w.u16(polymer)))).toBe(RESULT_OK);
    expect(rec.inv!.flags[to]).toBe(FLAG_BLUEPRINT);
    const fromBlueprint = (): number => send(h, s, CMD_CRAFT_BLUEPRINT, (w) => (w.bits(BOX_OPEN, 1), w.varint(to), w.u8(1)));
    expect([fromBlueprint(), makeAt(h, s, polymer, 1), makeAt(h, s, electronics, 1), rec.jobs]).toEqual([RESULT_SHORT, RESULT_SHORT, RESULT_SHORT, []]);
    h.host.items.mint(rec, id(core, "gasoline"), 1);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    const xp = me.xp;
    expect([fromBlueprint(), makeAt(h, s, electronics, 1), makeAt(h, s, polymer, 1)]).toEqual([RESULT_OK, RESULT_OK, RESULT_OK]);
    // 2 s each, one after another.
    h.run(6500);
    expect([rec.inv!.total(polymer), rec.inv!.total(electronics), rec.jobs]).toEqual([2, 1, []]);
    expect(["obsidian", "paste", "silica_pearls", "ingot"].map((n) => rec.inv!.total(id(core, n)))).toEqual([0, 0, 0, 0]);
    expect(rec.inv!.flags[to]).toBe(FLAG_BLUEPRINT);
    // A blueprint's product may come out above its quality, and its experience with it (D419).
    expect(me.xp - xp).toBeGreaterThanOrEqual(2.24 * 2 + 3.04 - 1e-9);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a fabricator whose spare gasoline is taken out goes out when the piece burning does, and a unit due after that tick waits rather than finishing", () => {
  const { h, me, ref, rec } = workshop(fab, "fabricator");
  try {
    const [out, widget, stone, gas] = [id(fab, "fabricator"), id(fab, "test:widget"), id(fab, "stone"), id(fab, "gasoline")];
    me.engrams.push(id(fab, "test:engram-widget"));
    h.host.items.mint(rec, stone, 1);
    h.host.items.mint(rec, gas, 2);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    const t0 = h.world.tick;
    expect(h.host.progression.craftAt(me, rec, widget, 1)).toBe(RESULT_OK);
    expect(rec.fire!.out).toBe(t0 + 1800 * TICK_RATE);
    // The spare piece is taken out and nobody opens it after: the fire's deadline still says 1,800 s, but the piece burning
    // ends at 900 s. The craft deadline at 1,000 s reads the fire first, finds it went out at 900 s, and the unit waits.
    skip(h, 10 * TICK_RATE);
    expect(h.host.items.burnItem(rec, gas, 1)).toBe(true);
    skip(h, t0 + 1000 * TICK_RATE - h.world.tick);
    expect([rec.kind, rec.fire, rec.inv!.total(widget), rec.jobs[0]]).toEqual([out, null, 0, { item: widget, left: 1, doneAt: 0, by: me.pid, rest: 100 * TICK_RATE }]);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});
