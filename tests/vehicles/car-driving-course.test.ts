import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { COMPACT } from "../../content/vehicles/compact.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { makeHandle } from "../../shared/ids.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { createVehicle } from "../../shared/sim/vehicle.ts";
import { vehiclePoint } from "../../shared/sim/vehicle-frame.ts";
import { vehicleStep } from "../../shared/sim/vehicle-body.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { StaticVehicleWorld } from "../../shared/world/vehicle.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

const made = compileContent([...CORE_CONTENT,
  { type: "structure", class: "static", id: "course:post", mesh: "box", color: 1, half: [.05, 2, .05], hp: 1e6 },
  { type: "structure", class: "static", id: "course:corner", mesh: "box", color: 1, half: [1.5, 3, 1.5], hp: 1e6 },
  { type: "structure", class: "static", id: "course:deck", mesh: "box", color: 1, half: [4, .25, 5], hp: 1e6 },
  { type: "structure", class: "static", id: "course:cagewall", mesh: "box", color: 1, half: [3.5, 3, .05], hp: 1e6 },
]);
if (!made.registry) throw new Error(made.errors.join("\n"));
const registry = made.registry;
function course() {
  const h = new Harness({}, 19, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(4)) }, registry);
  const session = h.join("course-driver"); h.run(400);
  const c = h.client(session)!, rec = h.host.records.byPid.get(c.pid)!, ents = h.world.ents;
  const car = h.host.spawnVehicle("core:compact", 64, 32, rec.team);
  ents.setPosition(c.ent, 65.6, 0, 32.12); h.world.history.discontinuity(c.ent);
  expect(h.host.urban.mount(c, car)).toBe(RESULT_OK); h.run(900); expect(c.drive).toBe(car);
  const vehicle = h.host.records.byPid.get(ents.pid[car]!)!, reports: { tick: number; speed: number; landing: number }[] = [];
  const impact = h.host.urban.impact.bind(h.host.urban);
  h.host.urban.impact = e => {
    if (e === car && (vehicleStep.impactSpeed > 0 || vehicleStep.landSpeed > 0)) reports.push({ tick: h.world.tick, speed: vehicleStep.impactSpeed, landing: vehicleStep.landSpeed });
    impact(e);
  };
  const health = () => h.host.survival.value(vehicle, V_HEALTH);
  const crewHealth = () => h.host.survival.value(rec, V_HEALTH);
  const place = (x: number, y: number, z: number, yaw: number, speed: number) => {
    const v = ents.vrow[car]!; ents.setPosition(car, x, y, z); ents.yaw[car] = Math.round(yaw * 65536 / (Math.PI * 2)) & 65535;
    ents.vehicleYaw[v] = yaw; ents.vehiclePitch[v] = ents.vehicleRoll[v] = 0;
    ents.vehicleQx[v] = ents.vehicleQz[v] = 0; ents.vehicleQy[v] = Math.sin(yaw / 2); ents.vehicleQw[v] = Math.cos(yaw / 2);
    ents.vehiclePitchRate[v] = ents.vehicleYawRate[v] = ents.vehicleRollRate[v] = 0;
    ents.vx[car] = Math.sin(yaw) * speed; ents.vy[car] = 0; ents.vz[car] = Math.cos(yaw) * speed;
    ents.flags[car] = ents.flags[car]! | F_GROUNDED; h.world.history.discontinuity(car);
  };
  const pose = () => { const v = ents.vrow[car]!; return { ...createVehicle(COMPACT, ents.x[car]!, ents.y[car]!, ents.z[car]!, ents.vehicleYaw[v]!),
    pitch: ents.vehiclePitch[v]!, roll: ents.vehicleRoll[v]!,
    qx: ents.vehicleQx[v]!, qy: ents.vehicleQy[v]!, qz: ents.vehicleQz[v]!, qw: ents.vehicleQw[v]! }; };
  const tick = (forward = 0) => { c.inputs.set(h.world.tick + 1, 0, forward, ents.yaw[car]!, 0, 0); h.server.tick(); };
  return { h, c, ents, car, vehicle, health, crewHealth, place, pose, tick, reports, solids: new StaticVehicleWorld(h.world) };
}

