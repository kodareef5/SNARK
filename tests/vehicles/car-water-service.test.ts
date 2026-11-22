import { expect, test } from "bun:test";
import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { makeHandle } from "../../shared/ids.ts";
import { RESULT_BUSY, RESULT_OK } from "../../shared/net/protocol.ts";
import { MODE_SWIM } from "../../shared/sim/character.ts";
import { F_GROUNDED } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../fixtures/net.ts";
import { flatMap } from "../fixtures/map.ts";
import { capsuleFree } from "../../shared/world/collide.ts";

function camp() {
  const h = new Harness({}, 1, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: writeMap(flatMap(2)) });
  const s = h.join("car-mechanic"); h.run(400);
  const c = h.client(s)!, actor = h.host.records.byPid.get(c.pid)!, ents = h.world.ents;
  ents.setPosition(c.ent, 65.8, 0, 64);
  h.world.history.discontinuity(c.ent);
  const e = h.host.spawnVehicle("core:compact", 64, 64, actor.team), v = ents.vrow[e]!;
  return { h, s, c, actor, ents, e, v, handle: makeHandle(e, ents.gen[e]!) };
}

test("a flooded car must be recovered before repair spends resources or restores engine condition", () => {
  const { h, c, actor, ents, e, v, handle } = camp();
  try {
    const materials = ["core:ingot", "core:polymer", "core:electronics"].map(name => h.reg.index.get(name)!);
    for (const item of materials) h.host.items.mint(actor, item, 100);
    const inv = h.host.items.inv(actor), before = materials.map(item => inv.total(item));
    ents.vehicleEngineCondition[v] = 0; ents.vehicleEngineOn[v] = 0; ents.vehicleFlooding[v] = 1;
    h.world.hf.seaLevel = 3;
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_BUSY);
    expect(materials.map(item => inv.total(item))).toEqual(before);
    expect(ents.vehicleEngineCondition[v]).toBe(0);
    h.world.hf.seaLevel = -1;
    ents.flags[e] = ents.flags[e]! | F_GROUNDED; ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    expect(h.host.vehicles.repair(c, handle)).toBe(RESULT_OK);
    expect(ents.vehicleEngineCondition[v]).toBeCloseTo(.25, 6);
    expect(ents.vehicleFlooding[v]).toBeCloseTo(.75, 6);
    expect(materials.every((item, i) => inv.total(item) < before[i]!)).toBe(true);
    expect(h.host.items.audit()).toEqual([]);
  } finally { h.host.shutdown(); }
});

test("a car occupant can escape locally at depth while preserving sinking velocity", () => {
  const { h, c, ents, e, v } = camp();
  try {
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1200);
    expect(c.drive).toBe(e);
    h.world.hf.seaLevel = 8; ents.setPosition(e, 64, 1, 64); ents.flags[e] = ents.flags[e]! & ~F_GROUNDED;
    ents.vx[e] = 2; ents.vy[e] = -1; ents.vehicleEngineOn[v] = 0; ents.vehicleEngineCondition[v] = 0;
    h.host.urban.syncAfterContact(e);
    h.host.urban.dismount(c);
    const pending = h.host.urban.occupancy.pending(c.pid)!; expect(pending).not.toBeNull();
    h.world.tick = pending.dueAt; h.host.urban.beforeStep();
    expect(c.drive).toBe(-1); expect(ents.mode[c.ent]).toBe(MODE_SWIM);
    expect(ents.y[c.ent]!).toBeLessThan(3);
    expect([ents.vx[c.ent], ents.vy[c.ent], ents.vz[c.ent]]).toEqual([2, -1, 0]);
  } finally { h.host.shutdown(); }
});

for (const depth of [.5, 8]) test(`a car resting on the bottom in ${depth}m water permits a clear local exit`, () => {
  const { h, c, ents, e, v } = camp();
  try {
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1200);
    h.world.hf.seaLevel = depth;
    ents.setPosition(e, 64, 0, 64); ents.flags[e] = ents.flags[e]! | F_GROUNDED;
    ents.vx[e] = ents.vy[e] = ents.vz[e] = 0;
    ents.vehicleEngineOn[v] = 0; ents.vehicleEngineCondition[v] = 0; ents.vehicleFlooding[v] = 1;
    h.host.urban.syncAfterContact(e);
    h.host.urban.dismount(c);
    const pending = h.host.urban.occupancy.pending(c.pid); expect(pending).not.toBeNull();
    h.world.tick = pending!.dueAt; h.host.urban.beforeStep();
    expect(c.drive).toBe(-1); expect(ents.seat[c.ent]).toBe(0);
    expect(ents.y[c.ent]!).toBeLessThan(1); // No escape teleport to the surface of deep water.
    const move = h.reg.move[ents.kind[c.ent]!]!;
    expect(capsuleFree(h.world, ents.x[c.ent]!, ents.y[c.ent]!, ents.z[c.ent]!, move.radius, move.height)).toBe(true);
  } finally { h.host.shutdown(); }
});

test("exiting on the far side of a flooded car keeps the survivor clear through the next contact steps", () => {
  const { h, c, ents, e, v } = camp();
  try {
    expect(h.host.urban.mount(c, e)).toBe(RESULT_OK); h.run(1500);
    const wall = h.reg.index.get("core:wall_stone")!;
    for (const z of [62.5, 65.5]) h.world.structs.add(wall, 65.05, 1.5, z, 16384, 0, 10000);
    h.world.hf.seaLevel = 2;
    ents.vehicleFlooding[v] = 1; ents.vehicleEngineCondition[v] = 0;
    h.host.urban.syncAfterContact(e); h.run(1500);
    const start = ents.x[e]!;
    h.host.urban.dismount(c); h.run(1500);
    expect(c.drive).toBe(-1);
    expect(ents.x[c.ent]!).toBeLessThan(start - 1.4);
    expect(ents.x[e]!).toBeCloseTo(start, 2);
  } finally { h.host.shutdown(); }
});
