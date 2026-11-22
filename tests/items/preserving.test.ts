// The preserving bin (planning/reference/stations-plan.md, S3, M6): a station that burns only sparkpowder, half an hour a
// piece, cooks nothing, and while lit keeps what lies in it 10 times as long (ark.wiki.gg Preserving_Bin: "when fueled by
// Sparkpowder", "a single Sparkpowder in the bin will keep it running for 30 minutes", "any eligible perishables will have
// their spoil timer increased by a multiplier of 10"; Spoilage, 10x). Spoiling is lazy (D41), so at the tick it lights or
// goes out every spoil clock in it is rescaled (server/preserve.ts, Items.rekeep).

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { ItemDef } from "../../shared/content/defs.ts";
import { compilePacks } from "../../shared/content/packs.ts";
import { CORE_PACK } from "../../content/core.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_STRUCT, RESULT_OK, RESULT_SHORT } from "../../shared/net/protocol.ts";
import { NO_PIN, STRUCT_DEMOLISH, STRUCT_LIGHT, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const BIN = id("preserving_bin");
const LIT = id("preserving_bin_lit");
const [MEAT, COOKED, SPOILED, BERRY, SPARK] = [id("meat"), id("meat_cooked"), id("spoiled_meat"), id("berry"), id("sparkpowder")];
/** Ticks one sparkpowder keeps the bin lit: 1,800 s. */
const PIECE = 1800 * TICK_RATE;

interface World {
  h: Harness;
  s: ClientSession;
  me: EntityRecord;
  /** Sets a bin down beside the survivor, `dx` metres along, and returns its ref and record. */
  bin(dx?: number): { ref: number; rec: EntityRecord };
  /** The light action through CMD_STRUCT, as the structure menu's "Light it" sends it. Returns the RESULT code. */
  act(ref: number, action: number): number;
  /** What the record's slots hold, slot by slot: item, count and spoil clock. */
  slots(rec: EntityRecord): number[][];
}

/** A survivor on flat ground, with cheats, and bins to set down beside her. `host` adds to the host's options. */
function arena(host: Record<string, unknown> = {}): World {
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0, ...host });
  const s = h.join("ada");
  h.run(300);
  const me = h.host.records.byPid.get(h.client(s)!.pid)!;
  const place = flatGround(h, 30, 30);
  h.say(s, "enablecheats");
  h.say(s, `tp ${place.x + 10} ${place.z + 10}`);
  return {
    h,
    s,
    me,
    bin: (dx = 0) => {
      const ref = h.world.structs.add(BIN, place.x + 11 + dx, place.y + reg.halfY[BIN]!, place.z + 10, 0, me.team, 600);
      return { ref, rec: h.host.fixtures.ensure(ref) };
    },
    act: (ref, action) => {
      let code = -1;
      s.onResult = (seq, c) => void (seq !== 0 && (code = c));
      s.command(CMD_STRUCT, (w: BitWriter) => {
        w.u32(ref);
        w.u8(action);
        if (action === STRUCT_USE) w.u16(NO_PIN);
      });
      h.run(150);
      return code;
    },
    slots: (rec) => slotsOf(h, rec),
  };
}

/** What the record's slots hold, by item: item, count and spoil clock, read through Items.inv. */
function slotsOf(h: Harness, rec: EntityRecord): number[][] {
  const inv = h.host.items.inv(rec);
  const out: number[][] = [];
  for (let k = 0; k < inv.cap; k++) if (inv.item[k] !== 0) out.push([inv.item[k]!, inv.count[k]!, inv.spoilAt[k]!]);
  return out.sort((a, b) => a[0]! - b[0]!);
}

const kindOf = (h: Harness, ref: number): number => h.world.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
const slotOf = (rec: EntityRecord, item: number): number => rec.inv!.item.indexOf(item);

