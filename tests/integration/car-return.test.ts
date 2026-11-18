import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAR_CHECK_SECONDS, GONE_RANGE } from "../../server/car-return.ts";
import { createHost, type Host } from "../../server/host.ts";
import { foundVehicle, VEHICLE_ORIGIN } from "../../server/vehicle-service.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { cycleTicks } from "../../shared/sim/clock.ts";
import { writeMap, type MapVehicle } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-car-return-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const reg = coreRegistry();
// Twelve chunks square: the first car's place is in chunk (1, 1), far enough from (10, 10) that a session there is not sent it.
const PLACED: MapVehicle[] = [
  { kind: "core:compact", x: 100, z: 100, yaw: 0, condition: [.35, .7], fuel: [.03, .15] },
  { kind: "core:caravan", x: 600, z: 600, yaw: 16384, fuel: [.15, .5] },
  { kind: "core:helicopter", x: 400, z: 120, yaw: 0, fuel: [.1, .5] },
];
const FILE = writeMap(flatMap(12, { vehicles: PLACED }));
const start = (seed = 5, dbPath?: string): Host => createHost(reg, { map: FILE, seed, clips: NO_CLIPS, rigs: [], ...(dbPath ? { dbPath } : {}) });
/** Every place looked at now, as its deadline would. */
const check = (host: Host): void => { const r = host.carReturn!; r.places.forEach((p, i) => r.due(i, p.due)); };
const days = (host: Host, n: number): number => Math.ceil(n * cycleTicks(host.world.clock));
/** The live records of the first place's cars, the map's and those that came back, with their entities. */
function carsOf(host: Host, place = 0): { pid: number; e: number; team: number; x: number; z: number; fuel: number }[] {
  const origin = host.carReturn!.places[place]!.origin, ents = host.world.ents, text = new TextDecoder();
  return [...host.records.byPid.values()].filter((r) => r.extra.get(VEHICLE_ORIGIN) && text.decode(r.extra.get(VEHICLE_ORIGIN)) === origin).map((r) => {
    const e = host.records.entOf.get(r.pid)!;
    return { pid: r.pid, e, team: r.team, x: ents.x[e]!, z: ents.z[e]!, fuel: ents.fuel[ents.vrow[e]!]! };
  }).sort((a, b) => a.pid - b.pid);
}
const driveOff = (host: Host, car: { e: number; x: number; z: number }): void => { host.world.ents.setPosition(car.e, car.x + GONE_RANGE + 30, host.world.ents.y[car.e]!, car.z); };

test("a place whose car was driven off gets another, owned by nobody and rolled again, FoundCarReturnDays of the game's clock later and not before", () => {
  const host = start();
  try {
    const r = host.carReturn!, place = r.places[0]!;
    // The cars on wheels are places; the helicopter is not.
    expect(r.places.map((p) => p.at.kind)).toEqual(["core:compact", "core:caravan"]);
    expect(host.rules.num("FoundCarReturnDays")).toBe(3);
    const [first] = carsOf(host);
    driveOff(host, first!);
    check(host);
    const went = host.world.tick;
    expect(place.gone).toBe(went);
    host.world.tick = went + days(host, 3) - 1; check(host);
    expect(r.returned).toBe(0);
    host.world.tick = went + days(host, 3); check(host);
    expect(r.returned).toBe(1);
    const [old, back] = carsOf(host);
    expect(old!.pid).toBe(first!.pid); expect(old!.x).toBeCloseTo(first!.x + GONE_RANGE + 30, 3);
    expect([back!.team, Math.round(back!.x), Math.round(back!.z)]).toEqual([0, 100, 100]);
    // Its state is a new roll in the map's ranges: foundVehicle's with the world's seed and one more for the one that came back.
    const capacity = reg.vehicle[reg.index.get("core:compact")!]!.spec.fuelCapacity;
    expect(back!.fuel).toBeCloseTo(foundVehicle(host.world.mapId, place.at, 6).fuel! * capacity, 4);
    expect(back!.fuel).not.toBeCloseTo(first!.fuel, 4);
    expect(host.world.ents.vehicleEngineCondition[host.world.ents.vrow[back!.e]!]).toBeCloseTo(foundVehicle(host.world.mapId, place.at, 6).engine!, 6);
    // Its car is back, so no more come however long it waits; and the place whose car never went gets none.
    host.world.tick += days(host, 30); check(host);
    expect([r.returned, carsOf(host).length, carsOf(host, 1).length]).toEqual([1, 2, 1]);
  } finally { host.shutdown(); }
});

test("a destroyed car's place gets another; with FoundCarReturnDays 0 none comes", () => {
  for (const setting of ["3", "0"]) {
    const host = start();
    try {
      host.setSetting("FoundCarReturnDays", setting);
      const [first] = carsOf(host), rec = host.records.byPid.get(first!.pid)!;
      host.survival.hurt(rec, 1e6, 0);
      expect(host.records.byPid.has(first!.pid)).toBe(false);
      check(host);
      host.world.tick += days(host, 3); check(host);
      expect(carsOf(host).length).toBe(setting === "0" ? 0 : 1);
    } finally { host.shutdown(); }
  }
});

