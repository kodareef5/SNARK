import { expect, test } from "bun:test";
import { boatSites, mappedBoatSites, type BoatSite } from "../../tools/boat/sites.ts";
import { flatMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { parseMap, writeMap, type MapData } from "../../shared/world/mapfile.ts";
import type { BuildingLabel } from "../../tools/mapworld/labels.ts";

function coast(): MapData {
  const map = flatMap(12, { seaLevel: 3 }), side = Math.sqrt(map.heights.length);
  for (let row = 0; row < side; row++) {
    const y = Math.max(0, Math.min(4, (58 - row * 2) * .5));
    for (let col = 0; col < side; col++) map.heights[row * side + col] = Math.round((y - map.minY) / map.stepY);
  }
  return map;
}

test("found boat variants use stable waterfront origins and preserve ranges through map encoding", () => {
  const map = coast(), reg = coreRegistry();
  const sites: BoatSite[] = [{ id: "marina", kind: "civilian", x: 80, z: 60, radius: 8 }, { id: "coast-guard", kind: "rescue", x: 350, z: 60, radius: 8 }, { id: "police", kind: "police", x: 640, z: 60, radius: 8 }];
  const found = boatSites(map, reg, sites);
  expect(found).toHaveLength(3); expect(found).toEqual(boatSites(map, reg, [...sites].reverse()));
  expect(new Set(found.map(v => v.kind))).toEqual(new Set(["core:boat", "core:boat_rescue", "core:boat_police"]));
  const encoded = parseMap(writeMap({ ...map, vehicles: found })).vehicles!;
  for (let i = 0; i < found.length; i++) {
    expect(encoded[i]!.id).toBe(found[i]!.id); expect(encoded[i]!.y).toBeCloseTo(found[i]!.y!, 2);
    expect(encoded[i]!.condition![0]).toBeCloseTo(.58, 6); expect(encoded[i]!.fuel![1]).toBeCloseTo(.42, 6);
  }
});

test("boat sites reject dry ground, open ocean without an accessible bank, and obstructed berths", () => {
  const reg = coreRegistry(), site: BoatSite = { id: "berth", kind: "civilian", x: 80, z: 60, radius: 0 };
  expect(boatSites(flatMap(2), reg, [site])).toEqual([]);
  expect(boatSites(flatMap(4, { seaLevel: 3 }), reg, [site])).toEqual([]);
  const map = coast();
  expect(boatSites({ ...map, statics: [{ kind: "core:wall", x: 80, y: 4, z: 60, yaw: 0 }] }, reg, [site])).toEqual([]);
});

test("direct map labels select real marina, beach, police and Coast Guard sites without inventing tags", () => {
  const label = (name: string, kind: string | null): BuildingLabel => ({ name, kind, also: [], height_m: null, height_from: null, levels: null, address: null, use: "", primary_use: "", uses: {}, area_m2: 500, e: 30, n: 40 });
  const sites = mappedBoatSites([
    { name: "Harbour", kind: "marina", e: 10, n: 20, in_footprint: null },
    { name: "Beach", kind: "beach", e: 20, n: 30, in_footprint: null },
    { name: "Park", kind: "park", e: 30, n: 40, in_footprint: null },
  ], { "1": label("Police station", "police_station"), "2": label("U.S. Coast Guard Station - Miami Beach", null), "3": label("Historic police museum", "museum") }, (e, n) => [100 - e, 100 + n]);
  expect(sites.map(s => s.kind)).toEqual(["civilian", "rescue", "police", "rescue"]);
  expect(sites[0]!.x).toBe(90); expect(sites[0]!.z).toBe(120);
  expect(sites.some(s => s.id === "building/3")).toBe(false);
});
