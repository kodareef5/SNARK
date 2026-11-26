import { expect, test } from "bun:test";
import { tekWallKinds, tekWallNeighbours } from "../../shared/world/lattice/tek-walls.ts";
import { PROVING_SPAWN } from "../../shared/world/proving.ts";
import { outpostCrew, stagePhaseBay } from "../../tools/pieces/tek-preview.ts";
import { Harness } from "../fixtures/net.ts";
import { flatWorld } from "../fixtures/world.ts";

test("the phase bay faces spawn with four door panels and an attached solid wall", () => {
  const world = flatWorld(8), team = 7, refs = stagePhaseBay(world, team);
  const kinds = tekWallKinds(world.reg.index), neighbours = new Int32Array(4);
  const doors = refs.filter(ref => {
    const row = world.structs.chunks[ref >>> 16]!, slot = ref & 65535;
    expect(row.owner[slot]).toBe(team);
    return row.kind[slot] === kinds.door;
  });
  expect(doors).toHaveLength(4);
  const xs = [], zs = [], ys = [];
  let solidContacts = 0;
  for (const ref of doors) {
    const row = world.structs.chunks[ref >>> 16]!, slot = ref & 65535;
    xs.push(row.x[slot]!);
    zs.push(row.z[slot]!);
    ys.push(row.y[slot]!);
    tekWallNeighbours(world.structs, kinds, ref, neighbours, true);
    expect([...neighbours].filter(other => other >= 0)).toHaveLength(2);
    tekWallNeighbours(world.structs, kinds, ref, neighbours);
    for (const other of neighbours) if (other >= 0 && !doors.includes(other)) solidContacts++;
  }
  expect(solidContacts).toBe(2);
  expect(Math.min(...xs)).toBeLessThan(PROVING_SPAWN.x);
  expect(Math.max(...xs)).toBeGreaterThan(PROVING_SPAWN.x);
  expect(Math.min(...zs)).toBeGreaterThan(PROVING_SPAWN.z + 6);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(3);
});

test("the preview crew can open the full bay and it closes after they pass", () => {
  let placed: number[] = [];
  const h = new Harness({}, 1, 60, { dev: true, modules: [outpostCrew(() => h.host, (host, team) => {
    placed = stagePhaseBay(host.world, team);
  })] });
  try {
    const reviewer = h.join("Phase reviewer"), kinds = tekWallKinds(h.reg.index);
    const kind = (ref: number) => h.world.structs.chunks[ref >>> 16]!.kind[ref & 65535];
    h.run(450);
    const active = placed.filter(ref => kind(ref) === kinds.door);
    const solid = placed.filter(ref => kind(ref) === kinds.solid);
    expect(active).toHaveLength(4);
    const row = h.world.structs.chunks[active[0]! >>> 16]!, slot = active[0]! & 65535;
    const approach = (offset: number) => h.world.ents.setPosition(h.ent(reviewer),
      row.x[slot]!, row.y[slot]! - 1.48, row.z[slot]! + offset);
    approach(-1.4);
    h.run(700);
    expect(active.map(kind)).toEqual(active.map(() => kinds.open));
    expect(solid.every(ref => kind(ref) === kinds.solid)).toBe(true);
    approach(5);
    h.run(3200);
    expect(active.map(kind)).toEqual(active.map(() => kinds.door));
  } finally {
    h.host.shutdown();
  }
});
