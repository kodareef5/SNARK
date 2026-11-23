import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CargoSpace, offset, towedPose } from "../../server/air-cargo-space.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_BUSY, RESULT_DENIED, RESULT_NOT_YOURS, RESULT_OK } from "../../shared/net/protocol.ts";
import { AIR_ACTION, AIR_PHASE } from "../../shared/sim/air-support.ts";
import { BTN_JUMP } from "../../shared/sim/character.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function yard(dbPath?: string) {
  return new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)), ...(dbPath ? { dbPath } : {}) });
}

function board(h: Harness) {
  const s = h.join("dispatcher"); h.run(500);
  const c = h.client(s)!, e = h.host.spawnVehicle("core:semi", 59, 53, 0, 0), a = h.world.ents;
  const def = h.reg.vehicle[a.kind[e]!]!, door = [0, 0, 0];
  h.host.urban.door(e, def.seats[0]!, h.reg.bodyRadius[c.kind]!, door);
  a.setPosition(c.ent, door[0]!, door[1]!, door[2]!);
  expect(h.host.urban.mount(c, e)).toBe(RESULT_OK);
  h.run(1600); expect(c.drive).toBe(e);
  return { s, c, e };
}

test("a moving fifth wheel draws the trailer axle through a turn", () => {
  const tractor = { x: 40, y: 2, z: 53, yaw: 0 };
  const old = towedPose(tractor);
  const next = { ...tractor, x: 40.16, z: 53.8, yaw: .13 };
  const trailer = towedPose(next, old), pin = offset(trailer, 0, 0, 3.75), plate = offset(next, 0, 0, -2.6);
  expect(pin.x).toBeCloseTo(plate.x, 8);
  expect(pin.z).toBeCloseTo(plate.z, 8);
  expect(Math.abs(trailer.yaw)).toBeLessThan(next.yaw);
  expect(trailer.yaw).not.toBe(next.yaw);
});

test("a ground delivery keeps its stock as it mounts, rolls and parks", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-air-cargo-")), path = join(dir, "world.db");
  let h = yard(path);
  try {
    const { c, s, e } = board(h), a = h.world.ents, service = h.host.airSupport;
    const other = h.join("visitor"); h.run(500);
    const outsider = h.client(other)!;
    a.setPosition(outsider.ent, 85, 0, 85);
    expect(service.call(outsider, null)).toBe(RESULT_DENIED);
    const at = towedPose({ x: a.x[e]!, y: a.y[e]!, z: a.z[e]!, yaw: 0 });
    const ground = offset(at, 5.35, 0, 0);
    expect(service.call(c, ground)).toBe(RESULT_OK);
    expect(service.call(c, null)).toBe(RESULT_BUSY);
    const phases = new Set<number>();
    for (let i = 0; i < 350 && !service.racks.size; i++) {
      h.run(100);
      for (const o of service.calls.values()) phases.add(o.phase);
    }
    expect(phases.has(AIR_PHASE.lower)).toBe(true);
    const rack = [...service.racks.values()][0]!;
    expect(rack?.trailer).toBe(false);
    expect(rack.slots).toBe(63);
    const command = (session: typeof s, action: number) => {
      let result = -1;
      session.onResult = (_, code) => { result = code; };
      session.airCommand(action, rack.id, 0); h.run(220); return result;
    };
    a.setPosition(outsider.ent, ground.x + 4, ground.y, ground.z);
    expect(command(other, AIR_ACTION.mount)).toBe(RESULT_NOT_YOURS);
    expect(command(s, AIR_ACTION.mount)).toBe(RESULT_OK);
    expect(rack.hitched).toBe(true);
    expect(h.world.structs.chunks[Math.floor(rack.ref / 65536)]!.kind[rack.ref & 65535]).toBe(h.reg.index.get("core:air_pod_chassis")!);
    const start = rack.z;
    h.pilots[0]!.moveZ = 1; h.run(4300);
    expect(rack.z).toBeGreaterThan(start + 4);
    h.pilots[0]!.moveZ = 0;
    h.pilots[0]!.buttons = BTN_JUMP;
    h.run(6000);
    expect(command(s, AIR_ACTION.unhitch)).toBe(RESULT_OK);
    expect(rack.hitched).toBe(false);
    const savedAt = rack.z, id = rack.id;
    h.host.shutdown();
    h = yard(path);
    const restored = h.host.airSupport.racks.get(id);
    expect(restored?.z).toBeCloseTo(savedAt);
    expect(restored?.slots).toBe(63);
    expect(restored?.hitched).toBe(false);
  } finally { h.host.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});

test("a roof across the descent leaves the cargo on its departing carrier", () => {
  const h = yard();
  try {
    const { c, e } = board(h), a = h.world.ents, service = h.host.airSupport;
    const at = towedPose({ x: a.x[e]!, y: a.y[e]!, z: a.z[e]!, yaw: 0 });
    const roof = h.reg.index.get("core:ceiling_wood")!;
    expect(h.world.structs.add(roof, at.x, at.y + 6, at.z, 0, 0, 1000)).toBeGreaterThanOrEqual(0);
    const space = new CargoSpace(h.world);
    expect(space.clear(at, true, "land", -1, e)).toBe(false);
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

test("a trailer stops a backing tractor at a wall", () => {
  const h = yard();
  try {
    const { c, e } = board(h), a = h.world.ents, service = h.host.airSupport;
    expect(service.call(c, null)).toBe(RESULT_OK);
    for (let i = 0; i < 250 && !service.racks.size; i++) h.run(100);
    const rack = [...service.racks.values()][0]!;
    expect(rack?.hitched).toBe(true);
    const back = offset(rack, 0, 0, -7.8);
    const wall = h.reg.index.get("core:wall_wood")!;
    h.world.structs.add(wall, back.x, back.y + 1.4, back.z, 0, 0, 1000);
    const before = rack.z;
    h.pilots[0]!.moveZ = -1;
    h.run(8000);
    expect(rack.z).toBeLessThan(before - 1);
    expect(rack.z).toBeGreaterThan(back.z + 3.8);
    expect(a.z[e]! - rack.z).toBeCloseTo(6.35, 1);
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
    for (let i = 0; i < 250 && !service.racks.size; i++) h.run(100);
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
