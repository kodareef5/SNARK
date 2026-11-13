import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { F_AWAKE } from "../../shared/sim/entities.ts";
import { STAT_NAMES } from "../../shared/sim/genome.ts";
import { V_FOOD, V_HEALTH } from "../../shared/sim/vitals.ts";
import type { EntityRecord } from "../../server/records.ts";
import { Harness } from "../fixtures/net.ts";
import { MIND_FLEE, MIND_HUNT, MIND_WANDER, TEMPER_DEFENDS, TEMPER_FLEES, TEMPER_HUNTS } from "../../server/behavior.ts";
import { flatGround } from "../fixtures/arena.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-creatures-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("creatures are simulated only near players, and only the moving ones cost a collision step", () => {
  const h = new Harness({}, 1, 30, { wakeRadius: 1 });
  const ents = h.world.ents;
  const near: number[] = [];
  const far: number[] = [];
  for (let i = 0; i < 30; i++) near.push(h.host.spawnCreature("core:grazer", 236 + (i % 6) * 6, 200 + Math.floor(i / 6) * 6, 5));
  for (let i = 0; i < 30; i++) far.push(h.host.spawnCreature("core:grazer", 40 + (i % 6) * 5, 440 + Math.floor(i / 6) * 5, 5));
  expect([...near, ...far].every((e) => e >= 0)).toBe(true);
  const where = (list: number[]) => list.map((e) => [ents.x[e], ents.z[e]]);

  // Nobody online: nothing is awake and nothing moves.
  const start = where([...near, ...far]);
  h.run(3000);
  expect(h.host.creatures.awakeCount).toBe(0);
  expect(h.host.creatures.stepped).toBe(0);
  expect(where([...near, ...far])).toEqual(start);

  // A player arrives at the spawn point: the herd beside it wakes, the one across the map does not.
  const s = h.join("watcher");
  h.run(400);
  expect(h.host.creatures.awakeCount).toBe(30);
  const farStart = where(far);
  h.run(8000);
  expect(where(near)).not.toEqual(where(near.map(() => -1)));
  let moved = 0;
  near.forEach((e, i) => {
    if (ents.x[e] !== start[i]![0] || ents.z[e] !== start[i]![1]) moved++;
  });
  expect(moved).toBeGreaterThan(20);
  expect(where(far)).toEqual(farStart);
  for (const e of far) expect(ents.flags[e]! & F_AWAKE).toBe(0);
  // Standing creatures are skipped: fewer collision steps than awake creatures.
  expect(h.host.creatures.stepped).toBeLessThan(h.host.creatures.awakeCount);
  // The player sees the herd.
  const seen = new RemoteSample();
  s.sampleRemote(seen);
  expect(seen.count).toBeGreaterThan(20);

  // The player leaves: once its body has lingered out, everything goes back to sleep.
  s.close();
  h.run(200);
  expect(h.host.creatures.awakeCount).toBeGreaterThan(0);
  h.run(5200);
  expect(h.host.creatures.awakeCount).toBe(0);
});

test("hunger runs on the world clock with no per-tick work, and starvation fires on its exact tick while dormant", () => {
  const fast = compileContent(CORE_CONTENT.map((d) => (d.id === "core:grazer" && d.type === "species" ? { ...d, food: { max: 10, perHour: 60 }, stats: { ...d.stats, food: [10, 0, 0] as const } } : d))).registry!;
  const h = new Harness({}, 1, 30, {}, fast);
  const c = h.host.creatures;
  const sv = h.host.survival;
  const food = (rec: EntityRecord) => sv.value(rec, V_FOOD);
  const a = h.host.records.byPid.get(h.world.ents.pid[h.host.spawnCreature("core:grazer", 100, 100, 1)]!)!;
  const b = h.host.records.byPid.get(h.world.ents.pid[h.host.spawnCreature("core:grazer", 104, 100, 1)]!)!;
  const born = h.world.tick;
  const due = a.vitals!.zeroTick(V_FOOD);
  expect(due - born).toBe(700); // 10 points at 60 per 4200-tick hour
  expect(food(a)).toBe(10);
  const health = sv.value(a, V_HEALTH);

  const until = (tick: number) => {
    while (h.world.tick < tick) h.server.tick();
  };
  until(born + 350);
  expect(food(a)).toBeCloseTo(5, 3);
  sv.add(b, V_FOOD, 3); // b eats: its deadline moves, the old one becomes stale
  until(due - 1);
  expect(sv.starving.size).toBe(0);
  until(due);
  expect([...sv.starving]).toEqual([a.pid]);
  expect(food(a)).toBe(0);
  expect(c.awakeCount).toBe(0); // all of this happened with nobody online
  until(due + 209);
  expect(sv.starving.has(b.pid)).toBe(false);
  until(due + 210); // 3 points buy 210 ticks
  expect(sv.starving.has(b.pid)).toBe(true);
  // Starving costs health, half a point a second, also without anyone stepping anything.
  expect(sv.value(a, V_HEALTH)).toBeCloseTo(health - 0.5 * (210 / 30), 3);
  sv.add(a, V_FOOD, 4);
  expect(sv.starving.has(a.pid)).toBe(false);
  expect(food(a)).toBe(4);
  // Fed again, health comes back instead of going.
  const low = sv.value(a, V_HEALTH);
  until(due + 510);
  expect(sv.value(a, V_HEALTH)).toBeGreaterThan(low);
});

