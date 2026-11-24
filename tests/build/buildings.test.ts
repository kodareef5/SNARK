// Four buildings a survivor raises piece by piece through the server, each of the pieces that came after the first
// nine: it stands, it is shut where it should be and walked where it should be, it comes down when what holds it is
// cut, and a restart and a late arrival find it as it stood.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Builder } from "../../client/core/build.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { TICK_DT } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_STRUCT, RESULT_OK } from "../../shared/net/protocol.ts";
import { Body, stanceEye, stepBody } from "../../shared/sim/character.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { Enclosure, SENSE_BODY, enclose } from "../../shared/world/lattice/rooms.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { NO_PIN, STRUCT_USE } from "../../shared/world/upkeep.ts";
import { builder } from "../fixtures/build.ts";
import { Harness } from "../fixtures/net.ts";
import { O, Plot, at, build, found, hand, keyOf, leaks, mid, plotOf, rowsOf, stand, step, type Tuple } from "../fixtures/pieces.ts";
import { coreRegistry, type TestWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const dir = mkdtempSync(join(tmpdir(), "snark-buildings-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Uses the piece `ref` as the use key does, with no PIN. Answers the server's code. */
function use(h: Harness, s: ClientSession, ref: number): number {
  let code = -1;
  s.onResult = (_seq, c) => void (code = c);
  s.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(STRUCT_USE), w.u16(NO_PIN)));
  h.run(150);
  return code;
}

/** How many air cells of the plot's base are shut in, to a body. */
function inside(w: TestWorld, p: Plot): number {
  const rooms = new Enclosure(w.reg.forms, SENSE_BODY);
  enclose(w.structs, p.fr, rooms);
  rooms.flood();
  return rooms.found.inside;
}

/** Every built row of the server's whose kind is one of `names`, as refs. */
function refsOf(h: Harness, ...names: string[]): number[] {
  const kinds = names.map(id);
  const out: number[] = [];
  h.world.structs.chunks.forEach((t, chunk) => {
    for (let s = 0; t && s < t.high; s++) if (kinds.includes(t.kind[s]!)) out.push(chunk * 65536 + s);
  });
  return out;
}

/** A survivor's body let down onto what is under (x, z) from `from`, and left there `ticks`: where it is then, and whether it stood all the while. */
function settled(w: TestWorld, x: number, z: number, from: number, ticks = 90): { y: number; moved: number; stood: boolean } {
  const move = reg.move[id("survivor")]!;
  const b = new Body();
  [b.x, b.z, b.y] = [x, z, from];
  while (capsuleFree(w, x, b.y - 0.01, z, move.radius, move.height) && b.y > 0) b.y -= 0.01;
  b.grounded = true;
  let stood = true;
  for (let t = 0; t < ticks; t++) {
    stepBody(w, b, 0, 0, 0, 0, 0, move, TICK_DT);
    stood &&= b.grounded;
  }
  return { y: b.y, moved: Math.hypot(b.x - x, b.z - z), stood };
}

/** Destroys rows of the server's and lets what they held fall. */
function destroy(h: Harness, refs: readonly number[]): void {
  for (const ref of refs) h.world.structs.damage(ref, 1e9, h.world.tick);
  h.run(900);
}

test("a hexagon tower with a tent of six triangle roofs: built at an odd yaw, shut behind its door, walked on, kept over a restart, and down when its floor goes", () => {
  const dbPath = join(dir, "tower.db");
  let { h, sessions } = builder(["ada"], 40, 40, { dbPath });
  let s = sessions[0]!;
  const pilot = h.pilots[0]!;
  const { w, p } = plotOf(h, s);
  found(h, s, p, "piece_triangle_foundation_wood", 9001);
  for (let k = 1; k < 6; k++) build(h, s, p, "piece_triangle_foundation_wood", "core:triangle_foundation_wood", O, 0, 2 * k);
  stand(h, s, p, O);
  // A wall on each side of the hexagon, the first with a doorway and its door.
  const side = (k: number): [Tuple, number] => [mid(step(O, 2 * k, 2), 2 * k + 4), 2 * k + 4];
  build(h, s, p, "piece_wall_wood", "core:doorframe_wood", side(0)[0], 0, side(0)[1]);
  const door = build(h, s, p, "piece_door_wood", "core:door_wood", side(0)[0], 0, side(0)[1]);
  for (let k = 1; k < 6; k++) build(h, s, p, "piece_wall_wood", "core:wall_wood", side(k)[0], 0, side(k)[1]);

  // The roof over the third wall, through the preview: looking at the wall's inner face under its top, the builder is
  // shown the triangle inside it, turned low over the wall and up to the middle.
  hand(h, s, "piece_triangle_roof_wood", 20);
  const b = new Builder();
  const eye = s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance);
  const [tx, tz] = p.metres(side(2)[0]);
  const [dx, dy, dz] = [tx - s.own.x, p.height(4) - 0.2 - eye, tz - s.own.z];
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  h.run(60);
  const d = [0, 0, 0];
  lookDirection(Math.round((pilot.yaw / (2 * Math.PI)) * 65536) & 0xffff, Math.round((pilot.pitch / (Math.PI / 2)) * 16384), d);
  b.update(s, s.world!, h.reg, s.own.x, eye, s.own.z, d[0]!, d[1]!, d[2]!, pilot.yaw, 0);
  expect([b.active, b.problem, b.kind]).toEqual([true, 0, id("triangle_roof_wood")]);
  let answer = -1;
  s.onResult = (seq, code) => {
    answer = code;
    b.result(seq, code, 1000);
  };
  expect(b.place(s, h.reg)).toBeGreaterThan(0);
  h.run(200);
  expect(answer).toBe(RESULT_OK);
  // The triangle over floor `k`, named from the corner its low side leaves: its high corner is then the middle.
  const roof = (k: number): [Tuple, number] => [step(O, 2 * k, 2), 2 * k + 4];
  const shown = { fr: 0, k0: 0, k1: 0 };
  h.world.structs.keyAt(h.host.build.last, shown);
  const want = keyOf(w, p.fr, "core:triangle_roof_wood", roof(2)[0], 4, roof(2)[1]);
  expect([shown.k0, shown.k1]).toEqual([want.k0, want.k1]);
  for (const k of [0, 1, 3, 4, 5]) build(h, s, p, "piece_triangle_roof_wood", "core:triangle_roof_wood", roof(k)[0], 4, roof(k)[1]);
  h.run(300);

  const built = rowsOf(h.world.structs, h.reg.ids);
  expect(built.length).toBe(6 + 6 + 1 + 6);
  // It stands: the walls on the floor, each roof on its wall and against its neighbours.
  expect(refsOf(h, "triangle_roof_wood").map((ref) => p.stability(ref))).toEqual([3, 3, 3, 3, 3, 3]);
  // One room of six cells behind the shut door, open with the door and shut with it again.
  expect(inside(w, p)).toBe(6);
  const [ox, oz] = p.metres(O);
  for (const y of [1.5, 3.3, 4]) expect(leaks(w, ox, p.height(0) + y, oz, 8, 1440)).toBe(0);
  expect([use(h, s, door), inside(w, p)]).toEqual([RESULT_OK, 0]);
  expect(leaks(w, ox, p.height(0) + 1.5, oz, 8, 1440)).toBeGreaterThan(0);
  expect([use(h, s, door), inside(w, p)]).toEqual([RESULT_OK, 6]);
  // The builder stands on its floor, and a body let down on a roof face stands there and does not slide.
  expect(Math.abs(s.own.y - p.height(0))).toBeLessThan(0.05);
  const [[ax, az], [bx, bz]] = [p.metres(roof(1)[0]), p.metres(step(O, 4, 2))];
  const [fx, fz] = [(ox + ax + bx) / 3, (oz + az + bz) / 3];
  const on = settled(w, fx, fz, p.height(4) + 4);
  expect(on.y).toBeGreaterThan(p.height(4) + 0.5);
  expect(on.y).toBeLessThan(p.height(6) + 0.3);
  expect([on.stood, on.moved < 0.05]).toEqual([true, true]);

  // The builder's client and one who comes late hold it key for key.
  expect(rowsOf(s.world!.structs, h.reg.ids)).toEqual(built);
  const late = h.join("bob");
  h.say(late, "enablecheats");
  h.say(late, `tp ${(ox + 9).toFixed(3)} ${oz.toFixed(3)}`);
  h.run(900);
  expect(rowsOf(late.world!.structs, h.reg.ids)).toEqual(built);

  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  s = h.join("ada");
  h.run(900);
  expect(rowsOf(h.world.structs, h.reg.ids)).toEqual(built);
  expect(rowsOf(s.world!.structs, h.reg.ids)).toEqual(built);
  // One wall gone, its roof hangs on the two beside it and nothing else moves. The floor gone, all of it comes down.
  destroy(h, [refsOf(h, "wall_wood")[0]!]);
  expect([rowsOf(h.world.structs, h.reg.ids).length, h.host.build.fallen]).toEqual([18, 0]);
  destroy(h, refsOf(h, "triangle_foundation_wood"));
  expect(rowsOf(h.world.structs, h.reg.ids)).toEqual([]);
  expect(h.host.build.fallen).toBe(12);
  expect(rowsOf(s.world!.structs, h.reg.ids)).toEqual([]);
});

