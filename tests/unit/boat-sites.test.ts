import { expect, test } from "bun:test";
import { boatSites, HARBOURS, mappedBoatSites, type BoatSite, type DistrictAt, type Harbours } from "../../tools/boat/sites.ts";
import { meets } from "../../tools/mapworld/ruin-obstacles.ts";
import type { BoatSpec } from "../../shared/sim/vehicle.ts";
import { flatMap } from "../fixtures/map.ts";
import { coreRegistry } from "../fixtures/world.ts";
import { mapHeightfield, parseMap, writeMap, type MapData } from "../../shared/world/mapfile.ts";
import type { BuildingLabel, PublicPlace } from "../../tools/mapworld/labels.ts";

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
  const encoded = parseMap(writeMap({ ...map, vehicles: found.map(({ site: _s, district: _d, ...v }) => v) })).vehicles!;
  for (let i = 0; i < found.length; i++) {
    expect(encoded[i]!.id).toBe(found[i]!.id); expect(encoded[i]!.y).toBeCloseTo(found[i]!.y!, 2);
    expect(encoded[i]!.condition![0]).toBeCloseTo(found[i]!.condition![0], 6); expect(encoded[i]!.fuel![1]).toBeCloseTo(found[i]!.fuel![1], 6);
  }
});

/** Two marinas and sixteen piers along the coast, and the vessels each holds. */
function harbours(districtAt: DistrictAt = () => null, rules = HARBOURS) {
  const map = coast(), reg = coreRegistry();
  const places: PublicPlace[] = [
    ...Array.from({ length: 2 }, (_, i) => ({ name: `Marina ${i}`, kind: "marina", e: 70 + i * 200, n: 80, in_footprint: null })),
    ...Array.from({ length: 16 }, (_, i) => ({ name: `Pier ${i}`, kind: "pier", e: 400 + i * 22, n: 64, in_footprint: null })),
  ];
  return { map, reg, sites: mappedBoatSites(places, {}, (e, n) => [e, n]), found: (sites: BoatSite[]) => boatSites(map, reg, sites, rules, districtAt) };
}

test("a marina holds several vessels and a share of piers one small craft, each clear of the others with its own draught", () => {
  const { map, reg, sites, found } = harbours(), boats = found(sites), hf = mapHeightfield(map);
  const marinas = sites.filter(s => s.waterfront === "marina").map(s => boats.filter(b => b.site === s.id).length);
  for (const n of marinas) { expect(n).toBeGreaterThanOrEqual(HARBOURS.marina.least); expect(n).toBeLessThanOrEqual(HARBOURS.marina.most); }
  const piers = boats.filter(b => b.id.startsWith("boat/place/pier/"));
  expect(piers.length).toBeGreaterThan(0);
  expect(piers.length).toBeLessThan(sites.filter(s => s.waterfront === "pier").length);
  expect(new Set(boats.map(b => b.id)).size).toBe(boats.length);
  for (const b of boats) {
    const spec = reg.vehicle[reg.index.get(b.kind)!]!.spec as BoatSpec;
    if (piers.includes(b)) expect(spec.halfLength * 2).toBeLessThanOrEqual(HARBOURS.pier.longest);
    expect(hf.waterAt(b.x, b.z) - hf.heightAt(b.x, b.z)).toBeGreaterThanOrEqual(spec.draft + .2);
    // Its room is clear of every other found hull.
    const box = (v: typeof b, grow: number) => { const s = reg.vehicle[reg.index.get(v.kind)!]!.spec; return { x: v.x, y: 0, z: v.z, yaw: v.yaw * 360 / 65536, size: [s.halfWidth * 2 + grow * 2, 1, s.halfLength * 2 + grow * 2] as const }; };
    for (const o of boats) if (o !== b) expect(meets(box(b, HARBOURS.room), box(o, 0))).toBe(false);
    for (const o of boats) if (o.site !== b.site) expect(Math.hypot(o.x - b.x, o.z - b.z)).toBeGreaterThanOrEqual(HARBOURS.apart);
  }
  // The same map gives the same harbours, whatever order its places come in.
  expect(found([...sites].reverse())).toEqual(boats);
});

test("a district's kind changes which vessels its harbours hold: workboats by the port, yachts and racers where it is rich", () => {
  const rules: Harbours = { ...HARBOURS, marina: { least: 6, most: 6 }, pier: { ...HARBOURS.pier, share: 1 }, apart: 40 };
  const kinds = (style: string) => { const { sites, found } = harbours(() => ({ name: "Somewhere", style }), rules); return found(sites).map(b => b.kind); };
  const work = kinds("industrial"), rich = kinds("deco");
  const share = (list: string[], ids: string[]) => list.filter(k => ids.includes(k)).length / list.length;
  expect(share(work, ["core:boat", "core:jon_boat"])).toBeGreaterThan(.6);
  expect(share(rich, ["core:boat", "core:jon_boat"])).toBeLessThan(.2);
  expect(share(rich, ["core:needle", "core:thunderbolt", "core:meridian", "core:belvedere", "core:sovereign", "core:riptide"])).toBeGreaterThan(share(work, ["core:needle", "core:thunderbolt", "core:meridian", "core:belvedere", "core:sovereign", "core:riptide"]) + .3);
  expect(work).not.toContain("core:sovereign");
  // A district's own name row comes last.
  const { sites, found } = harbours(() => ({ name: "Fisher Island", style: "industrial" }), rules);
  expect(found(sites).map(b => b.kind)).not.toContain("core:jon_boat");
  expect(() => boatSites(coast(), coreRegistry(), sites, { ...rules, styles: { deco: { "core:yatch": 3 } } })).toThrow("core:yatch");
});

test("some found vessels are hurt and some nearly whole, and every one has a little fuel", () => {
  const rules: Harbours = { ...HARBOURS, marina: { least: 6, most: 6 }, pier: { ...HARBOURS.pier, share: 1 }, apart: 40 };
  const { sites, found } = harbours(() => null, rules), boats = found(sites);
  expect(boats.length).toBeGreaterThan(20);
  const band = (b: (typeof boats)[number]) => HARBOURS.condition.findIndex(([lo, hi]) => b.condition![0] === lo && b.condition![1] === hi);
  expect(boats.every(b => band(b) >= 0 && HARBOURS.fuel.some(([lo, hi]) => b.fuel![0] === lo && b.fuel![1] === hi))).toBe(true);
  const counts = HARBOURS.condition.map((_, i) => boats.filter(b => band(b) === i).length);
  expect(counts.every(n => n > 0)).toBe(true);
  // A hurt hull still floats and makes way: no water comes in above half its condition.
  expect(Math.min(...HARBOURS.condition.map(b => b[0]))).toBeGreaterThanOrEqual(.5);
  expect(boats.filter(b => b.fuel![1] <= HARBOURS.fuel[0]![1]).length).toBeGreaterThan(boats.length / 2);
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
  // A place's name with spaces, accents or great length still makes an id a map file takes: plain ASCII, 80 at most.
  const [long] = mappedBoatSites([{ name: "Muelle de la Bahía Vizcaína para embarcaciones de recreo y pesca deportiva", kind: "pier", e: 519.6, n: 1614.4, in_footprint: null }], {}, (e, n) => [e, n]);
  expect(`boat/${long!.id}`).toMatch(/^[\x21-\x7e]{1,80}$/);
  expect(long!.id).toStartWith("place/pier/Muelle_de_la_Bahia_Vizcaina");
  expect(long!.id).toEndWith("@519.6,1614.4");
});
