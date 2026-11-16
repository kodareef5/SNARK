// The refining forge (planning/reference/stations-plan.md, S1): lit as a campfire is, it makes ingots and gasoline by
// itself, each in its own lane at once, with nobody looking; burnt wood leaves charcoal; it cooks nothing; it is not lit
// under water; and what it has under way survives a restart. Numbers from ark.wiki.gg (Refining Forge, Metal Ingot,
// Charcoal, read 2026-11-15): an ingot from 2 metal in 20 s, 5 gasoline from 6 oil and 5 hide in 10 s, wood 30 s a piece.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_CRAFT, CMD_CRAFT_AT, CMD_STRUCT, RESULT_DENIED, RESULT_INVALID, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { NO_PIN, STRUCT_LIGHT, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const [FORGE, LIT] = [id("forge"), id("forge_lit")];
const SECOND = TICK_RATE;

/** The section headers are added for the caller. */
function rulesOf(mode: string[]) {
  const made = loadConfig({ gus: "[ServerSettings]", game: ["[/script/shootergame.shootergamemode]", ...mode].join("\n") }, []);
  expect([made.report.refused, made.report.unknown]).toEqual([[], []]);
  return made.rules;
}

/** A Harness with ada joined, cheats on, standing beside a forge set on level ground. */
function smithy(host: ConstructorParameters<typeof Harness>[3] = {}) {
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, ...host });
  const s = h.join("ada");
  h.run(400);
  const at = flatGround(h, 30, 30);
  h.say(s, "enablecheats");
  h.say(s, `tp ${at.x + 10} ${at.z + 10}`);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const ref = h.world.structs.add(FORGE, at.x + 11.5, at.y + reg.halfY[FORGE]!, at.z + 10, 0, me.team, 2500);
  return { h, s, me, at, ref, rec: h.host.fixtures.ensure(ref) };
}

function send(h: Harness, s: ClientSession, cmd: number, write: (w: BitWriter) => void): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(cmd, write);
  h.run(150);
  return code;
}

