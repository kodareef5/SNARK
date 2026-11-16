import { expect, test } from "bun:test";
import { helicopterSites, type HelicopterSite } from "../../tools/helicopter/sites.ts";
import { flatMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { parseMap, writeMap } from "../../shared/world/mapfile.ts";

const reg = coreRegistry();
test("found liveries occupy supported roofs or yards, keep stable identities and retain condition through map encoding", () => {
  const statics = [];
  for (let x = -3; x <= 3; x += 3) for (let z = -3; z <= 3; z += 3) statics.push({ kind: "core:ceiling", x: 80 + x, y: 8, z: 80 + z, yaw: 0 });
  const map = flatMap(12, { statics });
  const sites: HelicopterSite[] = [{ id: "hospital", kind: "hospital", x: 80, z: 80, radius: 8 }, { id: "police", kind: "police", x: 500, z: 80, radius: 10 }, { id: "yard", kind: "civilian", x: 400, z: 500, radius: 10 }];
  const vehicles = helicopterSites(map, reg, sites);
  expect(vehicles).toHaveLength(3);
  expect(vehicles).toEqual(helicopterSites(map, reg, [...sites].reverse()));
  expect(vehicles.find(v => v.kind === "core:helicopter_rescue")!.y!).toBeGreaterThan(8);
  const encoded = parseMap(writeMap({ ...map, vehicles })).vehicles!;
  for (let i = 0; i < vehicles.length; i++) {
    expect(encoded[i]!.id).toBe(vehicles[i]!.id); expect(encoded[i]!.kind).toBe(vehicles[i]!.kind);
    expect(encoded[i]!.condition![0]).toBeCloseTo(.28, 6); expect(encoded[i]!.fuel![1]).toBeCloseTo(.55, 6);
  }
});

test("found aircraft reject drowned sites without flattening or clearing the world", () => {
  const map = flatMap(2, { seaLevel: 20 });
  expect(helicopterSites(map, reg, [{ id: "drowned", kind: "hospital", x: 64, z: 64, radius: 12 }])).toEqual([]);
});
