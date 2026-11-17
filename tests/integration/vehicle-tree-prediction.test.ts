import { expect, test } from "bun:test";
import { PredictedTrees } from "../../client/core/vehicle-trees.ts";
import { COMPACT_VEHICLE } from "../../content/vehicles/compact.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { Body } from "../../shared/sim/character.ts";
import { stepVehicleBody } from "../../shared/sim/vehicle-body.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

function mapOf() {
  const first = new Uint32Array(17); for (let i = 7; i < 17; i++) first[i] = 1;
  return writeMap(flatMap(4, { nodes: [{ kinds: ["core:tree"], first, kind: new Uint8Array([0]), x: new Uint16Array([24 * 1024]), z: new Uint16Array([28 * 1024]), yaw: new Uint16Array([0]) }],
    spawns: [{ name: "Driver", x: 152, z: 30, yaw: 0 }] }));
}

for (const rtt of [0, 80, 150]) test(`the actual driver predicts first-tree fracture at ${rtt}ms RTT without a local stop or snap`, () => {
  const h = new Harness({}, 2, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: mapOf() });
  try {
    const s = h.join("tree-driver", { tcp: true, latencyMs: rtt / 2, jitterMs: 10 }); h.run(4000);
    const c = h.client(s)!, a = h.world.ents, car = h.host.spawnVehicle("core:compact", 152, 30, 0);
    a.setPosition(c.ent, 153.6, 0, 30.12); h.world.history.discontinuity(c.ent);
    expect(h.host.urban.mount(c, car)).toBe(RESULT_OK); h.run(2500); expect(s.driving).toBe(car);
    let impact = -1, peakRaw = 0, peakRendered = 0, slowest = Infinity, prematureEffects = 0, confirmedEffects = 0, stepsPast = 0;
    const observed = s as unknown as { reconcile(tick: number, body: Body): void }, reconcile = observed.reconcile.bind(s);
    observed.reconcile = (tick, body) => {
      const sim = s.simTick, x = s.own.x, y = s.own.y, z = s.own.z, sx = s.smoothX, sy = s.smoothY, sz = s.smoothZ;
      reconcile(tick, body);
      if (tick >= sim || body.z < 87 || body.z > 112) return;
      peakRaw = Math.max(peakRaw, Math.hypot(s.own.x - x, s.own.y - y, s.own.z - z));
      peakRendered = Math.max(peakRendered, Math.hypot(s.own.x + s.smoothX - x - sx, s.own.y + s.smoothY - y - sy, s.own.z + s.smoothZ - z - sz));
    };
    s.onNode = (chunk, index, used, crushed) => {
      if (chunk !== 6 || index !== 0 || !used || !crushed) return;
      confirmedEffects++; if (!h.host.harvest!.crushed(6, 0)) prematureEffects++;
    };
    for (let ms = 0; ms < 13000 && (impact < 0 || h.world.tick < impact + 60); ms += 50) h.run(50, () => {
      const v = Math.hypot(s.own.vx, s.own.vz), pilot = h.pilots[0]!; pilot.moveZ = v < 19.7 ? 1 : v > 20.3 ? 0 : .35;
      if (s.own.z >= 89.7 && s.own.z < 99) { slowest = Math.min(slowest, v); stepsPast++; }
      if (impact < 0 && h.host.harvest!.crushed(6, 0)) impact = h.world.tick;
    });
    expect(impact).toBeGreaterThan(0); expect(stepsPast).toBeGreaterThan(10); expect(slowest).toBeGreaterThan(15);
    expect(peakRaw).toBeLessThan(.01); expect(peakRendered).toBeLessThan(.01);
    expect(a.z[car]!).toBeGreaterThan(112); expect(confirmedEffects).toBe(1); expect(prematureEffects).toBe(0);
    expect(s.nodeField!.store.chunks[6]!.kind[0]).toBe(0);
  } finally { h.host.shutdown(); }
});