test("the bin's numbers are the wiki's: 48 slots, 600 health, 16 days, sparkpowder alone at 1,800 s, no cooking, and 10 times as long only while lit", () => {
  expect([reg.structSlots[BIN], reg.maxHp[BIN], reg.decayDays[BIN], reg.structSlots[LIT], reg.lights[BIN], reg.lights[LIT], reg.burning[LIT]]).toEqual([48, 600, 16, 48, LIT, BIN, 1]);
  expect([reg.keeps[BIN], reg.keeps[LIT], reg.stationCooks[BIN], reg.stationCooks[LIT], reg.stationBase[LIT]]).toEqual([1, 10, 0, 0, BIN]);
  expect([reg.stationFuel[BIN]![SPARK], reg.stationFuel[BIN]![id("wood")], reg.stationFuel[BIN]![id("thatch")]]).toEqual([PIECE, 0, 0]);
  // 100 sparkpowder last "2 days, 2 hours" of real time (Preserving Bin, Powering).
  expect((100 * reg.stationFuel[BIN]![SPARK]!) / TICK_RATE / 3600).toBe(50);
  // Raw meat keeps 10 minutes in the hand (Raw Meat; Preserving Bin: "lasts 100 minutes in the bin").
  expect(reg.spoilTicks[MEAT]).toBe(600 * TICK_RATE);
  const piece = id("piece_preserving_bin");
  expect([reg.stack[piece], reg.weight[piece], [...reg.places[piece]!]]).toEqual([100, 4, [BIN]]);
  // Made in the hand, of 30 stone, 30 wood, 10 thatch and 20 fiber, for 6.9 times the global 4 (D465).
  expect([[...reg.recipeOf[piece]!], reg.craftAt[piece], (reg.defs[piece] as ItemDef).craft?.xp]).toEqual([[id("stone"), 30, id("wood"), 30, id("thatch"), 10, id("fiber"), 20], 0, 27.6]);
  const engram = reg.defs.find((d) => d?.type === "engram" && d.item === "core:piece_preserving_bin");
  expect(engram).toMatchObject({ level: 18, cost: 9, requires: ["core:engram-piece_storage_box"] });
});

