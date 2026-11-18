import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import type { WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { gridAt } from "../../tools/mapworld/base.ts";
import { S } from "../../tools/mapworld/ground.ts";
import { boxOf, meets, type Box } from "../../tools/mapworld/ruin-obstacles.ts";
import type { Site, StaticPiece } from "../../tools/mapworld/statics.ts";
import { parkCars, roadIndex, type Cars, type Parked } from "../../tools/mapworld/street-cars.ts";

const FLEET = ROAD_FLEET.map((s) => ({ id: s.id, def: s.vehicle as WheelVehicleDefinition }));
const DEF = new Map(FLEET.map((f) => [f.id, f.def]));
const DEFAULTS = (JSON.parse(readFileSync(join(import.meta.dir, "../../tools/mapworld/rules/default.json"), "utf8")) as { street: { cars: Cars } }).street.cars;
const folders: string[] = [];
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });

// A flat square of 1,024 m on 2 m samples, the ground 1 m up: its west half (x below 512) the district "Works", its
// east half "Homes". Roads are given in engine metres.
const N = 513, SIZE = (N - 1) * 2, GROUND = 1;
interface Road { mtfcc: string; width: number; from: [number, number]; to: [number, number] }
function fixture(roads: readonly Road[], routes: Site["growthRoutes"] = []): Site {
  const source = mkdtempSync(join(tmpdir(), "snark-street-cars-")); folders.push(source); mkdirSync(join(source, "base"));
  writeFileSync(join(source, "base/roads.geojson"), JSON.stringify({ type: "FeatureCollection", features: roads.map((r) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [r.from, r.to] }, properties: { mtfcc: r.mtfcc, width_m: r.width } })) }));
  const surface = new Uint8Array(N * N).fill(S.OPEN), district = new Uint8Array(N * N);
  for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
    const x = SIZE - col * 2, z = SIZE - row * 2, i = row * N + col;
    district[i] = x < SIZE / 2 ? 1 : 2;
    for (const r of roads) {
      const [ax, az] = r.from, [bx, bz] = r.to, ex = bx - ax, ez = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
      // The painted street runs a sample past its drawn width, as a raster of it does.
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) <= r.width / 2 + 1.5) surface[i] = S.STREET;
    }
  }
  return { source, world: { districts: [{ name: "Works", style: "industrial", tall: 0, ring: [] }, { name: "Homes", style: "residential", tall: 0, ring: [] }] },
    ground: { grid: gridAt([-SIZE / 2, -SIZE / 2, SIZE / 2, SIZE / 2]), surface, district }, growthRoutes: routes, vehicles: [], toLattice: (e: number, n: number) => [e, n], groundAt: () => GROUND } as unknown as Site;
}
const streets = (from: number, to: number, every: number): Road[] => {
  const out: Road[] = [];
  for (let z = from; z <= to; z += every) out.push({ mtfcc: "S1400", width: 8, from: [30, z], to: [994, z] });
  return out;
};
const rules = (parked: Partial<Cars["parked"]>): Cars => ({ ...DEFAULTS, parked: { ...DEFAULTS.parked, ...parked } });
// Many cars a district, so its mix can be counted.
const MANY = { perKm: 100, least: 0, most: 80, apart: 12, kinds: { "core:compact": 1, "core:caravan": 1, "core:panel_van": 1, "core:veloce": 1 },
  styles: { industrial: { "core:panel_van": 6, "core:veloce": 0 } }, districts: { Homes: { "core:caravan": 6, "core:panel_van": 0 } } };
const park = (site: Site, cars: Cars, pieces: StaticPiece[] = []): Parked[] => parkCars(site, pieces, roadIndex(site), cars, 7, FLEET);

const body = (p: Parked): Box => { const s = DEF.get(p.kind)!.spec; return { x: p.x, y: GROUND + s.height / 2, z: p.z, yaw: p.yaw, size: [s.halfWidth * 2, s.height, s.halfLength * 2] }; };
/** Its envelope, the door room its seats' entries need and the margin round both, as parkCars keeps clear. */
const room = (p: Parked, clear: number): Box => {
  const d = DEF.get(p.kind)!, s = d.spec, door = Math.max(s.halfWidth, ...d.seats.map((seat) => Math.abs(seat.entry[0])));
  return { x: p.x, y: GROUND + (s.height + 1) / 2, z: p.z, yaw: p.yaw, size: [(door + clear) * 2, s.height + 1, (s.halfLength + clear) * 2] };
};
const count = (cars: readonly Parked[], kind: string): number => cars.filter((p) => p.kind === kind).length;

