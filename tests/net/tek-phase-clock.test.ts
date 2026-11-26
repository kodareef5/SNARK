import { expect, test } from "bun:test";
import { tekWallKinds } from "../../shared/world/lattice/tek-walls.ts";
import { Harness } from "../fixtures/net.ts";

test("wall phase ticks survive late join and damage and leave a reused slot", () => {
  const h = new Harness(), first = h.join("first");
  h.run(500);
  const { structs, spawns } = h.world, { solid, door } = tekWallKinds(h.reg.index);
  const p = spawns[0]!, x = p.x + 6, z = p.z, y = h.world.hf.heightAt(x, z) + 3;
  const ref = structs.add(solid, x, y, z, 0, 4321, h.reg.maxHp[solid]!);
  const chunk = ref >>> 16, slot = ref & 65535, table = structs.chunks[chunk]!;
  h.run(400);
  structs.swap(ref, door);
  const tick = h.world.tick;
  (table.phaseTick ??= new Map()).set(slot, tick);
  h.run(400);
  const late = h.join("late");
  h.run(650);
  const clocks = () => [first, late].map(s => s.world!.structs.chunks[chunk]!.phaseTick?.get(slot));
  expect(clocks()).toEqual([tick, tick]);
  structs.damage(ref, 1000);
  h.run(350);
  expect(clocks()).toEqual([tick, tick]);
  structs.remove(ref);
  expect(structs.add(door, x, y, z, 0, 4321, h.reg.maxHp[door]!)).toBe(ref);
  h.run(450);
  expect(clocks()).toEqual([undefined, undefined]);
  h.host.shutdown();
});