test("raw meat keeps 10 minutes in a bin that is out and 100 in one lit; it lights only on sparkpowder, cooks nothing, and the survivor who has it open sees each clock as the server has it", () => {
  const w = arena();
  const { h, s } = w;
  try {
    const { ref, rec } = w.bin();
    const swaps: number[][] = [];
    h.host.stations.onSwap((r, t, from, to) => void (r === rec && swaps.push([t, from, to])));
    expect(w.act(ref, STRUCT_USE)).toBe(RESULT_OK);
    expect([s.station?.kind, s.open?.inventory.cap]).toEqual([BIN, 48]);
    // With nothing, or wood, which a campfire burns, it will not light: it takes only sparkpowder.
    expect(w.act(ref, STRUCT_LIGHT)).toBe(RESULT_SHORT);
    h.host.items.mint(rec, id("wood"), 10);
    expect(w.act(ref, STRUCT_LIGHT)).toBe(RESULT_SHORT);
    h.host.items.burnAll(rec);

    // Out, it keeps things as the hand does.
    h.host.items.mint(rec, MEAT, 1);
    const minted = h.world.tick;
    expect(w.slots(rec)).toEqual([[MEAT, 1, minted + 600 * TICK_RATE]]);
    h.host.items.mint(rec, SPARK, 4);
    h.run(10000);
    expect(w.act(ref, STRUCT_LIGHT)).toBe(RESULT_OK);
    const [[lit]] = swaps as [[number]];
    expect(swaps).toEqual([[lit, BIN, LIT]]);
    expect([kindOf(h, ref), rec.inv!.total(SPARK)]).toEqual([LIT, 3]);
    // What it had left when it was lit is ten times as long.
    const meatAt = lit + 10 * (minted + 600 * TICK_RATE - lit);
    expect(w.slots(rec)).toEqual([[MEAT, 1, meatAt], [SPARK, 3, 0]]);
    // A berry put in while it burns keeps 100 minutes, as anything does that keeps 10 in the hand. The raw meat lies a minute
    // and does not cook (it cooks in 20 s over a fire).
    h.host.items.mint(rec, BERRY, 1);
    const fresh = h.world.tick;
    expect(rec.inv!.spoilAt[slotOf(rec, BERRY)]).toBe(fresh + 6000 * TICK_RATE);
    h.run(60000);
    expect([h.host.items.inv(rec).total(MEAT), rec.inv!.total(COOKED), h.host.stations.cooked]).toEqual([1, 0, 0]);
    // The session has the bin open and sees the clocks the server has, the station lit with its out tick.
    expect([s.open!.inventory.spoilAt[slotOf(rec, MEAT)], s.open!.inventory.spoilAt[slotOf(rec, BERRY)], s.station?.kind, s.station?.out]).toEqual([meatAt, fresh + 6000 * TICK_RATE, LIT, lit + 4 * PIECE]);

    // The berry is there a tick before its hundred minutes and gone at them; the meat too, into spoiled meat at its tick.
    h.world.tick = fresh + 6000 * TICK_RATE - 1;
    expect(h.host.items.inv(rec).total(BERRY)).toBe(1);
    h.world.tick = fresh + 6000 * TICK_RATE;
    expect([h.host.items.inv(rec).total(BERRY), rec.inv!.total(MEAT), kindOf(h, ref)]).toEqual([0, 0, LIT]);
    expect(rec.inv!.spoilAt[slotOf(rec, SPOILED)]).toBe(meatAt + 10 * reg.spoilTicks[SPOILED]!);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("two bins lit together on one sparkpowder, one read every tick and one by nobody, come out the same when it has gone out, each clock rescaled at the tick it did", () => {
  const w = arena();
  const { h } = w;
  try {
    const a = w.bin(-1);
    const b = w.bin(1);
    const swaps: number[][] = [];
    h.host.stations.onSwap((r, t, from, to) => void swaps.push([r === a.rec ? 0 : 1, t, from, to]));
    const items = h.host.items;
    const both = (item: number, n: number): void => void (items.mint(a.rec, item, n), items.mint(b.rec, item, n));
    const t0 = h.world.tick;
    both(BERRY, 5);
    h.world.tick = t0 + 11000;
    both(MEAT, 3);
    both(COOKED, 2);
    h.world.tick = t0 + 17000;
    both(SPARK, 1);
    expect([h.host.stations.toggle(a.ref), h.host.stations.toggle(b.ref)]).toEqual([RESULT_OK, RESULT_OK]);
    const L = h.world.tick;
    const O = L + PIECE;
    const E = O + 30000;
    // One is read every tick, the other is left alone. Nothing else runs.
    while (h.world.tick < E) {
      h.world.tick++;
      items.inv(a.rec);
    }
    const seen = w.slots(a.rec);
    const unseen = w.slots(b.rec);
    expect(unseen).toEqual(seen);
    // Both went out at the tick their sparkpowder did, and were lit 10 then 1 again.
    expect(swaps).toEqual([
      [0, L, BIN, LIT],
      [1, L, BIN, LIT],
      [0, O, LIT, BIN],
      [1, O, LIT, BIN],
    ]);
    expect([kindOf(h, a.ref), kindOf(h, b.ref), a.rec.fire, b.rec.fire]).toEqual([BIN, BIN, null, null]);

    // Worked out by hand. Each top item's time left is scaled by 10 at L and by a tenth, rounded down, at O.
    const [M, C, S, B] = [reg.spoilTicks[MEAT]!, reg.spoilTicks[COOKED]!, reg.spoilTicks[SPOILED]!, reg.spoilTicks[BERRY]!];
    const lit = (at: number): number => L + 10 * (at - L);
    const out = (at: number): number => O + Math.floor((at - O) / 10);
    // Raw meat, minted at t0 + 11000: lit at L, out at O, then two spoil in the hand's time and one is left.
    const meat = out(lit(t0 + 11000 + M));
    // Cooked meat, minted then too: one spoils after O.
    const cooked = out(lit(t0 + 11000 + C));
    // Berries, minted at t0: the first spoils while lit, the next starts its 10 times, and one more spoils after O.
    const berry1 = lit(t0 + B);
    const berry = out(berry1 + 10 * B);
    expect([berry1 > L && berry1 < O, meat + M < E, meat + 2 * M > E, cooked < E, cooked + C > E, berry < E, berry + B > E]).toEqual([true, true, true, true, true, true, true]);
    expect(unseen).toEqual(
      [
        [BERRY, 3, berry + B],
        [MEAT, 1, meat + 2 * M],
        [COOKED, 1, cooked + C],
        // Spoiled meat, from the first raw meat at `meat`: the stack is as old as its oldest part.
        [SPOILED, 3, meat + S],
      ].sort((x, y) => x[0]! - y[0]!),
    );
    // The deadline that was the fires' does nothing now, and the ledger is whole.
    h.run(300);
    expect([w.slots(b.rec), h.host.stations.wentOut]).toEqual([unseen, 2]);
    expect(items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("food carried into a lit bin and out of it keeps its time left, scaled each way and never fresher, and the ledger is whole", () => {
  const w = arena();
  const { h, s, me } = w;
  try {
    const { ref, rec } = w.bin();
    h.host.items.mint(rec, SPARK, 2);
    expect(w.act(ref, STRUCT_USE)).toBe(RESULT_OK);
    expect(w.act(ref, STRUCT_LIGHT)).toBe(RESULT_OK);
    h.say(s, "give meat 1");
    const mine = h.host.items.inv(me);
    const from = mine.item.indexOf(MEAT);
    const born = mine.spoilAt[from]! - reg.spoilTicks[MEAT]!;
    h.run(20000);
    // The tick each move lands at: the bin's inventory changes then.
    let movedAt = -1;
    const told = h.host.items.onChange;
    h.host.items.onChange = (r) => {
      if (r === rec) movedAt = h.world.tick;
      told?.(r);
    };
    const move = (fromBox: number, fromSlot: number, toBox: number, toSlot: number): number => {
      let code = -1;
      s.onResult = (seq, c) => void (seq !== 0 && (code = c));
      s.command(CMD_MOVE, (wr: BitWriter) => (wr.bits(fromBox, 1), wr.varint(fromSlot), wr.bits(toBox, 1), wr.varint(toSlot), wr.u16(0), wr.u16(MEAT)));
      h.run(150);
      expect(code).toBe(RESULT_OK);
      return movedAt;
    };
    // Into the bin: what it had left at the tick it moved is ten times as long, and the session sees it so.
    const into = rec.inv!.free();
    const m = move(BOX_SELF, from, BOX_OPEN, into);
    const inAt = rec.inv!.spoilAt[into]!;
    expect(inAt).toBe(m + 10 * (born + reg.spoilTicks[MEAT]! - m));
    expect(s.open!.inventory.spoilAt[into]).toBe(inAt);
    // Out again ten minutes later: what it had left is a tenth, rounded down, so moving it never made it fresher. Ten minutes
    // in the bin cost it one of the hand's.
    h.world.tick += 600 * TICK_RATE;
    h.run(200);
    const back = mine.free();
    const n = move(BOX_OPEN, into, BOX_SELF, back);
    const outAt = mine.spoilAt[back]!;
    expect(outAt).toBe(n + Math.floor((inAt - n) / 10));
    // So it is as if it had lain in the hand all along but for the time in the bin, of which it spent a tenth, rounded up.
    expect(outAt - (n - m)).toBe(born + reg.spoilTicks[MEAT]! - Math.ceil((n - m) / 10));
    expect(n - m >= 600 * TICK_RATE).toBe(true);
    expect(s.inventory!.spoilAt[back]).toBe(outAt);
    expect([h.host.items.inv(me).total(MEAT), rec.inv!.total(MEAT)]).toEqual([1, 0]);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a bin lit across a restart keeps its clocks as they were, goes out at its tick after the load, and rescales them then; the spoil setting multiplies with the bin's", () => {
  const dir = mkdtempSync(joinPath(tmpdir(), "snark-bin-"));
  const dbPath = joinPath(dir, "world.db");
  // Raw meat keeps twice as long under GlobalSpoilingTimeMultiplier 2, and 20 times as long in a lit bin then.
  const config = loadConfig({ game: "[/script/shootergame.shootergamemode]\nGlobalSpoilingTimeMultiplier=2\n" }).rules;
  const w = arena({ dbPath, config });
  let h = w.h;
  try {
    const M = h.world.reg.spoilTicks[MEAT]!;
    expect(M).toBe(2 * 600 * TICK_RATE);
    const { ref, rec } = w.bin();
    h.host.items.mint(rec, SPARK, 1);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    const L = h.world.tick;
    h.host.items.mint(rec, MEAT, 2);
    expect(rec.inv!.spoilAt[slotOf(rec, MEAT)]).toBe(L + 10 * M);
    h.run(1000);
    const before = slotsOf(h, rec);
    h.host.shutdown();

    h = new Harness({}, 1, 60, { dev: true, dbPath, config });
    h.join("ada");
    h.run(300);
    const again = h.host.fixtures.find(ref)!;
    // Loaded lit, with the clocks it was saved with: nothing is rescaled by a load.
    expect([kindOf(h, ref), again.fire !== null, again.kind]).toEqual([LIT, true, LIT]);
    const inv = h.host.items.inv(again);
    expect([inv.keep, inv.spoilAt[slotOf(again, MEAT)], inv.total(MEAT)]).toEqual([10, before[0]![2], 2]);
    // The fuel (not scaled by the spoil setting) runs out at L + 1,800 s, after the load, by its deadline with nobody looking.
    h.world.tick = L + PIECE + 100;
    h.run(200);
    expect([kindOf(h, ref), again.fire]).toEqual([BIN, null]);
    const O = L + PIECE;
    expect(again.inv!.spoilAt[slotOf(again, MEAT)]).toBe(O + Math.floor((L + 10 * M - O) / 10));
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const how of ["demolished", "destroyed"] as const) test(`a lit bin ${how} leaves its food in a cache that keeps it as the hand does, its time left a tenth of what it had in the bin`, () => {
  const w = arena();
  const { h } = w;
  try {
    const { ref, rec } = w.bin();
    h.host.items.mint(rec, SPARK, 2);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    h.host.items.mint(rec, MEAT, 3);
    const lit = rec.inv!.spoilAt[slotOf(rec, MEAT)]!;
    expect(lit).toBe(h.world.tick + 10 * reg.spoilTicks[MEAT]!);
    h.run(2000);
    const caches = (): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.kind === id("cache"));
    expect(caches()).toEqual([]);
    if (how === "demolished") expect(w.act(ref, STRUCT_DEMOLISH)).toBe(RESULT_OK);
    else expect(h.world.structs.damage(ref, 1000, h.world.tick)).toBe(0);
    const [cache] = caches() as [EntityRecord];
    const t = h.world.tick;
    const at = cache.inv!.spoilAt[slotOf(cache, MEAT)]!;
    // Out of the bin it has a tenth of the time it had left there, rounded down, as if carried out at the tick it broke.
    expect([cache.inv!.total(MEAT), cache.inv!.total(SPARK), cache.inv!.keep]).toEqual([3, 1, 1]);
    // Destroyed, it broke at this tick; demolished, at one of the ticks the command took to arrive.
    const broke = Array.from({ length: how === "destroyed" ? 1 : 10 }, (_, k) => t - k).filter((d) => at === d + Math.floor((lit - d) / 10));
    expect(broke.length).toBeGreaterThan(0);
    // And it spoils in the cache at that tick, not ten times later.
    h.world.tick = at;
    expect(h.host.items.inv(cache).total(MEAT)).toBe(2);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a blueprint of sparkpowder is never the bin's fuel nor its jerky's: lit with one ahead of real sparkpowder, the real one burns and the blueprint stays", () => {
  const w = arena();
  const { h } = w;
  try {
    const items = h.host.items;
    expect(reg.blueprints[SPARK]).toBe(1);
    // A blueprint alone is no fuel: the bin will not light.
    const alone = w.bin(-2);
    expect(items.mint(alone.rec, SPARK, 1, 0, 0, -1, "", FLAG_BLUEPRINT)).toBe(1);
    expect(h.host.stations.toggle(alone.ref)).toBe(RESULT_SHORT);
    expect([kindOf(h, alone.ref), alone.rec.inv!.item[0], alone.rec.inv!.flags[0]]).toEqual([BIN, SPARK, FLAG_BLUEPRINT]);

    // The blueprint lies in the first slot, three real sparkpowder after it, with what jerky needs but the third
    // sparkpowder: the blueprint does not make up the count.
    const { ref, rec } = w.bin(2);
    items.mint(rec, SPARK, 1, 0, 0, -1, "", FLAG_BLUEPRINT);
    items.mint(rec, SPARK, 3);
    items.mint(rec, COOKED, 1);
    items.mint(rec, id("oil"), 1);
    expect([rec.inv!.item[0], rec.inv!.flags[0], rec.inv!.item[1], rec.inv!.count[1]]).toEqual([SPARK, FLAG_BLUEPRINT, SPARK, 3]);
    expect(h.host.stations.toggle(ref)).toBe(RESULT_OK);
    const lit = rec.fire!.at;
    // One real one burns; two are left, which with the blueprint are not the three jerky takes, so no lane is under way.
    expect([rec.inv!.total(SPARK), rec.inv!.item[0], rec.inv!.flags[0], rec.fire!.out]).toEqual([2, SPARK, FLAG_BLUEPRINT, lit + 3 * PIECE]);
    expect(rec.fire!.lanes!.map((l) => l.ticks)).toEqual([0, 0]);
    // Burnt out at its tick, all three real ones gone, the blueprint still in its slot and no jerky made.
    h.world.tick = lit + 3 * PIECE + 10;
    items.inv(rec);
    expect([kindOf(h, ref), rec.fire, rec.inv!.total(SPARK), rec.inv!.item[0], rec.inv!.flags[0], rec.inv!.total(id("jerky"))]).toEqual([BIN, null, 0, SPARK, FLAG_BLUEPRINT, 0]);
    expect(items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});

test("a container may keep things longer always, as ARK's feeding trough keeps them 4 times as long", () => {
  const pack = { name: "test", requires: ["core"], defs: [{ id: "test:trough", type: "structure" as const, class: "container" as const, mesh: "box", color: 3, half: [0.5, 0.3, 0.5] as [number, number, number], hp: 500, slots: 10, keeps: 4 }] };
  const made = compilePacks([CORE_PACK, pack]);
  expect(made.errors).toEqual([]);
  const tested = made.registry!;
  const trough = tested.index.get("test:trough")!;
  expect([tested.keeps[trough], tested.structKeeps[trough]]).toEqual([4, 4]);
  const h = new Harness({}, 1, 60, { dev: true, startingCreatures: 0 }, tested);
  try {
    const s = h.join("ada", {}, { registry: tested });
    h.run(300);
    const me = h.host.records.byPid.get(h.client(s)!.pid)!;
    const at = flatGround(h, 30, 30);
    const ref = h.world.structs.add(trough, at.x + 11, at.y + 0.3, at.z + 10, 0, me.team, 500);
    const rec = h.host.fixtures.ensure(ref);
    h.host.items.mint(rec, tested.index.get("core:meat")!, 1);
    expect(rec.inv!.spoilAt[rec.inv!.item.indexOf(tested.index.get("core:meat")!)]).toBe(h.world.tick + 4 * tested.spoilTicks[tested.index.get("core:meat")!]!);
    expect(h.host.items.audit()).toEqual([]);
  } finally {
    h.host.shutdown();
  }
});