test("the same delayed driver can crush a tree and strike the parked car immediately behind it", () => {
  const h = new Harness({}, 11, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: mapOf() });
  try {
    const driver = h.join("tree-and-car", { tcp: true, latencyMs: 75, jitterMs: 10 });
    h.run(4000);
    const client = h.client(driver)!, ents = h.world.ents;
    const car = h.host.spawnVehicle("core:compact", 152, 30);
    const target = h.host.spawnVehicle("core:compact", 152, 95.4);
    expect(target).toBeGreaterThanOrEqual(0);
    ents.setPosition(client.ent, 153.6, 0, 30.12);
    h.world.history.discontinuity(client.ent);
    expect(h.host.urban.mount(client, car)).toBe(RESULT_OK);
    h.run(2500);
    const harvest = h.host.harvest!, urban = h.host.urban;
    let fracture = -1, impact = -1, sawTarget = false;
    const pair = urban.collisionPair.bind(urban);
    urban.collisionPair = event => {
      if (impact < 0 && ((event.a.entity === car && event.b.entity === target) || (event.b.entity === car && event.a.entity === target))) {
        impact = event.tick;
        expect(harvest.crushed(6, 0)).toBe(true);
      }
      pair(event);
    };
    const targetHandle = makeHandle(target, ents.gen[target]!);
    h.run(8500, () => {
      h.pilots[0]!.moveZ = impact < 0 ? 1 : 0;
      if (fracture < 0 && harvest.crushed(6, 0)) fracture = h.world.tick;
      if (driver.vehicleContacts?.stats.lastTarget === targetHandle) sawTarget = true;
    });
    expect(fracture).toBeGreaterThan(0);
    expect(impact).toBeGreaterThanOrEqual(fracture);
    expect(impact - fracture).toBeLessThan(6);
    expect(sawTarget).toBe(true);
    expect(ents.z[target]!).toBeGreaterThan(97.4);
    expect(driver.nodeField!.store.chunks[6]?.kind[0] ?? 0).toBe(0);
    expect(driver.driving).toBe(car);
    expect(h.server.stats.faults).toBe(0);
  } finally { h.host.shutdown(); }
});

test("driver-only tree speculation survives replay, spends resistance again, and expires on rejection or vehicle generation change", () => {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: mapOf() });
  try {
    const field = h.world.nodeField!; h.host.harvest!.retain(6, 0, 1);
    const overlay = new PredictedTrees(h.world, h.reg, field), original = new Body();
    original.kind = h.reg.index.get("core:compact")!; original.vehicle = true; original.x = 152; original.y = 0; original.z = 89.7; original.vz = 20; original.fuel = 40;
    const handle = makeHandle(4, 1), first = new Body(), replay = new Body(), remote = new Body();
    first.copy(original); overlay.begin(100, handle); stepVehicleBody(h.world, first, 0, 0, 0, COMPACT_VEHICLE, undefined, undefined, true, overlay);
    expect(first.vz).toBeGreaterThan(15); expect(first.vz).toBeLessThan(18); expect(first.z).toBeGreaterThan(90);
    expect(field.store.chunks[6]!.kind[0]).toBeGreaterThan(0); expect(h.host.harvest!.goneCount).toBe(0);
    // Remote physics and rendering retain the solid tree until authority actually depletes it.
    remote.copy(original); stepVehicleBody(h.world, remote, 0, 0, 0, COMPACT_VEHICLE); expect(remote.vz).toBeLessThan(1);
    overlay.begin(101, handle); replay.copy(original); overlay.begin(100, handle);
    stepVehicleBody(h.world, replay, 0, 0, 0, COMPACT_VEHICLE, undefined, undefined, true, overlay);
    expect(replay.equals(first)).toBe(true);
    // A corrected timeline reaches the tree too slowly: rewinding must restore solid resistance, with no resource mutation.
    replay.copy(original); replay.vz = 4; overlay.begin(100, handle);
    stepVehicleBody(h.world, replay, 0, 0, 0, COMPACT_VEHICLE, undefined, undefined, true, overlay); expect(replay.vz).toBeLessThan(1);
    for (const expire of ["rejected", "timeout", "generation"] as const) {
      first.copy(original); overlay.begin(200, handle); stepVehicleBody(h.world, first, 0, 0, 0, COMPACT_VEHICLE, undefined, undefined, true, overlay);
      if (expire === "rejected") overlay.acknowledge(203);
      overlay.begin(expire === "timeout" ? 216 : 201, expire === "generation" ? makeHandle(4, 2) : handle);
      replay.copy(original); replay.vz = 4;
      stepVehicleBody(h.world, replay, 0, 0, 0, COMPACT_VEHICLE, undefined, undefined, true, overlay);
      expect(replay.vz).toBeLessThan(1);
    }
    expect(field.store.chunks[6]!.kind[0]).toBeGreaterThan(0); expect(h.host.harvest!.goneCount).toBe(0);
  } finally { h.host.shutdown(); }
});