/** Joins a second survivor of another tribe, with cheats, 9 m east of the lattice point `at`. */
function stranger(h: Harness, p: Plot, at: Tuple): ClientSession {
  const [x, z] = p.metres(at);
  const late = h.join("bob");
  h.say(late, "enablecheats");
  h.say(late, `tp ${(x + 9).toFixed(3)} ${z.toFixed(3)}`);
  h.run(900);
  return late;
}

/** A survivor's body walked along the heading from one point toward another for `ticks`, from rest on what is under the first: where it ends. */
function walked(w: TestWorld, from: readonly [number, number], to: readonly [number, number], drop: number, ticks: number): Body {
  const move = reg.move[id("survivor")]!;
  const b = new Body();
  [b.x, b.z, b.y] = [from[0], from[1], drop];
  while (capsuleFree(w, b.x, b.y - 0.01, b.z, move.radius, move.height) && b.y > 0) b.y -= 0.01;
  b.grounded = true;
  const heading = Math.round((Math.atan2(to[0] - from[0], to[1] - from[1]) / (2 * Math.PI)) * 65536) & 0xffff;
  for (let t = 0; t < ticks; t++) stepBody(w, b, 0, 127, heading, 0, 0, move, TICK_DT);
  return b;
}

test("a ramp up to a second floor with a railing round it: walked up, stopped at the rail, kept over a restart, and its floor down with its walls", () => {
  const dbPath = join(dir, "ramp.db");
  let { h, sessions } = builder(["ada"], 40, 40, { dbPath });
  let s = sessions[0]!;
  const { w, p } = plotOf(h, s);
  found(h, s, p, "piece_foundation_wood", 3001);
  build(h, s, p, "piece_foundation_wood", "core:foundation_wood", at(3, 1), 0, 0);
  // Walls round the east square on three sides, a floor on them, and the ramp on the west square rising east to it.
  for (const [m, own] of [[at(3, 0), 0], [at(4, 1), 3], [at(3, 2), 6]] as const) build(h, s, p, "piece_wall_wood", "core:wall_wood", m, 0, own);
  build(h, s, p, "piece_ceiling_wood", "core:ceiling_wood", at(3, 1), 4, 0);
  const ramp = build(h, s, p, "piece_stairs_wood", "core:ramp_wood", at(1, 1), 0, 9);
  for (const [m, own] of [[at(3, 0), 0], [at(4, 1), 3], [at(3, 2), 6]] as const) build(h, s, p, "piece_railing_wood", "core:railing_wood", m, 4, own);
  h.run(300);
  const built = rowsOf(h.world.structs, h.reg.ids);
  expect(built.length).toBe(2 + 3 + 1 + 1 + 3);
  expect([p.stability(ramp), ...refsOf(h, "ceiling_wood", "railing_wood").map((ref) => p.stability(ref))]).toEqual([4, 3, 4, 4, 4]);
  // From the ramp's foot a body walks up onto the floor, on to the rail at its far side, and no further.
  const up = walked(w, p.metres(at(0, 1)), p.metres(at(4, 1)), p.height(0) + 1, 600);
  const [ex, ez] = p.metres(at(4, 1));
  expect(Math.abs(up.y - p.height(4))).toBeLessThan(0.05);
  const short = Math.hypot(up.x - ex, up.z - ez);
  expect(short).toBeGreaterThan(0.3);
  expect(short).toBeLessThan(0.6);
  expect(rowsOf(s.world!.structs, h.reg.ids)).toEqual(built);
  expect(rowsOf(stranger(h, p, at(4, 1)).world!.structs, h.reg.ids)).toEqual(built);

  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  s = h.join("ada");
  h.run(900);
  expect(rowsOf(h.world.structs, h.reg.ids)).toEqual(built);
  // The walls gone, the floor and its rails come down; the ramp stands on its foundation.
  destroy(h, refsOf(h, "wall_wood"));
  expect(rowsOf(h.world.structs, h.reg.ids).map((row) => row.split(" ")[0]).sort()).toEqual(["core:foundation_wood", "core:foundation_wood", "core:ramp_wood"]);
  expect(h.host.build.fallen).toBe(4);
  expect(rowsOf(s.world!.structs, h.reg.ids).length).toBe(3);
});