test("a district parks the fleet by its weights: the defaults, changed by its style and then by its name", () => {
  const site = fixture(streets(100, 900, 100)), cars = park(site, rules(MANY));
  const works = cars.filter((p) => p.district === "Works"), homes = cars.filter((p) => p.district === "Homes");
  expect([works.length, homes.length]).toEqual([80, 80]);
  // Works is industrial: vans weigh 6 of 8 and no sports car is found there. Homes takes caravans by its own name, and no van.
  expect(count(works, "core:veloce")).toBe(0);
  expect(count(works, "core:panel_van") / works.length).toBeGreaterThan(.6);
  expect(count(homes, "core:panel_van")).toBe(0);
  expect(count(homes, "core:caravan") / homes.length).toBeGreaterThan(.6);
  expect(count(homes, "core:veloce")).toBeGreaterThan(0);
  expect(new Set(cars.map((p) => p.kind))).toEqual(new Set(["core:compact", "core:caravan", "core:panel_van", "core:veloce"]));
  // The same map and seed park the same cars.
  expect(park(site, rules(MANY))).toEqual(cars);
});

test("the default rules weigh only cars of the fleet, and a kind they misname stops the build", () => {
  const site = fixture(streets(100, 300, 100));
  const cars = park(site, DEFAULTS);
  // Two to four a district, spread 150 m apart.
  expect(cars.filter((p) => p.district === "Works").length).toBeGreaterThanOrEqual(2);
  expect(cars.filter((p) => p.district === "Homes").length).toBeLessThanOrEqual(4);
  for (const p of cars) expect(DEF.has(p.kind)).toBe(true);
  expect(() => park(site, rules({ styles: { industrial: { "core:lorry": 3 } } }))).toThrow("street.cars.parked weighs core:lorry, which is not a car of the fleet");
});

test("each kind keeps its own envelope and door room clear: a row of crates a van's room meets but a compact's does not", () => {
  // Crates along the street's middle, their kerbward faces 0.4 m short of it toward the kerb the cars stand at.
  const road: Road = { mtfcc: "S1400", width: 8, from: [30, 500], to: [994, 500] };
  const crates: StaticPiece[] = [];
  for (let x = 30; x <= 994; x += 1) crates.push({ kind: "core:crate", x, y: GROUND, z: 499.9, yaw: 0 });
  const pair = rules({ ...MANY, kinds: { "core:compact": 1, "core:panel_van": 1 }, styles: {}, districts: {} });
  const open = park(fixture([road]), pair), crowded = park(fixture([road]), pair, crates);
  expect(count(open, "core:panel_van")).toBeGreaterThan(10);
  expect(count(crowded, "core:panel_van")).toBe(0);
  expect(count(crowded, "core:compact")).toBeGreaterThan(10);
  for (const p of crowded) for (const c of crates) expect(meets(room(p, pair.parked.clear), boxOf(c))).toBe(false);
});

test("no two parked cars' envelopes cross, nor one's door room the other's body, none stands in a static or on a reserved route, and a car park holds several", () => {
  const lot: Road = { mtfcc: "S1780", width: 6, from: [100, 960], to: [400, 960] };
  // A route reserved across a street, as a room's walk is.
  const route = { points: [{ x: 700, y: GROUND, z: 585 }, { x: 700, y: GROUND, z: 615 }], width: 2 };
  const crate: StaticPiece = { kind: "core:crate", x: 200, y: GROUND, z: 302.7, yaw: 0 };
  const site = fixture([...streets(100, 900, 100), lot], [route]);
  const tight = rules({ ...MANY, apart: 6, lots: { classes: ["S1780"], least: 2, most: 4, apart: 6, perDistrict: 1, stall: 6 } });
  const cars = park(site, tight, [crate]);
  expect(cars.length).toBeGreaterThan(150);
  const clear = tight.parked.clear;
  for (const [i, p] of cars.entries()) {
    expect(meets(room(p, clear), boxOf(crate))).toBe(false);
    // The route's line grown by its half width, against the car's room.
    for (let z = 585; z <= 615; z += .25) for (const dx of [-1, 0, 1]) expect(meets(room(p, clear), { x: 700 + dx, y: GROUND + 1, z, yaw: 0, size: [.01, 2, .01] })).toBe(false);
    for (const q of cars.slice(i + 1)) {
      expect(meets(body(p), body(q))).toBe(false);
      expect(meets(room(p, clear), body(q)) || meets(room(q, clear), body(p))).toBe(false);
    }
  }
  // The car park's road: two to four cars together on it, each the lot's `apart` from the next and the district's from any other.
  const parked = cars.filter((p) => p.lot);
  expect(parked.length).toBeGreaterThanOrEqual(2); expect(parked.length).toBeLessThanOrEqual(4);
  for (const p of parked) {
    expect(Math.abs(p.z - 960)).toBeLessThan(3); expect(p.x).toBeGreaterThan(100); expect(p.x).toBeLessThan(400);
    for (const q of cars) if (q !== p) expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeGreaterThanOrEqual(6);
  }
  const xs = parked.map((p) => p.x).sort((a, b) => a - b);
  expect(xs.at(-1)! - xs[0]!).toBeLessThanOrEqual((parked.length - 1) * (6 + 4));
});