test("lit with the light action, a forge makes ingots and gasoline at once with nobody looking, cooks nothing, leaves charcoal for each piece of wood, and goes out when the wood does, its kind swapped back at that tick", () => {
  const { h, s, me, ref, rec } = smithy();
  try {
    const swaps: [number, number, number][] = [];
    h.host.stations.onSwap((r, t, from, to) => void (r === rec && swaps.push([t, from, to])));
    const total = (name: string): number => rec.inv!.total(id(name));
    for (const [name, n] of [["ore", 7], ["wood", 2], ["meat", 3], ["oil", 12], ["hide", 10]] as const) h.host.items.mint(rec, id(name), n);
    expect(h.host.items.inv(rec).cap).toBe(24);
    expect(send(h, s, CMD_STRUCT, (w) => (w.u32(ref), w.u8(STRUCT_LIGHT)))).toBe(RESULT_OK);
    const lit = rec.fire!.at;
    expect([rec.kind, h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff], swaps]).toEqual([LIT, LIT, [[lit, FORGE, LIT]]]);

    // Opened, the session is told when the fire goes out (two pieces of wood, 60 s) and when each lane's unit is done: an
    // ingot 20 s after lighting, five gasoline 10 s after. Lanes are in content order.
    expect(send(h, s, CMD_STRUCT, (w) => (w.u32(ref), w.u8(STRUCT_USE), w.u16(NO_PIN)))).toBe(RESULT_OK);
    const lanes = [id("ingot"), id("gasoline")].sort((a, b) => a - b);
    const ends: Record<number, number> = { [id("ingot")]: lit + 20 * SECOND, [id("gasoline")]: lit + 10 * SECOND };
    expect(s.station).toEqual({ kind: LIT, ref, out: lit + 60 * SECOND, lanes: lanes.map((item) => ({ item, doneAt: ends[item] })), jobs: [] });
    // Nothing a fire makes by itself is made by a job: not at the forge, nor in the hand.
    h.say(s, "give ore 10");
    for (const item of [id("ingot"), id("gasoline")]) {
      expect(send(h, s, CMD_CRAFT_AT, (w) => (w.u16(item), w.u8(1)))).toBe(RESULT_INVALID);
      expect(send(h, s, CMD_CRAFT, (w) => (w.u16(item), w.u8(1)))).toBe(RESULT_INVALID);
      expect(h.host.progression.craftAt(me, rec, item, 1)).toBe(RESULT_INVALID);
    }
    expect([rec.jobs, me.jobs]).toEqual([[], []]);
    send(h, s, CMD_STRUCT, (w) => (w.u32(ref), w.u8(STRUCT_USE), w.u16(NO_PIN)));

    // Nobody looks. Its deadlines make each unit at its tick and put it out at the tick the second piece of wood ends.
    h.run(70000);
    expect([rec.kind, rec.fire, h.host.stations.wentOut, swaps]).toEqual([FORGE, null, 1, [[lit, FORGE, LIT], [lit + 60 * SECOND, LIT, FORGE]]]);
    // Ingots at 20, 40 and 60 s (the third at the tick the fire goes out); gasoline at 10 and 20 s, when the oil ran out.
    expect([total("ingot"), total("ore"), total("gasoline"), total("oil"), total("hide"), h.host.stations.refined]).toEqual([3, 1, 10, 0, 0, 5]);
    // A piece of wood that burnt out left one charcoal, the first when the second piece was taken (Charcoal).
    expect([total("charcoal"), total("wood"), h.host.stations.left]).toEqual([2, 0, 2]);
    // It is no campfire: the meat on it is raw.
    expect([total("meat"), total("meat_cooked"), h.host.stations.cooked]).toEqual([3, 0, 0]);
    expect(rec.xp).toBe(0);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a restart mid-unit keeps what each lane has under way, and the ingot is made at the tick it would have been", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-forge-"));
  const dbPath = join(dir, "world.db");
  try {
    let { h, ref, rec } = smithy({ dbPath });
    h.host.items.mint(rec, id("ore"), 4);
    h.host.items.mint(rec, id("wood"), 1);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    const lit = rec.fire!.at;
    h.run(12000);
    h.host.items.inv(rec);
    const under = rec.fire!.lanes!.find((l) => l.item === id("ingot"))!.ticks;
    expect(under).toBeGreaterThan(5 * SECOND);
    expect(under).toBeLessThan(20 * SECOND);
    expect(rec.fire!.piece).toBe(id("wood"));
    const config = h.host.rules;
    h.host.shutdown();

    h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, dbPath, config });
    rec = h.host.fixtures.find(ref)!;
    expect([rec.kind, rec.fire!.piece, rec.fire!.lanes!.find((l) => l.item === id("ingot"))!.ticks - (rec.fire!.at - lit)]).toEqual([LIT, id("wood"), 0]);
    // The ingot is made 20 s after lighting, not 20 s after the restart; the second was under way when the wood ran out.
    const wait = (tick: number): void => h.run(Math.max(0, ((tick - h.world.tick) / TICK_RATE) * 1000));
    wait(lit + 20 * SECOND - 3);
    expect(h.host.items.inv(rec).total(id("ingot"))).toBe(0);
    wait(lit + 20 * SECOND + 3);
    expect(h.host.items.inv(rec).total(id("ingot"))).toBe(1);
    wait(lit + 31 * SECOND);
    expect([rec.kind, rec.fire, rec.inv!.total(id("ingot")), rec.inv!.total(id("ore")), rec.inv!.total(id("charcoal"))]).toEqual([FORGE, null, 1, 2, 1]);
    expect(h.host.items.audit()).toEqual([]);
    h.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("at twice the fuel time a piece of wood burns 60 s, and an ingot still takes 20; sparkpowder burns 60 s and leaves nothing", () => {
  const { h, ref, rec } = smithy({ config: rulesOf(["FuelConsumptionIntervalMultiplier=2"]) });
  try {
    h.host.items.mint(rec, id("ore"), 8);
    h.host.items.mint(rec, id("wood"), 1);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    const lit = rec.fire!.at;
    expect([rec.fire!.fuel, rec.fire!.out]).toEqual([60 * SECOND, lit + 60 * SECOND]);
    h.run(65000);
    expect([rec.kind, rec.inv!.total(id("ingot")), rec.inv!.total(id("ore")), rec.inv!.total(id("charcoal"))]).toEqual([FORGE, 3, 2, 1]);
    h.host.shutdown();
  } catch (e) {
    h.host.shutdown();
    throw e;
  }
  const again = smithy();
  try {
    again.h.host.items.mint(again.rec, id("sparkpowder"), 1);
    again.h.host.items.mint(again.rec, id("ore"), 8);
    expect(again.h.host.stations.toggle(again.ref)).toBe(RESULT_OK);
    expect(again.rec.fire!.out - again.rec.fire!.at).toBe(60 * SECOND);
    again.h.run(62000);
    expect([again.rec.kind, again.rec.inv!.total(id("ingot")), again.rec.inv!.total(id("sparkpowder")), again.rec.inv!.total(id("charcoal"))]).toEqual([FORGE, 3, 0, 0]);
    expect(again.h.host.items.audit()).toEqual([]);
  } finally {
    again.h.host.shutdown();
  }
});

