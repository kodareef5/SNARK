import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import type { ModuleDef } from "../../server/api/module.ts";
import { CMD_STRUCT, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { frame, frameOf } from "../../shared/world/frame.ts";
import { capsuleKind } from "../../shared/world/collide.ts";
import { STRUCT_TEK_DOOR, STRUCT_TEK_SOLID } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { set, start } from "../fixtures/slots.ts";

function yard(dbPath?: string, modules?: readonly ModuleDef[]) {
  const h = new Harness({}, 1, 60, { dev: true, dbPath, modules }), w = h.world;
  const owner = h.join("owner"), guest = h.join("guest");
  h.run(400);
  const id = (name: string) => h.reg.index.get("core:" + name)!;
  const solid = id("wall_tek"), door = id("phase_wall_tek"), open = id("phase_wall_open_tek");
  const who = h.host.records.byPid.get(h.client(owner)!.pid)!;
  const g = flatGround(h, 20, 20), foundation = id("foundation_metal");
  const base = start(w, foundation, g.x + 10, g.y, g.z + 10, 5137, who.team);
  const fr = w.structs.frameAt(base);
  for (const i of [-1, 3, 5]) set(w, fr, foundation, i, 1);
  const wall = (i: number, level = 0, k = door, turn = 0) => {
    const r = set(w, fr, k, i, 0, level, turn, 7777);
    expect(r).toBeGreaterThanOrEqual(0);
    return r;
  };
  const row = (r: number) => w.structs.chunks[r >>> 16]!;
  const kind = (r: number) => row(r).kind[r & 65535]!;
  const stand = (s: ClientSession, r: number, across: number, depth: number) => {
    const t = row(r), i = r & 65535;
    frameOf(t.yaw[i]!, t.twAt(i));
    w.ents.setPosition(h.ent(s), t.x[i]! + frame.cos * across + frame.sin * depth, t.y[i]! - 1.48, t.z[i]! - frame.sin * across + frame.cos * depth);
  };
  const act = (s: ClientSession, r: number, action: number): number => {
    let code = -1;
    const seq = s.command(CMD_STRUCT, b => { b.u32(r); b.u8(action); });
    s.onResult = (n, c) => { if (n === seq) code = c; };
    h.run(180);
    return code;
  };
  return { h, w, id, owner, guest, who, wall, base, fr, kind, row, stand, act, solid, door, open };
}

test("one authorized approach opens a rotated horizontal and vertical aperture", () => {
  const y = yard(), { h, owner, guest, door, open, solid, wall, stand, kind } = y;
  const a = wall(1), b = wall(3, 0, door, 6), c = wall(3, 4), fixed = wall(-1, 0, solid), corner = set(y.w, y.fr, door, 4, 1, 0, 3);
  const kinds = () => [a, b, c, fixed, corner].map(kind);
  stand(owner, a, 0, -4);
  stand(guest, a, 0, -1.7);
  h.run(350);
  expect(kinds()).toEqual([door, door, door, solid, door]);
  stand(owner, a, -1, -1.8);
  h.run(350);
  expect(kinds()).toEqual([open, open, open, solid, door]);
  const row = y.row(b), i = b & 65535;
  expect([row.hp[i], row.owner[i], y.w.structs.frameAt(b)]).toEqual([7777, y.who.team, y.fr]);
  const stamps = [a, b, c].map(ref => y.row(ref).phaseTick?.get(ref & 65535));
  expect(stamps[0]).toBeGreaterThan(0);
  expect(stamps).toEqual([stamps[0], stamps[0], stamps[0]]);
  const delivered = [a, b, c].map(ref => owner.world!.structs.chunks[ref >>> 16]!.phaseTick?.get(ref & 65535));
  expect(delivered).toEqual(stamps);
  expect(owner.world!.structs.chunks[c >>> 16]!.kind[c & 65535]).toBe(open);
  const hit = (k: number) => capsuleKind(h.reg.parts, k, row.x[i]!, row.y[i]!, row.z[i]!, row.yaw[i]!, row.twAt(i), row.x[i]!, row.y[i]! - 1.4, row.z[i]!, .3, 1.6, 0);
  expect([hit(open), hit(door)]).toEqual([false, true]);
  stand(owner, a, 0, -6);
  stand(guest, b, 0, .12);
  h.run(2700);
  // A stranger standing in the opening does not hold it: it is moved aside, and the field reforms clear of it.
  expect(kinds()).toEqual([door, door, door, solid, door]);
  const e = h.ent(guest), ents = y.w.ents;
  const inWall = () => capsuleKind(h.reg.parts, door, row.x[i]!, row.y[i]!, row.z[i]!, row.yaw[i]!, row.twAt(i), ents.x[e]!, ents.y[e]!, ents.z[e]!, h.reg.bodyRadius[ents.kind[e]!]!, h.reg.bodyHeight[ents.kind[e]!]!, 0);
  expect(inWall()).toBe(false);
  expect(Math.hypot(ents.x[e]! - row.x[i]!, ents.z[e]! - row.z[i]!)).toBeLessThan(1.5);
  const member = h.host.records.byPid.get(h.client(guest)!.pid)!;
  expect(h.host.tribes.create(y.who, "Aperture")).toBe("");
  expect(h.host.tribes.invite(y.who, member, true)).toBe("");
  expect(h.host.tribes.accept(member)).toBe("");
  stand(guest, b, 0, 1.6);
  h.run(400);
  expect(kind(c)).toBe(open);
  // A tribemate standing in it holds it, until two clear seconds after it leaves.
  stand(guest, b, 0, .12);
  h.run(2700);
  expect([a, b, c].map(kind)).toEqual([open, open, open]);
  expect(inWall()).toBe(true);
  stand(guest, b, 0, 4);
  h.run(1450);
  expect(kind(a)).toBe(open);
  h.run(850);
  expect(kinds()).toEqual([door, door, door, solid, door]);
  h.host.shutdown();
});

test("setting a wall mode checks permission, sight, range and occupied space", () => {
  const { h, w, id, owner, guest, wall, kind, stand, act, base, solid, door, open, row } = yard();
  const a = wall(1, 0, solid), i = a & 65535, t = row(a);
  stand(owner, a, 0, -7);
  stand(guest, a, 0, -2.8);
  expect(act(owner, a, STRUCT_TEK_DOOR)).toBe(RESULT_FAR);
  expect(act(guest, a, STRUCT_TEK_DOOR)).toBe(RESULT_NOT_YOURS);
  stand(owner, a, 0, -3);
  frameOf(t.yaw[i]!, t.twAt(i));
  const mask = w.structs.add(id("wall_metal"), t.x[i]! - frame.sin, t.y[i]!, t.z[i]! - frame.cos, t.yaw[i]!, 0, 100);
  expect(act(owner, a, STRUCT_TEK_DOOR)).toBe(RESULT_FAR);
  w.structs.remove(mask);
  expect(act(owner, base, STRUCT_TEK_DOOR)).toBe(RESULT_INVALID);
  expect(act(owner, a, STRUCT_TEK_DOOR)).toBe(RESULT_OK);
  expect(act(owner, a, STRUCT_TEK_DOOR)).toBe(RESULT_OK);
  expect(kind(a)).toBe(door);
  expect(t.phaseTick?.get(i)).toBeUndefined();
  stand(owner, a, 0, -1.5);
  h.run(350);
  expect(kind(a)).toBe(open);
  const began = t.phaseTick!.get(i)!;
  stand(guest, a, 0, 0);
  expect(act(owner, a, STRUCT_TEK_SOLID)).toBe(RESULT_OBSTRUCTED);
  expect(kind(a)).toBe(open);
  stand(guest, a, 0, 4);
  expect(act(owner, a, STRUCT_TEK_SOLID)).toBe(RESULT_OK);
  expect(act(owner, a, STRUCT_TEK_SOLID)).toBe(RESULT_OK);
  expect(kind(a)).toBe(solid);
  expect(t.phaseTick!.get(i)).toBeGreaterThan(began);
  h.host.shutdown();
});

test("adding and removing a bridge joins and splits only its active wall", () => {
  const { h, w, owner, wall, kind, stand, act, solid, door, open } = yard();
  const a = wall(-1), bridge = wall(1, 0, solid), b = wall(3);
  stand(owner, a, 0, -1.65);
  h.run(400);
  expect([kind(a), kind(bridge), kind(b)]).toEqual([open, solid, door]);
  expect(act(owner, bridge, STRUCT_TEK_DOOR)).toBe(RESULT_OK);
  expect([kind(a), kind(bridge), kind(b)]).toEqual([open, open, open]);
  w.structs.damage(bridge, 10000);
  h.run(2500);
  expect([kind(a), kind(bridge), kind(b)]).toEqual([open, 0, door]);
  h.host.shutdown();
});

test("a veto on one field cell holds the whole opening or closure", () => {
  let refuse = -1;
  const { h, owner, wall, kind, stand, door, open } = yard(undefined, [{ name: "tek_test", api: 1, setup(m) {
    m.on("structure.act", e => { if (e.data.action === "use" && e.data.ref === refuse) e.refuse("hold"); });
  }}]);
  const a = wall(1), b = wall(3);
  refuse = b;
  stand(owner, a, 0, -1.5);
  h.run(400);
  expect([kind(a), kind(b)]).toEqual([door, door]);
  refuse = -1;
  h.run(400);
  expect([kind(a), kind(b)]).toEqual([open, open]);
  refuse = a;
  stand(owner, a, 0, -4);
  h.run(2500);
  expect([kind(a), kind(b)]).toEqual([open, open]);
  refuse = -1;
  h.run(2500);
  expect([kind(a), kind(b)]).toEqual([door, door]);
  h.host.shutdown();
});

test("a saved open aperture recovers at the same refs and closes together", () => {
  const path = mkdtempSync(pathJoin(tmpdir(), "snark-phase-wall-")), dbPath = pathJoin(path, "world.db");
  try {
    const { h, owner, wall, kind, stand, open, door } = yard(dbPath);
    const a = wall(1), b = wall(3);
    stand(owner, a, 0, -1.65);
    h.run(450);
    expect(kind(b)).toBe(open);
    stand(owner, a, 0, -5);
    h.host.shutdown();
    const back = new Harness({}, 1, 60, { dev: true, dbPath });
    const kinds = () => [a, b].map(r => back.world.structs.chunks[r >>> 16]!.kind[r & 65535]);
    back.run(600);
    expect(kinds()).toEqual([open, open]);
    back.run(1800);
    expect(kinds()).toEqual([door, door]);
    const stamps = [a, b].map(r => back.world.structs.chunks[r >>> 16]!.phaseTick?.get(r & 65535));
    expect(stamps[0]).toBeGreaterThan(0);
    expect(stamps[0]).toBe(stamps[1]);
    back.host.shutdown();
  } finally { rmSync(path, { recursive: true, force: true }); }
});

test("a vehicle's nose holds every cell open after its owner leaves", () => {
  const { h, w, owner, who, wall, kind, stand, row, door, open } = yard();
  const a = wall(1), b = wall(3);
  stand(owner, a, 0, -1.6);
  h.run(350);
  const t = row(b), i = b & 65535;
  frameOf(t.yaw[i]!, t.twAt(i));
  const car = h.host.spawnVehicle("core:compact", t.x[i]! - 1.65 * frame.sin, t.z[i]! - 1.65 * frame.cos, who.team, Math.atan2(frame.sin, frame.cos));
  expect(car).toBeGreaterThanOrEqual(0);
  stand(owner, a, 0, -5);
  h.run(2700);
  expect([kind(a), kind(b)]).toEqual([open, open]);
  w.ents.setPosition(car, t.x[i]! + 12, t.y[i]!, t.z[i]! + 12);
  h.run(2600);
  expect([kind(a), kind(b)]).toEqual([door, door]);
  h.host.shutdown();
});

test("a held aperture reuses its links between topology edits", () => {
  const { h, w, owner, wall, kind, stand, open } = yard();
  const a = wall(-1), b = wall(1), c = wall(3), d = wall(5);
  stand(owner, a, 0, -1.5);
  h.run(350);
  expect([a, b, c, d].map(kind)).toEqual([open, open, open, open]);
  let lookups = 0;
  const refAt = w.structs.refAt.bind(w.structs);
  w.structs.refAt = (fr, k0, k1) => { lookups++; return refAt(fr, k0, k1); };
  for (let i = 0; i < 15; i++) { w.tick++; h.host.build.step(); }
  expect(lookups).toBe(0);
  h.host.shutdown();
});
