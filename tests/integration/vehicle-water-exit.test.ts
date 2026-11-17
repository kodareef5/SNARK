import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { isRotorVehicle } from "../../shared/sim/vehicle.ts";
import { helicopterMeetsCapsule } from "../../shared/world/helicopter.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";

const MAP = writeMap(flatMap(2));
function boarded() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: MAP });
  const s = h.join("ditched-pilot"); h.run(400);
  const c = h.client(s)!, ents = h.world.ents;
  ents.setPosition(c.ent, 40, 0, 40);
  const e = h.host.spawnVehicle("core:helicopter", 64, 64, 0);
  expect(e).toBeGreaterThanOrEqual(0);
  const def = h.reg.vehicle[ents.kind[e]!]!;
  if (!isRotorVehicle(def)) throw new Error("missing helicopter");
  const entry = def.seats[0]!.entry;
  ents.setPosition(c.ent, 64 + entry[0], entry[1], 64 + entry[2]);
  expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1100);
  expect(c.drive).toBe(e);
  return { h, c, e, ents, def };
}

for (const deep of [false, true]) test(`crew can leave a ${deep ? "submerged helicopter beneath a pier" : "ditched moving helicopter"} by a local clear route`, () => {
  const { h, c, e, ents, def } = boarded();
  try {
    h.world.hf.seaLevel = deep ? 10 : 3;
    ents.setPosition(e, 64, .5, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.vx[e] = 5; ents.vy[e] = -.2;
    h.host.urban.syncAfterContact(e);
    const before = [ents.x[c.ent]!, ents.y[c.ent]!, ents.z[c.ent]!];
    if (deep) {
      const ceiling = h.reg.index.get("core:ceiling")!;
      for (let x = -6; x <= 6; x += 3) for (let z = -6; z <= 6; z += 3) h.world.structs.add(ceiling, 64 + x, 5, 64 + z, 0, 0, 100);
    }
    h.host.urban.dismount(c);
    const pending = h.host.urban.occupancy.pending(c.pid);
    expect(pending).not.toBeNull();
    h.world.tick = pending!.dueAt; h.host.urban.beforeStep();
    expect(c.drive).toBe(-1); expect(ents.seat[c.ent]).toBe(0); expect(ents.mode[c.ent]).toBe(MODE_SWIM);
    expect([ents.vx[c.ent], ents.vy[c.ent], ents.vz[c.ent]]).toEqual([5, Math.fround(-.2), 0]);
    expect(Math.hypot(ents.x[c.ent]! - before[0]!, ents.y[c.ent]! - before[1]!, ents.z[c.ent]! - before[2]!)).toBeLessThanOrEqual(6.4);
    if (deep) expect(ents.y[c.ent]!).toBeLessThan(3);
    const move = h.reg.move[ents.kind[c.ent]!]!;
    expect(helicopterMeetsCapsule(def, { x: 64, y: .5, z: 64, yaw: 0, pitch: 0, roll: 0 },
      ents.x[c.ent]!, ents.y[c.ent]!, ents.z[c.ent]!, move.radius, move.height)).toBeNull();
  } finally { h.host.shutdown(); }
});

test("wet exit rechecks obstructions at commit, and a dry airborne helicopter still refuses ordinary exit", () => {
  const { h, c, e, ents } = boarded();
  try {
    ents.setPosition(e, 64, 12, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    h.host.urban.syncAfterContact(e);
    h.host.urban.dismount(c); h.world.tick += 60; h.host.urban.beforeStep();
    expect(c.drive).toBe(e);
    ents.setPosition(e, 64, .5, 64); h.world.hf.seaLevel = 3;
    h.host.urban.syncAfterContact(e); h.host.urban.dismount(c);
    const pending = h.host.urban.occupancy.pending(c.pid);
    expect(pending).not.toBeNull();
    const before = [ents.x[c.ent], ents.y[c.ent], ents.z[c.ent]], ceiling = h.reg.index.get("core:ceiling")!;
    for (let x = -6; x <= 6; x += 3) for (let z = -6; z <= 6; z += 3) h.world.structs.add(ceiling, 64 + x, ents.y[c.ent]! + .8, 64 + z, 0, 0, 100);
    h.world.tick = pending!.dueAt; h.host.urban.beforeStep();
    expect(c.drive).toBe(e); expect(ents.seat[c.ent]).toBe(e + 1);
    expect([ents.x[c.ent], ents.y[c.ent], ents.z[c.ent]]).toEqual(before);
  } finally { h.host.shutdown(); }
});
