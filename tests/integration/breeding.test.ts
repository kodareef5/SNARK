// Breeding: a pair that may, the egg, what hatches, and its growing up, at the reference's numbers.

import { Database } from "bun:sqlite";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { KEY_PROMPT } from "../../client/core/ui/hud.ts";
import { KEY_NAME_TITLE } from "../../client/core/ui/tame.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { buildCorePack } from "../../tools/pack/build.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { DEV_CONFIG } from "../../server/main.ts";
import { loadConfigFolder } from "../../server/settings/config.ts";
import type { Rules } from "../../server/settings/rules.ts";
import type { EntityRecord } from "../../server/records.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BOX_OPEN, BOX_SELF, CMD_CLOSE, CMD_FEED, CMD_MOVE, CMD_OPEN, CMD_ORDER, ORDER_ALL, ORDER_FOLLOW, ORDER_MATE, ORDER_STANCE, ORDER_STAY, ORDER_UNMATE, RESULT_DENIED, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK } from "../../shared/net/protocol.ts";
import { MATE_TICKS, growthStep, maturity, youngHunger, youngScale, youngShare } from "../../shared/sim/breeding.ts";
import { BTN_USE, MF_ROOTED, stanceEye } from "../../shared/sim/character.ts";
import { F_PROP } from "../../shared/sim/entities.ts";
import { STAT_COUNT } from "../../shared/sim/genome.ts";
import { GAME_HOUR_TICKS } from "../../shared/sim/lazy.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { MIND_WANDER } from "../../server/behavior.ts";
import { STAT_FOOD, STAT_HEALTH, statOf } from "../../server/survival.ts";
import type { SpeciesDef } from "../../shared/content/defs.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** Ada and Bob with cheats on level ground, five metres apart. */
function pen(host: { dbPath?: string; rules?: Record<string, number>; config?: Rules } = {}, registry: Registry = reg) {
  const h = new Harness({}, 1, 60, { dev: true, ...host }, registry);
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(500);
  const g = flatGround(h, 60, 30);
  const at = { x: g.x + 20, z: g.z + 8, y: g.y };
  for (const [s, dx] of [[ada, 0], [bob, -5]] as const) {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(at.x + dx).toFixed(3)} ${at.z.toFixed(3)}`);
  }
  const me = h.host.records.byPid.get(h.client(ada)!.pid)!;
  return { h, ada, bob, at, me };
}

/** A grown creature of `owner`'s tribe, of the sex given, standing where it is put. */
function tame(h: Harness, owner: EntityRecord, species: string, x: number, z: number, female: boolean, level = 10): { e: number; rec: EntityRecord } {
  const e = h.host.spawnCreature(`core:${species}`, x, z, level);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  rec.genome!.female = female;
  h.host.taming.give(rec, owner, 1);
  return { e, rec };
}

/** Tell creature `e` something, as `s`. Returns what the server said of it. */
function order(h: Harness, s: ClientSession, e: number, what: number): number {
  let code = -1;
  s.onResult = (seq, c) => void (seq !== 0 && (code = c));
  s.command(CMD_ORDER, (w: BitWriter) => (w.u32(e >>> 0), w.u8(what)));
  h.run(150);
  return code;
}

/** Look at entity `e`, `up` of the way up it, and press the use button. Returns what the server said unasked, or -1. */
function press(h: Harness, s: ClientSession, e: number, up = 0.5): number {
  const ents = h.world.ents;
  const me = h.ent(s);
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  const eye = ents.y[me]! + stanceEye(h.reg.move[ents.kind[me]!]!, 0);
  const [dx, dz] = [ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!];
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(ents.y[e]! + h.reg.bodyHeight[ents.kind[e]!]! * up - eye, Math.hypot(dx, dz));
  h.run(150);
  let told = -1;
  s.onResult = (seq, c) => void (seq === 0 && (told = c));
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(200);
  return told;
}

const eggs = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.egg !== null);
const young = (h: Harness): EntityRecord[] => [...h.host.records.byPid.values()].filter((r) => r.grown !== 0);

test("a female and a male of one tribe, both told they may, have an egg after half a minute together; it says when it will hatch, and she rests for most of a day or two", () => {
  const { h, ada, at, me } = pen();
  const ents = h.world.ents;
  const breeding = h.host.breeding;
  const f = tame(h, me, "parasaur", at.x - 2, at.z + 3, true);
  const m = tame(h, me, "parasaur", at.x + 2, at.z + 3, false, 25);
  // Looked into, she says what she is: of a kind that breeds, female, grown, and not told she may.
  ada.command(CMD_OPEN, (w: BitWriter) => w.u32(f.e));
  h.run(400);
  expect(ada.subject).toMatchObject({ owned: true, breeds: true, mating: false, female: true, stage: 3, maturity: 1, mate: 0, wait: 0 });
  // One of them willing is no pair. Both, and within a second they are one.
  expect(order(h, ada, f.e, ORDER_MATE)).toBe(RESULT_OK);
  h.run(2000);
  expect([f.rec.mating, m.rec.mating, breeding.pairCount]).toEqual([true, false, 0]);
  expect(order(h, ada, m.e, ORDER_MATE)).toBe(RESULT_OK);
  h.run(1100);
  expect([breeding.pairCount, breeding.begun, eggs(h).length]).toEqual([1, 1, 0]);
  const began = h.world.tick;
  // A third of the way through, the panel says so.
  h.run(9000);
  expect(ada.subject!.mating).toBe(true);
  expect(ada.subject!.mate).toBeGreaterThan(0.25);
  expect(ada.subject!.mate).toBeLessThan(0.45);
  expect(eggs(h).length).toBe(0);
  h.run(22000);
  // Done: an egg under her (or two, or three), and no pair.
  const laid = eggs(h);
  expect([breeding.mated, breeding.pairCount, laid.length >= 1 && laid.length <= 3, laid.length === breeding.laid]).toEqual([1, 0, true, true]);
  const egg = laid[0]!;
  const info = egg.egg!;
  expect(Math.abs(info.hatchAt - info.span - began - MATE_TICKS)).toBeLessThanOrEqual(TICK_RATE + 6);
  expect([egg.kind, egg.name, info.species, info.carrier, info.span]).toEqual([id("egg_parasaur"), "parasaur egg", id("parasaur"), 0, 5142 * TICK_RATE]);
  const ee = h.host.records.entOf.get(egg.pid)!;
  expect([(ents.flags[ee]! & F_PROP) !== 0, ents.span[ee], ents.grown[ee]]).toEqual([true, info.span, info.hatchAt]);
  // It lies just behind her, clear of her.
  const off = Math.hypot(egg.x - ents.x[f.e]!, egg.z - ents.z[f.e]!);
  expect([off > reg.bodyRadius[id("parasaur")]!, off < 2]).toEqual([true, true]);
  // What is in it is theirs: every stat one parent's or the other's (a mutation adds two), and both of them written down.
  const g = egg.genome!;
  expect([g.mother, g.father]).toEqual([f.rec.pid, m.rec.pid]);
  for (let s = 0; s < STAT_COUNT; s++) {
    expect([f.rec.genome!.wild[s], m.rec.genome!.wild[s]]).toContain(g.wild[s]);
    expect(g.tamed[s]).toBe(0);
  }
  // She rests between eighteen and forty-eight hours; he does not.
  const rest = (f.rec.mateReadyAt - (info.hatchAt - info.span)) / TICK_RATE / 3600;
  expect(rest).toBeGreaterThanOrEqual(18);
  expect(rest).toBeLessThan(48);
  expect(m.rec.mateReadyAt).toBe(0);
  h.run(3000);
  expect([breeding.pairCount, breeding.begun]).toEqual([0, 1]);
  expect(ada.subject).toMatchObject({ mating: true, mate: 0 });
  expect(Math.abs(ada.subject!.wait - (f.rec.mateReadyAt - h.world.tick) / TICK_RATE)).toBeLessThan(2);

  // Whoever is near sees the egg and can tell when it will hatch. It is not something to look into, and is none the worse for the trying.
  const seen = new RemoteSample();
  ada.sampleRemote(seen);
  const i = seen.kind.subarray(0, seen.count).indexOf(id("egg_parasaur"));
  expect([i >= 0, seen.name[i], seen.span[i], seen.grown[i]]).toEqual([true, "parasaur egg", info.span, info.hatchAt]);
  ada.command(CMD_CLOSE);
  h.run(200);
  // (From the side of it away from her, so that she is not what is looked at.)
  const [ax, az] = [egg.x - ents.x[f.e]!, egg.z - ents.z[f.e]!];
  h.say(ada, `tp ${(egg.x + (ax / off) * 1.5).toFixed(3)} ${(egg.z + (az / off) * 1.5).toFixed(3)}`);
  expect([press(h, ada, ee, 0.5), h.host.death.target(h.client(ada)!, 3.5)]).toEqual([-1, ee]);
  h.run(1000);
  expect([ada.open, h.client(ada)!.open, h.host.records.byPid.has(egg.pid), h.host.records.entOf.get(egg.pid)]).toEqual([null, 0, true, ee]);
  expect(h.host.items.audit()).toEqual([]);
});

test("no pair of two of one sex, of two tribes, too far apart, or with one that follows, is unconscious or overloaded; and a pair parted begins again from nothing", () => {
  const { h, ada, bob, at, me } = pen();
  const breeding = h.host.breeding;
  const survival = h.host.survival;
  const f = tame(h, me, "parasaur", at.x - 2, at.z + 3, true);
  const m = tame(h, me, "parasaur", at.x + 2, at.z + 3, false);
  // A male who is willing, but twelve metres off: too far to be anyone's.
  const far = tame(h, me, "parasaur", at.x - 2, at.z + 15, false);
  expect([order(h, ada, f.e, ORDER_MATE), order(h, ada, far.e, ORDER_MATE)]).toEqual([RESULT_OK, RESULT_OK]);
  h.run(2000);
  expect(breeding.pairCount).toBe(0);
  // Two females.
  m.rec.genome!.female = true;
  expect(order(h, ada, m.e, ORDER_MATE)).toBe(RESULT_OK);
  h.run(2000);
  expect(breeding.pairCount).toBe(0);
  m.rec.genome!.female = false;
  h.run(1100);
  expect([breeding.pairCount, breeding.begun, breeding.parted]).toEqual([1, 1, 0]);

  /** Whatever `spoil` does parts them within a second; `mend` undoes it, and they begin again. */
  let begun = 1;
  const parts = (what: string, spoil: () => void, mend: () => void): void => {
    spoil();
    h.run(1200);
    expect([what, breeding.pairCount, breeding.parted]).toEqual([what, 0, begun]);
    mend();
    h.run(1200);
    begun++;
    expect([what, breeding.pairCount, breeding.begun]).toEqual([what, 1, begun]);
  };
  // He is told to follow, and then to stay.
  parts("following", () => expect(order(h, ada, m.e, ORDER_FOLLOW)).toBe(RESULT_OK), () => expect(order(h, ada, m.e, ORDER_STAY)).toBe(RESULT_OK));
  // He is another tribe's.
  parts("another tribe's", () => ((m.rec.team = 9999), h.host.refreshBody(m.rec)), () => ((m.rec.team = me.team), h.host.refreshBody(m.rec)));
  // She is knocked out, and comes round.
  parts("unconscious", () => survival.add(f.rec, V_TORPOR, f.rec.vitals!.max[V_TORPOR]! / 1e6 + 1), () => survival.add(f.rec, V_TORPOR, -1e9));
  // He carries more than six sevenths of what he can.
  const stone = id("stone");
  parts("overloaded", () => (h.host.items.mint(m.rec, stone, 450), h.host.refreshBody(m.rec)), () => (h.host.items.burnItem(m.rec, stone, 450), h.host.refreshBody(m.rec)));
  // He is told he may not, and then that he may.
  parts("unwilling", () => expect(order(h, ada, m.e, ORDER_UNMATE)).toBe(RESULT_OK), () => expect(order(h, ada, m.e, ORDER_MATE)).toBe(RESULT_OK));
  // Each parting lost what had been begun: the egg comes half a minute after the last beginning, not the first.
  const last = h.world.tick;
  h.run(25000);
  expect(eggs(h).length).toBe(0);
  h.run(6500);
  expect([eggs(h).length >= 1, breeding.mated]).toEqual([true, 1]);
  expect(Math.abs(eggs(h)[0]!.egg!.hatchAt - eggs(h)[0]!.egg!.span - last - MATE_TICKS)).toBeLessThanOrEqual(TICK_RATE + 6);

  // Nobody tells another tribe's creature anything; nothing is told to mate by a whistle; and what does not breed is not told at all.
  expect(order(h, bob, far.e, ORDER_UNMATE)).toBe(RESULT_NOT_YOURS);
  expect(order(h, ada, ORDER_ALL, ORDER_MATE)).toBe(RESULT_INVALID);
  const box = tame(h, me, "grazer", at.x + 6, at.z + 3, true);
  expect([order(h, ada, box.e, ORDER_MATE), box.rec.mating, far.rec.mating]).toEqual([RESULT_INVALID, false, true]);
});

test("an egg hatches and what hatches is grown on the ticks they were due, watched or not, across restarts; and it has eaten the same to the last millionth", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-breed-"));
  const dbPath = join(dir, "world.db");
  // Hatching five hundred times as fast and growing up a thousand times: ten seconds in the egg, ninety-five growing.
  const hatchTicks = Math.ceil((5142 * TICK_RATE) / 500);
  const growTicks = Math.ceil((95238 * TICK_RATE) / 1000);
  const raise = (away: boolean): { egg: number; grew: number; food: number; health: number; level: number; rest: number } => {
    let { h, ada, at, me } = pen(away ? { dbPath } : {});
    h.say(ada, "rule hatchSpeed 500");
    h.say(ada, "rule matureSpeed 1000");
    const f = tame(h, me, "parasaur", at.x - 2, at.z + 3, true);
    const m = tame(h, me, "parasaur", at.x + 2, at.z + 3, false);
    expect([order(h, ada, f.e, ORDER_MATE), order(h, ada, m.e, ORDER_MATE)]).toEqual([RESULT_OK, RESULT_OK]);
    h.run(1200);
    expect(h.host.breeding.pairCount).toBe(1);
    const restart = (): void => {
      h.host.shutdown();
      h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules });
    };
    if (away) {
      // She goes far off as soon as they are a pair, and does not come back. Nobody sees any of what follows.
      h.say(ada, `tp ${(at.x + 300).toFixed(3)} ${(at.z + 300).toFixed(3)}`);
    }
    h.run(32000);
    const egg = eggs(h)[0]!;
    const info = { ...egg.egg! };
    expect(info.span).toBe(hatchTicks);
    const mother = f.rec.pid;
    const rest = f.rec.mateReadyAt - (info.hatchAt - info.span);
    if (away) {
      // Stopped and started with the egg unhatched: it lies where it lay, hatches when it would have, and she is still resting.
      restart();
      const again = h.host.records.byPid.get(egg.pid)!;
      const ee = h.host.records.entOf.get(egg.pid)!;
      expect([again.egg, (h.world.ents.flags[ee]! & F_PROP) !== 0, h.world.ents.grown[ee]]).toEqual([info, true, info.hatchAt]);
      expect(h.host.records.byPid.get(mother)).toMatchObject({ mating: true, mateReadyAt: (info.hatchAt - info.span) + rest });
    }
    // The tick it is grown on, noted as it happens: that is when its body is told it is young no longer.
    let grownAt = -1;
    const watch = (): void => {
      const ents = h.world.ents;
      const set = ents.setYoung.bind(ents);
      ents.setYoung = (i, born, grown) => {
        if (born === 0 && grown === 0 && ents.grown[i] !== 0) grownAt = h.world.tick;
        set(i, born, grown);
      };
    };
    watch();
    while (h.world.tick <= info.hatchAt + 5) h.run(500);
    const baby = young(h)[0]!;
    // Every egg of the litter has hatched, each into one young.
    expect([eggs(h).length, young(h).length >= 1]).toEqual([0, true]);
    expect([baby.grown - baby.span, baby.span, baby.team, baby.kind]).toEqual([info.hatchAt, growTicks, 0, id("parasaur")]);
    if (away) {
      // And again with it a third grown.
      h.run(30000);
      const before = { span: baby.span, grown: baby.grown, food: baby.vitals!.at(V_FOOD, h.world.tick), tick: h.world.tick };
      restart();
      watch();
      const again = h.host.records.byPid.get(baby.pid)!;
      expect({ span: again.span, grown: again.grown, food: again.vitals!.at(V_FOOD, h.world.tick), tick: h.world.tick }).toEqual(before);
      const e = h.host.records.entOf.get(baby.pid)!;
      expect([h.world.ents.span[e], h.world.ents.grown[e]]).toEqual([before.span, before.grown]);
    }
    const pid = baby.pid;
    const due = baby.grown;
    const now = (): EntityRecord => h.host.records.byPid.get(pid)!;
    while (h.world.tick <= due + 5) h.run(500);
    expect([now().span, now().grown, grownAt, h.host.breeding.grownUp >= 1]).toEqual([0, 0, due, true]);
    expect(h.host.items.audit()).toEqual([]);
    // What it has in it a hundred ticks after it was grown: nobody fed it, so only what it was born with, less what it burned.
    const v = now().vitals!;
    const done = { egg: info.span, grew: grownAt - info.hatchAt, food: v.at(V_FOOD, due + 100), health: v.max[V_HEALTH]!, level: now().genome!.level, rest };
    h.host.shutdown();
    void ada;
    return done;
  };
  const watched = raise(false);
  const unwatched = raise(true);
  expect(watched).toEqual({ ...watched, egg: hatchTicks, grew: growTicks });
  expect(unwatched).toEqual(watched);
  rmSync(dir, { recursive: true, force: true });
});

test("what hatches is nobody's and helpless until someone takes it; then it is theirs, small, hungry and weak, eats what it is given, and is no mount, no mate and nothing to tame until it is grown", () => {
  const { h, ada, bob, at, me } = pen();
  const ents = h.world.ents;
  const breeding = h.host.breeding;
  const survival = h.host.survival;
  const mind = h.host.creatures.mind;
  const def = reg.defs[id("parasaur")] as SpeciesDef;
  // Growing up a thousand times as fast: ninety-five seconds. Bob is sent off for now.
  h.say(ada, "rule matureSpeed 1000");
  h.say(bob, `tp ${(at.x + 200).toFixed(3)} ${(at.z + 200).toFixed(3)}`);
  const f = tame(h, me, "parasaur", at.x - 2, at.z + 3, true);
  const m = tame(h, me, "parasaur", at.x + 2, at.z + 3, false);
  expect([order(h, ada, f.e, ORDER_MATE), order(h, ada, m.e, ORDER_MATE)]).toEqual([RESULT_OK, RESULT_OK]);
  h.run(32500);
  const laid = eggs(h);
  expect(laid.length).toBeGreaterThanOrEqual(1);
  // A cheat: the egg looked at hatches now. Then any others, to be out of the way.
  const first = laid[0]!;
  const ee = h.host.records.entOf.get(first.pid)!;
  const off = Math.hypot(first.x - ents.x[f.e]!, first.z - ents.z[f.e]!);
  h.say(ada, `tp ${(first.x + ((first.x - ents.x[f.e]!) / off) * 1.5).toFixed(3)} ${(first.z + ((first.z - ents.z[f.e]!) / off) * 1.5).toFixed(3)}`);
  press(h, ada, ee, 0.5);
  expect(h.say(ada, "hatch")).toEqual(["hatched"]);
  expect([h.host.records.byPid.has(first.pid), ents.resolve(ents.handleOf(ee)) === ee && ents.kind[ee] === id("egg_parasaur")]).toEqual([false, false]);
  const baby = young(h)[0]!;
  const e = h.host.records.entOf.get(baby.pid)!;
  // (Any other egg of the litter is taken away, so that there is one young to speak of.)
  for (const other of eggs(h)) {
    const body = h.host.records.entOf.get(other.pid);
    if (body !== undefined) ents.destroy(body);
    h.host.records.delete(other.pid);
  }

  // Nobody's; it has the genome that was in the egg; and its body says when it was born and will be grown.
  expect([baby.team, breeding.unclaimed(baby), baby.genome === first.genome, baby.span, ents.span[e], ents.grown[e], ents.team[e]]).toEqual([0, true, true, Math.ceil((95238 * TICK_RATE) / 1000), baby.span, baby.grown, 0]);
  const full = (stat: number): number => statOf(def, baby.genome, stat, 0);
  /** Its limits and its hunger are what its hundredth says: a tenth of a grown one's health and food at birth, and 510 times its hunger. */
  const asItShouldBe = (): void => {
    const step = growthStep(baby.span, baby.grown, baby.vitals!.tick);
    expect(baby.vitals!.max[V_HEALTH]! / 1e6).toBeCloseTo(full(STAT_HEALTH) * youngShare(step), 3);
    expect(baby.vitals!.max[V_FOOD]! / 1e6).toBeCloseTo(full(STAT_FOOD) * youngShare(step), 3);
    expect(baby.vitals!.rate[V_FOOD]).toBe(-Math.round((0.27 * 1e6 * youngHunger(step)) / GAME_HOUR_TICKS));
  };
  asItShouldBe();
  expect(growthStep(baby.span, baby.grown, h.world.tick)).toBeLessThan(10);
  // Just hatched, it is a baby.
  const stages = new Set<number>([breeding.subject(baby).stage]);

  // A quarter the size: a shot through where a grown one's back would be passes over it, and one near the ground finds it.
  // (Each shot comes level at the body from four metres off, from the side given, and stops just past the middle of it. Ada, who stands there, is not what is asked about.)
  const cast = (who: number, up: number, ux: number, uz: number): number => h.host.combat.castBodies(h.ent(ada), ents.x[who]! + ux * 4, ents.y[who]! + up, ents.z[who]! + uz * 4, -ux, 0, -uz, 4.5);
  const [ux, uz] = [(first.x - ents.x[f.e]!) / off, (first.z - ents.z[f.e]!) / off];
  expect([cast(m.e, 1.6, 1, 0), cast(e, 1.6, ux, uz), cast(e, 0.4, ux, uz)]).toEqual([m.e, -1, e]);
  expect(youngScale(reg.birthScale[baby.kind]!, baby.span, baby.grown, h.world.tick)).toBeLessThan(0.35);
  // And every client is told the two ticks it draws it small by.
  const seen = new RemoteSample();
  ada.sampleRemote(seen);
  const i = seen.id.subarray(0, seen.count).indexOf(e);
  expect([i >= 0, seen.span[i], seen.grown[i], seen.team[i]]).toEqual([true, baby.span, baby.grown, 0]);

  // It stands where it hatched whatever is done to it. Lying unconscious it is nothing to tame. An aggressive creature does not take it for a wild one.
  const [x0, z0] = [ents.x[e]!, ents.z[e]!];
  h.host.creatures.provoke(e, at.x, at.z, h.ent(ada));
  expect(order(h, ada, m.e, ORDER_STANCE + 2)).toBe(RESULT_OK);
  h.run(2500);
  expect([ents.x[e], ents.z[e], mind.mind[e], mind.move[e], mind.targetOf(m.e)]).toEqual([x0, z0, MIND_WANDER, 0, -1]);
  expect(order(h, ada, m.e, ORDER_STANCE + 1)).toBe(RESULT_OK);
  survival.add(baby, V_TORPOR, baby.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(200);
  expect([baby.out, baby.tame]).toEqual([true, null]);
  survival.add(baby, V_TORPOR, -1e9);
  h.run(200);
  expect(baby.out).toBe(false);

  // Whoever uses it takes it: it is her tribe's, she is asked what to call it, and it stands where it is.
  // (She stands on the side of it away from its mother, as she has since the egg, so that it is what she looks at.)
  const had = ada.tamed.length;
  expect(press(h, ada, e, 0.08)).toBe(-1);
  expect([baby.team, ents.team[e], breeding.claimed, breeding.unclaimed(baby), ada.tamed.length - had, ada.tamed.at(-1)]).toEqual([me.team, me.team, 1, false, 1, { handle: ents.handleOf(e), kind: id("parasaur"), level: baby.genome!.level, te: 255 }]);
  expect(mind.owned.has(e)).toBe(true);
  // Used again it is looked into, and says how young it is. It is not to be saddled, and not to be told it may mate.
  expect(press(h, ada, e, 0.08)).toBe(-1);
  expect(ada.open !== null).toBe(true);
  expect(ada.subject).toMatchObject({ owned: true, breeds: true, mating: false, female: baby.genome!.female });
  expect(ada.subject!.stage).toBeLessThan(3);
  expect(ada.subject!.maturity).toBeLessThan(0.5);
  let code = -1;
  ada.onResult = (seq, c) => void (seq !== 0 && (code = c));
  const put = (item: string, n: number, slot: number): void => {
    h.say(ada, `give ${item} ${n}`);
    const inv = ada.inventory!;
    ada.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(inv.item.indexOf(id(item))), w.bits(BOX_OPEN, 1), w.varint(slot), w.u16(0), w.u16(id(item))));
    h.run(150);
  };
  put("saddle_parasaur", 1, 0);
  ada.command(CMD_FEED, (w: BitWriter) => (w.varint(0), w.u16(id("saddle_parasaur"))));
  h.run(150);
  expect([code, baby.saddle, h.host.riding.mount(h.client(ada)!, e) !== RESULT_OK]).toEqual([RESULT_DENIED, 0, true]);
  expect([order(h, ada, e, ORDER_MATE), baby.mating]).toEqual([RESULT_INVALID, false]);
  h.host.items.burnItem(baby, id("saddle_parasaur"), 1);

  // It can carry a share of what a grown one can: a load a grown one walks under roots it to the spot.
  const stone = id("stone");
  h.host.items.mint(baby, stone, 300);
  h.host.items.mint(m.rec, stone, 300);
  h.host.refreshBody(baby);
  h.host.refreshBody(m.rec);
  expect([(ents.mflags[e]! & MF_ROOTED) !== 0, (ents.mflags[m.e]! & MF_ROOTED) !== 0]).toEqual([true, false]);
  h.host.items.burnItem(baby, stone, 300);
  h.host.items.burnItem(m.rec, stone, 300);
  h.host.refreshBody(baby);

  // Berries put in it: it eats one whenever it is hungry enough for one, and so does not starve.
  put("berry", 60, 1);
  ada.command(CMD_CLOSE);
  h.run(200);
  const meals = h.host.taming.meals;
  // Bob, back again, cannot take what is hers.
  h.say(bob, `tp ${(x0 + ux * 1.5 - uz * 1.2).toFixed(3)} ${(z0 + uz * 1.5 + ux * 1.2).toFixed(3)}`);
  press(h, bob, e, 0.08);
  expect([baby.team, bob.open, breeding.claimed]).toEqual([me.team, null, 1]);

  // It grows: a baby, then a juvenile from a tenth, an adolescent from half; at each hundredth it holds more and hungers less.
  let checked = 0;
  while (baby.grown !== 0 && h.world.tick < baby.grown - 20) {
    h.run(4000);
    if (baby.grown === 0) break;
    stages.add(breeding.subject(baby).stage);
    asItShouldBe();
    checked++;
  }
  expect([[...stages].sort(), checked > 10]).toEqual([[0, 1, 2], true]);
  expect(h.host.taming.meals - meals).toBeGreaterThanOrEqual(2);
  expect(survival.value(baby, V_FOOD)).toBeGreaterThan(0);
  h.run(3000);
  // Grown: it is as any of its kind, and may be told it may mate.
  expect([baby.span, baby.grown, ents.span[e], ents.grown[e], breeding.grownUp, breeding.subject(baby).stage]).toEqual([0, 0, 0, 0, 1, 3]);
  expect(baby.vitals!.max[V_HEALTH]! / 1e6).toBeCloseTo(full(STAT_HEALTH), 3);
  expect(baby.vitals!.max[V_FOOD]! / 1e6).toBeCloseTo(full(STAT_FOOD), 3);
  expect(baby.vitals!.rate[V_FOOD]).toBe(-Math.round((0.27 * 1e6) / GAME_HOUR_TICKS));
  expect(cast(e, 1.6, ux, uz)).toBe(e);
  expect([order(h, ada, e, ORDER_MATE), baby.mating]).toEqual([RESULT_OK, true]);
  expect(h.host.items.audit()).toEqual([]);
});

/** The world's content, but a parasaur bears its young alive: no egg, ten minutes carried, fifty growing. */
function liveRegistry(): Registry {
  const { registry, errors } = compileContent(CORE_CONTENT.map((d) => (d.type === "species" && d.id === "core:parasaur" ? { ...d, breeds: { incubate: 600, mature: 3000 } } : d)));
  if (!registry) throw new Error(errors.join("\n"));
  return registry;
}

test("a species that bears its young alive goes the same way with no egg: carried, born where the mother then stands, and lost with her", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-bear-"));
  const dbPath = join(dir, "world.db");
  const live = liveRegistry();
  const parasaur = live.index.get("core:parasaur")!;
  let { h, ada, at, me } = pen({ dbPath }, live);
  // A hundred times as fast: six seconds carried.
  h.say(ada, "rule hatchSpeed 100");
  const a = tame(h, me, "parasaur", at.x - 3, at.z + 3, true);
  const b = tame(h, me, "parasaur", at.x + 3, at.z + 3, true);
  const m = tame(h, me, "parasaur", at.x, at.z + 6, false);
  for (const c of [a, b, m]) expect(order(h, ada, c.e, ORDER_MATE)).toBe(RESULT_OK);
  h.run(1200);
  // One male, two females: both pairs at once.
  expect(h.host.breeding.pairCount).toBe(2);
  h.run(31000);
  const carried = eggs(h);
  const ofA = carried.filter((r) => r.egg!.carrier === a.rec.pid);
  const ofB = carried.filter((r) => r.egg!.carrier === b.rec.pid);
  expect([h.host.breeding.mated, ofA.length >= 1, ofB.length >= 1, ofA.length + ofB.length === carried.length]).toEqual([2, true, true, true]);
  // Nothing was laid: what is carried has no body, and is of its own kind.
  for (const r of carried) expect([r.kind, h.host.records.entOf.get(r.pid), r.egg!.span]).toEqual([parasaur, undefined, (600 * TICK_RATE) / 100]);
  const bodies = (): number => {
    let n = 0;
    for (let i = 0; i < h.world.ents.cap; i++) if ((h.world.ents.flags[i]! & 1) !== 0 && h.world.ents.kind[i] === parasaur) n++;
    return n;
  };
  expect(bodies()).toBe(3);
  // Stopped and started while they carry: what is carried is still carried, and is nobody's body.
  const [pa, pb] = [a.rec.pid, b.rec.pid];
  const due = carried[0]!.egg!.hatchAt;
  h.host.shutdown();
  // On the settings it was stopped on: started on others, what is carried would be carried as long as those say.
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: h.host.rules }, live);
  expect([eggs(h).length, bodies(), young(h).length]).toEqual([carried.length, 3, 0]);
  // One of the mothers dies before her time.
  h.host.survival.add(h.host.records.byPid.get(pb)!, V_HEALTH, -1e9);
  expect(h.host.records.byPid.has(pb)).toBe(false);
  while (h.world.tick <= due + 5) h.run(500);
  // The other's are born where she stands, and are nobody's; the dead one's are not born at all.
  const born = young(h);
  const mother = h.host.records.byPid.get(pa)!;
  const me2 = h.host.records.entOf.get(pa)!;
  expect([born.length, eggs(h).length, h.host.breeding.hatched]).toEqual([ofA.length, 0, ofA.length]);
  for (const r of born) {
    expect([r.grown - r.span, r.team, r.kind, r.genome!.mother, r.span]).toEqual([due, 0, parasaur, mother.pid, 3000 * TICK_RATE]);
    expect([r.x, r.z]).toEqual([h.world.ents.x[me2]!, h.world.ents.z[me2]!]);
  }
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
  void me;
});

test("a development server reads a folder of its own, with taming, hatching and growing up turned up so that raising a creature takes minutes; the folder is the truth at every start; and the cheats hurry the rest", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-dev-"));
  const dbPath = join(dir, "world.db");
  const dev = loadConfigFolder(DEV_CONFIG);
  // Everything in the folder's two files was understood and takes effect.
  expect([dev.report.unknown, dev.report.refused, dev.report.waiting.map((w) => w.row.name), dev.report.applied.length]).toEqual([[], [], [], 6]);
  let { h, ada, at, me } = pen({ dbPath, config: dev.rules });
  const rules = h.host.rules;
  expect([rules.num("TamingSpeedMultiplier"), rules.num("EggHatchSpeedMultiplier"), rules.num("BabyMatureSpeedMultiplier"), rules.num("MatingIntervalMultiplier"), rules.on("ShowFloatingDamageText"), rules.on("AlwaysAllowStructurePickup")]).toEqual([10, 50, 300, 0.002, true, true]);
  // At these, a parasaur's egg takes under two minutes and what hatches about five; at the reference's, an hour and a half and more than a day.
  const [egg, grow] = [reg.incubateTicks[id("parasaur")]! / TICK_RATE, reg.matureTicks[id("parasaur")]! / TICK_RATE];
  expect([egg / rules.num("EggHatchSpeedMultiplier") < 120, grow / rules.num("BabyMatureSpeedMultiplier") < 360, egg > 5000, grow > 90000]).toEqual([true, true, true, true]);
  // A rule changed from the console lasts until the server is started again: then the folder says what it is.
  h.say(ada, "rule hatchSpeed 7");
  expect(h.host.rules.num("EggHatchSpeedMultiplier")).toBe(7);
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath, config: loadConfigFolder(DEV_CONFIG).rules });
  expect([h.host.rules.num("EggHatchSpeedMultiplier"), h.host.rules.num("BabyMatureSpeedMultiplier")]).toEqual([50, 300]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });

  // The cheats: a wild creature is hers for the asking; and a young one is grown for the asking.
  ({ h, ada, at, me } = pen());
  h.host.spawnCreature("core:parasaur", at.x, at.z + 4, 7);
  h.pilots[0]!.yaw = 0;
  h.run(300);
  expect(h.say(ada, "forcetame")).toEqual(["tamed core:parasaur level 7"]);
  expect(h.say(ada, "forcetame")).toEqual(["it is yours already"]);
  const mine = [...h.host.records.byPid.values()].filter((r) => r.kind === id("parasaur") && r.team === me.team);
  expect(mine.length).toBe(1);
  // Made young by hand, for the asking of it to be grown.
  const rec = mine[0]!;
  rec.span = 100000;
  rec.grown = h.world.tick + 100000;
  h.host.refreshBody(rec);
  expect(rec.vitals!.max[V_HEALTH]! / 1e6).toBeCloseTo(statOf(reg.defs[rec.kind] as SpeciesDef, rec.genome, STAT_HEALTH, 0) * 0.1, 3);
  expect([h.say(ada, "grow"), rec.grown, h.say(ada, "grow"), h.say(ada, "hatch"), h.say(ada, "hatch all")]).toEqual([["grown"], 0, ["nothing young there"], ["no egg there"], ["0 hatched"]]);
  expect(rec.vitals!.max[V_HEALTH]! / 1e6).toBeCloseTo(statOf(reg.defs[rec.kind] as SpeciesDef, rec.genome, STAT_HEALTH, 0), 3);
});

test("a whole client, looking at an egg, is told when it will hatch; looking at what hatched, that it is there to take; and taking it with the use key, is asked its name", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const app = new App(h.join("ada", { latencyMs: 20 }, { manual: true }), h.reg, parsePack(buildCorePack()));
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  const say = (line: string): void => (app.session.text(line), run(300));
  run(500);
  say("enablecheats");
  const g = flatGround(h, 60, 30);
  const at = { x: g.x + 20, z: g.z + 8 };
  say(`tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const me = h.host.records.byPid.get(h.client(app.session)!.pid)!;
  const f = tame(h, me, "parasaur", at.x - 2, at.z + 6, true);
  const m = tame(h, me, "parasaur", at.x + 2, at.z + 6, false);
  f.rec.mating = m.rec.mating = true;
  run(32500);
  // (What to call the two she was given is not asked here: the panel that asks would have the keyboard.)
  app.session.tamed.length = 0;
  run(100);
  expect(app.ui.naming.open).toBe(false);
  const egg = eggs(h)[0]!;
  const ents = h.world.ents;
  // She stands a metre and a half from it, on the side away from its mother, and looks down at it.
  const off = Math.hypot(egg.x - ents.x[f.e]!, egg.z - ents.z[f.e]!);
  const [ux, uz] = [(egg.x - ents.x[f.e]!) / off, (egg.z - ents.z[f.e]!) / off];
  say(`tp ${(egg.x + ux * 1.5).toFixed(3)} ${(egg.z + uz * 1.5).toFixed(3)}`);
  app.controls.yaw = Math.atan2(-ux, -uz);
  app.controls.pitch = Math.atan2(0.25 - 1.62, 1.5);
  run(400);
  const left = Math.ceil((egg.egg!.hatchAt - h.world.tick) / TICK_RATE);
  expect(app.ui.frame.find(KEY_PROMPT)!.text).toBe(`parasaur egg  hatches in ${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m`);
  // The use key does nothing to an egg.
  app.key("KeyE", true);
  run(100);
  app.key("KeyE", false);
  run(300);
  expect([app.session.open, h.host.records.byPid.has(egg.pid)]).toEqual([null, true]);
  // Hatched, there is a young one there, and the screen says it can be taken.
  for (const other of eggs(h)) h.host.breeding.hatchNow(other);
  run(400);
  const baby = young(h).find((r) => r.x === egg.x && r.z === egg.z)!;
  expect([baby.team, app.ui.frame.find(KEY_PROMPT)!.text]).toEqual([0, "E  take the young parasaur"]);
  app.key("KeyE", true);
  run(100);
  app.key("KeyE", false);
  run(400);
  expect([baby.team, app.ui.naming.open, app.ui.frame.find(KEY_NAME_TITLE)!.text]).toEqual([me.team, true, `Yours: a young parasaur, level ${baby.genome!.level}`]);
});

