// Eggs as things (P6): taken up, carried, kept, set down and eaten; laid in place of feces; and what a modified client
// cannot do with them.

import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { DEADLINE_BREED, fertile, held } from "../../server/breeding.ts";
import { createHost } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { CMD_DROP, CMD_OPEN, CMD_TAKE, CMD_USE, RESULT_FAR, RESULT_FULL, RESULT_INVALID, RESULT_OK, RESULT_STALE } from "../../shared/net/protocol.ts";
import { EGG_LIMIT, EGG_LIMIT_RANGE, leftAtSpeed } from "../../shared/sim/breeding.ts";
import { F_AWAKE, F_PROP } from "../../shared/sim/entities.ts";
import { Genome, rollWild } from "../../shared/sim/genome.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { Rng } from "../../shared/rng.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { flatGround } from "../fixtures/arena.ts";
import { OP_EAT, OP_GO, OP_LAID, OP_PUT, OP_TAKE } from "../fixtures/crash-child.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const dir = mkdtempSync(join(tmpdir(), "snark-eggs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Ada with cheats on level ground. */
function pen(host: { dbPath?: string; wakeRadius?: number } = {}) {
  const h = new Harness({}, 1, 60, { dev: true, ...host });
  const ada = h.join("ada");
  h.run(500);
  const g = flatGround(h, 60, 40);
  const at = { x: g.x + 20, z: g.z + 8, y: g.y };
  h.say(ada, "enablecheats");
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  return { h, ada, at, me };
}

function tame(h: Harness, owner: EntityRecord, species: string, x: number, z: number, female: boolean): { e: number; rec: EntityRecord } {
  const e = h.host.spawnCreature(`core:${species}`, x, z, 10);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  rec.genome!.female = female;
  h.host.taming.give(rec, owner, 1);
  return { e, rec };
}

function wild(h: Harness, species: string, x: number, z: number, female: boolean): { e: number; rec: EntityRecord } {
  const e = h.host.spawnCreature(`core:${species}`, x, z, 10);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  rec.genome!.female = female;
  return { e, rec };
}

/** A fertilised dodo egg lying at (x, z), as breeding lays one, hatching in `ticks`. */
function laidFertile(h: Harness, x: number, z: number, genome: Genome, ticks: number, team = 0): EntityRecord {
  const egg = h.host.records.create(id("egg_dodo"), "dodo egg");
  egg.genome = genome;
  egg.team = team;
  egg.x = x;
  egg.z = z;
  egg.y = h.world.hf.heightAt(x, z);
  const hatchAt = h.world.tick + ticks;
  egg.egg = { species: id("dodo"), span: ticks, hatchAt, carrier: 0 };
  h.host.death.place(egg);
  h.world.ents.setYoung(h.host.records.entOf.get(egg.pid)!, ticks, hatchAt);
  h.host.deadlines.push(hatchAt, DEADLINE_BREED, egg.pid, hatchAt);
  return egg;
}

/** Sends one command and returns its result code, or -1 if none came. */
function command(h: Harness, s: ClientSession, op: number, write: (w: BitWriter) => void): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(op, write);
  h.run(200);
  return code;
}
const take = (h: Harness, s: ClientSession, e: number): number => command(h, s, CMD_TAKE, (w) => w.u32(e >>> 0));
const drop = (h: Harness, s: ClientSession, slot: number, item: number, n = 0): number => command(h, s, CMD_DROP, (w) => (w.varint(slot), w.u16(n), w.u16(item)));

/** Puts Ada 1 m from `x, z`, on the side away from (fx, fz). */
function beside(h: Harness, s: ClientSession, x: number, z: number, fx: number, fz: number): void {
  const off = Math.hypot(x - fx, z - fz) || 1;
  h.say(s, `tp ${(x + (x - fx) / off).toFixed(3)} ${(z + (z - fz) / off).toFixed(3)}`);
}

const lying = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.egg !== null && h.host.records.entOf.has(r.pid));
const young = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.grown !== 0);
const heaps = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.kind === id("feces"));

