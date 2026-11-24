// Triangle foundations and ceilings, and the squares that stand 30 and 60 degrees round in a base because of them:
// offered, judged, held up, shut, collided with, saved and sent as any piece is.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngramDef, StructureDef } from "../../shared/content/defs.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { writeNew } from "../../shared/net/place.ts";
import { CMD_PLACE, RESULT_OBSTRUCTED, RESULT_OK, RESULT_TOO_HIGH } from "../../shared/net/protocol.ts";
import { Enclosure, SENSE_BODY, enclose } from "../../shared/world/lattice/rooms.ts";
import { freePose, restPose, type Pose } from "../../shared/world/snap.ts";
import { Builder } from "../../client/core/build.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { twOf } from "../../shared/world/lattice/basis.ts";
import { CLS_SQUARE, CLS_TRIANGLE, cellOf, keyDir } from "../../shared/world/lattice/module.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { Harness } from "../fixtures/net.ts";
import { builder } from "../fixtures/build.ts";
import { O, Plot, centre, cornerFault, hand, keyOf, leaks, mid, rowsOf, send, siteOf, step, type Tuple } from "../fixtures/pieces.ts";
import { coreRegistry, flatWorld, type TestWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;
const dir = mkdtempSync(join(tmpdir(), "snark-triangles-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A dodecagon as a plan: six triangles round the base's first corner, a square on each side of that hexagon and a triangle between each two squares. */
function dodecagon(): { inner: [Tuple, number][]; squares: [Tuple, number][]; outer: [Tuple, number][]; walls: [Tuple, number][] } {
  const inner: [Tuple, number][] = [];
  const squares: [Tuple, number][] = [];
  const outer: [Tuple, number][] = [];
  const walls: [Tuple, number][] = [];
  for (let k = 0; k < 6; k++) {
    const corner = step(O, 2 * k, 2);
    const e = 2 * k + 4;
    const a = step(corner, e - 3, 2);
    inner.push([O, 2 * k]);
    // The square outside the hexagon's side that runs from `corner` along `e`, by its centre.
    squares.push([centre(a, e), e]);
    outer.push([corner, e - 5]);
    // The square's far side, and the outer triangle's.
    walls.push([mid(a, e), e], [mid(step(corner, e - 5, 2), e - 1), e - 1]);
  }
  return { inner, squares, outer, walls };
}

/** Builds the dodecagon's floor, walls and roof of ceilings in a plot whose first triangle is its base's first piece. Returns every ref. */
function build(p: Plot, tier = "wood"): number[] {
  const d = dodecagon();
  const refs: number[] = [];
  const tri = (form: string): string => `core:triangle_${form}_${tier}`;
  for (const [a, own] of d.inner.slice(1)) refs.push(p.put(tri("foundation"), a, 0, own));
  for (const [c, own] of d.squares) refs.push(p.put(`core:foundation_${tier}`, c, 0, own));
  for (const [a, own] of d.outer) refs.push(p.put(tri("foundation"), a, 0, own));
  for (const [m, own] of d.walls) refs.push(p.put(`core:wall_${tier}`, m, 0, own));
  for (const [c, own] of d.squares) refs.push(p.put(`core:ceiling_${tier}`, c, 4, own));
  for (const [a, own] of d.outer) refs.push(p.put(tri("ceiling"), a, 4, own));
  for (const [a, own] of d.inner) refs.push(p.put(tri("ceiling"), a, 4, own));
  return refs;
}

test("triangles are kinds in wood, stone and metal, each an item of its own at the reference's cost and half a square's health", () => {
  for (const tier of ["wood", "stone", "metal"]) {
    expect([...reg.places[id(`piece_triangle_foundation_${tier}`)]!]).toEqual([id(`triangle_foundation_${tier}`)]);
    expect([...reg.places[id(`piece_triangle_ceiling_${tier}`)]!]).toEqual([id(`triangle_ceiling_${tier}`)]);
    expect([(reg.defs[id(`triangle_foundation_${tier}`)] as StructureDef).hp, (reg.defs[id(`triangle_ceiling_${tier}`)] as StructureDef).hp]).toEqual([7500, 5000]);
  }
  expect(reg.index.get("core:triangle_foundation_thatch")).toBeUndefined();
  const engram = reg.defs[id("engram-piece_triangle_foundation_wood")] as EngramDef;
  expect([engram.level, engram.cost]).toEqual([11, 6]);
  // A triangle is convex parts on axes 60 degrees apart, and a foundation by its role: the ground and other tribes' range go by it.
  expect([reg.parts.hulls!.start[id("triangle_foundation_wood") + 1]! - reg.parts.hulls!.start[id("triangle_foundation_wood")]!, reg.role[id("triangle_foundation_wood")], reg.role[id("triangle_ceiling_stone")]]).toEqual([1, 0, 2]);
});

for (const yaw of [0, 5003, 40961]) {
  test(`at yaw ${yaw}: a dodecagon of triangles and turned squares is built slot by slot, stands, is one room, and no look gets out`, () => {
    const w = flatWorld(4);
    const p = new Plot(w);
    const first = p.start(128, 128, yaw, "core:triangle_foundation_wood");
    // Each neighbour is offered by what is built: a triangle across a triangle's side, a square 30 or 60 degrees round across another.
    expect(p.offers("core:triangle_foundation_wood", O, 0, 2, O, 0)).toBe(true);
    expect(p.offers("core:foundation_wood", centre(step(step(O, 0, 2), 1, 2), 4), 0, 4, step(O, 0, 2), 0)).toBe(true);
    const refs = [first, ...build(p)];
    expect(refs.length).toBe(18 + 12 + 18);
    for (const ref of refs) expect(cornerFault(w, ref)).toBe("");
    // Every piece stands: the floor by itself, the walls on it, the ceilings on the walls and beside each other.
    const numbers = refs.map((ref) => p.stability(ref));
    expect([Math.min(...numbers.slice(0, 30)), Math.min(...numbers.slice(30, 42)), Math.min(...numbers.slice(42))]).toEqual([4, 3, 1]);
    // A second piece in a slot is refused by its key, whatever its turn; so is a square that would lie over two of them.
    expect(p.judge("core:triangle_foundation_wood", O, 0, 4)).toBe(RESULT_OBSTRUCTED);
    expect(p.judge("core:triangle_foundation_wood", step(O, 0, 2), 0, 8)).toBe(RESULT_OBSTRUCTED);
    // One room of eighteen cells, shut to a body.
    const rooms = new Enclosure(w.reg.forms, SENSE_BODY);
    enclose(w.structs, p.fr, rooms);
    rooms.flood();
    expect([rooms.found.rooms, rooms.found.inside]).toEqual([1, 18]);
    // From its middle, at three heights, every level look ends on a wall; and straight down and up on a floor.
    const [x, z] = p.metres(O);
    for (const y of [0.1, 1.5, 2.7]) expect(leaks(w, x, p.height(0) + y, z, 9, 1440)).toBe(0);
    // With one wall gone the room is open and a look gets out.
    w.structs.remove(refs[18]!);
    enclose(w.structs, p.fr, rooms);
    rooms.flood();
    expect(rooms.found.inside).toBe(0);
    expect(leaks(w, x, p.height(0) + 1.5, z, 9, 1440)).toBeGreaterThan(0);
  });
}

test("the ground is read under a triangle's own corners: one that would hang over a drop is refused, and on open ground it lies on the highest of them", () => {
  const w = flatWorld(4);
  // Level ground at 0 that falls away past x = 131.
  const ground = (x: number): number => (x > 131 ? -4 : 0);
  const p = new Plot(w, 7, siteOf(w, ground));
  p.start(128, 128, 0, "core:triangle_foundation_wood");
  // Round the first corner, the next triangle lies on level ground. The one across the first's far side reaches over the drop.
  expect(p.judge("core:triangle_foundation_wood", O, 0, 2)).toBe(RESULT_OK);
  p.put("core:triangle_foundation_wood", O, 0, 2);
  expect(p.judge("core:triangle_foundation_wood", step(O, 0, 2), 0, 2)).toBe(RESULT_TOO_HIGH);
  // On open ground a triangle is set by its first corner, its top an eighth over the highest ground under its three.
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const hill = (x: number, z: number): number => (z > 201 ? 1 : 0);
  expect(freePose(hill, w.reg, id("triangle_foundation_wood"), 200, 200, 0, 0, pose)).toBe(true);
  expect(pose.y / U + w.reg.halfY[id("triangle_foundation_wood")]!).toBeCloseTo(1.125, 6);
  // A box rests on a triangle floor where its middle is over it, and not past its sloping side.
  const floor = w.structs.chunks.findIndex((t) => t !== null) * 65536;
  const [cx, cz] = p.metres(O);
  expect([restPose(w.structs, w.reg, floor, id("storage_box"), cx + 1.5, cz + 0.8, 0, pose), restPose(w.structs, w.reg, floor, id("storage_box"), cx + 0.2, cz + 2, 0, pose)]).toEqual([true, false]);
});

/** A builder who has a triangle base's first piece down and stands on it. */
function founded(h: Harness, s: ReturnType<typeof builder>["sessions"][number], yaw: number): { w: TestWorld; p: Plot } {
  const w: TestWorld = { dims: h.world.dims, hf: h.world.hf, structs: h.world.structs, reg: h.reg, kind: (name) => h.reg.index.get(name)! };
  const p = new Plot(w, h.host.records.byPid.get(h.client(s)!.pid)!.team);
  hand(h, s, "piece_triangle_foundation_wood", 40);
  let code = -1;
  s.onResult = (_seq, c) => void (code = c);
  s.command(CMD_PLACE, (out: BitWriter) => writeNew(out, 0, Math.round(s.own.x * U), Math.round((s.own.z + 6) * U), yaw));
  h.run(150);
  if (code !== RESULT_OK) throw new Error(`the first triangle was refused with ${code}`);
  p.fr = w.structs.frameAt(h.host.build.last);
  return { w, p };
}

test("the preview offers the triangle looked at, outlines it as a triangle turned as its base turns it, and what it shows is what is built", () => {
  const { h, sessions } = builder();
  const s = sessions[0]!;
  const pilot = h.pilots[0]!;
  const { w, p } = founded(h, s, 7001);
  const b = new Builder();
  const eye = (): number => s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance);
  /** Looks at the lattice point `at` on the base's floor and runs the preview. */
  const look = (at: Tuple): void => {
    const [x, z] = p.metres(at);
    const [dx, dy, dz] = [x - s.own.x, p.height(0) - eye(), z - s.own.z];
    pilot.yaw = Math.atan2(dx, dz);
    pilot.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    h.run(60);
    const d = [0, 0, 0];
    lookDirection(Math.round((pilot.yaw / (2 * Math.PI)) * 65536) & 0xffff, Math.round((pilot.pitch / (Math.PI / 2)) * 16384), d);
    b.update(s, s.world!, h.reg, s.own.x, eye(), s.own.z, d[0]!, d[1]!, d[2]!, pilot.yaw, 0);
  };
  // The middle of the triangle next round the first corner: the look ends on bare ground, and that slot is the nearest.
  const third = [step(O, 2, 2), step(O, 4, 2)];
  const middle = [0, 1, 2, 3].map((i) => (third[0]![i]! + third[1]![i]!) / 3);
  const [gx, gz] = p.metres(middle.map(Math.round));
  expect(Math.hypot(gx - s.own.x, gz - s.own.z)).toBeLessThan(12);
  look(middle.map(Math.round));
  const want = keyOf(w, p.fr, "core:triangle_foundation_wood", O, 0, 2);
  expect([b.active, b.problem, b.kind]).toEqual([true, 0, id("triangle_foundation_wood")]);
  // Its outline is a triangle's, from its first corner, in the turn class of its first side.
  const [ox, oz] = p.metres(O);
  expect([b.slotMark.cls, b.slotMark.tw]).toEqual([CLS_TRIANGLE, twOf(keyDir(want.k1))]);
  expect([b.slotMark.x, b.slotMark.z]).toEqual([ox, oz]);
  let answer = -1;
  s.onResult = (seq, code) => {
    answer = code;
    b.result(seq, code, 1000);
  };
  expect(b.place(s, h.reg)).toBeGreaterThan(0);
  h.run(200);
  expect(answer).toBe(RESULT_OK);
  const built = h.host.build.last;
  const key = { fr: 0, k0: 0, k1: 0 };
  h.world.structs.keyAt(built, key);
  expect([key.fr, key.k0, cellOf(key.k1)]).toEqual([want.fr, want.k0, cellOf(want.k1)]);
  const t = h.world.structs.chunks[Math.floor(built / 65536)]!;
  expect([t.kind[built & 0xffff], Math.round(t.x[built & 0xffff]! * U), Math.round(t.z[built & 0xffff]! * U), t.yaw[built & 0xffff], t.twAt(built & 0xffff)]).toEqual([id("triangle_foundation_wood"), b.pose.x, b.pose.z, b.pose.yaw, b.tw]);
  // A square foundation is offered across the first triangle's outer side, 30 degrees round in the base, and is outlined so.
  hand(h, s, "piece_foundation_wood");
  const far = centre(step(step(O, 0, 2), 1, 2), 4);
  look(far);
  expect([b.active, b.problem, b.kind, b.slotMark.cls]).toEqual([true, 0, id("foundation_wood"), CLS_SQUARE]);
  expect(b.tw).not.toBe(0);
  expect(b.slotMark.tw).toBe(b.tw);
});

test("a builder raises a dodecagon through the server at an odd yaw; a restart and a late arrival find it as it stands", () => {
  const dbPath = join(dir, "dodecagon.db");
  let { h, sessions } = builder(["ada"], 40, 40, { dbPath });
  let s = sessions[0]!;
  const { w, p } = founded(h, s, 7001);
  const d = dodecagon();
  // The builder stands on the hexagon's middle once it is down, in reach of every piece.
  const [mx, mz] = p.metres(O);
  const place = (item: string, variant: number, kind: string, at: Tuple, lvl: number, own: number): void => {
    if (s.inventory!.item[s.inventory!.hotbar + 9] !== h.reg.index.get(`core:${item}`)) hand(h, s, item, 40);
    const got = send(h, s, variant, keyOf(w, p.fr, kind, at, lvl, own));
    if (got.code !== RESULT_OK) throw new Error(`${kind} at ${at.join()} level ${lvl}: ${got.code}`);
  };
  for (const [a, own] of d.inner.slice(1)) place("piece_triangle_foundation_wood", 0, "core:triangle_foundation_wood", a, 0, own);
  h.say(s, `tp ${mx.toFixed(3)} ${(p.height(0) + 0.05).toFixed(3)} ${mz.toFixed(3)}`);
  h.run(120);
  for (const [c, own] of d.squares) place("piece_foundation_wood", 0, "core:foundation_wood", c, 0, own);
  for (const [a, own] of d.outer) place("piece_triangle_foundation_wood", 0, "core:triangle_foundation_wood", a, 0, own);
  for (const [m, own] of d.walls) place("piece_wall_wood", 0, "core:wall_wood", m, 0, own);
  for (const [c, own] of d.squares) place("piece_ceiling_wood", 0, "core:ceiling_wood", c, 4, own);
  for (const [a, own] of [...d.outer, ...d.inner]) place("piece_triangle_ceiling_wood", 0, "core:triangle_ceiling_wood", a, 4, own);
  h.run(300);
  const built = rowsOf(h.world.structs, h.reg.ids);
  expect(built.length).toBe(48);
  // The builder's own client holds the same rows, key for key and place for place.
  expect(rowsOf(s.world!.structs, h.reg.ids)).toEqual(built);
  // Shut in under its own roof, the builder cannot be seen out of it.
  expect(leaks(w, s.own.x, s.own.y + 1.5, s.own.z, 9)).toBe(0);
  const late = h.join("bob");
  h.say(late, "enablecheats");
  h.say(late, `tp ${(mx + 9).toFixed(3)} ${mz.toFixed(3)}`);
  h.run(900);
  expect(rowsOf(late.world!.structs, h.reg.ids)).toEqual(built);

  h.host.shutdown();
  h = new Harness({}, 1, 60, { dev: true, dbPath });
  s = h.join("ada");
  h.run(900);
  expect(rowsOf(h.world.structs, h.reg.ids)).toEqual(built);
  expect(rowsOf(s.world!.structs, h.reg.ids)).toEqual(built);
  // Nothing fell on the way: the base is judged again as it is loaded and stands as it stood.
  expect(h.host.build.fallen).toBe(0);
});
