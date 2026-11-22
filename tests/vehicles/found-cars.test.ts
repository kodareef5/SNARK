import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost, type Host } from "../../server/host.ts";
import { foundVehicle } from "../../server/vehicle-service.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { parseMap, writeMap, type MapVehicle } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-found-cars-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const reg = coreRegistry();
// As a city's build writes them: whole cars with only a fuel range, hurt ones with a condition range too.
const HURT = [.35, .7] as const, LOW = [.03, .15] as const, SOME = [.15, .5] as const;
const PLACED: MapVehicle[] = [
  { kind: "core:compact", x: 60, z: 60, yaw: 0, fuel: LOW },
  { kind: "core:panel_van", x: 100, z: 60, yaw: 16384, condition: HURT, fuel: LOW },
  { kind: "core:veloce", x: 140, z: 60, yaw: 0, condition: HURT, fuel: SOME },
  { kind: "core:caravan", x: 180, z: 60, yaw: 32768, fuel: SOME },
  { kind: "core:berlinetta", x: 60, z: 160, yaw: 0, condition: HURT, fuel: LOW },
  { kind: "core:fastback", x: 140, z: 160, yaw: 0, fuel: LOW },
];
const FILE = writeMap(flatMap(4, { vehicles: PLACED }));
const start = (seed: number, dbPath?: string): Host => createHost(reg, { map: FILE, seed, clips: NO_CLIPS, rigs: [], ...(dbPath ? { dbPath } : {}) });

/** Each parked car's kind and place, its fuel as a share of its tank, its engine's and hull's condition and its health's share. */
function found(host: Host): (string | number)[][] {
  const ents = host.world.ents;
  return [...host.records.byPid.values()].filter((r) => reg.vehicle[r.kind]).map((r) => {
    const e = host.records.entOf.get(r.pid)!, v = ents.vrow[e]!, def = reg.vehicle[r.kind]!;
    return [reg.ids[r.kind]!, Math.round(ents.x[e]!), Math.round(ents.z[e]!), ents.fuel[v]! / def.spec.fuelCapacity, ents.vehicleEngineCondition[v]!, ents.vehicleHullCondition[v]!, r.vitals!.at(V_HEALTH, host.world.tick) / r.vitals!.max[V_HEALTH]!];
  }).sort((a, b) => Number(a[1]) - Number(b[1]) || Number(a[2]) - Number(b[2]));
}

test("a found car is rolled once in its map's ranges, from the world's seed and where it stands: one map and seed park the same cars in the same state, and a save keeps them", () => {
  const hosts = [start(5), start(5), start(6)];
  try {
    const [a, b, other] = hosts.map(found);
    expect(a).toHaveLength(PLACED.length);
    expect(b).toEqual(a!);
    // Another seed rolls each car again in the same ranges.
    expect(other!.map((row) => row.slice(0, 3))).toEqual(a!.map((row) => row.slice(0, 3)));
    expect(other!.map((row) => row[3])).not.toEqual(a!.map((row) => row[3]));
    const placements = parseMap(FILE).vehicles!;
    for (const row of a!) {
      const placed = placements.find((p) => p.kind === row[0])!, rolled = foundVehicle("test:flat", placed, 5);
      const [fuel, engine, hull, health] = row.slice(3) as number[];
      expect(fuel).toBeCloseTo(rolled.fuel!, 5); expect(engine).toBeCloseTo(rolled.engine!, 6); expect(hull).toBeCloseTo(rolled.hull!, 6);
      expect(fuel).toBeGreaterThanOrEqual(placed.fuel![0] - 1e-6); expect(fuel).toBeLessThanOrEqual(placed.fuel![1] + 1e-6);
      if (placed.condition) {
        // Hurt, but its engine runs: it stops at 0.08.
        for (const n of [engine, hull]) { expect(n).toBeGreaterThanOrEqual(HURT[0] - 1e-6); expect(n).toBeLessThanOrEqual(HURT[1] + 1e-6); }
        expect(health).toBeCloseTo(hull, 3);
      } else expect([engine, hull, health]).toEqual([1, 1, 1]);
    }
  } finally { for (const h of hosts) h.shutdown(); }

  // Saved, and loaded by a world started with another seed: nothing is rolled again and no car is parked twice.
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

test("a car found at the bottom of the hurt range with the least fuel still drives off", () => {
  const file = writeMap(flatMap(4, { vehicles: [{ kind: "core:compact", x: 100, z: 120, yaw: 0, condition: [HURT[0], HURT[0]], fuel: [LOW[0], LOW[0]] }] }));
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: file });
  try {
    const car = h.host.records.entOf.get([...h.host.records.byPid.values()].find((r) => reg.vehicle[r.kind])!.pid)!, ents = h.world.ents;
    expect(ents.vehicleEngineCondition[ents.vrow[car]!]).toBeCloseTo(HURT[0], 6);
    expect(ents.fuel[ents.vrow[car]!]).toBeCloseTo(LOW[0] * 40, 4);
    const ada = h.join("ada");
    h.run(400);
    h.say(ada, "enablecheats");
    h.say(ada, "tp 101.6 120.12");
    h.run(200);
    expect(h.host.urban.mount(h.client(ada)!, car)).toBe(RESULT_OK);
    h.run(1200);
    expect(ada.driving).toBe(car);
    h.pilots[0]!.moveZ = 1;
    h.run(1500);
    h.pilots[0]!.moveZ = 0;
    h.run(3000);
    expect(ents.z[car]!).toBeGreaterThan(130);
    expect(ents.fuel[ents.vrow[car]!]!).toBeLessThan(LOW[0] * 40);
  } finally { h.host.shutdown(); }
});