test("a dodo's fertilised egg taken up keeps its young and the time it had left across a restart, and set down hatches on the tick that time gives", () => {
  const dbPath = join(dir, "carried.db");
  let { h, ada, me } = pen({ dbPath });
  // A 50x server: the dodo's egg takes a minute.
  h.say(ada, "setting EggHatchSpeedMultiplier 50");
  const ents = () => h.world.ents;
  const f = tame(h, me, "dodo", ents().x[h.ent(ada)]! - 0.6, ents().z[h.ent(ada)]! + 3, true);
  const m = tame(h, me, "dodo", ents().x[h.ent(ada)]! + 0.6, ents().z[h.ent(ada)]! + 3, false);
  f.rec.mating = m.rec.mating = true;
  h.run(32500);
  const [egg, ...litter] = lying(h);
  // Only one of a litter is followed.
  for (const other of litter) {
    ents().destroy(h.host.records.entOf.get(other.pid)!);
    h.host.records.delete(other.pid);
  }
  const span = Math.ceil(reg.incubateTicks[id("dodo")]! / 50);
  expect([egg!.kind, egg!.egg!.span, egg!.team, fertile(egg!)]).toEqual([id("egg_dodo"), span, me.team, true]);
  const was = { wild: [...egg!.genome!.wild], colors: [...egg!.genome!.colors], female: egg!.genome!.female, mother: egg!.genome!.mother, father: egg!.genome!.father };
  beside(h, ada, egg!.x, egg!.z, ents().x[f.e]!, ents().z[f.e]!);
  const hatchAt = egg!.egg!.hatchAt;
  const before = h.world.tick;
  expect(take(h, ada, h.host.records.entOf.get(egg!.pid)!)).toBe(RESULT_OK);
  // It lies there no more. In her bag is a fertilised egg that stands for it, and it keeps the time it had left.
  const inv = h.host.items.inv(me);
  const slot = inv.item.indexOf(id("dodo_egg_fertile"));
  const left = egg!.egg!.hatchAt;
  expect([h.host.records.entOf.has(egg!.pid), inv.refOf(slot), held(egg!), h.host.eggs.taken]).toEqual([false, egg!.pid, true, 1]);
  expect(left).toBeLessThanOrEqual(hatchAt - before);
  expect(left).toBeGreaterThanOrEqual(hatchAt - h.world.tick);
  // Held past the tick it would have hatched, it has not, as in ARK.
  while (h.world.tick < hatchAt + 300) h.run(1000);
  expect([h.host.breeding.hatched, egg!.egg!.hatchAt, young(h).length]).toEqual([0, left, 0]);
  // Hatching made twice as fast while it is held halves what it has left.
  h.say(ada, "setting EggHatchSpeedMultiplier 100");
  expect([egg!.egg!.hatchAt, egg!.egg!.span]).toEqual([leftAtSpeed(left, 50, 100), span / 2]);
  h.say(ada, "setting EggHatchSpeedMultiplier 50");
  expect([egg!.egg!.hatchAt, egg!.egg!.span]).toEqual([leftAtSpeed(leftAtSpeed(left, 50, 100), 100, 50), span]);
  const kept = egg!.egg!.hatchAt;

  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
  ada = h.join("ada");
  h.run(1000);
  const again = h.host.records.byPid.get(egg!.pid)!;
  const mine = h.host.items.inv(h.host.records.byPid.get(me.pid)!);
  expect([mine.item[slot], mine.refOf(slot), again.egg!.hatchAt, held(again), h.host.records.entOf.has(again.pid), h.host.eggs.mended, h.host.items.audit()]).toEqual([id("dodo_egg_fertile"), egg!.pid, kept, true, false, 0, []]);
  const g = again.genome!;
  expect({ wild: [...g.wild], colors: [...g.colors], female: g.female, mother: g.mother, father: g.father }).toEqual(was);

  // Set down, it lies ahead of her and hatches the time it had left from then.
  const down = h.world.tick;
  expect(drop(h, ada, slot, id("dodo_egg_fertile"))).toBe(RESULT_OK);
  const due = again.egg!.hatchAt;
  expect(due - kept).toBeGreaterThanOrEqual(down);
  expect(due - kept).toBeLessThanOrEqual(h.world.tick);
  const ee = h.host.records.entOf.get(again.pid)!;
  expect([mine.item[slot], held(again), (h.world.ents.flags[ee]! & F_PROP) !== 0, h.world.ents.span[ee], h.world.ents.grown[ee]]).toEqual([0, false, true, span, due]);
  while (h.world.tick < due - 30) h.run(500);
  expect(young(h).length).toBe(0);
  while (h.world.tick < due + 5) h.run(200);
  const baby = young(h)[0]!;
  expect([baby.grown - baby.span, baby.genome === g, baby.kind, h.host.records.byPid.has(again.pid)]).toEqual([due, true, id("dodo"), false]);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

test("a female dodo, wild or tamed, lays an unfertilised egg at her vent in place of her feces 13 times in 100; a male, or one not grown, never does", () => {
  const { h, ada, at, me } = pen();
  h.say(ada, `tp ${(at.x + 30).toFixed(3)} ${at.z.toFixed(3)}`);
  const hen = wild(h, "dodo", at.x, at.z + 2, true);
  h.run(300);
  const ents = h.world.ents;
  const look = [0, 0, 0];
  const counts = { egg: 0, feces: 0 };
  const N = 4000;
  for (let k = 0; k < N; k++) {
    const left = h.host.feces.go(hen.rec, hen.e)!;
    // Where her rig's vent is: a little behind her middle, under the tail.
    lookDirection(ents.yaw[hen.e]!, 0, look);
    const [dx, dz] = [left.x - ents.x[hen.e]!, left.z - ents.z[hen.e]!];
    if (k < 20) {
      expect(dx * look[0]! + dz * look[2]!).toBeLessThan(-0.05);
      expect(Math.hypot(dx, dz)).toBeLessThan(0.4);
      // Fallen to the level ground she stands on.
      expect(Math.abs(left.y - ents.y[hen.e]!)).toBeLessThan(0.01);
    }
    if (left.egg) {
      counts.egg++;
      expect([left.kind, left.team, left.inv!.item[0], left.inv!.count[0], fertile(left), left.name]).toEqual([id("egg_dodo"), 0, id("dodo_egg"), 1, false, "dodo egg"]);
    } else {
      counts.feces++;
      expect([left.kind, left.inv!.item[0], left.name]).toEqual([id("feces"), id("feces_small"), "small animal feces"]);
    }
    // Taken away, so that none pile up.
    h.host.death.remove(left);
  }
  expect(counts.egg / N).toBeGreaterThan(0.115);
  expect(counts.egg / N).toBeLessThan(0.145);
  const cock = wild(h, "dodo", at.x + 3, at.z + 2, false);
  const chick = tame(h, me, "dodo", at.x - 3, at.z + 2, true);
  chick.rec.span = 1000;
  chick.rec.grown = h.world.tick + 900;
  const hen2 = tame(h, me, "dodo", at.x - 6, at.z + 2, true);
  let theirs = 0;
  let tamed: EntityRecord | null = null;
  for (let k = 0; k < 300; k++) {
    for (const d of [cock, chick]) {
      const left = h.host.feces.go(d.rec, d.e)!;
      if (left.egg) theirs++;
      h.host.death.remove(left);
    }
    const left = h.host.feces.go(hen2.rec, hen2.e)!;
    if (left.egg && !tamed) tamed = left;
    else h.host.death.remove(left);
  }
  expect([theirs, tamed?.team]).toEqual([0, me.team]);
  expect(h.host.items.audit()).toEqual([]);
});

test("at most 6 unfertilised eggs lie within 10 m: then she leaves feces, and fertilised eggs are not counted, as in ARK", () => {
  const { h, ada, at } = pen();
  h.say(ada, `tp ${(at.x + 30).toFixed(3)} ${at.z.toFixed(3)}`);
  const hen = wild(h, "dodo", at.x, at.z + 2, true);
  h.run(300);
  const rng = new Rng(3);
  for (let k = 0; k < 3; k++) laidFertile(h, at.x + 1 + k * 0.3, at.z + 1, rollWild(rng, 5, reg.colorSet[id("dodo")]!), 99999);
  const near = (x: number, z: number): number => lying(h).filter((r) => !fertile(r) && Math.hypot(r.x - x, r.z - z) <= EGG_LIMIT_RANGE).length;
  let most = 0;
  for (let k = 0; k < 400; k++) {
    h.host.feces.go(hen.rec, hen.e);
    most = Math.max(most, near(at.x, at.z + 2));
  }
  expect([EGG_LIMIT, most, h.host.eggs.near(id("egg_dodo"), at.x, at.z + 2)]).toEqual([6, 6, 6]);
  // 12 m on, she lays again.
  const ents = h.world.ents;
  ents.setPosition(hen.e, at.x + 12, ents.y[hen.e]!, at.z + 2);
  let laid = 0;
  for (let k = 0; k < 100; k++) if (h.host.feces.go(hen.rec, hen.e)?.egg) laid++;
  expect(laid).toBeGreaterThan(0);
  expect(near(at.x + 12, at.z + 2)).toBeLessThanOrEqual(6);
  expect(h.host.items.audit()).toEqual([]);
});

test("a modified client cannot take an egg out of reach, take one twice, set one down twice, or learn anything of a fertilised egg's young", () => {
  const { h, ada, at, me } = pen();
  const ents = h.world.ents;
  const rng = new Rng(9);
  const one = rollWild(rng, 30, reg.colorSet[id("dodo")]!);
  const two = rollWild(rng, 5, reg.colorSet[id("dodo")]!);
  one.female = true;
  two.female = false;
  const a = laidFertile(h, at.x + 1, at.z + 6, one, 99999, me.team);
  const b = laidFertile(h, at.x - 1, at.z + 6, two, 99999, me.team);
  h.run(500);
  // What Ada is shown of the two is the same: no level, no colours, no team.
  const seen = new RemoteSample();
  ada.sampleRemote(seen);
  const shown = (egg: EntityRecord) => {
    const i = seen.id.subarray(0, seen.count).indexOf(h.host.records.entOf.get(egg.pid)!);
    return [seen.kind[i], seen.level[i], [...seen.colors.subarray(i * 6, i * 6 + 6)], seen.team[i], seen.name[i], seen.span[i]];
  };
  expect(shown(a)).toEqual(shown(b));
  expect(shown(a)).toEqual([id("egg_dodo"), 0, [0, 0, 0, 0, 0, 0], 0, "dodo egg", 99999]);
  // It cannot be opened, as a creature or with the use key.
  expect(command(h, ada, CMD_OPEN, (w) => w.u32(h.host.records.entOf.get(a.pid)!))).toBe(RESULT_INVALID);
  expect([ada.subject, ada.open]).toEqual([null, null]);

  // From 6 m it is out of reach. Nothing that is not an egg lying can be taken.
  h.say(ada, `tp ${(at.x + 1).toFixed(3)} ${(at.z + 12).toFixed(3)}`);
  const ea = h.host.records.entOf.get(a.pid)!;
  expect([take(h, ada, ea), take(h, ada, 0xffffffff), take(h, ada, h.ent(ada)), take(h, ada, ents.cap + 5)]).toEqual([RESULT_FAR, RESULT_INVALID, RESULT_INVALID, RESULT_INVALID]);
  const dodo = wild(h, "dodo", at.x + 3, at.z + 9, true);
  h.run(200);
  expect(take(h, ada, dodo.e)).toBe(RESULT_INVALID);

  // Asked twice at once, it is taken once.
  h.say(ada, `tp ${at.x.toFixed(3)} ${(at.z + 7.5).toFixed(3)}`);
  const codes: number[] = [];
  ada.onResult = (seq, c) => void (seq !== 0 && codes.push(c));
  const eb = h.host.records.entOf.get(b.pid)!;
  for (const e of [ea, ea, eb, eb]) ada.command(CMD_TAKE, (w) => w.u32(e));
  h.run(400);
  expect(codes).toEqual([RESULT_OK, RESULT_INVALID, RESULT_OK, RESULT_INVALID]);
  const inv = h.host.items.inv(me);
  const fertileItem = id("dodo_egg_fertile");
  expect([inv.total(fertileItem), held(a), held(b)]).toEqual([2, true, true]);
  // In her bag the two are alike to the last bit: the item, its count, its quality, its wear and its spoil clock.
  h.run(400);
  const sa = inv.item.indexOf(fertileItem);
  const sb = inv.item.indexOf(fertileItem, sa + 1);
  const mirror = ada.inventory!;
  const slot = (s: number) => [mirror.item[s], mirror.count[s], mirror.quality[s], mirror.dur[s], mirror.spoilAt[s], mirror.ammo[s], mirror.loaded[s], mirror.attach[s], mirror.refOf(s)];
  expect(slot(sa)).toEqual(slot(sb));
  expect(slot(sa).slice(0, 2)).toEqual([fertileItem, 1]);

  // Set down twice at once, it lies once.
  codes.length = 0;
  for (let k = 0; k < 2; k++) ada.command(CMD_DROP, (w) => (w.varint(sa), w.u16(0), w.u16(fertileItem)));
  h.run(400);
  expect(codes).toEqual([RESULT_OK, RESULT_STALE]);
  const ref = (pid: number) => [...h.host.records.byPid.values()].filter((r) => r.inv?.ref?.includes(pid)).length;
  expect([lying(h).filter((r) => fertile(r)).length, inv.total(fertileItem), ref(a.pid) + ref(b.pid)]).toEqual([1, 1, 1]);

  // An unfertilised egg goes whole into the bag once; a full bag takes none.
  const laid = h.host.eggs.lay(id("dodo"), 0, at.x, ents.y[h.ent(ada)]!, at.z + 6.5, 0)!;
  codes.length = 0;
  const el = h.host.records.entOf.get(laid.pid)!;
  for (let k = 0; k < 2; k++) ada.command(CMD_TAKE, (w) => w.u32(el));
  h.run(400);
  expect([codes, inv.total(id("dodo_egg")), h.host.records.byPid.has(laid.pid)]).toEqual([[RESULT_OK, RESULT_INVALID], 1, false]);
  const another = h.host.eggs.lay(id("dodo"), 0, at.x + 0.5, ents.y[h.ent(ada)]!, at.z + 6.5, 0)!;
  h.host.items.burnItem(me, id("dodo_egg"), 1);
  h.host.items.mint(me, id("stone"), inv.room(id("stone"), 0, reg));
  expect(take(h, ada, h.host.records.entOf.get(another.pid)!)).toBe(RESULT_FULL);
  expect([h.host.records.entOf.has(another.pid), h.host.items.audit()]).toEqual([true, []]);
});

test("a dodo egg is food: eaten, it feeds; a fertilised one eaten or spoiled is gone with its young", () => {
  const { h, ada, at, me } = pen();
  const rng = new Rng(4);
  const egg = laidFertile(h, at.x, at.z + 1.5, rollWild(rng, 5, reg.colorSet[id("dodo")]!), 99999);
  h.run(300);
  expect(take(h, ada, h.host.records.entOf.get(egg.pid)!)).toBe(RESULT_OK);
  const inv = h.host.items.inv(me);
  const slot = inv.item.indexOf(id("dodo_egg_fertile"));
  h.host.survival.add(me, V_FOOD, -60);
  const food = me.vitals!.at(V_FOOD, h.world.tick);
  expect(command(h, ada, CMD_USE, (w) => (w.varint(slot), w.u16(id("dodo_egg_fertile"))))).toBe(RESULT_OK);
  expect(me.vitals!.at(V_FOOD, h.world.tick) - food).toBeGreaterThan(19e6);
  expect([inv.total(id("dodo_egg_fertile")), h.host.records.byPid.has(egg.pid)]).toEqual([0, false]);

  // Held in a dodo, which keeps food four times as long, it spoils in 32 days.
  const keeper = tame(h, me, "dodo", at.x + 3, at.z + 3, false);
  const kept = laidFertile(h, at.x + 3, at.z + 4, rollWild(rng, 5, reg.colorSet[id("dodo")]!), 99999);
  expect(h.host.eggs.takeUp(keeper.rec, kept)).toBe(RESULT_OK);
  const spoil = reg.spoilTicks[id("dodo_egg_fertile")]! * 4;
  h.host.items.spoilTo(keeper.rec, h.world.tick + spoil - 10);
  expect(h.host.records.byPid.has(kept.pid)).toBe(true);
  h.host.items.spoilTo(keeper.rec, h.world.tick + spoil + 10);
  expect([h.host.records.byPid.has(kept.pid), keeper.rec.inv!.total(id("dodo_egg_fertile"))]).toEqual([false, 0]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a creature awake leaves its feces every 100 to 300 s, lying a minute; one with nobody near does not", () => {
  // Creatures a chunk from a survivor are awake, so that the far corner of the proving ground is out of the way.
  const { h, ada, at } = pen({ wakeRadius: 1 });
  const cock = wild(h, "dodo", at.x + 4, at.z + 4, false);
  const t0 = h.world.tick;
  const times: number[] = [];
  const seen = new Set<number>();
  while (h.world.tick < t0 + 330 * TICK_RATE) {
    h.run(500);
    for (const heap of heaps(h)) {
      if (seen.has(heap.pid)) continue;
      seen.add(heap.pid);
      times.push(h.world.tick);
      // It lies a minute, at the item decomposition rule's 1.
      expect(heap.expiresAt - h.world.tick).toBeLessThanOrEqual(60 * TICK_RATE);
      expect(heap.expiresAt - h.world.tick).toBeGreaterThan(59 * TICK_RATE);
      expect([heap.inv!.item[0], heap.inv!.count[0]]).toEqual([id("feces_small"), 1]);
      expect(Math.hypot(heap.x - h.world.ents.x[cock.e]!, heap.z - h.world.ents.z[cock.e]!)).toBeLessThan(1.5);
    }
  }
  expect(times.length).toBeGreaterThanOrEqual(1);
  expect(times.length).toBeLessThanOrEqual(4);
  // The first comes 100 to 300 s after it was first seen awake, within a second.
  expect(times[0]! - t0).toBeGreaterThanOrEqual(100 * TICK_RATE);
  expect(times[0]! - t0).toBeLessThanOrEqual(302 * TICK_RATE);
  for (let k = 1; k < times.length; k++) expect(times[k]! - times[k - 1]!).toBeGreaterThanOrEqual(99 * TICK_RATE);
  // A minute later each is gone.
  h.run(61000);
  expect(heaps(h).filter((r) => seen.has(r.pid)).length).toBe(0);
  // With nobody near, it sleeps, and goes no more.
  h.say(ada, "tp 500 500");
  h.run(1000);
  expect(h.world.ents.flags[cock.e]! & F_AWAKE).toBe(0);
  const asleep = h.host.feces.dropped;
  h.run(320000);
  expect(h.host.feces.dropped).toBe(asleep);
  expect(h.host.items.audit()).toEqual([]);
});

test("taking a wild egg angers the wild of its species near it, as ARK's raptors are; a dodo's or a parasaur's angers none, nor does a tribe's egg", () => {
  const { h, ada, at, me } = pen();
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const adaE = h.ent(ada);
  // Beyond a raptor's sight of her, within the 30 m where it hears of the egg; and one beyond that. Each stands where it is.
  const near = wild(h, "raptor", at.x + 26, at.z, true);
  const far = wild(h, "raptor", at.x + 45, at.z, true);
  const dodo = wild(h, "dodo", at.x + 6, at.z, true);
  const para = wild(h, "parasaur", at.x - 10, at.z + 8, true);
  h.run(100);
  for (const c of [near, far, dodo, para]) mind.stay(c.e, 0xffffffff);
  h.run(200);
  const y = ents.y[adaE]!;
  const hunting = () => [mind.targetOf(near.e), mind.targetOf(far.e), mind.targetOf(dodo.e), mind.targetOf(para.e)];
  expect(hunting()).toEqual([-1, -1, -1, -1]);
  // A tribe's raptor egg, a dodo's and a parasaur's: none is angered.
  const ours = h.host.eggs.lay(id("raptor"), me.team, at.x, y, at.z + 1.2, 0)!;
  const dodoEgg = h.host.eggs.lay(id("dodo"), 0, at.x + 0.6, y, at.z + 1.2, 0)!;
  const paraEgg = h.host.eggs.lay(id("parasaur"), 0, at.x - 0.6, y, at.z + 1.2, 0)!;
  h.run(200);
  for (const egg of [ours, dodoEgg, paraEgg]) expect(take(h, ada, h.host.records.entOf.get(egg.pid)!)).toBe(RESULT_OK);
  expect(hunting()).toEqual([-1, -1, -1, -1]);
  // A wild raptor's: the near one comes for her.
  const theirs = h.host.eggs.lay(id("raptor"), 0, at.x, y, at.z + 1.2, 0)!;
  h.run(200);
  expect(take(h, ada, h.host.records.entOf.get(theirs.pid)!)).toBe(RESULT_OK);
  expect(hunting()).toEqual([adaE, -1, -1, -1]);
  expect(h.host.eggs.angered).toBe(1);
});

test("a pair mates within a range set by its adults' size: dodos 2.5 m apart do and 3.5 m apart do not; parasaurs 6 m apart do", () => {
  const { h, at, me } = pen();
  const pairs = h.host.breeding.pairs;
  const both = (species: string, x: number, z: number, apart: number) => {
    const f = tame(h, me, species, x - apart / 2, z, true);
    const m = tame(h, me, species, x + apart / 2, z, false);
    f.rec.mating = m.rec.mating = true;
    return f.rec.pid;
  };
  const close = both("dodo", at.x, at.z + 4, 2.5);
  const apart = both("dodo", at.x, at.z + 12, 3.5);
  const big = both("parasaur", at.x, at.z + 22, 6);
  h.run(1200);
  expect([pairs.has(close), pairs.has(apart), pairs.has(big)]).toEqual([true, false, true]);
});

test("a world saved before eggs were things loads as it was: an egg lying hatches on its tick, may be taken up, and is saved in the new form", () => {
  const dbPath = join(dir, "before.db");
  let { h, ada, at } = pen({ dbPath });
  const rng = new Rng(12);
  const egg = laidFertile(h, at.x, at.z + 1.5, rollWild(rng, 5, reg.colorSet[id("dodo")]!), 40 * TICK_RATE);
  const other = laidFertile(h, at.x + 3, at.z + 1.5, rollWild(rng, 5, reg.colorSet[id("dodo")]!), 400 * TICK_RATE);
  h.run(500);
  const info = { ...egg.egg! };
  h.host.shutdown();
  // A build from before wrote revision 3, with no part for what a slot stands for, and nothing held.
  const db = new Database(dbPath);
  for (const row of db.query("SELECT pid, data FROM entities").all() as { pid: number; data: Uint8Array }[]) {
    const r = new BitReader(row.data);
    const w = new BitWriter(row.data.length + 16);
    expect(r.u8()).toBe(5);
    w.u8(3);
    w.string(r.string(256));
    const n = r.varint();
    const parts: [number, Uint8Array][] = [];
    for (let k = 0; k < n; k++) parts.push([r.varint(), r.blob(1 << 20)]);
    const kept = parts.filter(([c]) => c !== 20);
    w.varint(kept.length);
    for (const [c, blob] of kept) {
      w.varint(c);
      w.blob(blob);
    }
    db.query("UPDATE entities SET data = ? WHERE pid = ?").run(w.bytes().slice(), row.pid);
  }
  db.close();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  ada = h.join("ada");
  h.run(1000);
  const again = h.host.records.byPid.get(egg.pid)!;
  expect([again.egg, fertile(again), held(again), h.host.records.entOf.has(egg.pid), h.host.eggs.mended]).toEqual([info, true, false, true, 0]);
  // Laid by a tribe's creature or not, a fertilised egg angers nobody: one from before has no team.
  const late = h.host.records.byPid.get(other.pid)!;
  expect(late.team).toBe(0);
  h.say(ada, `tp ${(late.x + 1).toFixed(3)} ${late.z.toFixed(3)}`);
  expect(take(h, ada, h.host.records.entOf.get(late.pid)!)).toBe(RESULT_OK);
  expect(h.host.eggs.angered).toBe(0);
  while (h.world.tick < info.hatchAt + 5) h.run(500);
  const baby = young(h).find((r) => r.genome === again.genome)!;
  expect(baby.grown - baby.span).toBe(info.hatchAt);
  const holder = h.client(ada)!.pid;
  h.host.shutdown();
  // What changed is saved in the new form: the egg held, and Ada, whose slot stands for it.
  const store = new Database(dbPath, { readonly: true });
  const form = (pid: number): number => (store.query("SELECT data FROM entities WHERE pid = ?").get(pid) as { data: Uint8Array }).data[0]!;
  expect([form(late.pid), form(holder)]).toEqual([5, 5]);
  store.close();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  expect([held(h.host.records.byPid.get(late.pid)!), h.host.eggs.mended, h.host.items.audit()]).toEqual([true, 0, []]);
  h.host.shutdown();
});

/** Kills the child, without warning, once it has printed `minAcks` acknowledgements. */
async function runUntilKilled(db: string, seed: number, minAcks: number): Promise<void> {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "../fixtures/crash-child.ts"), db, String(seed), "eggs"], { stdout: "pipe", stderr: "inherit" });
  const decoder = new TextDecoder();
  let text = "";
  let killed = false;
  for await (const chunk of proc.stdout) {
    text += decoder.decode(chunk);
    if (!killed && text.split("acked").length > minAcks) {
      proc.kill(9);
      killed = true;
    }
  }
  await proc.exited;
}

