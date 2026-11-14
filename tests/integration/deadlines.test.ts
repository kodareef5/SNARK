// The deadline heap holds what is waiting, not everything that was ever scheduled.
import { expect, test } from "bun:test";
import { createHost } from "../../server/host.ts";
import { V_FOOD, V_HEALTH } from "../../shared/sim/vitals.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("a body rated two thousand times has one deadline waiting, and it still comes due on its tick", () => {
  const host = createHost(coreRegistry(), { startingCreatures: 0 });
  const rec = host.records.byPid.get(host.world.ents.pid[host.spawnCreature("core:grazer", 256, 250, 1)]!)!;
  const survival = host.survival;
  host.game.tick();
  const waiting = host.deadlines.size;
  // Each blow and each refresh rates the body again. Its food still runs out on the same tick, days from now.
  const due = rec.vitals!.zeroTick(V_FOOD);
  for (let n = 0; n < 1000; n++) {
    survival.hurt(rec, 0.05, 0);
    host.refreshBody(rec);
    host.game.tick();
  }
  expect(rec.vitals!.zeroTick(V_FOOD)).toBe(due);
  expect(host.deadlines.size - waiting).toBeLessThan(4);

  // A deadline that moves is scheduled again, and the one it replaces is passed over when its tick comes.
  survival.add(rec, V_FOOD, 1 - survival.value(rec, V_FOOD));
  const zero = rec.vitals!.zeroTick(V_FOOD);
  expect(zero).toBeLessThan(due);
  const health = survival.value(rec, V_HEALTH);
  while (host.world.tick < zero - 1) host.game.tick();
  expect(survival.starving.has(rec.pid)).toBe(false);
  host.game.tick();
  expect(survival.starving.has(rec.pid)).toBe(true);
  // Fed again, it stops starving at once and is rated for the long run.
  survival.add(rec, V_FOOD, 300);
  expect(survival.starving.has(rec.pid)).toBe(false);
  for (let n = 0; n < 300; n++) host.game.tick();
  expect(survival.value(rec, V_HEALTH)).toBeGreaterThan(health);
  expect(host.deadlines.size - waiting).toBeLessThan(8);
});