test("a world saved when a young one's birth and an egg's laying were kept as ticks is read as it was: each is now how long its growing takes and when it ends", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-breed-old-"));
  const dbPath = join(dir, "world.db");
  let h = new Harness({}, 1, 60, { dev: true, dbPath });
  // Long enough that what is put in it below could have begun in it: a beginning was a tick of the world.
  h.run(60000);
  const g = flatGround(h, 20, 20);
  // A young one a third grown, an egg part way to hatching, and a grown female who has lately laid.
  const young = h.host.records.byPid.get(h.world.ents.pid[h.host.spawnCreature("core:parasaur", g.x + 5, g.z + 5, 4)]!)!;
  young.span = 1500;
  young.grown = h.world.tick + 1000;
  h.world.ents.setYoung(h.host.records.entOf.get(young.pid)!, young.span, young.grown);
  const egg = h.host.records.create(id("egg_parasaur"), "parasaur egg");
  egg.genome = young.genome;
  egg.x = g.x + 9;
  egg.z = g.z + 5;
  egg.y = g.y;
  egg.egg = { species: id("parasaur"), span: 1200, hatchAt: h.world.tick + 800, carrier: 0 };
  h.host.death.place(egg);
  const mother = h.host.records.byPid.get(h.world.ents.pid[h.host.spawnCreature("core:parasaur", g.x + 13, g.z + 5, 4)]!)!;
  mother.mating = true;
  mother.mateReadyAt = h.world.tick + 777777;
  for (const r of [young, egg, mother]) h.host.records.dirty.add(r.pid);
  h.host.breeding.resume();
  h.run(1000);
  expect([young.grown - young.span > 0, egg.egg.hatchAt - egg.egg.span > 0]).toEqual([true, true]);
  const was = { young: [young.span, young.grown], egg: { ...egg.egg }, mother: [mother.mating, mother.mateReadyAt, mother.span, mother.grown] };
  const pids = [young.pid, egg.pid, mother.pid];
  h.host.shutdown();

  // The save, as the build before this one wrote it: breeding as component 16, with a beginning where there is now a span.
  const db = new Database(dbPath);
  let rewritten = 0;
  for (const row of db.query("SELECT pid, data FROM entities").all() as { pid: number; data: Uint8Array }[]) {
    const r = new BitReader(row.data);
    const w = new BitWriter(row.data.length + 64);
    w.u8(r.u8());
    w.string(r.string(256));
    const n = r.varint();
    w.varint(n);
    for (let k = 0; k < n; k++) {
      const component = r.varint();
      const blob = r.blob(1 << 20);
      if (component !== 18) {
        w.varint(component);
        w.blob(blob);
        continue;
      }
      const c = new BitReader(blob);
      const o = new BitWriter(96);
      o.bool(c.bool());
      o.uint53(c.uint53());
      const span = c.uint53();
      const grown = c.uint53();
      o.uint53(grown === 0 ? 0 : grown - span);
      o.uint53(grown);
      const isEgg = c.bool();
      o.bool(isEgg);
      if (isEgg) {
        o.varint(c.varint());
        const hatching = c.uint53();
        const hatchAt = c.uint53();
        o.uint53(hatchAt - hatching);
        o.uint53(hatchAt);
        o.uint53(c.uint53());
      }
      expect([c.overflow, o.overflow]).toEqual([false, false]);
      w.varint(16);
      w.blob(o.bytes());
      rewritten++;
    }
    expect([r.overflow, w.overflow]).toEqual([false, false]);
    db.query("UPDATE entities SET data = ? WHERE pid = ?").run(w.bytes().slice(), row.pid);
  }
  db.close();
  expect(rewritten).toBe(3);

  h = new Harness({}, 1, 60, { dev: true, dbPath });
  const [y, e, m] = pids.map((pid) => h.host.records.byPid.get(pid)!);
  expect({ young: [y!.span, y!.grown], egg: { ...e!.egg }, mother: [m!.mating, m!.mateReadyAt, m!.span, m!.grown] }).toEqual(was);
  // Its body says so too, and it goes on growing from where it was.
  const ye = h.host.records.entOf.get(y!.pid)!;
  expect([h.world.ents.span[ye], h.world.ents.grown[ye], h.host.breeding.subject(y!).maturity]).toEqual([1500, was.young[1]!, maturity(1500, was.young[1]!, h.world.tick)]);
  expect(h.host.breeding.subject(y!).maturity).toBeGreaterThan(0.33);
  // Saved again, it is written the new way, and read the same.
  h.run(1000);
  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  expect([h.host.records.byPid.get(pids[0]!)!.span, h.host.records.byPid.get(pids[1]!)!.egg]).toEqual([1500, was.egg]);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
