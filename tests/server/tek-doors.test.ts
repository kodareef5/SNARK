import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { RESULT_DENIED, RESULT_OBSTRUCTED, RESULT_OK, RESULT_PIN } from "../../shared/net/protocol.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { SOUTH, join, start } from "../fixtures/slots.ts";

function scene(dbPath?: string, modules?: readonly ModuleDef[]) {
  const h = new Harness({}, 1, 60, { dev: true, dbPath, modules });
  const owner = h.join("owner"), guest = h.join("guest");
  h.run(400);
  const world = h.world, g = flatGround(h, 14, 14);
  const kind = (s: string) => h.reg.index.get("core:" + s)!;
  const builder = h.host.records.byPid.get(h.client(owner)!.pid)!;
  const base = start(world, kind("foundation_metal"), g.x + 6, g.y, g.z + 6, 0, builder.team);
  const jamb = join(world, base, kind("doorframe_metal"), SOUTH);
  const ref = join(world, jamb, kind("door_tek"), 0, 0, 6900);
  expect(ref).toBeGreaterThanOrEqual(0);
  const slot = ref & 65535, row = world.structs.chunks[ref >>> 16]!;
  frameOf(row.yaw[slot]!, row.twAt(slot));
  const c = frame.cos, s = frame.sin, x = row.x[slot]!, y = row.y[slot]!, z = row.z[slot]!;
  const stand = (who: typeof owner, u: number, v: number) => world.ents.setPosition(h.ent(who), x + c * u + s * v, y - h.reg.halfY[kind("door_tek")]! + .05, z - s * u + c * v);
  const leaf = () => h.reg.ids[row.kind[slot]!]!;
  return { h, owner, guest, world, builder, ref, slot, row, kind, stand, leaf, x, y, z, c, s };
}

test("a Tek leaf in a Metal frame admits its tribe from either side", () => {
  const { h, owner, guest, ref, stand, leaf, builder, row, slot } = scene();
  const visitor = h.host.records.byPid.get(h.client(guest)!.pid)!;
  const fixture = h.host.fixtures.ensure(ref);
  fixture.pin = 3654;
  stand(owner, 0, -3);
  stand(guest, 0, -1.7);
  h.run(450);
  expect(leaf()).toBe("core:door_tek");
  stand(guest, 3, -3);
  stand(owner, 0, -1.65);
  h.run(350);
  expect([leaf(), fixture.kind, fixture.pin, row.owner[slot], row.hp[slot]]).toEqual(["core:door_open_tek", row.kind[slot], 3654, builder.team, 6900]);
  expect(owner.world!.structs.chunks[ref >>> 16]!.kind[slot]).toBe(row.kind[slot]!);
  h.run(2500);
  expect(leaf()).toBe("core:door_open_tek");
  stand(owner, 0, -4);
  h.run(1600);
  expect(leaf()).toBe("core:door_open_tek");
  h.run(750);
  expect(leaf()).toBe("core:door_tek");
  expect(h.host.tribes.create(builder, "Copper")).toBe("");
  expect(h.host.tribes.invite(builder, visitor, true)).toBe("");
  expect(h.host.tribes.accept(visitor)).toBe("");
  stand(guest, .1, 1.75);
  h.run(400);
  expect(leaf()).toBe("core:door_open_tek");
  h.host.shutdown();
});

test("a solid wall prevents a nearby owner's sensor from opening the door", () => {
  const { h, owner, world, kind, stand, leaf, x, y, z, c, s, row, slot } = scene();
  const block = world.structs.add(kind("wall_metal"), x - s * .7, y, z - c * .7, row.yaw[slot]!, 0, 100);
  stand(owner, 0, -1.7);
  h.run(500);
  expect(leaf()).toBe("core:door_tek");
  world.structs.remove(block);
  h.run(500);
  expect(leaf()).toBe("core:door_open_tek");
  h.host.shutdown();
});

test("a stranger in the swing is moved aside and the door shuts", () => {
  const { h, owner, guest, world, stand, leaf, x, z } = scene();
  stand(owner, 0, -1.6);
  h.run(400);
  expect(leaf()).toBe("core:door_open_tek");
  stand(owner, 0, -4);
  stand(guest, 0, .7);
  const e = h.ent(guest), at = () => [world.ents.x[e]! - x, world.ents.z[e]! - z];
  const [bx, bz] = at();
  h.run(3400);
  expect(leaf()).toBe("core:door_tek");
  const [ax, az] = at();
  expect(Math.hypot(ax - bx, az - bz)).toBeGreaterThan(.2);
  expect(Math.hypot(ax, az)).toBeLessThan(3);
  h.host.shutdown();
});

test("a tribemate in the swing keeps the door open until two clear seconds pass", () => {
  const { h, owner, guest, builder, stand, leaf } = scene();
  const visitor = h.host.records.byPid.get(h.client(guest)!.pid)!;
  expect(h.host.tribes.create(builder, "Copper")).toBe("");
  expect(h.host.tribes.invite(builder, visitor, true)).toBe("");
  expect(h.host.tribes.accept(visitor)).toBe("");
  stand(owner, 0, -1.6);
  h.run(400);
  expect(leaf()).toBe("core:door_open_tek");
  stand(owner, 0, -4);
  stand(guest, 0, .7);
  h.run(3400);
  expect(leaf()).toBe("core:door_open_tek");
  stand(guest, 3, 0);
  h.run(1350);
  expect(leaf()).toBe("core:door_open_tek");
  h.run(900);
  expect(leaf()).toBe("core:door_tek");
  h.host.shutdown();
});