for (const speed of [5, 12, 20]) test(`native driving crosses the authored ramp and crest at ${speed} m/s without ordinary-jump damage`, () => {
    const s = course(), { h, ents, car } = s;
    try {
      const ramp = h.reg.index.get("core:zslope_ramp"); expect(ramp).toBeDefined();
      expect(h.world.structs.add(ramp!, 64, .8, 43, 0, 0, 16000)).toBeGreaterThanOrEqual(0);
      s.place(64, 0, 37, 0, speed); const hp = s.health(), crew = s.crewHealth();
      let top = 0, launch = -1, landing = -1;
      for (let i = 0; i < 180; i++) {
        s.tick(127); top = Math.max(top, ents.y[car]!);
        if (ents.z[car]! > 47 && !(ents.flags[car]! & F_GROUNDED) && launch < 0) launch = i;
        if (launch >= 0 && (ents.flags[car]! & F_GROUNDED) && ents.z[car]! > 49 && Math.abs(ents.vy[car]!) < .5) { landing = i; break; }
      }
      expect(top).toBeGreaterThan(1.8); expect(launch).toBeGreaterThanOrEqual(0); expect(landing).toBeGreaterThan(launch); expect(landing - launch).toBeLessThan(60);
      expect(s.solids.blocked(s.pose(), s.pose(), COMPACT)).toBeNull();
      expect(s.health()).toBe(hp); expect(s.crewHealth()).toBe(crew); expect(s.c.drive).toBe(car);
    } finally { h.host.shutdown(); }
});

test("a retained ten-centimetre post stops a native thirty-four-metre-per-second car sweep", () => {
  const s = course(), { h, ents, car } = s;
  try {
    const post = h.reg.index.get("course:post")!, ref = h.world.structs.add(post, 64, 2, 40, 0, 0, 1e6), hp = s.health(), crew = s.crewHealth();
    s.place(64, 0, 37, 0, 34);
    for (let i = 0; i < 12; i++) { s.tick(); expect(ents.z[car]!).toBeLessThan(38.1); }
    expect(h.world.structs.chunks[ref >>> 16]!.kind[ref & 65535]).toBe(post);
    expect(s.reports.some(r => r.speed > 20)).toBe(true); expect(s.health()).toBeLessThan(hp); expect(s.health()).toBeGreaterThan(0);
    expect(s.crewHealth()).toBe(crew); expect(s.solids.blocked(s.pose(), s.pose(), COMPACT)).toBeNull();
  } finally { h.host.shutdown(); }
});

test("native mirrored corner impacts turn the chassis in opposite directions with equal damage", () => {
  const results: { spin: number; damage: number; travel: number }[] = [];
  for (const sign of [-1, 1]) {
    const s = course(), { h, ents, car } = s;
    try {
      h.world.structs.add(h.reg.index.get("course:corner")!, 64 + sign * 1.8, 3, 40.7, 0, 0, 1e6);
      s.place(64, 0, 37, 0, 20); const hp = s.health(), crew = s.crewHealth(); let spin = 0;
      for (let i = 0; i < 12; i++) { s.tick(); const rate = ents.vehicleYawRate[ents.vrow[car]!]!; if (Math.abs(rate) > Math.abs(spin)) spin = rate; }
      expect(s.reports.some(r => r.speed > 2)).toBe(true); expect(Math.abs(spin)).toBeGreaterThan(.1); expect(s.crewHealth()).toBe(crew);
      expect(s.solids.blocked(s.pose(), s.pose(), COMPACT)).toBeNull();
      results.push({ spin, damage: hp - s.health(), travel: ents.z[car]! - 37 });
    } finally { h.host.shutdown(); }
  }
  expect(results[0]!.spin * results[1]!.spin).toBeLessThan(0);
  expect(results[0]!.damage).toBeCloseTo(results[1]!.damage, 1); expect(results[0]!.travel).toBeCloseTo(results[1]!.travel, 2);
});

test("a native car leaves a one-and-a-half-metre deck and lands without hanging or ordinary-jump damage", () => {
  const s = course(), { h, ents, car } = s;
  try {
    h.world.structs.add(h.reg.index.get("course:deck")!, 64, 1.25, 42, 0, 0, 1e6);
    s.place(64, 1.5, 43, Math.PI / 6, 12); const hp = s.health(), crew = s.crewHealth();
    let launch = -1, landing = -1;
    for (let i = 0; i < 90; i++) {
      s.tick(64);
      if (!(ents.flags[car]! & F_GROUNDED) && launch < 0) launch = i;
      if (launch >= 0 && (ents.flags[car]! & F_GROUNDED) && ents.y[car]! < .1) { landing = i; break; }
    }
    expect(launch).toBeGreaterThanOrEqual(0); expect(landing).toBeGreaterThan(launch); expect(landing - launch).toBeLessThan(60);
    expect(ents.z[car]!).toBeGreaterThan(49); expect(Math.hypot(ents.vx[car]!, ents.vz[car]!)).toBeGreaterThan(5);
    expect(s.health()).toBe(hp); expect(s.crewHealth()).toBe(crew); expect(s.solids.blocked(s.pose(), s.pose(), COMPACT)).toBeNull();
  } finally { h.host.shutdown(); }
});

