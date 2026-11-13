// Building: pieces set down by survivors, through the client and through the server's rules.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { BUILD_REASONS, Builder, GHOST_BAD, GHOST_OK } from "../../client/core/build.ts";
import { DRAW_BLEND, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { KEY_AMMO, KEY_PROMPT } from "../../client/core/ui/hud.ts";
import { BUILDING_CONTENT } from "../../content/building.ts";
import type { EngramDef, ItemDef, RecipeDef } from "../../shared/content/defs.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { buildCorePack } from "../../tools/pack/build.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { DOOR_WIDTH, FOUNDATION_THICK, RISE, WALL_HEIGHT } from "../../content/building.ts";
import { NO_TARGET } from "../../server/build.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_CRAFT, CMD_LEARN, CMD_MOVE, CMD_PLACE, CMD_SELECT, RESULT_DENIED, RESULT_ENEMY_NEAR, RESULT_NO_SUPPORT, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { capsuleKind } from "../../shared/world/collide.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { makeSockets, poseAt, socketsOf, type Pose } from "../../shared/world/snap.ts";
import { GONE_DESTROYED, GONE_FELL } from "../../shared/world/structures.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;
const PIECES = ["foundation", "wall", "ceiling", "pillar", "door", "stairs"];

/** How many of each piece a builder starts with: as many as one who has put everything into carrying can walk with. */
const STOCK = 60;

/** Survivors with cheats on level ground, strong enough to carry sixty pieces of every kind in wood, one kind to each of the first six hotbar slots. */
function builder(names = ["ada"], wide = 40, deep = wide) {
  const h = new Harness({}, 1, 60, { dev: true });
  const sessions = names.map((n) => h.join(n));
  h.run(600);
  const g = flatGround(h, wide, deep);
  const at = { x: g.x + wide / 2, z: g.z + 4, y: g.y };
  sessions.forEach((s, i) => {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(at.x + i * 2).toFixed(3)} ${at.z.toFixed(3)}`);
    h.say(s, "setstat weight 255");
    PIECES.forEach((piece, slot) => {
      expect(h.say(s, `give piece_${piece}_wood ${STOCK}`)[0]).toContain(`gave ${STOCK}`);
      const inv = s.inventory!;
      const from = inv.item.indexOf(id(`piece_${piece}_wood`));
      s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + slot), w.u16(0), w.u16(id(`piece_${piece}_wood`))));
      h.run(100);
      expect(inv.item[inv.hotbar + slot]).toBe(id(`piece_${piece}_wood`));
    });
  });
  h.run(200);
  const structs = h.world.structs;
  /** Take the piece of this name in hand. */
  const hold = (s: ClientSession, piece: string): void => {
    s.command(CMD_SELECT, (w: BitWriter) => w.u8(PIECES.indexOf(piece)));
    h.run(100);
  };
  /** Ask outright for a piece to be set in place `socket` of `target`, and say what the server answered and the ref it built, if it did. */
  const join = (s: ClientSession, piece: string, target: number, socket: number, turn = 0, variant = 0): { code: number; ref: number } => {
    hold(s, piece);
    let code = -1;
    s.onResult = (_seq, c) => void (code = c);
    const before = h.host.build.placed;
    s.command(CMD_PLACE, (w: BitWriter) => (w.u8(variant), w.u32(target), w.u8(socket), w.u8(turn)));
    h.run(150);
    return { code, ref: h.host.build.placed > before ? h.host.build.last : -1 };
  };
  const count = (s: ClientSession, piece: string): number => s.inventory!.total(id(`piece_${piece}_wood`));
  const rowOf = (ref: number): [number, number, number, number, number, number] => {
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    const k = ref & 0xffff;
    return [t.kind[k]!, Math.round(t.x[k]! * U), Math.round(t.y[k]! * U), Math.round(t.z[k]! * U), t.yaw[k]!, t.owner[k]!];
  };
  return { h, sessions, at, hold, join, count, rowOf, structs };
}

/** Run the client's preview for a session as its app would, from where its body is and the way its pilot looks. */
function preview(h: Harness, s: ClientSession, pilot: Pilot, b: Builder, nowMs = 0): void {
  const dir = [0, 0, 0];
  lookDirection(Math.round((pilot.yaw / (2 * Math.PI)) * 65536) & 0xffff, Math.round((pilot.pitch / (Math.PI / 2)) * 16384), dir);
  b.update(s, s.world!, h.reg, s.own.x, s.own.y + stanceEye(h.reg.move[s.ownKind]!, s.own.stance), s.own.z, dir[0]!, dir[1]!, dir[2]!, pilot.yaw, nowMs);
}

test("a piece in hand is shown where it would go and set down there: on open ground first, then joined, turned, and in another form", () => {
  const { h, sessions, hold, count, rowOf, structs } = builder();
  const s = sessions[0]!;
  const pilot = h.pilots[0]!;
  const b = new Builder();
  const team = h.host.records.byPid.get(h.client(s)!.pid)!.team;
  const built = structs.count;
  let answer = -1;
  s.onResult = (seq, code) => {
    answer = code;
    b.result(seq, code, 1000);
  };
  const place = (): number => {
    answer = -1;
    expect(b.place(s, h.reg)).toBeGreaterThan(0);
    h.run(200);
    return answer;
  };
  // Nothing in hand that can be built: the preview is off, and the button asks for nothing.
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(9));
  h.run(100);
  preview(h, s, pilot, b);
  expect([b.active, b.place(s, h.reg)]).toEqual([false, 0]);

  // A foundation, looking at the ground five metres ahead: shown there, level, a little above the ground.
  hold(s, "foundation");
  pilot.yaw = 0;
  pilot.pitch = Math.atan2(-1.62, 5);
  h.run(100);
  preview(h, s, pilot, b);
  expect([b.active, b.problem, b.notice]).toEqual([true, 0, ""]);
  expect(b.kind).toBe(id("foundation_wood"));
  expect(b.pose.x / U).toBeCloseTo(s.own.x, 1);
  expect(b.pose.z / U).toBeCloseTo(s.own.z + 5, 1);
  expect(b.pose.y / U + FOUNDATION_THICK / 2).toBeCloseTo(s.own.y + 0.125, 2);
  const had = count(s, "foundation");
  expect(place()).toBe(RESULT_OK);
  // It is built where it was shown, it is the builder's team's, one fewer is carried, and the client has it too.
  const first = h.host.build.last;
  expect(rowOf(first)).toEqual([id("foundation_wood"), b.pose.x, b.pose.y, b.pose.z, b.pose.yaw, team]);
  expect(count(s, "foundation")).toBe(had - 1);
  expect(structs.count).toBe(built + 1);
  const mine = s.world!.structs.chunks[Math.floor(first / 65536)]!;
  expect([mine.kind[first & 0xffff], mine.owner[first & 0xffff]]).toEqual([id("foundation_wood"), team]);

  // Looking at it again, the piece in hand joins it: shown as its neighbour, on the side looked toward.
  pilot.pitch = Math.atan2(-1.62, 6.3);
  h.run(100);
  preview(h, s, pilot, b);
  expect(b.problem).toBe(0);
  expect([b.pose.x, b.pose.y, b.pose.z - 3 * U]).toEqual(rowOf(first).slice(1, 4));
  // Q takes the next nearest place instead: a neighbour to one side.
  b.key("KeyQ", true, false, 0, h.reg);
  b.key("KeyQ", false, false, 100, h.reg);
  preview(h, s, pilot, b, 100);
  expect(Math.abs(b.pose.x - rowOf(first)[1]!)).toBe(3 * U);
  expect(b.pose.z).toBe(rowOf(first)[3]!);
  expect(place()).toBe(RESULT_OK);
  // Once it is there, the same place is taken, and the preview says so before the server is asked.
  b.cycle = 1;
  preview(h, s, pilot, b, 100);
  expect([b.problem, b.notice]).toEqual([RESULT_OBSTRUCTED, "Something is in the way"]);
  expect(place()).toBe(RESULT_OBSTRUCTED);
  b.cycle = 0;

  // A wall on the far edge; R makes it a doorframe, then a windowframe, then a wall again; E turns it about.
  hold(s, "wall");
  preview(h, s, pilot, b);
  expect([b.kind, b.problem]).toEqual([id("wall_wood"), 0]);
  const facing = b.pose.yaw;
  b.key("KeyR", true, false, 0, h.reg);
  preview(h, s, pilot, b);
  expect(b.kind).toBe(id("doorframe_wood"));
  b.key("KeyE", true, false, 0, h.reg);
  preview(h, s, pilot, b);
  expect(b.pose.yaw).toBe((facing + 32768) & 0xffff);
  b.key("KeyR", true, false, 0, h.reg);
  preview(h, s, pilot, b);
  expect(b.kind).toBe(id("windowframe_wood"));
  b.key("KeyR", true, false, 0, h.reg);
  b.key("KeyR", true, false, 0, h.reg);
  preview(h, s, pilot, b);
  expect(b.kind).toBe(id("doorframe_wood"));
  expect(place()).toBe(RESULT_OK);
  const frame = h.host.build.last;
  expect(rowOf(frame)[0]).toBe(id("doorframe_wood"));
  expect(rowOf(frame)[2]! / U).toBeCloseTo(rowOf(first)[2]! / U + FOUNDATION_THICK / 2 + WALL_HEIGHT / 2, 6);
  // Keys that are building's are taken while a piece is in hand, and not otherwise.
  expect(["KeyE", "KeyQ", "KeyR", "ArrowUp", "ArrowDown"].map((k) => b.key(k, false, false, 0, h.reg))).toEqual([true, true, true, true, true]);
  expect(b.key("KeyW", true, false, 0, h.reg)).toBe(false);

  // A wall has nowhere to go on open ground: looking away from everything, nothing is shown, and the reason is said.
  pilot.yaw = Math.PI;
  h.run(100);
  preview(h, s, pilot, b, 4000);
  expect([b.problem, b.notice]).toEqual([RESULT_NO_SNAP, "It must join something built"]);
  expect(b.place(s, h.reg)).toBe(0);
  // Q held lets go of other pieces: a foundation is then set down free even beside one it could join, and raised by the arrow keys.
  hold(s, "foundation");
  pilot.yaw = 2.2;
  pilot.pitch = Math.atan2(-1.62, 6);
  h.run(100);
  b.key("KeyQ", true, false, 5000, h.reg);
  preview(h, s, pilot, b, 5400);
  b.key("KeyQ", false, false, 5450, h.reg);
  expect(b.free).toBe(true);
  for (let k = 0; k < 3; k++) b.key("ArrowUp", true, false, 0, h.reg);
  b.key("KeyE", true, false, 0, h.reg);
  preview(h, s, pilot, b, 5500);
  expect(b.problem).toBe(0);
  expect(b.pose.y / U + FOUNDATION_THICK / 2).toBeCloseTo(s.own.y + 0.125 + 3 / 8, 2);
  expect(b.pose.yaw).toBe((Math.round((2.2 / (2 * Math.PI)) * 65536) + 16384) & 0xffff);
  expect(place()).toBe(RESULT_OK);
  expect(rowOf(h.host.build.last).slice(1, 5)).toEqual([b.pose.x, b.pose.y, b.pose.z, b.pose.yaw]);
  // A refusal from the server is said for a while, whatever the preview thinks.
  b.result(0, RESULT_NOT_YOURS, 6000);
  preview(h, s, pilot, b, 6100);
  expect(b.notice).not.toBe(BUILD_REASONS[RESULT_NOT_YOURS]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a two-floor house, piece by piece: walked into through its doorway, up its stairs, and out onto its upper floor", () => {
  const { h, sessions, at, join, count, rowOf, structs } = builder();
  const s = sessions[0]!;
  const pilot = h.pilots[0]!;
  const ok = (piece: string, target: number, socket: number, turn = 0, variant = 0): number => {
    const r = join(s, piece, target, socket, turn, variant);
    expect([piece, r.code]).toEqual([piece, RESULT_OK]);
    return r.ref;
  };
  // The first foundation on open ground, eight metres north of where the builder began; three more to make a square of two by two.
  // The builder stands near enough to reach all of it.
  h.say(s, `tp ${at.x.toFixed(3)} ${(at.z + 4).toFixed(3)}`);
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  let code = -1;
  s.onResult = (_seq, c) => void (code = c);
  s.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round(at.x * U), 32), w.sbits(Math.round((at.z + 8) * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  expect(code).toBe(RESULT_OK);
  const sw = h.host.build.last;
  const nw = ok("foundation", sw, 0);
  const se = ok("foundation", sw, 1);
  const ne = ok("foundation", nw, 1);
  // Walls all round the ground floor, facing out; the one nearest the builder has the doorway.
  const door = ok("wall", sw, 2, 0, 1);
  const walls = [ok("wall", se, 2), ok("wall", se, 1), ok("wall", ne, 1), ok("wall", ne, 0), ok("wall", nw, 0, 0, 2), ok("wall", nw, 3), ok("wall", sw, 3)];
  expect(rowOf(door)[0]).toBe(id("doorframe_wood"));
  expect(rowOf(walls[4]!)[0]).toBe(id("windowframe_wood"));
  // Stairs in the north-east corner, rising to the north from the open floor south of them; the upper floor over the other three, held by the walls.
  ok("stairs", ne, 0, 0);
  const upSW = ok("ceiling", door, 1);
  const upSE = ok("ceiling", walls[0]!, 1);
  const upNW = ok("ceiling", walls[4]!, 1);
  // Over the stairs there can be no floor.
  expect(join(s, "ceiling", walls[3]!, 1).code).toBe(RESULT_OBSTRUCTED);
  // The upper storey: walls on the ground floor's walls, and a roof on those.
  const upper = [door, ...walls].map((w) => ok("wall", w, 0));
  const roofs = [ok("ceiling", upper[0]!, 1), ok("ceiling", upper[1]!, 1), ok("ceiling", upper[5]!, 1), ok("ceiling", upper[4]!, 1)];
  expect(new Set(roofs.map((r) => rowOf(r)[2])).size).toBe(1);
  expect(structs.count).toBeGreaterThanOrEqual(4 + 8 + 1 + 3 + 8 + 4);
  // What it cost: a piece from the hand for each one built, and nothing for the one refused.
  expect([STOCK - count(s, "foundation"), STOCK - count(s, "wall"), STOCK - count(s, "ceiling"), STOCK - count(s, "stairs")]).toEqual([4, 16, 7, 1]);

  // In through the doorway, which is in the south wall of the south-west piece.
  const ents = h.world.ents;
  const e = h.ent(s);
  const floor = rowOf(sw)[2]! / U + FOUNDATION_THICK / 2;
  const [doorX, doorZ] = [rowOf(door)[1]! / U, rowOf(door)[3]! / U];
  h.say(s, `tp ${doorX.toFixed(3)} ${(doorZ - 2).toFixed(3)}`);
  pilot.yaw = 0;
  pilot.pitch = 0;
  pilot.moveZ = 1;
  h.run(800);
  pilot.moveZ = 0;
  h.run(200);
  expect(ents.z[e]!).toBeGreaterThan(doorZ + 0.5);
  expect(ents.y[e]!).toBeCloseTo(floor, 2);
  // Across to the south-east piece, north up the stairs to their top, then west off them onto the upper floor.
  const [stairX, stairZ] = [rowOf(ne)[1]! / U, rowOf(ne)[3]! / U];
  h.say(s, `tp ${stairX.toFixed(3)} ${floor.toFixed(3)} ${(stairZ - 3).toFixed(3)}`);
  pilot.yaw = 0;
  h.run(300);
  // Every step of the climb is predicted: nothing the server says moves the body.
  const corrections = s.stats.corrections;
  pilot.moveZ = 1;
  h.run(1500);
  expect(ents.y[e]!).toBeGreaterThan(floor + RISE - 0.35);
  pilot.yaw = -Math.PI / 2;
  h.run(1000);
  pilot.moveZ = 0;
  h.run(300);
  // On the upper floor, over the north-west piece, a storey above the ground floor; the client agrees with every step.
  // (A body that has come up steps stands within its ground probe of the floor, a centimetre or two, and settles.)
  expect(Math.abs(ents.y[e]! - (floor + RISE))).toBeLessThan(0.03);
  expect(ents.x[e]!).toBeLessThan(stairX - 1.5);
  expect(Math.abs(ents.z[e]! - rowOf(upNW)[3]! / U)).toBeLessThan(1.5);
  expect([s.own.x, s.own.z]).toEqual([ents.x[e]!, ents.z[e]!]);
  expect(Math.abs(s.own.y - ents.y[e]!)).toBeLessThan(0.01);
  expect(s.stats.corrections - corrections).toBe(0);
  expect(rowOf(upSW)[2]).toBe(rowOf(upSE)[2]);
  expect(h.host.items.audit()).toEqual([]);
});

test("what the server will not build: on another tribe's work, out of reach, nowhere, or without the piece; and no bytes build anything else", () => {
  const { h, sessions, at, join, count, rowOf, structs } = builder(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  ada.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round(at.x * U), 32), w.sbits(Math.round((at.z + 6) * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  const base = h.host.build.last;
  expect(base).toBeGreaterThanOrEqual(0);
  // Bob is not of her tribe: nothing of his joins what she built, and his pieces stay in his hands.
  expect(join(bob, "wall", base, 0).code).toBe(RESULT_NOT_YOURS);
  expect(join(bob, "foundation", base, 1).code).toBe(RESULT_NOT_YOURS);
  expect(count(bob, "wall")).toBe(STOCK);
  // Nor does anything join what nobody built: the proving ground's own walls.
  let plain = -1;
  for (let c = 0; c < structs.chunks.length && plain < 0; c++) {
    const t = structs.chunks[c];
    if (t) for (let k = 0; k < t.high; k++) if (t.kind[k] === id("foundation") && t.owner[k] === 0) plain = c * 65536 + k;
  }
  if (plain >= 0) expect(join(ada, "wall", plain, 0).code).toBe(RESULT_NOT_YOURS);
  // In one tribe, he may.
  h.say(ada, "tribe create Builders");
  h.say(ada, "tribe invite bob");
  h.say(bob, "tribe accept");
  const wall = join(bob, "wall", base, 0);
  expect(wall.code).toBe(RESULT_OK);
  expect(rowOf(wall.ref)[5]).toBe(rowOf(base)[5]);
  // Places that are not there: a number past the last, a piece that has none on this one, a structure that does not exist.
  expect(join(ada, "wall", base, 4).code).toBe(RESULT_NO_SNAP);
  expect(join(ada, "door", base, 0).code).toBe(RESULT_NO_SNAP);
  expect(join(ada, "wall", 0x7fff0000, 0).code).toBe(RESULT_NO_SNAP);
  // A form the piece does not have; and a hand with nothing to build in it.
  expect(join(ada, "wall", base, 1, 0, 3).code).toBe(RESULT_INVALID);
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(8));
  h.run(100);
  let code = -1;
  ada.onResult = (_seq, c) => void (code = c);
  ada.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(base), w.u8(1), w.u8(0)));
  h.run(150);
  expect(code).toBe(RESULT_INVALID);
  // A wall, a ceiling or a door on open ground; a foundation off the map; and one too far from where she stands.
  const free = (piece: string, x: number, z: number): number => {
    ada.command(CMD_SELECT, (w: BitWriter) => w.u8(PIECES.indexOf(piece)));
    h.run(100);
    ada.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round(x * U), 32), w.sbits(Math.round(z * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
    h.run(150);
    return code;
  };
  expect([free("wall", at.x, at.z + 3), free("ceiling", at.x, at.z + 3), free("door", at.x, at.z + 3)]).toEqual([RESULT_NO_SNAP, RESULT_NO_SNAP, RESULT_NO_SNAP]);
  expect(free("foundation", -50, at.z)).toBe(RESULT_INVALID);
  expect(free("foundation", at.x, at.z + 30)).toBe(RESULT_FAR);
  // Where she stands, she is in the way of it; a step off, she is not.
  expect(free("foundation", at.x, at.z)).toBe(RESULT_OBSTRUCTED);
  expect(free("pillar", at.x - 1.5, at.z)).toBe(RESULT_OK);
  // The dead build nothing.
  h.say(ada, "suicide");
  h.run(300);
  expect(free("foundation", at.x + 3, at.z + 4)).toBe(RESULT_DENIED);

  // Any bytes at all: the server answers each, builds only what its rules allow, and the books still balance.
  const before = structs.count;
  const rng = new Rng(88);
  let answers = 0;
  bob.onResult = () => void answers++;
  let sent = 0;
  for (let i = 0; i < 400; i++) {
    const n = rng.int(14);
    sent++;
    bob.command(CMD_PLACE, (w: BitWriter) => {
      if (rng.int(3) === 0) {
        // Shaped like a real one, with wild numbers in it.
        w.u8(rng.int(4));
        w.u32(rng.int(2) === 0 ? NO_TARGET : rng.int(3) === 0 ? base : rng.int(0x7fffffff));
        for (let k = 0; k < n; k++) w.u8(rng.int(256));
      } else for (let k = 0; k < n; k++) w.u8(rng.int(256));
    });
    if (i % 8 === 7) h.run(300);
  }
  h.run(1000);
  expect(answers).toBe(sent);
  // Whatever got built by chance was his to build: one of the pieces he carries, within his reach, his tribe's.
  for (let c = 0; c < structs.chunks.length; c++) {
    const t = structs.chunks[c];
    if (!t) continue;
    for (let k = 0; k < t.high; k++) {
      if (t.kind[k] === 0 || t.owner[k] !== rowOf(base)[5]) continue;
      expect(reg.role[t.kind[k]!]).toBeGreaterThanOrEqual(0);
      expect(Math.hypot(t.x[k]! - at.x, t.z[k]! - at.z)).toBeLessThan(40);
    }
  }
  expect(structs.count - before).toBe(h.host.build.placed - 3);
  expect(h.host.items.audit()).toEqual([]);
});

test("what is shown is what is built: over two thousand looks with every piece, turned and changed at random, the server's place is the preview's", () => {
  const { h, sessions, rowOf } = builder(["ada"], 60);
  const s = sessions[0]!;
  const pilot = h.pilots[0]!;
  const b = new Builder();
  const rng = new Rng(2026);
  let answer = -1;
  s.onResult = (seq, code) => {
    answer = code;
    b.result(seq, code, 0);
  };
  const counts = { built: 0, agreed: 0, body: 0, nowhere: 0 };
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  const why: Record<number, number> = {};
  const ents = h.world.ents;
  const e = h.ent(s);
  const p = h.reg.move[s.ownKind]!;
  let now = 0;
  for (let i = 0; i < 2000; i++) {
    // Every so often the yard is cleared, so that there is room to begin again.
    if (i % 120 === 119) {
      const structs = h.world.structs;
      for (let c = 0; c < structs.chunks.length; c++) {
        const t = structs.chunks[c];
        if (t) for (let k = 0; k < t.high; k++) if (t.kind[k] !== 0 && t.owner[k] === rec.team) structs.remove(c * 65536 + k);
      }
      h.run(400);
    }
    // Now and then walk somewhere else in the yard; mostly stand and build.
    if (i % 25 === 0) {
      pilot.moveZ = 1;
      pilot.yaw = rng.range(-Math.PI, Math.PI);
      h.run(rng.int(900));
      pilot.moveZ = 0;
      h.run(250);
    }
    const piece = rng.int(PIECES.length);
    // Never short of pieces: what is used is made up, a few at a time, so that the load stays one a body can walk with.
    const item = id(`piece_${PIECES[piece]}_wood`);
    if (s.inventory!.total(item) < 5) h.host.items.mint(rec, item, 20);
    s.command(CMD_SELECT, (w: BitWriter) => w.u8(piece));
    pilot.yaw = rng.range(-Math.PI, Math.PI);
    pilot.pitch = rng.range(-1.3, 0.2);
    h.run(70);
    now += 400;
    for (let k = rng.int(3); k > 0; k--) b.key("KeyE", true, false, now, h.reg);
    for (let k = rng.int(3); k > 0; k--) b.key("KeyR", true, false, now, h.reg);
    if (rng.int(3) === 0) {
      b.key("KeyQ", true, false, now, h.reg);
      b.key("KeyQ", false, false, now + 50, h.reg);
    }
    if (rng.int(12) === 0) b.free = !b.free;
    b.lift = rng.int(5) === 0 ? rng.int(8) - 3 : 0;
    preview(h, s, pilot, b, now);
    if (!b.active || b.problem === RESULT_NO_SNAP) {
      counts.nowhere++;
      continue;
    }
    const pose: Pose = { ...b.pose };
    const [kind, predicted] = [b.kind, b.problem];
    const before = h.host.build.placed;
    answer = -1;
    b.place(s, h.reg);
    h.run(70);
    expect(answer).not.toBe(-1);
    if (answer === RESULT_OK) {
      // Built: exactly where it was shown, as what it was shown as.
      counts.built++;
      expect(predicted).toBe(0);
      expect(h.host.build.placed).toBe(before + 1);
      expect(rowOf(h.host.build.last).slice(0, 5)).toEqual([kind, pose.x, pose.y, pose.z, pose.yaw]);
    } else if (predicted !== 0) {
      // Refused, for the reason the preview gave.
      counts.agreed++;
      why[predicted] = (why[predicted] ?? 0) + 1;
      expect(answer).toBe(predicted);
    } else {
      // Refused where the preview saw nothing against it: only ever because the builder's own body was in the way.
      counts.body++;
      expect(answer).toBe(RESULT_OBSTRUCTED);
      expect(capsuleKind(h.reg.parts, kind, pose.x / U, pose.y / U, pose.z / U, pose.yaw, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height, 0.1)).toBe(true);
    }
  }
  // Enough of each to mean something.
  expect(counts.built).toBeGreaterThan(200);
  expect(counts.agreed).toBeGreaterThan(100);
  expect(counts.nowhere).toBeGreaterThan(50);
  expect(Object.keys(why).length).toBeGreaterThanOrEqual(1);
  expect(s.stats.undecodable).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
  // Every piece's places are known to both sides alike: none was refused as no place at all.
  expect(socketsOf(h.world.structs, h.reg, h.host.build.last, id("wall_wood"), makeSockets())).toBeGreaterThanOrEqual(0);
  expect(poseAt(h.world.structs, h.reg, 0x7fff0000, id("wall_wood"), 0, 0, { x: 0, y: 0, z: 0, yaw: 0 })).toBe(false);
  expect(DOOR_WIDTH).toBe(1.4);
});

test("pieces are made as anything is: an engram at the reference's level, a recipe at its cost, and the thing in hand to set down", () => {
  // Every piece that can be set down has its item, a recipe that makes it, and an engram that teaches the recipe.
  const items = BUILDING_CONTENT.filter((d): d is ItemDef => d.type === "item" && d.places !== undefined);
  expect(items.length).toBe(4 + 6 + 6 + 6);
  const levels: Record<string, number[]> = {};
  for (const item of items) {
    const recipe = BUILDING_CONTENT.find((d): d is RecipeDef => d.type === "recipe" && d.makes === item.id)!;
    const engram = BUILDING_CONTENT.find((d): d is EngramDef => d.type === "engram" && d.unlocks.includes(recipe.id))!;
    expect(engram.label.toLowerCase()).toBe(item.label!);
    (levels[item.id.split("_").at(-1)!] ??= []).push(engram.level);
    // What it is set down as: itself, and for a wall its other forms.
    expect(item.places![0]).toBe(`core:${item.id.slice(11)}`);
  }
  // Thatch at 4, wood from 11 to 14, stone from 24 to 27, metal from 45 to 47.
  expect(Object.fromEntries(Object.entries(levels).map(([tier, l]) => [tier, [Math.min(...l), Math.max(...l)]]))).toEqual({ thatch: [4, 4], wood: [11, 14], stone: [24, 27], metal: [45, 47] });
  const needs = (name: string): [string, number][] => (BUILDING_CONTENT.find((d) => d.id === `core:make-piece_${name}`) as RecipeDef).needs.map((n) => [n.item.slice(5), n.count]);
  expect(needs("wall_wood")).toEqual([["wood", 40], ["thatch", 10], ["fiber", 7]]);
  expect(needs("foundation_thatch")).toEqual([["thatch", 20], ["wood", 6], ["fiber", 15]]);
  expect(needs("ceiling_stone")).toEqual([["stone", 60], ["wood", 30], ["thatch", 20]]);
  expect(needs("foundation_metal")).toEqual([["ingot", 50], ["paste", 15]]);
  expect((reg.defs[id("piece_wall_wood")] as ItemDef).places).toEqual(["core:wall_wood", "core:doorframe_wood", "core:windowframe_wood"]);
  expect((reg.defs[id("piece_wall_thatch")] as ItemDef).places).toEqual(["core:wall_thatch", "core:doorframe_thatch"]);

  // A survivor of level 4 learns the thatch foundation, makes one from what it has gathered, and sets it down.
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada");
  h.run(600);
  h.say(s, "enablecheats");
  const g = flatGround(h, 12, 12);
  h.say(s, `tp ${(g.x + 6).toFixed(3)} ${(g.z + 2).toFixed(3)}`);
  h.say(s, "addxp 100");
  expect(s.progress.level).toBeGreaterThanOrEqual(4);
  for (const [item, n] of [["thatch", 40], ["wood", 12], ["fiber", 30]] as const) h.say(s, `give ${item} ${n}`);
  const say = (fn: () => number, ms = 300): void => {
    fn();
    h.run(ms);
  };
  say(() => s.command(CMD_LEARN, (w: BitWriter) => w.u16(id("engram-piece_foundation_thatch"))));
  say(() => s.command(CMD_CRAFT, (w: BitWriter) => (w.u16(id("make-piece_foundation_thatch")), w.u8(2))), 11000);
  const inv = s.inventory!;
  expect(inv.total(id("piece_foundation_thatch"))).toBe(2);
  expect([inv.total(id("thatch")), inv.total(id("wood")), inv.total(id("fiber"))]).toEqual([0, 0, 0]);
  const from = inv.item.indexOf(id("piece_foundation_thatch"));
  say(() => s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar), w.u16(0), w.u16(id("piece_foundation_thatch")))));
  say(() => s.command(CMD_SELECT, (w: BitWriter) => w.u8(0)));
  const b = new Builder();
  const pilot = h.pilots[0]!;
  pilot.pitch = Math.atan2(-1.62, 5);
  h.run(100);
  preview(h, s, pilot, b);
  expect([b.kind, b.problem]).toEqual([id("foundation_thatch"), 0]);
  say(() => b.place(s, h.reg));
  expect(inv.total(id("piece_foundation_thatch"))).toBe(1);
  expect(h.host.build.placed).toBe(1);
  expect(h.host.items.audit()).toEqual([]);
});

test("in the whole client: the piece in hand is drawn where it would go, the button sets it down and is no blow, and the screen says what is wrong", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = parsePack(buildCorePack());
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  const run = (ms: number) => {
    let packet = null;
    h.run(ms, (now) => (packet = app.frame(now, 1280, 720)));
    return packet as ReturnType<App["frame"]>;
  };
  run(600);
  const s = app.session;
  app.session.text("enablecheats");
  run(300);
  const g = flatGround(h, 14, 14);
  s.text(`tp ${(g.x + 7).toFixed(3)} ${(g.z + 2).toFixed(3)}`);
  run(300);
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  for (const [slot, piece] of ["piece_foundation_wood", "piece_wall_wood"].entries()) {
    h.host.items.mint(rec, id(piece), 3);
    run(200);
    const inv = s.inventory!;
    const from = inv.item.indexOf(id(piece));
    s.command(CMD_MOVE, (w: BitWriter) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(inv.hotbar + slot), w.u16(0), w.u16(id(piece))));
    run(150);
  }
  // Nothing in hand: nothing shown, and the screen's hints are the usual ones.
  const ghost = app.scene!.ghost;
  expect(ghost.kind).toBe(0);
  // A foundation in hand, looking at the ground: it is in the frame as one see-through draw, in the colour for "it may go here".
  app.key("Digit1", true);
  app.controls.yaw = 0;
  app.controls.pitch = Math.atan2(-1.62, 5);
  let packet = run(300)!;
  expect([ghost.kind, ghost.color]).toEqual([id("foundation_wood"), GHOST_OK]);
  const blended = (): number => {
    let n = 0;
    for (let d = 0; d < packet.drawCount; d++) if ((packet.drawFlags[d]! & DRAW_BLEND) !== 0 && packet.drawMesh[d] === app.scene!.meshOfKind[ghost.kind]) n++;
    return n;
  };
  expect(blended()).toBe(1);
  expect(app.ui.frame.find(KEY_AMMO)!.text).toContain("E turn");
  expect(app.ui.frame.find(KEY_PROMPT)).toBeNull();
  // The button sets it down. It is not a punch: the body does nothing with its hands.
  const hits = h.host.combat.hits;
  app.mouseButton(0, true);
  app.mouseButton(0, false);
  run(300);
  expect(h.host.build.placed).toBe(1);
  expect([s.own.act, h.host.combat.hits]).toEqual([0, hits]);
  expect(s.inventory!.total(id("piece_foundation_wood"))).toBe(2);
  // The wall, looking at the foundation: shown on an edge. E, Q and R are building's while it is in hand.
  app.key("Digit2", true);
  packet = run(300)!;
  expect([ghost.kind, ghost.color]).toEqual([id("wall_wood"), GHOST_OK]);
  expect(app.key("KeyR", true)).toBe(true);
  app.key("KeyR", false);
  packet = run(100)!;
  expect(ghost.kind).toBe(id("doorframe_wood"));
  const yaw = ghost.yaw;
  expect(app.key("KeyE", true)).toBe(true);
  app.key("KeyE", false);
  run(100);
  expect(ghost.yaw).toBe((yaw + 32768) & 0xffff);
  app.mouseButton(0, true);
  run(300);
  expect(h.host.build.placed).toBe(2);
  // The same place again: shown in the colour for "it may not", with the reason under the crosshair.
  packet = run(200)!;
  expect([ghost.kind, ghost.color]).toEqual([id("doorframe_wood"), GHOST_BAD]);
  expect(app.ui.frame.find(KEY_PROMPT)!.text).toBe("Something is in the way");
  // Looking at the sky with a wall: nowhere for it, nothing drawn, and the reason said.
  app.controls.pitch = 1;
  packet = run(200)!;
  expect(ghost.kind).toBe(0);
  expect(app.ui.frame.find(KEY_PROMPT)!.text).toBe("It must join something built");
  // With the piece put away, the keys are the body's again and the button is a blow.
  app.key("Digit2", true);
  run(300);
  expect(ghost.kind).toBe(0);
  expect(app.key("KeyQ", true)).toBe(false);
  expect(h.host.items.audit()).toEqual([]);
});

test("nothing is built that nothing would hold up; and when what held a piece goes, the piece falls, and what another still holds stays", () => {
  const { h, sessions, at, join, rowOf, structs } = builder();
  const s = sessions[0]!;
  const team = h.host.records.byPid.get(h.client(s)!.pid)!.team;
  const ok = (piece: string, target: number, socket: number, turn = 0, variant = 0): number => {
    const r = join(s, piece, target, socket, turn, variant);
    expect([piece, r.code]).toEqual([piece, RESULT_OK]);
    return r.ref;
  };
  const mine = (): number => {
    let n = 0;
    for (const t of structs.chunks) if (t) for (let k = 0; k < t.high; k++) if (t.kind[k] !== 0 && t.owner[k] === team) n++;
    return n;
  };
  h.say(s, `tp ${at.x.toFixed(3)} ${(at.z + 3).toFixed(3)}`);
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  s.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round((at.x - 1.5) * U), 32), w.sbits(Math.round((at.z + 8) * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  // Two foundations side by side, west and east. Walls round the outside; on the edge they share, a doorframe with its door.
  const west = h.host.build.last;
  const east = ok("foundation", west, 1);
  const outer = { wn: ok("wall", west, 0), ws: ok("wall", west, 2), ww: ok("wall", west, 3), en: ok("wall", east, 0), es: ok("wall", east, 2), ee: ok("wall", east, 1) };
  const shared = ok("wall", west, 1, 0, 1);
  const door = ok("door", shared, 0);
  // A floor over each, a wall of the upper storey over the west wall, and stairs on the east foundation.
  const overWest = ok("ceiling", outer.ww, 1);
  const overEast = ok("ceiling", outer.ee, 1);
  const upper = ok("wall", outer.ww, 0);
  // Out past the east wall the floor goes two pieces and no further, and the preview knows it.
  const out1 = ok("ceiling", outer.ee, 0);
  const out2 = ok("ceiling", out1, 0);
  expect(join(s, "ceiling", out2, 0).code).toBe(RESULT_NO_SUPPORT);
  expect(join(s, "wall", out2, 0).code).toBe(RESULT_NO_SUPPORT);
  expect(BUILD_REASONS[RESULT_NO_SUPPORT]).toBe("Nothing would hold it up");
  const all = mine();
  expect(all).toBe(2 + 6 + 2 + 2 + 1 + 2);

  // The west foundation is destroyed. Nothing else comes down: its walls hang from the floor above them,
  // which is joined to the doorframe that stands on the east foundation, all within reach.
  const there = (ref: number): boolean => structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] !== 0;
  structs.damage(west, 1e9);
  expect(h.host.build.pending).toBeGreaterThan(0);
  h.run(400);
  expect(h.host.build.pending).toBe(0);
  expect([h.host.build.fallen, mine()]).toEqual([0, all - 1]);
  // The client is shown what went and what did not.
  const seen = (ref: number): number => s.world!.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
  expect([seen(west), seen(shared)]).toEqual([0, rowOf(shared)[0]]);
  // The doorframe goes: its door has no frame, and falls. The rest is still joined, through the floors, to the east walls.
  structs.damage(shared, 1e9);
  h.run(400);
  expect([door, overWest, overEast, outer.ww, upper].map(there)).toEqual([false, true, true, true, true]);
  expect(h.host.build.fallen).toBe(1);
  // The east foundation, the last thing standing on the ground: everything comes down, and nothing of the tribe's remains.
  structs.damage(east, 1e9);
  h.run(600);
  expect(mine()).toBe(0);
  expect(h.host.build.pending).toBe(0);
  expect(h.host.build.fallen).toBe(all - 3);
  // What fell gave nothing back, and the books balance.
  expect(h.host.items.audit()).toEqual([]);

  // A long floor on two pillars; the far pillar goes, and what it alone held falls: the pieces past the near pillar's reach.
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const add = (piece: string, target: number, k: number): number => {
    poseAt(structs, h.reg, target, id(`${piece}_wood`), k, 0, pose);
    return structs.add(id(`${piece}_wood`), pose.x / U, pose.y / U, pose.z / U, pose.yaw, team, 10000);
  };
  const near = structs.add(id("pillar_wood"), at.x - 12, at.y + 1.5 - 0.125, at.z + 14, 0, team, 6250);
  const floor = [add("ceiling", near, 0)];
  for (let k = 0; k < 4; k++) floor.push(add("ceiling", floor[k]!, 1));
  const farPillar = add("pillar", floor[2]!, 1);
  expect(floor.map((r) => h.host.build.support.standsRef(r))).toEqual([true, true, true, true, true]);
  const fell = h.host.build.fallen;
  structs.damage(farPillar, 1e9);
  h.run(300);
  expect(floor.map(there)).toEqual([true, true, true, false, false]);
  expect(h.host.build.fallen - fell).toBe(2);
  for (const r of [near, floor[0]!, floor[1]!, floor[2]!]) structs.remove(r);
  h.run(300);

  // A tower of walls sixty high with its bottom knocked out: all of it comes down, in the tick after, as one removal.
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  s.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round((at.x + 4) * U), 32), w.sbits(Math.round((at.z + 8) * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  const base = h.host.build.last;
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.items.mint(rec, id("piece_wall_wood"), 40);
  h.run(200);
  // Built by the server's own hand past the first few: a builder cannot reach sixty storeys up.
  let top = ok("wall", base, 0);
  const bottom = top;
  for (let k = 0; k < 59; k++) {
    poseAt(structs, h.reg, top, id("wall_wood"), 0, 0, pose);
    top = structs.add(id("wall_wood"), pose.x / U, pose.y / U, pose.z / U, pose.yaw, team, 10000);
  }
  expect(h.host.build.support.standsRef(top)).toBe(true);
  const before = h.host.build.fallen;
  structs.damage(bottom, 1e9);
  const waves = h.host.build.collapse.waves;
  h.server.tick();
  expect(h.host.build.fallen - before).toBe(59);
  expect(h.host.build.collapse.waves - waves).toBe(1);
  expect(mine()).toBe(1);
  h.server.tick();
  expect(h.host.build.collapse.busy).toBe(false);
});

test("a house that comes down: whoever watches is told of it as a few removals and sees its pieces fall from where it began; whoever comes later finds it simply gone", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = parsePack(buildCorePack());
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  // Bob watches too, as a session with nothing to show it: what he is told of stays where it is put.
  const bob = h.join("bob");
  let packet: ReturnType<App["frame"]> = null;
  let most = 0;
  let drawn = 0;
  const wallMesh = (): number => app.scene!.meshOfKind[id("wall_wood")]!;
  const run = (ms: number): void =>
    h.run(ms, (now) => {
      packet = app.frame(now, 1280, 720);
      const falling = app.falling;
      if (!packet || !falling || falling.count === 0) return;
      most = Math.max(most, falling.count);
      // Walls on their way down are in the frame as walls: one plain draw of the frame's own instances.
      for (let d = 0; d < packet.drawCount; d++) if (packet.drawBuffer[d] === TRANSIENT_BUFFER && packet.drawMesh[d] === wallMesh() && packet.drawFlags[d] === 0) drawn = Math.max(drawn, packet.drawInstances[d]!);
    });
  run(600);
  const s = app.session;
  s.text("enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 40, 40);
  s.text(`tp ${(g.x + 20).toFixed(3)} ${(g.z + 3).toFixed(3)}`);
  h.say(bob, `tp ${(g.x + 22).toFixed(3)} ${(g.z + 3).toFixed(3)}`);
  run(300);
  app.controls.yaw = 0;
  app.controls.pitch = 0.1;

  // A house four foundations square and two storeys high, set down by the server's own hand ten metres in front of them.
  const structs = h.world.structs;
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const add = (piece: string, target: number, k: number): number => {
    expect(poseAt(structs, h.reg, target, id(`${piece}_wood`), k, 0, pose)).toBe(true);
    return structs.add(id(`${piece}_wood`), pose.x / U, pose.y / U, pose.z / U, pose.yaw, 9, 10000);
  };
  const N = 4;
  const ground: number[][] = [];
  for (let i = 0; i < N; i++) {
    ground.push([]);
    for (let j = 0; j < N; j++) ground[i]!.push(i === 0 && j === 0 ? structs.add(id("foundation_wood"), g.x + 15, g.y + FOUNDATION_THICK / 2, g.z + 12, 0, 9, 15000) : j === 0 ? add("foundation", ground[i - 1]![0]!, 1) : add("foundation", ground[i]![j - 1]!, 0));
  }
  let tiles = ground;
  for (let storey = 0; storey < 2; storey++) {
    tiles = tiles.map((line, i) =>
      line.map((t, j) => {
        const north = add("wall", t, 0);
        add("wall", t, 1);
        if (j === 0) add("wall", t, 2);
        if (i === 0) add("wall", t, 3);
        return add("ceiling", north, 1);
      }),
    );
  }
  const pieces = N * N + 2 * (N * N * 3 + 2 * N);
  const ours = (st: typeof structs): number => {
    let n = 0;
    for (const t of st.chunks) if (t) for (let k = 0; k < t.high; k++) if (t.kind[k] !== 0 && t.owner[k] === 9) n++;
    return n;
  };
  /** Whether a client has every chunk it holds exactly as the server does: every slot's kind. */
  const same = (c: ClientSession): boolean => c.world!.structs.chunks.every((t, chunk) => !t || Array.from(t.kind.subarray(0, t.high)).join() === Array.from(structs.chunks[chunk]!.kind.subarray(0, t.high)).join());
  expect(ours(structs)).toBe(pieces);
  for (const ref of ground.flat()) expect(h.host.build.support.standsRef(ref)).toBe(true);
  run(1000);
  expect([ours(s.world!.structs), ours(bob.world!.structs), same(s), same(bob)]).toEqual([pieces, pieces, true, true]);
  expect([s.rubble.length, bob.rubble.length, app.falling!.count]).toEqual([0, 0, 0]);

  // Every foundation is destroyed at once. All of it comes down, over a second or so, in a handful of waves.
  const origin = structs.chunks[Math.floor(ground[0]![0]! / 65536)]!;
  const began = [origin.x[ground[0]![0]! & 0xffff]!, origin.y[ground[0]![0]! & 0xffff]!, origin.z[ground[0]![0]! & 0xffff]!];
  const sent = h.server.stats.chunkBytes;
  const from = h.world.tick;
  for (const ref of ground.flat()) structs.damage(ref, 1e9, from);
  const waves = h.host.build.collapse.waves;
  run(2500);
  expect([ours(structs), h.host.build.pending, h.host.build.fallen]).toEqual([0, 0, pieces - N * N]);
  expect(h.host.build.collapse.waves - waves).toBeGreaterThan(1);
  // Both have exactly what the server has, and it cost each of them a fraction of what telling of every row would:
  // four bytes a row at the least.
  expect([ours(s.world!.structs), ours(bob.world!.structs), same(s), same(bob)]).toEqual([0, 0, true, true]);
  const each = (h.server.stats.chunkBytes - sent) / 2;
  expect(each).toBeLessThan(pieces * 2);
  expect(each).toBeGreaterThan(20);

  // Bob was told of every piece once, with why it went: the foundations destroyed, the rest fallen from where the first foundation stood.
  expect(bob.rubble.length).toBe(pieces);
  expect(bob.rubble.filter((r) => r.cause === GONE_DESTROYED).length).toBe(N * N);
  const fell = bob.rubble.filter((r) => r.cause === GONE_FELL);
  expect(fell.length).toBe(pieces - N * N);
  expect(fell.every((r) => r.ox === began[0] && r.oy === began[1] && r.oz === began[2] && r.tick > from && r.tick < from + 60)).toBe(true);
  expect(new Set(bob.rubble.map((r) => `${r.kind} ${r.x} ${r.y} ${r.z}`)).size).toBe(pieces);
  expect(new Set(fell.map((r) => r.tick)).size).toBe(h.host.build.collapse.waves - waves);
  // Ada saw them go: taken in as they came, many in the air at once and drawn there, and all gone into the ground since.
  expect([s.rubble.length, app.falling!.taken, app.falling!.dropped, app.falling!.count]).toEqual([0, pieces, 0, 0]);
  expect(most).toBeGreaterThan(pieces / 2);
  expect(drawn).toBeGreaterThan(10);

  // Whoever comes later is shown what is there now, and nothing of how it came to be.
  const cy = h.join("cy");
  run(1500);
  expect([same(cy), ours(cy.world!.structs), cy.rubble.length]).toEqual([true, 0, 0]);
  // Something that went a while ago is, to those who hear of it only now, simply gone.
  const old = structs.add(id("pillar_wood"), g.x + 20, g.y + 1.375, g.z + 10, 0, 9, 6250);
  run(300);
  expect(ours(bob.world!.structs)).toBe(1);
  const seen = bob.rubble.length;
  structs.damage(old, 1e9, h.world.tick - 100);
  run(300);
  expect([ours(bob.world!.structs), bob.rubble.length - seen, same(bob)]).toEqual([0, 0, true]);
  // A slot emptied and filled again before anyone was told: the new piece is what they have, not a hole where the old one was.
  const first = structs.add(id("pillar_wood"), g.x + 20, g.y + 1.375, g.z + 10, 0, 9, 6250);
  run(300);
  structs.damage(first, 1e9, h.world.tick);
  const second = structs.add(id("foundation_wood"), g.x + 24, g.y + FOUNDATION_THICK / 2, g.z + 10, 0, 9, 15000);
  expect(second).toBe(first);
  run(300);
  expect([ours(bob.world!.structs), same(bob), same(s), same(cy)]).toEqual([1, true, true, true]);
  expect(bob.world!.structs.chunks[Math.floor(second / 65536)]!.kind[second & 0xffff]).toBe(id("foundation_wood"));
  expect(s.stats.undecodable + bob.stats.undecodable + cy.stats.undecodable).toBe(0);
});

test("nothing is built near what another tribe has founded: fifty metres from a foundation, ten from a pillar in the ground", () => {
  const yard = (names: string[]) => {
    const made = builder(names, 120, 10);
    const { h, sessions, at } = made;
    let code = -1;
    for (const s of sessions) s.onResult = (_seq, c) => void (code = c);
    /** Stand `far` metres along the yard and set a piece on the ground three metres further on. */
    const found = (s: ClientSession, piece: string, far: number): number => {
      h.say(s, `tp ${(at.x - 58 + far).toFixed(3)} ${at.z.toFixed(3)}`);
      s.command(CMD_SELECT, (w: BitWriter) => w.u8(PIECES.indexOf(piece)));
      h.run(100);
      code = -1;
      s.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round((at.x - 58 + far + 3) * U), 32), w.sbits(Math.round(at.z * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
      h.run(200);
      return code;
    };
    return { ...made, found };
  };
  const { h, sessions, at, found } = yard(["ada", "bob"]);
  const [ada, bob] = sessions as [ClientSession, ClientSession];
  expect(found(ada, "foundation", 10)).toBe(RESULT_OK);
  // Bob, of no tribe of hers: not thirty metres off, not forty-nine, with a foundation or with a pillar; at fifty-one, yes.
  expect(found(bob, "foundation", 40)).toBe(RESULT_ENEMY_NEAR);
  expect(found(bob, "pillar", 40)).toBe(RESULT_ENEMY_NEAR);
  expect(found(bob, "foundation", 59)).toBe(RESULT_ENEMY_NEAR);
  expect(found(bob, "foundation", 61)).toBe(RESULT_OK);
  expect(BUILD_REASONS[RESULT_ENEMY_NEAR]).toBe("Too near another tribe's foundation");
  // She builds beside her own, away from his; but now his is there, not within fifty metres of it, though it is nearer her own.
  expect(found(ada, "foundation", 5)).toBe(RESULT_OK);
  expect(found(ada, "foundation", 20)).toBe(RESULT_ENEMY_NEAR);
  // In one tribe there is no "another's": his work is hers, and she builds against it.
  h.say(ada, `tp ${(at.x - 5).toFixed(3)} ${(at.z + 1).toFixed(3)}`);
  h.say(bob, `tp ${(at.x - 5).toFixed(3)} ${(at.z + 3).toFixed(3)}`);
  h.say(ada, "tribe create Neighbours");
  h.say(ada, "tribe invite bob");
  h.say(bob, "tribe accept");
  expect(found(ada, "foundation", 44)).toBe(RESULT_OK);
  expect(h.host.items.audit()).toEqual([]);

  // A pillar in the ground keeps others off for ten metres only.
  const other = yard(["cy", "dee"]);
  const [cy, dee] = other.sessions as [ClientSession, ClientSession];
  expect(other.found(cy, "pillar", 20)).toBe(RESULT_OK);
  expect(other.found(dee, "foundation", 26)).toBe(RESULT_ENEMY_NEAR);
  expect(other.found(dee, "pillar", 12)).toBe(RESULT_ENEMY_NEAR);
  expect(other.found(dee, "foundation", 32)).toBe(RESULT_OK);
});
