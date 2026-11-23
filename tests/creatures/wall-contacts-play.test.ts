// A ridden rex against walls, its rider's client predicting it (shared/sim/character.ts): sliding its head along a
// wall, turning the long way round from it, and sliding its footprint along a low wall, the client's body is the
// server's to the bit.
import { expect, test } from "bun:test";
import { camp, pilot, pos, ride, tame } from "../kit/kit.ts";

test("a ridden rex at walls, turning the long way round, is predicted uncorrected", () => {
  const { h, ada } = camp({ link: { latencyMs: 60, jitterMs: 5 } });
  const rex = tame(h, ada, "rex", { saddled: true });
  ride(h, ada, rex.e);
  const at = pos(h, rex.e);
  const wall = h.reg.index.get("core:wall_stone")!;
  // A full wall 12 m north.
  for (let x = at.x - 30; x < at.x + 30; x += 3) for (const y of [1.5, 4.5]) h.world.structs.add(wall, x + 1.5, y, at.z + 12, 0, 0, 10000);
  h.run(1000);
  const p = pilot(h, ada);
  const before = [ada.stats.corrections, ada.stats.stateCorrections];
  const yaws: number[] = [];
  const run = (ms: number): void => {
    for (let t = 0; t < ms; t += 100) {
      h.run(100);
      yaws.push(h.world.ents.yaw[rex.e]!);
    }
  };
  // North-east into the wall, its head sliding east along it.
  p.yaw = 1.2;
  p.moveZ = 1;
  run(6000);
  expect(pos(h, rex.e).z).toBeGreaterThan(at.z + 8);
  // Its look west and a little north: the short way round is through the wall, so it turns the long way, by the south.
  p.moveZ = 0;
  p.yaw = -1.4;
  yaws.length = 0;
  run(6000);
  expect(yaws.some((yaw) => Math.abs(yaw - 32768) < 4096)).toBe(true);
  // A wall of one storey, under its head, 5 m west of it, and south-south-west along it: its front end slides on it.
  const { x, z } = pos(h, rex.e);
  for (let k = z - 30; k < z - 3; k += 3) h.world.structs.add(wall, x - 5, 1.5, k + 1.5, 16384, 0, 10000);
  h.run(1000);
  p.yaw = Math.PI + 0.5;
  p.moveZ = 1;
  run(8000);
  expect(pos(h, rex.e).x).toBeGreaterThan(x - 5);
  expect(pos(h, rex.e).z).toBeLessThan(z - 10);
  expect([ada.stats.corrections - before[0]!, ada.stats.stateCorrections - before[1]!]).toEqual([0, 0]);
});