test("creatures keep their genome, hunger and place across a restart", () => {
  const db = join(dir, "herd.db");
  const h = new Harness({}, 1, 30, { dbPath: db, startingCreatures: 12 });
  h.run(500);
  const before = [...h.host.records.byPid.values()].map((r) => ({ pid: r.pid, x: r.x, z: r.z, food: h.host.survival.value(r, V_FOOD), wild: [...r.genome!.wild], colors: [...r.genome!.colors], level: r.genome!.level }));
  expect(before.length).toBe(12);
  expect(before.some((r) => r.level > 1)).toBe(true);
  const tick = h.world.tick;
  h.host.shutdown();

  const h2 = new Harness({}, 1, 30, { dbPath: db, startingCreatures: 12 });
  expect(h2.world.tick).toBe(tick);
  expect(h2.world.ents.count).toBe(12); // restored, not spawned a second time
  for (const r of before) {
    const rec = h2.host.records.byPid.get(r.pid)!;
    expect([...rec.genome!.wild]).toEqual(r.wild);
    expect([...rec.genome!.colors]).toEqual(r.colors);
    expect(h2.host.survival.value(rec, V_FOOD)).toBe(r.food);
    const e = h2.host.records.entOf.get(r.pid)!;
    expect(h2.world.ents.x[e]).toBeCloseTo(r.x, 3);
    expect(h2.world.ents.z[e]).toBeCloseTo(r.z, 3);
  }
  h2.host.shutdown();
});

const reg = compileContent(CORE_CONTENT).registry!;