test("a car park's stalls draw among the kinds that fit a stall: a bus, a semi or a tanker parks at a kerb and leaves no stall empty", () => {
  // A car park in Works: a row of stalls 2.7 m apart on the lot's ground, each nose to the aisle north of it.
  const site = fixture(streets(100, 900, 100)), { surface, grid } = site.ground;
  for (let x = 196; x <= 264; x += 2) for (let z = 548; z <= 558; z += 2) surface[((SIZE - z) / 2) * N + (SIZE - x) / 2] = S.LOT;
  const stalls = [];
  for (let x = 200; x <= 260; x += 2.7) stalls.push({ lot: "lot", e: grid.west + grid.x1 - x, n: grid.north - grid.z1 + 550, fe: grid.west + grid.x1 - x, fn: grid.north - grid.z1 + 552.5 });
  writeFileSync(join(site.source, "base/stalls.json"), JSON.stringify(stalls));
  const long = ["core:tanker", "core:bus", "core:semi"], trucks = { industrial: Object.fromEntries(long.map((id) => [id, 40])) };
  const mix = { ...MANY, kinds: { "core:compact": 1 }, districts: {} }, lot = (cars: readonly Parked[]): Parked[] => cars.filter((p) => p.lot);
  const plain = park(site, rules({ ...mix, styles: {} })), withTrucks = park(site, rules({ ...mix, styles: trucks }));
  expect(lot(plain).length).toBeGreaterThanOrEqual(DEFAULTS.parked.lots.least);
  expect(lot(withTrucks)).toEqual(lot(plain));
  for (const p of lot(withTrucks)) expect(DEF.get(p.kind)!.spec.halfLength * 2).toBeLessThanOrEqual(DEFAULTS.parked.lots.stall);
  expect(withTrucks.some((p) => !p.lot && long.includes(p.kind))).toBe(true);
  // Drawn for stalls they do not fit, the trucks would leave the car park short of cars.
  const unlimited = park(site, rules({ ...mix, styles: trucks, lots: { ...DEFAULTS.parked.lots, stall: 100 } }));
  expect(lot(unlimited).length).toBeLessThan(lot(plain).length);
});

test("a share of the parked cars are hurt in a range they drive in, the rest whole, and every one's fuel is in a band, most of them low", () => {
  const site = fixture(streets(100, 900, 100)), cars = rules(MANY), parked = park(site, cars);
  const { hurt, fuel } = cars.parked;
  expect(hurt.condition[0]).toBeGreaterThan(.08);
  const hurtOnes = parked.filter((p) => p.condition);
  expect(hurtOnes.length / parked.length).toBeGreaterThan(hurt.share - .08); expect(hurtOnes.length / parked.length).toBeLessThan(hurt.share + .08);
  for (const p of hurtOnes) expect(p.condition).toEqual(hurt.condition);
  for (const p of parked) expect(fuel.some(([from, to]) => p.fuel[0] === from && p.fuel[1] === to)).toBe(true);
  const low = fuel.reduce((a, b) => (b[2] > a[2] ? b : a));
  expect(low[1]).toBeLessThanOrEqual(.15);
  expect(parked.filter((p) => p.fuel[1] === low[1]).length / parked.length).toBeGreaterThan(.6);
  // The bands and the share are the map's: the same map and seed give the same ranges, and other bands are taken as given.
  expect(park(site, cars)).toEqual(parked);
  const full = park(site, rules({ ...MANY, hurt: { share: 0, condition: [.5, .5] }, fuel: [[1, 1, 1]] }));
  expect(full.every((p) => !p.condition && p.fuel[0] === 1)).toBe(true);
});