test("manual locking and PINs still work and a hand-shut leaf stays shut", () => {
  const { h, owner, guest, ref, stand, leaf } = scene();
  const fixture = h.host.fixtures.ensure(ref);
  fixture.pin = 3654;
  fixture.lock = 1;
  stand(owner, 0, -4);
  stand(guest, 0, -1.7);
  h.run(350);
  const use = (pin?: number) => h.host.build.use(h.client(guest)!, ref, pin);
  expect(use()).toBe(RESULT_PIN);
  expect(use(1234)).toBe(RESULT_DENIED);
  expect(use(3654)).toBe(RESULT_OK);
  expect(leaf()).toBe("core:door_open_tek");
  stand(guest, 4, 0);
  stand(owner, 0, -1.65);
  h.run(350);
  expect(h.host.build.use(h.client(owner)!, ref)).toBe(RESULT_OK);
  h.run(700);
  expect(leaf()).toBe("core:door_tek");
  stand(owner, 0, -4);
  h.run(400);
  stand(owner, 0, -1.65);
  h.run(400);
  expect(leaf()).toBe("core:door_open_tek");
  h.host.shutdown();
});

test("a saved open leaf resumes its timer and retains its lock and ref", () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), "snark-tek-door-")), dbPath = pathJoin(dir, "door.db");
  try {
    const { h, owner, ref, stand, leaf } = scene(dbPath);
    const fixture = h.host.fixtures.ensure(ref);
    fixture.pin = 3256;
    fixture.lock = 1;
    stand(owner, 0, -1.65);
    h.run(400);
    expect(leaf()).toBe("core:door_open_tek");
    stand(owner, 0, -4);
    h.host.shutdown();
    const back = new Harness({}, 1, 60, { dev: true, dbPath });
    const table = back.world.structs.chunks[ref >>> 16]!;
    back.run(500);
    expect(back.reg.ids[table.kind[ref & 65535]!]).toBe("core:door_open_tek");
    back.run(2000);
    expect([back.reg.ids[table.kind[ref & 65535]!], back.host.fixtures.find(ref)?.pin, back.host.fixtures.locked(ref)])
      .toEqual(["core:door_tek", 3256, true]);
    back.host.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a build veto can hold the automatic door shut", () => {
  let denied = true, sawOwner = 0;
  const { h, owner, stand, leaf } = scene(undefined, [{ name: "door_test", api: 1, setup(m) {
    m.on("structure.act", e => {
      if (denied && e.data.action === "use") {
        sawOwner = Number(e.data.byPid);
        e.refuse("door offline");
      }
    });
  } }]);
  stand(owner, 0, -1.65);
  h.run(400);
  expect([sawOwner, leaf()]).toEqual([h.client(owner)!.pid, "core:door_tek"]);
  denied = false;
  h.run(400);
  expect(leaf()).toBe("core:door_open_tek");
  h.host.shutdown();
});

test("ordinary doors and Tek hatches and gates stay manual", () => {
  const { h, owner, world, kind, stand, leaf, ref } = scene();
  stand(owner, 0, -1.65);
  for (const name of ["door_metal", "trapdoor_tek", "gate_tek"]) {
    const shut = kind(name);
    expect(shut).toBeGreaterThan(0);
    world.structs.swap(ref, shut);
    h.run(300);
    expect(leaf()).toBe("core:" + name);
    const open = h.reg.opens[shut]!;
    world.structs.swap(ref, open);
    h.run(2200);
    expect(leaf()).toBe(h.reg.ids[open]);
  }
  h.host.shutdown();
});

test("an owner shuts an ordinary door on a stranger in the doorway, and not on a tribemate", () => {
  const { h, owner, guest, builder, world, kind, stand, leaf, ref } = scene();
  const shut = kind("door_metal"), open = h.reg.opens[shut]!;
  world.structs.swap(ref, open);
  stand(owner, 0, -3);
  stand(guest, 0, 0);
  expect(h.host.build.use(h.client(owner)!, ref)).toBe(RESULT_OK);
  expect(leaf()).toBe("core:door_metal");
  world.structs.swap(ref, open);
  const visitor = h.host.records.byPid.get(h.client(guest)!.pid)!;
  expect(h.host.tribes.create(builder, "Copper")).toBe("");
  expect(h.host.tribes.invite(builder, visitor, true)).toBe("");
  expect(h.host.tribes.accept(visitor)).toBe("");
  stand(guest, 0, 0);
  expect(h.host.build.use(h.client(owner)!, ref)).toBe(RESULT_OBSTRUCTED);
  expect(leaf()).toBe(h.reg.ids[open]!);
  h.host.shutdown();
});

test("a blocked door leaves strangers in the doorway where they stand", () => {
  const { h, owner, guest, world, kind, stand, ref } = scene();
  const open = kind("door_open_metal");
  world.structs.swap(ref, open);
  stand(owner, .25, 0);
  stand(guest, 0, 0);
  const e = h.ent(guest), position = () => [world.ents.x[e], world.ents.z[e]];
  const before = position();
  expect(h.host.build.use(h.client(owner)!, ref)).toBe(RESULT_OBSTRUCTED);
  expect(position()).toEqual(before);
  h.host.shutdown();
});
