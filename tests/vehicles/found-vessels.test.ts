import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost, type Host } from "../../server/host.ts";
import { foundVehicle } from "../../server/vehicle-service.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap, type MapVehicle } from "../../shared/world/mapfile.ts";
import { HARBOURS } from "../../tools/boat/sites.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-found-vessels-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const reg = coreRegistry();
// As a city's build berths them: each with one band of condition and one of fuel from the harbours' rules.
const [HURT, BETWEEN, SOUND] = HARBOURS.condition.map(([lo, hi]) => [lo, hi] as const) as [readonly [number, number], readonly [number, number], readonly [number, number]];
const [LOW, SOME] = HARBOURS.fuel.map(([lo, hi]) => [lo, hi] as const) as [readonly [number, number], readonly [number, number]];
const MOORED: MapVehicle[] = [
  { id: "boat/place/marina/A@1,1", kind: "core:jon_boat", x: 60, z: 60, yaw: 0, condition: HURT, fuel: LOW },
  { id: "boat/place/marina/A@1,1#1", kind: "core:riptide", x: 80, z: 60, yaw: 0, condition: SOUND, fuel: LOW },
  { id: "boat/place/marina/A@1,1#2", kind: "core:solstice", x: 110, z: 60, yaw: 16384, condition: BETWEEN, fuel: SOME },
  { id: "boat/place/marina/B@2,2", kind: "core:sovereign", x: 160, z: 160, yaw: 0, condition: HURT, fuel: LOW },
  { id: "boat/place/pier/C@3,3", kind: "core:needle", x: 60, z: 180, yaw: 32768, condition: BETWEEN, fuel: LOW },
];
const FILE = writeMap(flatMap(4, { seaLevel: 4, vehicles: MOORED }));
const start = (seed: number, dbPath?: string): Host => createHost(reg, { map: FILE, seed, clips: NO_CLIPS, rigs: [], ...(dbPath ? { dbPath } : {}) });

/** Each found vessel's kind and berth, its fuel as a share of its tank, its drive's and hull's condition and its health's share. */
function found(host: Host): (string | number)[][] {
  const ents = host.world.ents;
  return [...host.records.byPid.values()].filter((r) => reg.vehicle[r.kind]).map((r) => {
    const e = host.records.entOf.get(r.pid)!, v = ents.vrow[e]!, def = reg.vehicle[r.kind]!;
    return [reg.ids[r.kind]!, Math.round(ents.x[e]!), Math.round(ents.z[e]!), ents.fuel[v]! / def.spec.fuelCapacity, ents.vehicleEngineCondition[v]!, ents.vehicleHullCondition[v]!, r.vitals!.at(V_HEALTH, host.world.tick) / r.vitals!.max[V_HEALTH]!];
  }).sort((a, b) => Number(a[1]) - Number(b[1]) || Number(a[2]) - Number(b[2]));
}

test("one map and seed berth the same vessels in the same state; another seed rolls them again; a save and a reload keep every one as rolled", () => {
  const hosts = [start(5), start(5), start(6)];
  try {
    const [a, b, other] = hosts.map(found);
    expect(a).toHaveLength(MOORED.length);
    expect(b).toEqual(a!);
    expect(other!.map((row) => row.slice(0, 3))).toEqual(a!.map((row) => row.slice(0, 3)));
    expect(other!.map((row) => row[3])).not.toEqual(a!.map((row) => row[3]));
    for (const row of a!) {
      const placed = MOORED.find((p) => p.kind === row[0])!, rolled = foundVehicle("test:flat", placed, 5);
      const [fuel, engine, hull, health] = row.slice(3) as number[];
      expect(fuel).toBeCloseTo(rolled.fuel!, 5); expect(engine).toBeCloseTo(rolled.engine!, 6); expect(hull).toBeCloseTo(rolled.hull!, 6);
      for (const [n, [lo, hi]] of [[fuel, placed.fuel!], [engine, placed.condition!], [hull, placed.condition!]] as const) {
        expect(n).toBeGreaterThanOrEqual(lo - 1e-6); expect(n).toBeLessThanOrEqual(hi + 1e-6);
      }
      expect(health).toBeCloseTo(hull, 3);
    }
  } finally { for (const h of hosts) h.shutdown(); }

  const db = join(dir, "found.db");
  const first = start(5, db), before = found(first);
  first.shutdown();
  const again = start(9, db);
  try {
    expect(again.loaded!.fresh).toBe(false);
    const after = found(again);
    expect(after.map((row) => row.slice(0, 3))).toEqual(before.map((row) => row.slice(0, 3)));
    for (const [i, row] of after.entries()) for (let k = 3; k < row.length; k++) expect(row[k] as number).toBeCloseTo(before[i]![k] as number, 6);
  } finally { again.shutdown(); }
});

test("a vessel found at the bottom of the hurt band with the least fuel still floats and makes way", () => {
  for (const kind of ["core:jon_boat", "core:sovereign"]) {
    const placed: MapVehicle = { id: "boat/place/marina/Worst@0,0", kind, x: 128, z: 60, yaw: 0, condition: [HURT[0], HURT[0]], fuel: [LOW[0], LOW[0]] };
    const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4, { seaLevel: 4, vehicles: [placed] })) });
    try {
      const ents = h.world.ents, e = h.host.records.entOf.get([...h.host.records.byPid.values()].find((r) => reg.vehicle[r.kind])!.pid)!, v = ents.vrow[e]!;
      const def = reg.vehicle[ents.kind[e]!]!;
      expect(ents.vehicleHullCondition[v]).toBeCloseTo(HURT[0], 6);
      const ada = h.join("ada");
      h.run(400);
      const c = h.client(ada)!, entry = def.seats[0]!.entry;
      ents.setPosition(c.ent, 128 + entry[0], 3.9, 60 + entry[2]); ents.mode[c.ent] = MODE_SWIM;
      expect(h.host.urban.mount(c, e)).toBe(RESULT_OK);
      h.run(1500);
      expect(ada.driving).toBe(e);
      const rest = ents.y[e]!;
      h.pilots[0]!.moveZ = 127;
      h.run(20000);
      expect(ents.z[e]! - 60, kind).toBeGreaterThan(30);
      expect(ents.vehicleFlooding[v], kind).toBe(0);
      expect(ents.fuel[v]!).toBeLessThan(LOW[0] * def.spec.fuelCapacity);
      h.pilots[0]!.moveZ = 0;
      h.run(30000);
      expect(Math.abs(ents.y[e]! - rest), kind).toBeLessThan(.1);
    } finally { h.host.shutdown(); }
  }
});
