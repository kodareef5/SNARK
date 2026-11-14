// Ways through a wall, into a box or onto a mount that the review of 2026-11-14 found open. Each case was once possible.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { FOUNDATION_THICK } from "../../content/building.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_OPEN, BOX_SELF, CMD_MOVE, CMD_STRUCT, RESULT_FAR, RESULT_LOCKED, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_USE, stanceEye } from "../../shared/sim/character.ts";
import { HIT_STRUCTURE, castWorld, lookDirection, rayHit } from "../../shared/world/ray.ts";
import { frameAxes, poseAt, type Pose } from "../../shared/world/snap.ts";
import { NO_PIN, STRUCT_LOCK, STRUCT_PIN, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;

/** Survivors with cheats on level ground, two metres apart. */
function arena(names: string[], wide = 40, deep = 24) {
  const h = new Harness({}, 1, 60, { dev: true });
  const sessions = names.map((n) => h.join(n));
  h.run(500);
  const g = flatGround(h, wide, deep);
  const at = { x: g.x + wide / 2, y: g.y, z: g.z + deep / 2 };
  sessions.forEach((s, i) => {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(at.x + i * 2).toFixed(3)} ${(at.z - 8).toFixed(3)}`);
  });
  const recs = sessions.map((s) => h.host.records.byPid.get(h.client(s)!.pid)!);
  return { h, sessions, recs, at };
}

function press(h: Harness, s: ClientSession, buttons: number): void {
  const pilot = h.pilots[h.sessions.indexOf(s)]!;
  pilot.buttons = buttons;
  h.run(100);
  pilot.buttons = 0;
  h.run(150);
}

test("a wall built at a turn that leaves its pieces a hair apart is still a wall: the use key and a named use do not reach the box behind where two of its pieces join", () => {
  const { h, sessions, recs, at } = arena(["ada", "bob"]);
  const [, bob] = sessions as [ClientSession, ClientSession];
  const structs = h.world.structs;
  const ents = h.world.ents;
  const team = recs[0]!.team;
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const join = (target: number, piece: string, k: number): number => {
    expect(poseAt(structs, reg, target, id(piece), k, 0, pose)).toBe(true);
    return structs.add(id(piece), pose.x / U, pose.y / U, pose.z / U, pose.yaw, team, 10000);
  };
  const place = (ref: number): [number, number, number] => {
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    return [t.x[ref & 0xffff]!, t.y[ref & 0xffff]!, t.z[ref & 0xffff]!];
  };
  // Of all turns, this one has the longest whole-number frame: joined pieces stood 2.7 mm apart as rays measured them.
  const yaw = 8048;
  const axes = new Int32Array(4);
  frameAxes(yaw, axes);
  const length = Math.hypot(axes[0]!, axes[1]!);
  expect(length).toBeGreaterThan(768.69);
  const [ax, az, nx, nz] = [axes[0]! / length, axes[1]! / length, axes[2]! / length, axes[3]! / length];
  // Ada's two foundations side by side, with a wall along the same edge of each.
  const f1 = structs.add(id("foundation_stone"), at.x, at.y + FOUNDATION_THICK / 2, at.z, yaw, team, 15000);
  const f2 = join(f1, "foundation_stone", 1);
  const walls = [join(f1, "wall_stone", 0), join(f2, "wall_stone", 0)];
  const [x1, , z1] = place(walls[0]!);
  const [x2, , z2] = place(walls[1]!);
  const mx = (x1 + x2) / 2;
  const mz = (z1 + z2) / 2;

  // Bob stands outside, a metre and a half from the wall, straight out from where its two pieces join.
  h.say(bob, `tp ${(mx + nx * 1.5).toFixed(5)} ${(mz + nz * 1.5).toFixed(5)}`, 200);
  const me = h.ent(bob);
  const eye = ents.y[me]! + stanceEye(reg.move[ents.kind[me]!]!, 0);
  // Ada's box stands on the foundation behind the wall, on the line from Bob through the join. It has no lock.
  const back = 1.2 / Math.hypot(mx - ents.x[me]!, mz - ents.z[me]!);
  const top = place(f1)[1] + FOUNDATION_THICK / 2;
  const box = structs.add(id("storage_box"), mx + (mx - ents.x[me]!) * back, top + reg.halfY[id("storage_box")]!, mz + (mz - ents.z[me]!) * back, yaw, team, 500);
  const state = h.host.fixtures.ensure(box);
  expect(h.host.items.mint(state, id("ingot"), 150)).toBe(150);
  expect(h.host.fixtures.locked(box)).toBe(false);
  const [bx, by, bz] = place(box);

  // He looks at the box. His look, as the server will cast it, meets the wall within a third of a millimetre of the join.
  const pilot = h.pilots[1]!;
  pilot.yaw = Math.atan2(bx - ents.x[me]!, bz - ents.z[me]!);
  pilot.pitch = Math.atan2(by - eye, Math.hypot(bx - ents.x[me]!, bz - ents.z[me]!));
  h.run(200);
  const c = h.client(bob)!;
  const d = [0, 0, 0];
  lookDirection(c.heldYaw, c.heldPitch, d);
  expect(castWorld(h.world, ents.x[me]!, eye, ents.z[me]!, d[0]!, d[1]!, d[2]!, 3.5)).toBe(HIT_STRUCTURE);
  expect(walls).toContain(rayHit.ref);
  const hx = ents.x[me]! + d[0]! * rayHit.t - mx;
  const hz = ents.z[me]! + d[2]! * rayHit.t - mz;
  expect(Math.abs(hx * ax + hz * az)).toBeLessThan(0.0003);

  press(h, bob, BTN_USE);
  expect(bob.open).toBeNull();
  let code = -1;
  bob.onResult = (seq, result) => void (seq !== 0 && (code = result));
  bob.command(CMD_STRUCT, (w: BitWriter) => (w.u32(box), w.u8(STRUCT_USE), w.u16(NO_PIN)));
  h.run(200);
  expect([code, bob.open]).toEqual([RESULT_FAR, null]);
  expect(h.host.items.inv(state).total(id("ingot"))).toBe(150);
});

/** Sends a CMD_STRUCT for `ref` and returns its result code. */
function act(h: Harness, s: ClientSession, ref: number, action: number, code = -1): number {
  let got = -1;
  s.onResult = (seq, result) => void (seq !== 0 && (got = result));
  s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(action), code >= 0 ? w.u16(code) : 0));
  h.run(150);
  return got;
}

/** Asks to take the first stack of the open container into the survivor's first slot. */
function grab(s: ClientSession, item: number): void {
  s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_OPEN, 1), w.varint(0), w.bits(BOX_SELF, 1), w.varint(0), w.u16(0), w.u16(item)));
}

test("a lock or a new PIN shuts a box for a stranger who has it open, at once: not one more thing leaves it", () => {
  const { h, sessions, recs, at } = arena(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const ingot = id("ingot");
  // Ada's box stands in front of the two of them. It has no lock, so Bob, who is not of her tribe, may open it.
  const box = h.world.structs.add(id("storage_box"), at.x + 1, at.y + reg.halfY[id("storage_box")]!, at.z - 6, 0, recs[0]!.team, 500);
  const state = h.host.fixtures.ensure(box);
  expect(h.host.items.mint(state, ingot, 100)).toBe(100);
  const left = (): number => h.host.items.inv(state).total(ingot);
  expect([act(h, bob, box, STRUCT_USE, NO_PIN), bob.open?.name]).toEqual([RESULT_OK, "storage box"]);

  // She locks it, and in the same moment he asks for what is in it.
  ada.command(CMD_STRUCT, (w: BitWriter) => (w.u32(box), w.u8(STRUCT_LOCK)));
  grab(bob, ingot);
  h.run(200);
  expect([h.host.fixtures.locked(box), left(), bob.open?.name]).toEqual([true, 100, undefined]);
  expect(act(h, bob, box, STRUCT_USE, NO_PIN)).toBe(RESULT_LOCKED);

  // She sets a PIN and he opens it with that. She sets another: it is shut for him again, until he has the new one.
  expect(act(h, ada, box, STRUCT_PIN, 1234)).toBe(RESULT_OK);
  expect([act(h, bob, box, STRUCT_USE, 1234), bob.open?.name]).toEqual([RESULT_OK, "storage box"]);
  ada.command(CMD_STRUCT, (w: BitWriter) => (w.u32(box), w.u8(STRUCT_PIN), w.u16(4321)));
  grab(bob, ingot);
  h.run(200);
  expect([left(), bob.open?.name]).toEqual([100, undefined]);
  expect([act(h, bob, box, STRUCT_USE, 4321), bob.open?.name]).toEqual([RESULT_OK, "storage box"]);
  // With the PIN he has it as before: it stays open, and what he takes is his.
  h.run(300);
  grab(bob, ingot);
  h.run(200);
  expect([left(), bob.open?.name, bob.inventory!.total(ingot)]).toEqual([0, "storage box", 100]);
});

test("a member put out of a tribe can no longer empty its vault or ride its mount", () => {
  const { h, sessions, recs, at } = arena(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  const ingot = id("ingot");
  const enlist = (): void => {
    h.say(ada, "tribe invite bob");
    h.say(bob, "tribe accept");
    expect(recs[1]!.team).toBe(recs[0]!.team);
  };
  h.say(ada, "tribe create Wolves");
  enlist();
  // The tribe's vault, locked, with a member's hands in it.
  const vault = h.world.structs.add(id("vault"), at.x + 1, at.y + reg.halfY[id("vault")]!, at.z - 6, 0, recs[0]!.team, 50000);
  const state = h.host.fixtures.ensure(vault);
  state.lock = 1;
  expect(h.host.items.mint(state, ingot, 100)).toBe(100);
  expect([act(h, bob, vault, STRUCT_USE, NO_PIN), bob.open?.name]).toEqual([RESULT_OK, "vault"]);

  // He is put out, and in the same moment asks for what is in it.
  ada.text("tribe kick bob");
  grab(bob, ingot);
  h.run(300);
  expect(recs[1]!.team).not.toBe(recs[0]!.team);
  expect([h.host.items.inv(state).total(ingot), bob.open?.name]).toEqual([100, undefined]);
  expect(act(h, bob, vault, STRUCT_USE, NO_PIN)).toBe(RESULT_LOCKED);

  // Back in the tribe, he gets on its saddled mount. Put out again, he is put off it.
  enlist();
  const e = h.host.spawnCreature("core:parasaur", at.x + 5, at.z - 8, 1);
  expect(e).toBeGreaterThanOrEqual(0);
  const mount = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  mount.team = recs[0]!.team;
  mount.saddle = id("saddle_parasaur");
  h.host.creatures.mind.stay(e, 0xffffffff);
  h.host.creatures.claimed(e);
  const c = h.client(bob)!;
  expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
  h.run(200);
  expect(c.drive).toBe(e);
  h.say(ada, "tribe kick bob");
  expect([c.drive, h.world.ents.seat[c.ent]]).toEqual([-1, 0]);
});
