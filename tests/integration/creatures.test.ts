import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { F_AWAKE } from "../../shared/sim/entities.ts";
import { lazyZeroTick, ratePerTick } from "../../shared/sim/lazy.ts";
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

  // The player leaves: everything goes back to sleep.
  s.close();
  h.run(200);
  expect(h.host.creatures.awakeCount).toBe(0);
});

test("hunger runs on the world clock with no per-tick work, and starvation fires on its exact tick while dormant", () => {
  const fast = compileContent(CORE_CONTENT.map((d) => (d.id === "core:grazer" ? { ...d, food: { max: 10, perHour: 60 } } : d))).registry!;
  const h = new Harness({}, 1, 30, {}, fast);
  const c = h.host.creatures;
  const a = h.host.records.byPid.get(h.world.ents.pid[h.host.spawnCreature("core:grazer", 100, 100, 1)]!)!;
  const b = h.host.records.byPid.get(h.world.ents.pid[h.host.spawnCreature("core:grazer", 104, 100, 1)]!)!;
  const born = h.world.tick;
  const due = lazyZeroTick(a.food0, a.foodTick, -ratePerTick(60));
  expect(due - born).toBe(700); // 10 points at 60 per 4200-tick hour
  expect(c.foodOf(a)).toBe(10);

  const until = (tick: number) => {
    while (h.world.tick < tick) h.server.tick();
  };
  until(born + 350);
  expect(c.foodOf(a)).toBeCloseTo(5, 3);
  c.feed(b, 3); // b eats: its deadline moves, the old one becomes stale
  until(due - 1);
  expect(c.starving.size).toBe(0);
  until(due);
  expect([...c.starving]).toEqual([a.pid]);
  expect(c.foodOf(a)).toBe(0);
  expect(c.awakeCount).toBe(0); // all of this happened with nobody online
  until(due + 209);
  expect(c.starving.has(b.pid)).toBe(false);
  until(due + 210); // 3 points buy 210 ticks
  expect(c.starving.has(b.pid)).toBe(true);
  c.feed(a, 4);
  expect(c.starving.has(a.pid)).toBe(false);
  expect(c.foodOf(a)).toBe(4);
});

test("creatures keep their genome, hunger and place across a restart", () => {
  const db = join(dir, "herd.db");
  const h = new Harness({}, 1, 30, { dbPath: db, startingCreatures: 12 });
  h.run(500);
  const before = [...h.host.records.byPid.values()].map((r) => ({ pid: r.pid, x: r.x, z: r.z, food: h.host.creatures.foodOf(r), wild: [...r.genome!.wild], colors: [...r.genome!.colors], level: r.genome!.level }));
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
    expect(h2.host.creatures.foodOf(rec)).toBe(r.food);
    const e = h2.host.records.entOf.get(r.pid)!;
    expect(h2.world.ents.x[e]).toBeCloseTo(r.x, 3);
    expect(h2.world.ents.z[e]).toBeCloseTo(r.z, 3);
  }
  h2.host.shutdown();
});
