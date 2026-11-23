import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CargoSpace, hitchedPose, offset } from "../../server/air-cargo-space.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_NOT_YOURS, RESULT_OK } from "../../shared/net/protocol.ts";
import { AIR_ACTION, AIR_PHASE } from "../../shared/sim/air-support.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import type { WheelVehicleDefinition } from "../../shared/sim/vehicle.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function yard(dbPath?: string) {
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(3)), ...(dbPath ? { dbPath } : {}) });
  h.host.setSetting("AirSupportOrderRequired", "False");
  return h;
}

function board(h: Harness) {
  const s = h.join("dispatcher"); h.run(500);
  const c = h.client(s)!, e = h.host.spawnVehicle("core:semi", 96, 60, 0, 0), a = h.world.ents;
  const def = h.reg.vehicle[a.kind[e]!]!, door = [0, 0, 0];
  h.host.urban.door(e, def.seats[0]!, h.reg.bodyRadius[c.kind]!, door);
  a.setPosition(c.ent, door[0]!, door[1]!, door[2]!);
  expect(h.host.urban.mount(c, e)).toBe(RESULT_OK);
  h.run(1600); expect(c.drive).toBe(e);
  return { s, c, e };
}

const frame = (h: Harness, e: number) => {
  const a = h.world.ents, v = a.vrow[e]!;
  return { x: a.x[e]!, y: a.y[e]!, z: a.z[e]!, yaw: a.vehicleYaw[v]!, qx: a.vehicleQx[v]!, qy: a.vehicleQy[v]!, qz: a.vehicleQz[v]!, qw: a.vehicleQw[v]! };
};
const trailerOf = (h: Harness, rack: number) => h.host.records.entOf.get(h.host.airSupport.racks.get(rack)!.pid) ?? -1;

test("a trailer delivery lands on the fifth wheel and couples", () => {
  const h = yard();
  try {
    const { c, e } = board(h), service = h.host.airSupport;
    expect(service.call(c, null)).toBe(RESULT_OK);
    for (let i = 0; i < 900 && !service.racks.size; i++) h.run(100);
    const rack = [...service.racks.values()][0]!;
    expect(rack.slots).toBe(63);
    const trailer = trailerOf(h, rack.id);
    expect(h.host.hitches.trailerOf(e)).toBe(trailer);
    const semi = h.reg.vehicle[h.world.ents.kind[e]!] as WheelVehicleDefinition;
    const want = hitchedPose(frame(h, e), semi.spec.fifthWheel!);
    expect(Math.hypot(h.world.ents.x[trailer]! - want.x, h.world.ents.z[trailer]! - want.z)).toBeLessThan(.1);
  } finally { h.host.shutdown(); }
});