test("a forge whose foot is below the sea is not lit, though a campfire there is; above it, it is", () => {
  const { h, s, me, at, ref, rec } = smithy();
  try {
    const sea = h.world.hf.seaLevel;
    const wet = h.world.structs.add(FORGE, at.x + 14, sea - 0.1 + reg.halfY[FORGE]!, at.z + 14, 0, me.team, 2500);
    const fire = h.world.structs.add(id("campfire"), at.x + 16, sea - 0.1 + reg.halfY[id("campfire")]!, at.z + 16, 0, me.team, 100);
    for (const r of [wet, fire, ref]) h.host.items.mint(h.host.fixtures.ensure(r), id("wood"), 2);
    expect([h.host.stations.toggle(wet), h.host.stations.toggle(fire), h.host.stations.toggle(ref)]).toEqual([RESULT_DENIED, RESULT_OK, RESULT_OK]);
    expect([h.host.fixtures.ensure(wet).kind, h.host.fixtures.ensure(wet).fire, rec.kind]).toEqual([FORGE, null, LIT]);
    void s;
  } finally {
    h.host.shutdown();
  }
});

test("a blueprint of sparkpowder in a forge is no fuel: lit with one ahead of wood, the wood burns, and the blueprint is left; of what a forge refines, none can be a blueprint", () => {
  const { h, ref, rec } = smithy();
  try {
    const items = h.host.items;
    const spark = id("sparkpowder");
    // The forge's ore, oil and hide are gathered, not made, and what it refines is fired: none is ever a blueprint.
    expect([spark, id("ore"), id("oil"), id("hide"), id("ingot"), id("gasoline")].map((i) => reg.blueprints[i])).toEqual([1, 0, 0, 0, 0, 0]);
    expect(items.mint(rec, spark, 1, 0, 0, -1, "", FLAG_BLUEPRINT)).toBe(1);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_SHORT);
    items.mint(rec, id("wood"), 1);
    items.mint(rec, id("ore"), 4);
    expect([rec.inv!.item[0], rec.inv!.flags[0]]).toEqual([spark, FLAG_BLUEPRINT]);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    const lit = rec.fire!.at;
    expect([rec.fire!.piece, rec.fire!.out, rec.inv!.total(id("wood"))]).toEqual([id("wood"), lit + 30 * SECOND, 0]);
    h.run(32000);
    // Out when the wood is, with an ingot made and a charcoal left; the blueprint is where it was.
    expect([rec.kind, rec.fire, rec.inv!.total(id("ingot")), rec.inv!.total(id("charcoal")), rec.inv!.item[0], rec.inv!.flags[0]]).toEqual([FORGE, null, 1, 1, spark, FLAG_BLUEPRINT]);
    expect(items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a full forge read every tick and one read by nobody come out the same when a berry in them spoils mid-piece and frees a slot: the waiting ingot is made at that tick", () => {
  const { h, me, at } = smithy();
  try {
    const items = h.host.items;
    const forges = [0, 1].map((k) => {
      const ref = h.world.structs.add(FORGE, at.x + 13 + 3 * k, at.y + reg.halfY[FORGE]!, at.z + 14, 0, me.team, 2500);
      return { ref, rec: h.host.fixtures.ensure(ref) };
    });
    // A berry minted now spoils in 600 s. Each forge is lit 1,000 ticks before that, full: 10 ore, 2 sparkpowder, the berry
    // and 21 stacks of stone, so its first ingot, done 20 s after lighting, waits for room until the berry is gone.
    const t0 = h.world.tick;
    for (const { rec } of forges) items.mint(rec, id("berry"), 1);
    h.world.tick = t0 + reg.spoilTicks[id("berry")]! - 1000;
    for (const { rec } of forges) {
      items.mint(rec, id("ore"), 10);
      items.mint(rec, id("sparkpowder"), 2);
      items.mint(rec, id("stone"), 21 * reg.stack[id("stone")]!);
      expect(rec.inv!.free()).toBe(-1);
    }
    expect(forges.map(({ ref }) => h.host.stations.toggle(ref))).toEqual([RESULT_OK, RESULT_OK]);
    const lit = h.world.tick;
    const [a, b] = forges as [(typeof forges)[0], (typeof forges)[0]];
    // One is read every tick, the other is left alone until both have gone out. Nothing else runs.
    while (h.world.tick < lit + 130 * SECOND) {
      h.world.tick++;
      items.inv(a.rec);
    }
    items.inv(b.rec);
    const slots = (rec: typeof a.rec): number[][] => {
      const out: number[][] = [];
      for (let s = 0; s < rec.inv!.cap; s++) if (rec.inv!.item[s] !== 0) out.push([rec.inv!.item[s]!, rec.inv!.count[s]!]);
      return out.sort((x, y) => x[0]! - y[0]! || x[1]! - y[1]!);
    };
    expect([b.rec.kind, b.rec.fire, slots(b.rec)]).toEqual([a.rec.kind, a.rec.fire, slots(a.rec)]);
    // The berry spoiled 1,000 ticks after lighting, and an ingot was made then and every 20 s after: five, all the ore,
    // before the second sparkpowder ended at 120 s.
    expect([a.rec.kind, a.rec.inv!.total(id("ingot")), a.rec.inv!.total(id("ore")), a.rec.inv!.total(id("berry"))]).toEqual([FORGE, 5, 0, 0]);
    expect(items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});