test("eggs and feces are neither lost nor doubled by a process killed at any moment: laid, taken up, set down, eaten, spoiled and hatched", async () => {
  const db = join(dir, "killed.db");
  const ops = new Map<number, number>();
  for (const [seed, minAcks] of [[21, 60], [22, 90], [23, 45]] as const) {
    await runUntilKilled(db, seed, minAcks);
    // Loading audits the ledger, and puts right any slot or held egg that disagree: there must be none.
    const host = createHost(reg, { dbPath: db });
    expect([host.items.audit(), host.eggs.mended]).toEqual([[], 0]);
    let items = 0;
    let heldEggs = 0;
    for (const rec of host.records.byPid.values()) {
      if (held(rec)) heldEggs++;
      for (let s = 0; rec.inv && s < rec.inv.cap; s++) if (rec.inv.item[s] === id("dodo_egg_fertile")) items++;
      // An unfertilised egg or feces lying holds its one stack.
      if ((rec.egg !== null && !fertile(rec)) || rec.kind === id("feces")) expect([rec.inv?.used(), host.records.entOf.has(rec.pid)]).toEqual([1, true]);
    }
    expect(items).toBe(heldEggs);
    for (const j of host.persistence!.store.journal()) ops.set(j.op, (ops.get(j.op) ?? 0) + 1);
    host.shutdown();
  }
  // Each kind of step was taken many times.
  for (const op of [OP_GO, OP_LAID, OP_TAKE, OP_PUT, OP_EAT]) expect([op, (ops.get(op) ?? 0) > 5]).toEqual([op, true]);
});
