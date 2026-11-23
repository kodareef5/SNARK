import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { AIR_PHASE } from "../../shared/sim/air-support.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

/** Two kilometres of flat ground and a driver in a semi in the middle of it. */
function rig() {
  const h = new Harness({}, 1, 30, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(32)) });
  h.host.setSetting("AirSupportOrderRequired", "False");
  const s = h.join("driver"); h.run(500);
  const c = h.client(s)!, a = h.world.ents, e = h.host.spawnVehicle("core:semi", 1024, 1024, 0, 0);
  const def = h.reg.vehicle[a.kind[e]!]!, door = [0, 0, 0];
  h.host.urban.door(e, def.seats[0]!, h.reg.bodyRadius[c.kind]!, door);
  a.setPosition(c.ent, door[0]!, door[1]!, door[2]!);
  expect(h.host.urban.mount(c, e)).toBe(RESULT_OK);
  h.run(1600);
  return { h, s, c, a, e };
}
const aircraft = (h: Harness, pid: number) => h.host.records.entOf.get(pid) ?? -1;

test("the carrier comes from out of sight, banks and flares, and leaves", () => {
  const { h, c, a } = rig();
  try {
    const service = h.host.airSupport;
    expect(service.call(c, null)).toBe(RESULT_OK);
    const order = [...service.calls.values()][0]!, carrier = aircraft(h, order.carrier);
    expect(Math.hypot(a.x[carrier]! - a.x[c.ent]!, a.z[carrier]! - a.z[c.ent]!)).toBeGreaterThan(900);
    let pitch = 0, roll = 0, fastest = 0;
    for (let i = 0; i < 900 && !service.racks.size; i++) {
      h.run(100);
      const e = aircraft(h, order.carrier), v = a.vrow[e]!;
      pitch = Math.max(pitch, Math.abs(a.vehiclePitch[v]!)); roll = Math.max(roll, Math.abs(a.vehicleRoll[v]!));
      fastest = Math.max(fastest, Math.hypot(a.vx[e]!, a.vz[e]!));
    }
    expect(service.racks.size).toBe(1);
    expect(fastest).toBeGreaterThan(40);
    expect(pitch).toBeGreaterThan(.15);
    expect(roll).toBeLessThan(.5);
    for (let i = 0; i < 900 && service.calls.size; i++) h.run(100);
    expect(service.calls.size).toBe(0);
    expect(h.host.records.byPid.has(order.carrier)).toBe(false);
  } finally { h.host.shutdown(); }
});

test("a carrier shot down drops its trailer, which falls to the ground", () => {
  const { h, c, a } = rig();
  try {
    const service = h.host.airSupport;
    expect(service.call(c, null)).toBe(RESULT_OK);
    const order = [...service.calls.values()][0]!;
    for (let i = 0; i < 600 && order.phase !== AIR_PHASE.follow; i++) h.run(100);
    expect(order.phase).toBe(AIR_PHASE.follow);
    const carrier = h.host.records.byPid.get(order.carrier)!;
    h.host.survival.hurt(carrier, 1e9, 0);
    h.run(500);
    expect(service.calls.size).toBe(0);
    const rack = [...service.racks.values()][0]!;
    expect(rack).toBeDefined();
    const trailer = h.host.records.entOf.get(rack.pid)!;
    h.run(8000);
    expect(a.y[trailer]!).toBeLessThan(1);
    expect(Math.hypot(a.vx[trailer]!, a.vy[trailer]!, a.vz[trailer]!)).toBeLessThan(.5);
  } finally { h.host.shutdown(); }
});

test("a call spends one air freight order, and none when calls are free", () => {
  const { h, c } = rig();
  try {
    const service = h.host.airSupport, me = h.host.records.byPid.get(c.pid)!, paper = h.reg.index.get("core:freight_order")!;
    expect(h.host.setSetting("AirSupportOrderRequired", "True")).toBe("");
    expect(service.call(c, null)).not.toBe(RESULT_OK);
    h.host.items.mint(me, paper, 2);
    expect(service.call(c, null)).toBe(RESULT_OK);
    expect(h.host.items.inv(me).total(paper)).toBe(1);
  } finally { h.host.shutdown(); }
});
