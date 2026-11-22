// A car rolls over a small creature as over a speed bump: it keeps its way with a thump, and the creature is crushed. A
// bigger one is met as a body, and bounces off or dies of the blow.
import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

/** A car with a driver coming up the road along +Z at 9 m/s at a creature of `kind` standing in its way. */
function road(kind: string) {
  const h = new Harness({}, 5, 60, { dev: true, clips: NO_CLIPS, rigs: [], wild: false, map: writeMap(flatMap(4)) });
  h.join("watcher");
  h.run(600);
  const a = h.world.ents;
  const car = h.host.spawnVehicle("core:compact", 100, 60, 0);
  const driver = h.host.spawnCreature("core:civilian", 101.5, 60, 1);
  expect(h.host.urban.seatNpc(driver, car, "driver")).toBe(0);
  h.run(1500);
  const victim = h.host.spawnCreature(kind, 100, 75, 1);
  h.run(300);
  return { h, a, car, victim, gen: a.gen[victim]! };
}

test("a car runs over a dodo with a thump and hardly slows; the dodo is crushed", () => {
  const { h, a, car, victim, gen } = road("core:dodo");
  try {
    const contacts = h.host.urban.contacts!;
    let after: number[] = [];
    h.run(3000, () => {
      if (contacts.runOvers === 1 && after.length === 0) after = [a.vz[car]!, a.vy[car]!];
      if (contacts.runOvers === 0 && a.z[car]! < 80) { a.vz[car] = 9; a.vx[car] = 0; }
    });
    expect(contacts.runOvers).toBe(1);
    expect((a.flags[victim]! & F_ALIVE) === 0 || a.gen[victim] !== gen).toBe(true);
    // Just after: still near its 9 m/s, and lifted by the thump.
    expect(after[0]!).toBeGreaterThan(7.5);
    expect(after[1]!).toBeGreaterThan(0.1);
  } finally { h.host.shutdown(); }
});

test("a parasaur in the road is met as a body, not run over", () => {
  const { h, a, car } = road("core:parasaur");
  try {
    h.run(3000, () => { if (a.z[car]! < 72) { a.vz[car] = 9; a.vx[car] = 0; } });
    expect(h.host.urban.contacts!.runOvers).toBe(0);
  } finally { h.host.shutdown(); }
});
