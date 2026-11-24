import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteSample } from "../../client/core/session.ts";
import { ROAD_FLEET } from "../../content/vehicles/road-fleet.ts";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { BTN_PRIMARY, BTN_SECONDARY, stanceEye } from "../../shared/sim/character.ts";
import { withVehicleDoor } from "../../shared/sim/vehicle-body.ts";
import { rayVehicleCover } from "../../shared/sim/vehicle-frame.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";

const def = ROAD_FLEET.find(s => s.id === "core:concept003")!.vehicle!;

test("a door carries its pane out of the opening as it swings", () => {
  const hit = { panel: -1 };
  const frame = { pitch: 0, roll: 0, doors: 0, missingPanels: 0 };
  const cross = (y: number) => rayVehicleCover(def, 0, 0, 0, 0, 1.5, y, .32, -1, 0, 0, frame, hit);
  expect(cross(1.05)).toBeLessThan(1);
  expect(def.breakablePanels![hit.panel]!.bone).toBe("glass_left");
  expect(cross(.58)).toBeLessThan(1);
  expect(def.breakablePanels![hit.panel]!.bone).toBe("door_left");
  frame.doors = withVehicleDoor(0, 0, 1);
  expect(cross(.58)).toBeGreaterThan(2);
  expect(cross(1.05)).toBeGreaterThan(2);
  frame.doors = 0;
  frame.missingPanels = 1 << 6;
  expect(cross(1.05)).toBeGreaterThan(2);
  expect(cross(.58)).toBeLessThan(1);
});

test("shots shatter glass and detach doors for observers and a reloaded car", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-car-panels-"));
  const options = { dev: true, clips: NO_CLIPS, rigs: [], dbPath: join(dir, "world.db") };
  let h = new Harness({}, 5, 60, options);
  try {
    const shooter = h.join("shooter"), observer = h.join("observer");
    h.run(1200);
    h.say(shooter, "enablecheats"); h.say(shooter, "kit pistol");
    h.run(500);
    takeInHand(h, shooter, h.reg.index.get("core:pistol")!);
    h.run(6000);
    const x = h.world.spawn.x, z = h.world.spawn.z - 8;
    h.say(shooter, `tp ${x + 4} ${z + .30}`);
    h.run(500);
    const car = h.host.spawnVehicle(def.id, x, z, 0, 0), ents = h.world.ents;
    const e = h.client(shooter)!.ent, row = ents.vrow[car]!, pid = ents.pid[car]!;
    h.run(400);
    const aim = (y: number, dz: number) => {
      const dx = x + 1.06 - ents.x[e]!, rz = z + dz - ents.z[e]!;
      const eye = ents.y[e]! + stanceEye(h.reg.move[ents.kind[e]!]!, ents.stance[e]!);
      h.pilots[0]!.yaw = Math.atan2(dx, rz);
      h.pilots[0]!.pitch = Math.atan2(ents.y[car]! + y - eye, Math.hypot(dx, rz));
      h.pilots[0]!.buttons = BTN_SECONDARY; h.run(400);
      h.pilots[0]!.buttons |= BTN_PRIMARY; h.run(100);
      h.pilots[0]!.buttons = BTN_SECONDARY; h.run(800);
    };
    h.host.survival.gods.add(pid);
    aim(1.04, .33);
    expect(ents.vehicleMissingPanels[row]).toBe(0);
    h.host.survival.gods.delete(pid);
    aim(1.04, .33);
    expect(ents.vehicleMissingPanels[row]).toBe(1 << 6);
    aim(.58, -.50);
    aim(.58, -.50);
    const mask = (1 << 6) | (1 << 2) | (1 << 8);
    expect(ents.vehicleMissingPanels[row]).toBe(mask);
    const newcomer = h.join("newcomer"); h.run(600);
    for (const session of [shooter, observer, newcomer]) {
      const remote = new RemoteSample();
      session.sampleRemote(remote);
      const i = remote.id.subarray(0, remote.count).indexOf(car);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(remote.vehicleMissingPanels[i]).toBe(mask);
    }
    h.host.urban.hitPanel(car, 3, 40);
    expect(ents.vehicleMissingPanels[row]).toBe(mask);
    h.host.shutdown();
    h = new Harness({}, 5, 60, options);
    const restored = h.world.ents, id = h.host.records.entOf.get(pid)!;
    expect(restored.vehicleMissingPanels[restored.vrow[id]!]).toBe(mask);
    h.host.urban.hitPanel(id, 3, 20);
    expect(restored.vehicleMissingPanels[restored.vrow[id]!]).toBe(mask | (1 << 3) | (1 << 9));
  } finally {
    h.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rewound fire reaches the passenger only after their window broke", () => {
  const h = new Harness({}, 7, 60, { dev: true, clips: NO_CLIPS, rigs: [] });
  try {
    const { world } = h, { ents, history } = world;
    const car = h.host.spawnVehicle(def.id, 100, 100, 0);
    ents.setPosition(car, 100, 0, 100);
    const occupant = ents.create(h.reg.index.get("core:survivor")!, 100, .45, 100, 0);
    ents.seat[occupant] = car + 1; ents.seatGen[occupant] = ents.gen[car]!;
    ents.seatSlot[occupant] = 2; history.track(occupant);
    world.tick = 3; history.record(3);
    const eye = new Float64Array(3);
    expect(h.host.combat.eye(occupant, eye, 3, false)).toBe(true);
    const cast = (tick: number) => h.host.combat.castBodies(-1, eye[0]! - 3, eye[1]!, eye[2]!, 1, 0, 0, 3.1, 0, tick);
    const saved = h.host.combat;
    expect(cast(3)).toBe(car);
    expect(def.breakablePanels![saved.panel]!.bone).toBe("glass_right");
    world.tick = 4;
    h.host.urban.hitPanel(car, saved.panel, 10);
    history.record(4);
    world.tick = 5;
    expect(cast(3)).toBe(car);
    expect(cast(4)).toBe(occupant);
    expect(cast(5)).toBe(occupant);
  } finally { h.host.shutdown(); }
});