test("a ground drop parks on its legs, and the semi backs under it and tows it", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-air-cargo-")), path = join(dir, "world.db");
  let h = yard(path);
  try {
    const { c, s, e } = board(h), a = h.world.ents, service = h.host.airSupport;
    const other = h.join("visitor"); h.run(500);
    const outsider = h.client(other)!;
    a.setPosition(outsider.ent, 150, 0, 150);
    expect(service.call(outsider, null)).toBe(RESULT_DENIED);
    const semi = h.reg.vehicle[a.kind[e]!] as WheelVehicleDefinition;
    // Straight behind the semi, a metre and a half back from where it would hitch.
    const ground = offset(hitchedPose(frame(h, e), semi.spec.fifthWheel!), 0, 0, -1.5);
    expect(service.call(c, ground)).toBe(RESULT_OK);
    expect(service.call(c, null)).toBe(RESULT_BUSY);
    const phases = new Set<number>();
    for (let i = 0; i < 350 && !service.racks.size; i++) {
      h.run(100);
      for (const o of service.calls.values()) phases.add(o.phase);
    }
    expect(phases.has(AIR_PHASE.lower)).toBe(true);
    const rack = [...service.racks.values()][0]!, trailer = trailerOf(h, rack.id);
    expect(h.host.hitches.tractorOf(trailer)).toBe(-1);
    h.run(2000);
    // Standing on its legs, it does not roll.
    const parked = a.z[trailer]!;
    h.run(2000);
    expect(Math.abs(a.z[trailer]! - parked)).toBeLessThan(.05);
    const command = (session: typeof s, action: number) => {
      let result = -1;
      session.onResult = (_, code) => { result = code; };
      session.airCommand(action, rack.id, 0); h.run(220); return result;
    };
    a.setPosition(outsider.ent, a.x[trailer]! + 2.2, 0, a.z[trailer]!);
    expect(command(other, AIR_ACTION.panels)).toBe(RESULT_NOT_YOURS);
    h.pilots[0]!.moveZ = -0.35;
    for (let i = 0; i < 80 && h.host.hitches.tractorOf(trailer) < 0; i++) h.run(100);
    expect(h.host.hitches.tractorOf(trailer)).toBe(e);
    h.pilots[0]!.moveZ = 1; h.run(4000);
    expect(a.z[trailer]!).toBeGreaterThan(parked + 4);
    h.pilots[0]!.moveZ = 0; h.pilots[0]!.buttons = BTN_JUMP;
    h.run(5000);
    expect(command(s, AIR_ACTION.unhitch)).toBe(RESULT_OK);
    expect(h.host.hitches.tractorOf(trailer)).toBe(-1);
    const savedAt = a.z[trailer]!, id = rack.id;
    h.host.shutdown();
    h = yard(path);
    h.run(300);
    expect(h.host.airSupport.racks.get(id)?.slots).toBe(63);
    expect(h.world.ents.z[trailerOf(h, id)]!).toBeCloseTo(savedAt, 0);
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("a roof across the descent leaves the cargo on its departing carrier", () => {
  const h = yard();
  try {
    const { c, e } = board(h), a = h.world.ents, service = h.host.airSupport;
    const semi = h.reg.vehicle[a.kind[e]!] as WheelVehicleDefinition;
    const at = hitchedPose(frame(h, e), semi.spec.fifthWheel!);
    const roof = h.reg.index.get("core:ceiling_wood")!;
    expect(h.world.structs.add(roof, at.x, at.y + 6, at.z, 0, 0, 1000)).toBeGreaterThanOrEqual(0);
    const trailer = h.reg.vehicle[h.reg.index.get("core:air_trailer")!] as WheelVehicleDefinition;
    expect(new CargoSpace(h.world, trailer).clear(at, "land", [e])).toBe(false);
    expect(h.host.setSetting("AirSupportWait", "3")).toBe("");
    expect(service.call(c, null)).toBe(RESULT_OK);
    let returned = false;
    for (let i = 0; i < 320 && !returned; i++) {
      h.run(100);
      returned = [...service.calls.values()].some(o => o.phase === AIR_PHASE.outbound && o.loaded);
    }
    expect(returned).toBe(true);
    expect(service.racks.size).toBe(0);
  } finally { h.host.shutdown(); }
});

test("a towed trailer stops a backing semi at a wall", () => {
  const h = yard();
  try {
    const { c, e } = board(h), a = h.world.ents, service = h.host.airSupport;
    expect(service.call(c, null)).toBe(RESULT_OK);
    for (let i = 0; i < 900 && !service.racks.size; i++) h.run(100);
    const trailer = trailerOf(h, [...service.racks.values()][0]!.id);
    const wall = h.reg.index.get("core:wall_wood")!, back = a.z[trailer]! - 6.5;
    for (const x of [-2.4, 0, 2.4]) h.world.structs.add(wall, a.x[trailer]! + x, 1.5, back, 0, 0, 1000);
    h.pilots[0]!.moveZ = -1;
    h.run(8000);
    expect(a.z[trailer]! - 4.45).toBeGreaterThan(back - .2);
    expect(h.host.hitches.tractorOf(trailer)).toBe(e);
  } finally { h.host.shutdown(); }
});

test("a survivor behind a reversing trailer is pushed aside", () => {
  const h = yard();
  try {
    const { c, e } = board(h), a = h.world.ents, service = h.host.airSupport;
    expect(service.call(c, null)).toBe(RESULT_OK);
    for (let i = 0; i < 900 && !service.racks.size; i++) h.run(100);
    const trailer = trailerOf(h, [...service.racks.values()][0]!.id);
    const other = h.join("visitor"); h.run(500);
    const body = h.client(other)!.ent;
    a.setPosition(body, a.x[trailer]! + .4, 0, a.z[trailer]! - 5.4);
    h.run(500);
    const start = a.z[e]!;
    h.pilots[0]!.moveZ = -1; h.run(5000);
    expect(start - a.z[e]!).toBeGreaterThan(4);
  } finally { h.host.shutdown(); }
});

test("an open rack closes itself when the semi drives off", () => {
  const h = yard();
  try {
    const { s, c } = board(h), service = h.host.airSupport;
    expect(service.call(c, null)).toBe(RESULT_OK);
    for (let i = 0; i < 900 && !service.racks.size; i++) h.run(100);
    const rack = [...service.racks.values()][0]!;
    h.run(1500);
    s.airCommand(AIR_ACTION.panels, rack.id, 0); h.run(2500);
    expect(rack.open).toBe(1);
    h.pilots[0]!.moveZ = 1; h.run(3000);
    expect(rack.opening).toBe(false);
    expect(rack.open).toBeLessThan(1);
  } finally { h.host.shutdown(); }
});

test("movement during lowering starts a fresh approach", () => {
  const h = yard();
  try {
    const { c } = board(h), service = h.host.airSupport;
    expect(service.call(c, null)).toBe(RESULT_OK);
    const order = [...service.calls.values()][0]!;
    for (let i = 0; i < 300 && order.phase !== AIR_PHASE.lower; i++) h.run(100);
    expect(order.phase).toBe(AIR_PHASE.lower);
    h.pilots[0]!.moveZ = 1; h.run(1600);
    expect(order.phase).toBe(AIR_PHASE.follow);
    expect(service.racks.size).toBe(0);
    h.pilots[0]!.moveZ = 0; h.pilots[0]!.buttons = BTN_JUMP;
    for (let i = 0; i < 900 && !service.racks.size; i++) h.run(100);
    expect(service.racks.size).toBe(1);
    expect(order.loaded).toBe(false);
  } finally { h.host.shutdown(); }
});

test("a restart before release returns the unclaimed freight", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-air-pending-")), path = join(dir, "world.db");
  let h = yard(path);
  try {
    const { c } = board(h), service = h.host.airSupport;
    expect(service.call(c, null)).toBe(RESULT_OK);
    const order = [...service.calls.values()][0]!;
    for (let i = 0; i < 300 && order.phase !== AIR_PHASE.lower; i++) h.run(100);
    expect(order.phase).toBe(AIR_PHASE.lower);
    h.host.shutdown();
    h = yard(path);
    const restored = h.host.airSupport;
    h.run(300);
    expect(restored.calls.get(order.id)?.phase).toBe(AIR_PHASE.outbound);
    expect(restored.calls.get(order.id)?.loaded).toBe(true);
    expect(restored.racks.size).toBe(0);
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
