import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { F_AWAKE } from "../../shared/sim/entities.ts";
import { V_FOOD, V_HEALTH } from "../../shared/sim/vitals.ts";
import type { EntityRecord } from "../../server/records.ts";
import { Harness } from "../fixtures/net.ts";

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