test("a creature that holds more than four thousand of something keeps all of it across a restart", () => {
  const db = join(dir, "big.db");
  const h = new Harness({}, 1, 30, { dbPath: db });
  h.run(100);
  const g = flatGround(h, 10, 10);
  const e = h.host.spawnCreature("core:parasaur", g.x + 5, g.z + 5, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  // Thirty levels in food: four times what it began with, 6,000.
  rec.genome!.wild[STAT_NAMES.indexOf("food")] = 30;
  h.host.refreshBody(rec);
  h.host.survival.refill(rec);
  h.run(500);
  const food = h.host.survival.value(rec, V_FOOD);
  expect(food).toBeGreaterThan(5990);
  const tick = h.world.tick;
  h.host.shutdown();
  const h2 = new Harness({}, 1, 30, { dbPath: db });
  expect(h2.world.tick).toBe(tick);
  const again = h2.host.records.byPid.get(rec.pid)!;
  expect(h2.host.survival.value(again, V_FOOD)).toBe(food);
  expect(again.vitals!.max[V_FOOD]! / 1e6).toBeCloseTo(6000, 3);
  h2.host.shutdown();
});

test("a raptor goes for a survivor it sees, runs it down and bites; led too far from where it began it gives up, rests, and loses what it cannot see", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 120, 24);
  const [x0, z0] = [g.x + 8, g.z + 12];
  h.say(ada, `tp ${x0.toFixed(3)} ${z0.toFixed(3)}`);
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const combat = h.host.combat;
  const me = (): number => h.ent(ada);
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  // Sixteen metres off, in the open: within its sight.
  const e = h.host.spawnCreature("core:raptor", x0 + 16, z0, 1);
  const raptor = h.host.records.byPid.get(ents.pid[e]!)!;
  const far = (): number => Math.hypot(ents.x[e]! - ents.x[me()]!, ents.z[e]! - ents.z[me()]!);
  expect([reg.temper[ents.kind[e]!], reg.sight[ents.kind[e]!], reg.leash[ents.kind[e]!]]).toEqual([TEMPER_HUNTS, 22, 60]);
  // It thinks twice a second: within a second it is after her, and looking at her.
  h.run(1000);
  expect([mind.mind[e], mind.targetOf(e), mind.hunts]).toEqual([MIND_HUNT, me(), 1]);
  // It runs her down and bites: the blow is its own, through the one damage function, and takes what its jaws do.
  const full = h.host.survival.value(rec, V_HEALTH);
  let ran = 0;
  for (let k = 0; k < 40 && h.host.survival.value(rec, V_HEALTH) >= full; k++) {
    h.run(250);
    ran = Math.max(ran, Math.hypot(ents.vx[e]!, ents.vz[e]!));
  }
  expect(full - h.host.survival.value(rec, V_HEALTH)).toBeGreaterThan(10);
  expect([combat.last.by, combat.last.victim, mind.bites > 0]).toEqual([raptor.pid, rec.pid, true]);
  expect(far()).toBeLessThan(3.2);
  // It ran at her (faster than it walks), and stopped to bite.
  expect(ran).toBeGreaterThan(reg.move[ents.kind[e]!]!.walkSpeed * 1.5);
  // She is kept alive for the rest.
  h.host.survival.gods.add(rec.pid);

  // Led away east, twelve metres ahead of it at a time: it follows, until it is sixty metres from where it began; then it gives up, with her still in plain sight.
  let led = 0;
  for (let k = 0; k < 60 && mind.mind[e] === MIND_HUNT; k++) {
    h.say(ada, `tp ${(ents.x[e]! + 12).toFixed(3)} ${z0.toFixed(3)}`, 60);
    h.run(500);
    led = ents.x[e]! - (x0 + 16);
  }
  expect([mind.mind[e], mind.gaveUp]).toEqual([MIND_WANDER, 1]);
  expect(led).toBeGreaterThan(55);
  expect(led).toBeLessThan(72);
  expect(far()).toBeLessThan(22);
  // It wants a rest before another hunt: for some seconds it leaves her be, though she stands in front of it. Then it is after her again.
  h.run(3000);
  expect(mind.hunts).toBe(1);
  h.run(5000);
  expect([mind.mind[e], mind.hunts]).toEqual([MIND_HUNT, 2]);
  // Out of its sight (far off), it loses her.
  h.say(ada, `tp ${(x0).toFixed(3)} ${z0.toFixed(3)}`, 60);
  h.run(1500);
  expect([mind.mind[e], mind.gaveUp, far() > 40]).toEqual([MIND_WANDER, 2, true]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a hunter does not see through what is built; a parasaur runs from what hurts it and bites nobody; one that only defends itself leaves a survivor be until it is hurt", () => {
  const wary = CORE_CONTENT.find((d) => d.id === "core:raptor")!;
  const { registry } = compileContent([...CORE_CONTENT, { ...wary, id: "core:raptor_wary", temper: "defends" } as (typeof CORE_CONTENT)[number]]);
  const h = new Harness({}, 1, 60, { dev: true }, registry!);
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 60, 40);
  const [x0, z0] = [g.x + 30, g.z + 6];
  h.say(ada, `tp ${x0.toFixed(3)} ${z0.toFixed(3)}`);
  const ents = h.world.ents;
  const mind = h.host.creatures.mind;
  const rec = h.host.records.byPid.get(h.client(ada)!.pid)!;
  h.host.survival.gods.add(rec.pid);
  const me = h.ent(ada);
  // A wall five pieces long, four metres in front of her; a raptor ten metres beyond it.
  const wall = registry!.index.get("core:wall_wood")!;
  const walls = [-2, -1, 0, 1, 2].map((k) => h.world.structs.add(wall, x0 + k * 3, g.y + 1.5, z0 + 4, 0, 0, 10000));
  const hunter = h.host.spawnCreature("core:raptor", x0, z0 + 14, 1);
  mind.stay(hunter, h.world.tick + 60);
  h.run(2500);
  expect([mind.mind[hunter], mind.hunts]).toEqual([MIND_WANDER, 0]);
  // The wall gone, it sees her at once.
  mind.stay(hunter, h.world.tick + 30);
  for (const ref of walls) h.world.structs.remove(ref);
  h.run(2000);
  expect([mind.mind[hunter], mind.targetOf(hunter)]).toEqual([MIND_HUNT, me]);
  h.host.creatures.remove(hunter);

  // A parasaur stands six metres off and does nothing about her. Hurt, it runs the other way, fast, and bites nobody.
  const para = h.host.spawnCreature("core:parasaur", x0, z0 + 8, 1);
  expect(registry!.temper[ents.kind[para]!]).toBe(TEMPER_FLEES);
  mind.stay(para, h.world.tick + 90);
  h.run(2000);
  expect(mind.mind[para]).toBe(MIND_WANDER);
  const bites = mind.bites;
  h.host.creatures.provoke(para, ents.x[me]!, ents.z[me]!, me);
  expect(mind.mind[para]).toBe(MIND_FLEE);
  h.run(4000);
  expect(ents.z[para]! - (z0 + 8)).toBeGreaterThan(12);
  expect(mind.bites).toBe(bites);
  // After a few seconds it has stopped running.
  h.run(2500);
  expect(mind.mind[para]).toBe(MIND_WANDER);
  h.host.creatures.remove(para);

  // One that only defends itself: it sees her and leaves her be. Hurt by her, it goes for her.
  const w = h.host.spawnCreature("core:raptor_wary", x0 + 6, z0 + 6, 1);
  expect(registry!.temper[ents.kind[w]!]).toBe(TEMPER_DEFENDS);
  mind.stay(w, h.world.tick + 30);
  h.run(3000);
  expect(mind.mind[w]).toBe(MIND_WANDER);
  h.host.creatures.provoke(w, ents.x[me]!, ents.z[me]!, me);
  expect([mind.mind[w], mind.targetOf(w)]).toEqual([MIND_HUNT, me]);
  // What it hunts dies: it has nothing to hunt, and wanders.
  h.host.survival.gods.delete(rec.pid);
  h.say(ada, "suicide");
  h.run(1500);
  expect(mind.mind[w]).toBe(MIND_WANDER);
});