test("no car comes back by anything a tribe built, nor onto a body, until they are gone", () => {
  const host = start();
  try {
    const r = host.carReturn!, ents = host.world.ents;
    driveOff(host, carsOf(host)[0]!);
    check(host); host.world.tick += days(host, 3);
    // A wall a tribe put up 50 m off keeps it away; the map's own pieces, owned by nobody, do not.
    const wall = host.world.structs.add(reg.index.get("core:wall")!, 150, 1.5, 100, 0, 7, 1000);
    check(host);
    expect(r.returned).toBe(0);
    host.world.structs.remove(wall);
    host.world.structs.add(reg.index.get("core:wall")!, 110, 1.5, 100, 0, 0, 1000);
    // A creature standing by its door, and then out of the way.
    const grazer = host.spawnCreature("core:grazer", 101.8, 100, 1);
    expect(grazer).toBeGreaterThanOrEqual(0);
    check(host);
    expect(r.returned).toBe(0);
    ents.setPosition(grazer, 130, ents.y[grazer]!, 100);
    check(host);
    expect(r.returned).toBe(1);
  } finally { host.shutdown(); }
});

test("no car comes back where a survivor is shown it arrive: it waits until nobody is near enough", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: FILE });
  try {
    const r = h.host.carReturn!;
    h.host.setSetting("FoundCarReturnDays", "0.001");
    const ada = h.join("ada");
    h.run(400);
    h.say(ada, "enablecheats");
    h.say(ada, "tp 160 150");
    h.run(300);
    driveOff(h.host, carsOf(h.host)[0]!);
    check(h.host);
    h.run(4000);
    check(h.host);
    expect(r.returned).toBe(0);
    // Nine chunks off, past the three a session is sent bodies from.
    h.say(ada, "tp 700 700");
    h.run(300);
    check(h.host);
    expect(r.returned).toBe(1);
    expect(carsOf(h.host).map((c) => [Math.round(c.x), Math.round(c.z)])).toContainEqual([100, 100]);
  } finally { h.host.shutdown(); }
});

test("a place gets one car for each that went, across a save and a reload, each rolled anew", () => {
  const db = join(dir, "return.db"), capacity = reg.vehicle[reg.index.get("core:compact")!]!.spec.fuelCapacity;
  let host = start(5, db);
  driveOff(host, carsOf(host)[0]!);
  check(host); host.world.tick += days(host, 3); check(host);
  const firstBack = carsOf(host)[1]!;
  expect(host.carReturn!.places[0]!.times).toBe(1);
  host.shutdown();

  // Loaded, it finds both cars by their origin, and its own car is there: none comes however long it waits.
  host = start(5, db);
  let r = host.carReturn!;
  expect([r.places[0]!.times, r.places[0]!.gone, r.places[0]!.pids.length]).toEqual([1, -1, 2]);
  host.world.tick += days(host, 10); check(host);
  expect([r.returned, carsOf(host).length]).toEqual([0, 2]);
  // Its second car goes, and the world stops before the days are out: loaded again it keeps the tick it went.
  driveOff(host, carsOf(host).find((c) => c.pid === firstBack.pid)!);
  check(host);
  const went = r.places[0]!.gone;
  expect(went).toBe(host.world.tick);
  host.shutdown();

  host = start(9, db);
  try {
    r = host.carReturn!;
    expect(r.places[0]!.gone).toBe(went);
    host.world.tick = went + days(host, 3); check(host); check(host);
    expect([r.returned, r.places[0]!.times, carsOf(host).length]).toEqual([1, 2, 3]);
    // The third is rolled with the seed of the world that made it and the two before it.
    const third = carsOf(host).at(-1)!;
    expect(third.fuel).toBeCloseTo(foundVehicle(host.world.mapId, r.places[0]!.at, 9 + 2).fuel! * capacity, 4);
    expect(third.fuel).not.toBeCloseTo(firstBack.fuel, 4);
  } finally { host.shutdown(); }
});

test("nothing runs between a place's checks: one deadline each, each looked at once every ten minutes", () => {
  const host = start();
  try {
    const r = host.carReturn!;
    expect(CAR_CHECK_SECONDS).toBe(600);
    // The first place's check comes the tick after the start, the second's half a period on.
    const period = CAR_CHECK_SECONDS * TICK_RATE;
    for (let t = 0; t < 30; t++) host.game.tick();
    expect(r.checks).toBe(1);
    for (let t = 0; t < period / 2; t++) host.game.tick();
    expect(r.checks).toBe(2);
  } finally { host.shutdown(); }
});