test("a cellar under a trapdoor with a ladder: shut it is a room and a floor, open a way down; locked to others, kept over a restart, down with its walls", () => {
  const dbPath = join(dir, "cellar.db");
  let { h, sessions } = builder(["ada"], 40, 40, { dbPath });
  let s = sessions[0]!;
  const { w, p } = plotOf(h, s);
  found(h, s, p, "piece_foundation_wood", 11001);
  for (const [m, own] of [[at(1, 0), 0], [at(2, 1), 3], [at(1, 2), 6], [at(0, 1), 9]] as const) build(h, s, p, "piece_wall_wood", "core:wall_wood", m, 0, own);
  build(h, s, p, "piece_trapdoor_frame_wood", "core:trapdoor_frame_wood", at(1, 1), 4, 0);
  const leaf = build(h, s, p, "piece_trapdoor_wood", "core:trapdoor_wood", at(1, 1), 4, 0);
  const ladder = build(h, s, p, "piece_ladder_wood", "core:ladder_wood", at(1, 2), 0, 0);
  h.run(300);
  const built = rowsOf(h.world.structs, h.reg.ids);
  expect(built.length).toBe(1 + 4 + 1 + 1 + 1);
  expect([p.stability(leaf), p.stability(ladder), inside(w, p)]).toEqual([3, 4, 1]);
  // Shut, the leaf is a floor: a body let down on it stays up there.
  const [x, z] = p.metres(at(1, 1));
  expect(Math.abs(settled(w, x, z, p.height(4) + 1).y - p.height(4))).toBeLessThan(0.05);
  // Another tribe's survivor finds it locked. Its own opens it from inside the cellar, looking up at it.
  const bob = stranger(h, p, at(1, 1));
  expect(use(h, bob, leaf)).not.toBe(RESULT_OK);
  stand(h, s, p, at(1, 1));
  expect(use(h, s, leaf)).toBe(RESULT_OK);
  const open = h.world.structs.chunks[Math.floor(leaf / 65536)]!.kind[leaf & 0xffff];
  expect([open, inside(w, p)]).toEqual([id("trapdoor_open_wood"), 0]);
  expect(bob.world!.structs.chunks[Math.floor(leaf / 65536)]!.kind[leaf & 0xffff]).toBe(open);
  // Open, a body let down over the hole lands on the cellar's floor.
  stand(h, s, p, at(-3, 1));
  expect(Math.abs(settled(w, x, z, p.height(4) + 1).y - p.height(0))).toBeLessThan(0.05);

  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  s = h.join("ada");
  h.run(900);
  // It comes back open, as it was left.
  expect(rowsOf(h.world.structs, h.reg.ids)).toEqual(rowsOf(w.structs, h.reg.ids));
  expect(rowsOf(s.world!.structs, h.reg.ids).length).toBe(8);
  // The wall the ladder hangs on gone, the ladder still hangs under the frame's side; the rest of the walls gone, the frame, its leaf and the ladder come down.
  destroy(h, [refsOf(h, "wall_wood")[2]!]);
  expect([refsOf(h, "ladder_wood").length, h.host.build.fallen]).toEqual([1, 0]);
  destroy(h, refsOf(h, "wall_wood"));
  expect(rowsOf(h.world.structs, h.reg.ids).map((row) => row.split(" ")[0])).toEqual(["core:foundation_wood"]);
  expect(h.host.build.fallen).toBe(3);
});