test("a fast asymmetric ramp can carry angular momentum through a full roll back onto the wheels", () => {
  const s = course(), { h, ents, car } = s;
  try {
    h.world.structs.add(h.reg.index.get("core:zslope_ramp")!, 65.8, .8, 43, 0, 0, 16000);
    s.place(64, 0, 37, 0, 25); const v = ents.vrow[car]!; let lowestUp = 1;
    for (let tick = 0; tick < 180; tick++) {
      s.tick(64); lowestUp = Math.min(lowestUp, 1 - 2 * (ents.vehicleQx[v]! ** 2 + ents.vehicleQz[v]! ** 2));
    }
    expect(lowestUp).toBeLessThan(-.95);
    expect(1 - 2 * (ents.vehicleQx[v]! ** 2 + ents.vehicleQz[v]! ** 2)).toBeGreaterThan(.95);
    expect(ents.z[car]!).toBeGreaterThan(45);
  } finally { h.host.shutdown(); }
});

// A narrower ramp overlap at 24 m/s stops on the roof; the former 1.8 m/25 m/s entry now completes the roll above.
for (const [offset, speed, roof] of [[2.2, 12, false], [2.4, 24, true]] as const) test(`an asymmetric ramp naturally rolls onto its ${roof ? "roof" : "side"}, settles and permits exit`, () => {
  const s = course(), { h, ents, car } = s;
  try {
    h.world.structs.add(h.reg.index.get("core:zslope_ramp")!, 64 + offset, .8, 43, 0, 0, 16000);
    s.place(64, 0, 37, 0, speed); const v = ents.vrow[car]!, crew = s.crewHealth();
    expect([ents.vehiclePitchRate[v], ents.vehicleYawRate[v], ents.vehicleRollRate[v]]).toEqual([0, 0, 0]);
    let up = 1, peakRoll = 0, top = 0;
    for (let i = 0; i < 180; i++) {
      s.tick(64); top = Math.max(top, ents.y[car]!); peakRoll = Math.max(peakRoll, Math.abs(ents.vehicleRollRate[v]!));
      const qx = ents.vehicleQx[v]!, qy = ents.vehicleQy[v]!, qz = ents.vehicleQz[v]!, qw = ents.vehicleQw[v]!;
      expect(Math.abs(qx * qx + qy * qy + qz * qz + qw * qw - 1)).toBeLessThan(1e-5);
      up = Math.min(up, 1 - 2 * (qx * qx + qz * qz));
    }
    expect(top).toBeGreaterThan(.5); expect(peakRoll).toBeGreaterThan(.5); expect(up).toBeLessThan(roof ? -.95 : 0);
    const restingUp = 1 - 2 * (ents.vehicleQx[v]! ** 2 + ents.vehicleQz[v]! ** 2);
    if (roof) expect(restingUp).toBeLessThan(-.95); else expect(Math.abs(restingUp)).toBeLessThan(.02);
    expect(Math.hypot(ents.vx[car]!, ents.vy[car]!, ents.vz[car]!)).toBeLessThan(.05);
    expect(ents.z[car]!).toBeGreaterThan(40); expect(s.c.drive).toBe(car); expect(s.crewHealth()).toBe(crew);
    const wall = h.reg.index.get("course:cagewall")!, at = s.pose(), corner = [0, 0, 0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const x of [-COMPACT.halfWidth, COMPACT.halfWidth]) for (const y of [COMPACT.clearance, COMPACT.height]) for (const z of [-COMPACT.halfLength, COMPACT.halfLength]) {
      vehiclePoint(at, [x, y, z], corner); x0 = Math.min(x0, corner[0]!); x1 = Math.max(x1, corner[0]!);
      z0 = Math.min(z0, corner[2]!); z1 = Math.max(z1, corner[2]!);
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const cage = [[cx, z0 - .2, 0], [cx, z1 + .2, 0], [x0 - .2, cz, 16384], [x1 + .2, cz, 16384]]
      .map(([wx, wz, yaw]) => h.world.structs.add(wall, wx!, 3, wz!, yaw!, 0, 1e6));
    expect(s.solids.blocked(at, at, COMPACT)).toBeNull();
    h.host.urban.dismount(s.c); for (let i = 0; i < 60; i++) s.tick();
    expect(s.c.drive).toBe(car); // Emergency escape still checks the whole local route against real walls.
    for (const ref of cage) h.world.structs.remove(ref);
    h.host.urban.dismount(s.c);
    for (let i = 0; i < 60 && s.c.drive === car; i++) s.tick();
    expect(s.c.drive).toBe(-1); expect(ents.seat[s.c.ent]).toBe(0);
    expect(h.host.vehicles.flip(s.c, makeHandle(car, ents.gen[car]!))).toBe(RESULT_OK);
    for (let i = 0; i < 45; i++) s.tick();
    expect(1 - 2 * (ents.vehicleQx[v]! ** 2 + ents.vehicleQz[v]! ** 2)).toBeGreaterThan(.99);
    expect(ents.y[car]!).toBeLessThan(.15);
  } finally { h.host.shutdown(); }
});
