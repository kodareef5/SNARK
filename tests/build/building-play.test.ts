import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { BUILD_REASONS, Builder, GHOST_BAD, GHOST_OK } from "../../client/core/build.ts";
import { DRAW_BLEND, TRANSIENT_BUFFER } from "../../client/core/render/packet.ts";
import { KEY_AMMO, KEY_PROMPT } from "../../client/core/ui/hud.ts";
import { BUILDING_CONTENT } from "../../content/building.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { ITEMS } from "../../content/items/index.ts";
import { SKATE_PARK } from "../../content/skate-park.ts";
import type { EngramDef, ItemDef } from "../../shared/content/defs.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { DOOR_WIDTH, FOUNDATION_THICK, RISE, WALL_HEIGHT } from "../../content/building.ts";
import { NO_TARGET } from "../../server/build.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { BOX_SELF, CMD_CRAFT, CMD_LEARN, CMD_MOVE, CMD_PLACE, CMD_SELECT, RESULT_BODY, RESULT_DENIED, RESULT_ENEMY_NEAR, RESULT_NO_SUPPORT, RESULT_FAR, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_NO_SNAP, RESULT_OBSTRUCTED, RESULT_OK } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { capsuleKind } from "../../shared/world/collide.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { makeSockets, poseAt, socketsOf, type Pose } from "../../shared/world/snap.ts";
import { GONE_DESTROYED, GONE_FELL } from "../../shared/world/structures.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { PIECES, STOCK, builder } from "../fixtures/build.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;
/** Runs the client's build preview as the app would, from the body's eye along the pilot's look. */
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
  // Slot 9 holds nothing that can be built, so the preview is off.
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(9));
  h.run(100);
  preview(h, s, pilot, b);
  expect([b.active, b.place(s, h.reg)]).toEqual([false, 0]);

  // The look meets the ground 5 m ahead. The foundation's top is 0.125 m above the ground.
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
  const first = h.host.build.last;
  expect(rowOf(first)).toEqual([id("foundation_wood"), b.pose.x, b.pose.y, b.pose.z, b.pose.yaw, team]);
  expect(count(s, "foundation")).toBe(had - 1);
  expect(structs.count).toBe(built + 1);
  const mine = s.world!.structs.chunks[Math.floor(first / 65536)]!;
  expect([mine.kind[first & 0xffff], mine.owner[first & 0xffff]]).toEqual([id("foundation_wood"), team]);

  // Looking at the foundation snaps the piece in hand to its neighbour on the side looked toward.
  pilot.pitch = Math.atan2(-1.62, 6.3);
  h.run(100);
  preview(h, s, pilot, b);
  expect(b.problem).toBe(0);
  expect([b.pose.x, b.pose.y, b.pose.z - 3 * U]).toEqual(rowOf(first).slice(1, 4));
  // Q takes the next nearest socket, a neighbour to one side.
  b.key("KeyQ", true, false, 0, h.reg);
  b.key("KeyQ", false, false, 100, h.reg);
  preview(h, s, pilot, b, 100);
  expect(Math.abs(b.pose.x - rowOf(first)[1]!)).toBe(3 * U);
  expect(b.pose.z).toBe(rowOf(first)[3]!);
  expect(place()).toBe(RESULT_OK);
  // The same place is now taken. The preview says so before the server is asked.
  b.cycle = 1;
  preview(h, s, pilot, b, 100);
  expect([b.problem, b.notice]).toEqual([RESULT_OBSTRUCTED, "Blocked by wooden foundation"]);
  expect(place()).toBe(RESULT_OBSTRUCTED);
  b.cycle = 0;

  // T cycles the wall through doorframe, windowframe and wall. R turns it about.
  hold(s, "wall");
  preview(h, s, pilot, b);
  expect([b.kind, b.problem]).toEqual([id("wall_wood"), 0]);
  const facing = b.pose.yaw;
  b.key("KeyT", true, false, 0, h.reg);
  preview(h, s, pilot, b);
  expect(b.kind).toBe(id("doorframe_wood"));
  b.key("KeyR", true, false, 0, h.reg);
  preview(h, s, pilot, b);
  expect(b.pose.yaw).toBe((facing + 32768) & 0xffff);
  b.key("KeyT", true, false, 0, h.reg);
  preview(h, s, pilot, b);
  expect(b.kind).toBe(id("windowframe_wood"));
  b.key("KeyT", true, false, 0, h.reg);
  b.key("KeyT", true, false, 0, h.reg);
  preview(h, s, pilot, b);
  expect(b.kind).toBe(id("doorframe_wood"));
  expect(place()).toBe(RESULT_OK);
  const frame = h.host.build.last;
  expect(rowOf(frame)[0]).toBe(id("doorframe_wood"));
  expect(rowOf(frame)[2]! / U).toBeCloseTo(rowOf(first)[2]! / U + FOUNDATION_THICK / 2 + WALL_HEIGHT / 2, 6);
  expect(["KeyT", "KeyQ", "KeyR", "ArrowUp", "ArrowDown"].map((k) => b.key(k, false, false, 0, h.reg))).toEqual([true, true, true, true, true]);
  expect(["KeyW", "KeyE"].map((k) => b.key(k, true, false, 0, h.reg))).toEqual([false, false]);

  // Looking away from every structure, a wall has nothing to join.
  pilot.yaw = Math.PI;
  h.run(100);
  preview(h, s, pilot, b, 4000);
  expect([b.problem, b.notice]).toEqual([RESULT_NO_SNAP, "It must join something built"]);
  expect(b.place(s, h.reg)).toBe(0);
  // Holding Q turns snapping off, so the foundation goes down free beside one it could join. Each arrow press raises it an eighth of a metre.
  hold(s, "foundation");
  pilot.yaw = 2.2;
  pilot.pitch = Math.atan2(-1.62, 6);
  h.run(100);
  b.key("KeyQ", true, false, 5000, h.reg);
  preview(h, s, pilot, b, 5400);
  b.key("KeyQ", false, false, 5450, h.reg);
  expect(b.free).toBe(true);
  for (let k = 0; k < 3; k++) b.key("ArrowUp", true, false, 0, h.reg);
  b.key("KeyR", true, false, 0, h.reg);
  preview(h, s, pilot, b, 5500);
  expect(b.problem).toBe(0);
  expect(b.pose.y / U + FOUNDATION_THICK / 2).toBeCloseTo(s.own.y + 0.125 + 3 / 8, 2);
  expect(b.pose.yaw).toBe((Math.round((2.2 / (2 * Math.PI)) * 65536) + 16384) & 0xffff);
  expect(place()).toBe(RESULT_OK);
  expect(rowOf(h.host.build.last).slice(1, 5)).toEqual([b.pose.x, b.pose.y, b.pose.z, b.pose.yaw]);
  // A result with sequence 0 answers no placement, so its reason is not shown.
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
  // The builder stands within reach of the whole house. Four foundations make a square of two by two.
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
  // Walls all round the ground floor. The south wall of the south-west piece is the doorframe.
  const door = ok("wall", sw, 2, 0, 1);
  const walls = [ok("wall", se, 2), ok("wall", se, 1), ok("wall", ne, 1), ok("wall", ne, 0), ok("wall", nw, 0, 0, 2), ok("wall", nw, 3), ok("wall", sw, 3)];
  expect(rowOf(door)[0]).toBe(id("doorframe_wood"));
  expect(rowOf(walls[4]!)[0]).toBe(id("windowframe_wood"));
  // Stairs in the north-east corner rise to the north. The upper floor covers the other three pieces.
  ok("stairs", ne, 0, 0);
  const upSW = ok("ceiling", door, 1);
  const upSE = ok("ceiling", walls[0]!, 1);
  const upNW = ok("ceiling", walls[4]!, 1);
  // The stairs obstruct a floor over them.
  expect(join(s, "ceiling", walls[3]!, 1).code).toBe(RESULT_OBSTRUCTED);
  const upper = [door, ...walls].map((w) => ok("wall", w, 0));
  const roofs = [ok("ceiling", upper[0]!, 1), ok("ceiling", upper[1]!, 1), ok("ceiling", upper[5]!, 1), ok("ceiling", upper[4]!, 1)];
  expect(new Set(roofs.map((r) => rowOf(r)[2])).size).toBe(1);
  expect(structs.count).toBeGreaterThanOrEqual(4 + 8 + 1 + 3 + 8 + 4);
  // Each piece built cost one from the stock. The refused ceiling cost nothing.
  expect([STOCK - count(s, "foundation"), STOCK - count(s, "wall"), STOCK - count(s, "ceiling"), STOCK - count(s, "stairs")]).toEqual([4, 16, 7, 1]);

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
  // The walk goes from the south-east piece north up the stairs, then west onto the upper floor.
  const [stairX, stairZ] = [rowOf(ne)[1]! / U, rowOf(ne)[3]! / U];
  h.say(s, `tp ${stairX.toFixed(3)} ${floor.toFixed(3)} ${(stairZ - 3).toFixed(3)}`);
  pilot.yaw = 0;
  h.run(300);
  // The client predicts the whole climb, so no correction arrives.
  const corrections = s.stats.corrections;
  pilot.moveZ = 1;
  h.run(1500);
  expect(ents.y[e]!).toBeGreaterThan(floor + RISE - 0.35);
  pilot.yaw = -Math.PI / 2;
  h.run(1000);
  pilot.moveZ = 0;
  h.run(300);
  // A body that has climbed steps stands within its ground probe of the floor, a centimetre or two, before it settles.
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
  expect(join(bob, "wall", base, 0).code).toBe(RESULT_NOT_YOURS);
  expect(join(bob, "foundation", base, 1).code).toBe(RESULT_NOT_YOURS);
  expect(count(bob, "wall")).toBe(STOCK);
  // Nothing joins a structure that has no owner (the map's own).
  let plain = -1;
  for (let c = 0; c < structs.chunks.length && plain < 0; c++) {
    const t = structs.chunks[c];
    if (t) for (let k = 0; k < t.high; k++) if (t.kind[k] === id("foundation") && t.owner[k] === 0) plain = c * 65536 + k;
  }
  if (plain >= 0) expect(join(ada, "wall", plain, 0).code).toBe(RESULT_NOT_YOURS);
  h.say(ada, "tribe create Builders");
  h.say(ada, "tribe invite bob");
  h.say(bob, "tribe accept");
  const wall = join(bob, "wall", base, 0);
  expect(wall.code).toBe(RESULT_OK);
  expect(rowOf(wall.ref)[5]).toBe(rowOf(base)[5]);
  // No such place: a socket number past the last, a piece with no socket on this one, and a structure that does not exist.
  expect(join(ada, "wall", base, 4).code).toBe(RESULT_NO_SNAP);
  expect(join(ada, "door", base, 0).code).toBe(RESULT_NO_SNAP);
  expect(join(ada, "wall", 0x7fff0000, 0).code).toBe(RESULT_NO_SNAP);
  // A variant the piece does not have, then a hand with nothing to build.
  expect(join(ada, "wall", base, 1, 0, 3).code).toBe(RESULT_INVALID);
  ada.command(CMD_SELECT, (w: BitWriter) => w.u8(8));
  h.run(100);
  let code = -1;
  ada.onResult = (_seq, c) => void (code = c);
  ada.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(base), w.u8(1), w.u8(0)));
  h.run(150);
  expect(code).toBe(RESULT_INVALID);
  // Free placement: a piece that must join something, a point off the map, and a point too far away.
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
  // Her own body is in the way of a foundation where she stands, and not of a pillar a step off.
  expect(free("foundation", at.x, at.z)).toBe(RESULT_BODY);
  expect(free("pillar", at.x - 1.5, at.z)).toBe(RESULT_OK);
  h.say(ada, "suicide");
  h.run(300);
  expect(free("foundation", at.x + 3, at.z + 4)).toBe(RESULT_DENIED);

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
        // Shaped like a real command, with random numbers in it.
        w.u8(rng.int(4));
        w.u32(rng.int(2) === 0 ? NO_TARGET : rng.int(3) === 0 ? base : rng.int(0x7fffffff));
        for (let k = 0; k < n; k++) w.u8(rng.int(256));
      } else for (let k = 0; k < n; k++) w.u8(rng.int(256));
    });
    if (i % 8 === 7) h.run(300);
  }
  h.run(1000);
  expect(answers).toBe(sent);
  // Anything built by chance is a piece he carries, within his reach, and his tribe's.
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
    // Clears the yard every 120 looks, so there is room to build.
    if (i % 120 === 119) {
      const structs = h.world.structs;
      for (let c = 0; c < structs.chunks.length; c++) {
        const t = structs.chunks[c];
        if (t) for (let k = 0; k < t.high; k++) if (t.kind[k] !== 0 && t.owner[k] === rec.team) structs.remove(c * 65536 + k);
      }
      h.run(400);
    }
    if (i % 25 === 0) {
      pilot.moveZ = 1;
      pilot.yaw = rng.range(-Math.PI, Math.PI);
      h.run(rng.int(900));
      pilot.moveZ = 0;
      h.run(250);
    }
    const piece = rng.int(PIECES.length);
    // Tops up 20 at a time, so the load stays one a body can walk with.
    const item = id(`piece_${PIECES[piece]}_wood`);
    if (s.inventory!.total(item) < 5) h.host.items.mint(rec, item, 20);
    s.command(CMD_SELECT, (w: BitWriter) => w.u8(piece));
    pilot.yaw = rng.range(-Math.PI, Math.PI);
    pilot.pitch = rng.range(-1.3, 0.2);
    h.run(70);
    now += 400;
    for (let k = rng.int(3); k > 0; k--) b.key("KeyR", true, false, now, h.reg);
    for (let k = rng.int(3); k > 0; k--) b.key("KeyT", true, false, now, h.reg);
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
      counts.built++;
      expect(predicted).toBe(0);
      expect(h.host.build.placed).toBe(before + 1);
      expect(rowOf(h.host.build.last).slice(0, 5)).toEqual([kind, pose.x, pose.y, pose.z, pose.yaw]);
    } else if (predicted !== 0) {
      counts.agreed++;
      why[predicted] = (why[predicted] ?? 0) + 1;
      expect(answer).toBe(predicted);
    } else {
      // Refused where the preview found no problem. That happens only when the builder's own body is in the way.
      counts.body++;
      expect(answer).toBe(RESULT_BODY);
      expect(capsuleKind(h.reg.parts, kind, pose.x / U, pose.y / U, pose.z / U, pose.yaw, ents.x[e]!, ents.y[e]!, ents.z[e]!, p.radius, p.height, 0.1)).toBe(true);
    }
  }
  // Enough of each outcome to mean something.
  expect(counts.built).toBeGreaterThan(200);
  expect(counts.agreed).toBeGreaterThan(100);
  expect(counts.nowhere).toBeGreaterThan(50);
  expect(Object.keys(why).length).toBeGreaterThanOrEqual(1);
  expect(s.stats.undecodable).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
  expect(socketsOf(h.world.structs, h.reg, h.host.build.last, id("wall_wood"), makeSockets())).toBeGreaterThanOrEqual(0);
  expect(poseAt(h.world.structs, h.reg, 0x7fff0000, id("wall_wood"), 0, 0, { x: 0, y: 0, z: 0, yaw: 0 })).toBe(false);
  expect(DOOR_WIDTH).toBe(1.4);
});

test("pieces are made as anything is: an engram at the reference's level, at its cost, and the thing in hand to set down", () => {
  // The pack as assembled, where each piece carries how it is made. The item program's stations and the skate park's
  // pieces are counted apart (content/items, content/skate-park.ts).
  const program = new Set([...ITEMS, ...SKATE_PARK].map((d) => d.id));
  const items = CORE_CONTENT.filter((d): d is ItemDef => d.type === "item" && d.places !== undefined && !program.has(d.id));
  // Four thatch pieces, six each of wood, stone and metal, and seven things: three containers, a campfire, a sleeping bag, a
  // simple bed, and a bunk bed, which is made at a Fabricator from what does not exist yet, so nothing makes it.
  expect(items.length).toBe(4 + 6 + 6 + 6 + 7);
  expect(items.filter((d) => d.craft === undefined).map((d) => d.id)).toEqual(["core:piece_bunk_bed"]);
  const levels: Record<string, number[]> = {};
  const stores: [string, number][] = [];
  for (const item of items.filter((d) => d.id !== "core:piece_bunk_bed")) {
    expect(item.craft !== undefined).toBe(true);
    const engram = BUILDING_CONTENT.find((d): d is EngramDef => d.type === "engram" && d.item === item.id)!;
    expect(engram.label.toLowerCase()).toBe(item.label!);
    if (/_(thatch|wood|stone|metal)$/.test(item.id)) (levels[item.id.split("_").at(-1)!] ??= []).push(engram.level);
    else stores.push([item.id.slice(11), engram.level]);
    expect(item.places![0]).toBe(`core:${item.id.slice(11)}`);
  }
  // The vault at ARK's level 75 since stations S6 (Vault).
  expect(stores).toEqual([["storage_box", 4], ["storage_large", 16], ["vault", 75], ["campfire", 2], ["sleeping_bag", 4], ["bed", 7]]);
  expect(Object.fromEntries(Object.entries(levels).map(([tier, l]) => [tier, [Math.min(...l), Math.max(...l)]]))).toEqual({ thatch: [4, 4], wood: [11, 14], stone: [24, 27], metal: [45, 47] });
  const needs = (name: string): [string, number][] => items.find((d) => d.id === `core:piece_${name}`)!.craft!.needs.map((n) => [n.item.slice(5), n.count]);
  expect(needs("wall_wood")).toEqual([["wood", 40], ["thatch", 10], ["fiber", 7]]);
  expect(needs("foundation_thatch")).toEqual([["thatch", 20], ["wood", 6], ["fiber", 15]]);
  expect(needs("ceiling_stone")).toEqual([["stone", 60], ["wood", 30], ["thatch", 20]]);
  expect(needs("foundation_metal")).toEqual([["ingot", 50], ["paste", 15]]);
  expect((reg.defs[id("piece_wall_wood")] as ItemDef).places).toEqual(["core:wall_wood", "core:doorframe_wood", "core:windowframe_wood"]);
  expect((reg.defs[id("piece_wall_thatch")] as ItemDef).places).toEqual(["core:wall_thatch", "core:doorframe_thatch"]);

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
  say(() => s.command(CMD_CRAFT, (w: BitWriter) => (w.u16(id("piece_foundation_thatch")), w.u8(2))), 11000);
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
  const pack = parsePack(corePackBytes());
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
  const ghost = app.scene!.ghost;
  expect(ghost.kind).toBe(0);
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
  expect(app.ui.frame.find(KEY_AMMO)!.text).toContain("R turn");
  expect(app.ui.frame.find(KEY_PROMPT)).toBeNull();
  const hits = h.host.combat.hits;
  app.mouseButton(0, true);
  app.mouseButton(0, false);
  run(300);
  expect(h.host.build.placed).toBe(1);
  expect([s.own.act, h.host.combat.hits]).toEqual([0, hits]);
  expect(s.inventory!.total(id("piece_foundation_wood"))).toBe(2);
  app.key("Digit2", true);
  packet = run(300)!;
  expect([ghost.kind, ghost.color]).toEqual([id("wall_wood"), GHOST_OK]);
  expect(app.key("KeyT", true)).toBe(true);
  app.key("KeyT", false);
  packet = run(100)!;
  expect(ghost.kind).toBe(id("doorframe_wood"));
  const yaw = ghost.yaw;
  expect(app.key("KeyR", true)).toBe(true);
  app.key("KeyR", false);
  run(100);
  expect(ghost.yaw).toBe((yaw + 32768) & 0xffff);
  app.mouseButton(0, true);
  run(300);
  expect(h.host.build.placed).toBe(2);
  // The ghost is still on the place just filled.
  packet = run(200)!;
  expect([ghost.kind, ghost.color]).toEqual([id("doorframe_wood"), GHOST_BAD]);
  expect(app.ui.frame.find(KEY_PROMPT)!.text).toBe("Blocked by wooden doorframe");
  // Looking at the sky, a wall has nothing to join.
  app.controls.pitch = 1;
  packet = run(200)!;
  expect(ghost.kind).toBe(0);
  expect(app.ui.frame.find(KEY_PROMPT)!.text).toBe("It must join something built");
  // Pressing the slot's key again puts the piece away, and Q is no longer building's.
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
  // Two foundations side by side, west and east, with walls round the outside. On the edge they share stands a doorframe with its door.
  const west = h.host.build.last;
  const east = ok("foundation", west, 1);
  const outer = { wn: ok("wall", west, 0), ws: ok("wall", west, 2), ww: ok("wall", west, 3), en: ok("wall", east, 0), es: ok("wall", east, 2), ee: ok("wall", east, 1) };
  const shared = ok("wall", west, 1, 0, 1);
  const door = ok("door", shared, 0);
  // A floor over each, and an upper wall over the west wall.
  const overWest = ok("ceiling", outer.ww, 1);
  const overEast = ok("ceiling", outer.ee, 1);
  const upper = ok("wall", outer.ww, 0);
  // Past the east wall a floor reaches two pieces and no further.
  const out1 = ok("ceiling", outer.ee, 0);
  const out2 = ok("ceiling", out1, 0);
  expect(join(s, "ceiling", out2, 0).code).toBe(RESULT_NO_SUPPORT);
  expect(join(s, "wall", out2, 0).code).toBe(RESULT_NO_SUPPORT);
  expect(BUILD_REASONS[RESULT_NO_SUPPORT]).toBe("Nothing would hold it up");
  const all = mine();
  expect(all).toBe(2 + 6 + 2 + 2 + 1 + 2);

  // With the west foundation destroyed nothing else falls. Its walls hang from the floor above, which joins the doorframe on the east foundation.
  const there = (ref: number): boolean => structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff] !== 0;
  structs.damage(west, 1e9);
  expect(h.host.build.pending).toBeGreaterThan(0);
  h.run(400);
  expect(h.host.build.pending).toBe(0);
  expect([h.host.build.fallen, mine()]).toEqual([0, all - 1]);
  const seen = (ref: number): number => s.world!.structs.chunks[Math.floor(ref / 65536)]!.kind[ref & 0xffff]!;
  expect([seen(west), seen(shared)]).toEqual([0, rowOf(shared)[0]]);
  // Without its frame the door falls. The west floor still joins the east walls through the east floor. The west walls
  // hung from it and the upper wall on it are a piece further from those walls by the way through the pieces, and fall.
  structs.damage(shared, 1e9);
  h.run(400);
  expect([door, overWest, overEast, outer.ww, upper].map(there)).toEqual([false, true, true, false, false]);
  expect(h.host.build.fallen).toBe(5);
  // The east foundation is the last piece on the ground, so all the rest falls. The three destroyed pieces do not count as fallen.
  structs.damage(east, 1e9);
  h.run(600);
  expect(mine()).toBe(0);
  expect(h.host.build.pending).toBe(0);
  expect(h.host.build.fallen).toBe(all - 3);
  expect(h.host.items.audit()).toEqual([]);

  // A floor of five on two pillars. With the far pillar gone, the two pieces past the near pillar's reach fall.
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

  // A tower of sixty walls with its bottom knocked out falls in one tick, as one wave.
  s.command(CMD_SELECT, (w: BitWriter) => w.u8(0));
  h.run(100);
  s.command(CMD_PLACE, (w: BitWriter) => (w.u8(0), w.u32(NO_TARGET), w.sbits(Math.round((at.x + 4) * U), 32), w.sbits(Math.round((at.z + 8) * U), 32), w.u16(0), w.sbits(0, 8), w.u8(0)));
  h.run(200);
  const base = h.host.build.last;
  const rec = h.host.records.byPid.get(h.client(s)!.pid)!;
  h.host.items.mint(rec, id("piece_wall_wood"), 40);
  h.run(200);
  // Past the first wall the test adds rows directly, because a builder cannot reach sixty storeys up.
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
  const pack = parsePack(corePackBytes());
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  // Bob is a bare session with no app to consume its rubble list, so the list keeps every removal he was sent.
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
      // Falling walls are one plain draw of wall instances from the frame's transient buffer.
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

  // A house four foundations square and two storeys high, added directly in front of them.
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
  /** Whether every chunk the client holds has the server's kind in every slot. */
  const same = (c: ClientSession): boolean => c.world!.structs.chunks.every((t, chunk) => !t || Array.from(t.kind.subarray(0, t.high)).join() === Array.from(structs.chunks[chunk]!.kind.subarray(0, t.high)).join());
  expect(ours(structs)).toBe(pieces);
  for (const ref of ground.flat()) expect(h.host.build.support.standsRef(ref)).toBe(true);
  run(1000);
  expect([ours(s.world!.structs), ours(bob.world!.structs), same(s), same(bob)]).toEqual([pieces, pieces, true, true]);
  expect([s.rubble.length, bob.rubble.length, app.falling!.count]).toEqual([0, 0, 0]);

  const origin = structs.chunks[Math.floor(ground[0]![0]! / 65536)]!;
  const began = [origin.x[ground[0]![0]! & 0xffff]!, origin.y[ground[0]![0]! & 0xffff]!, origin.z[ground[0]![0]! & 0xffff]!];
  const sent = h.server.stats.chunkBytes;
  const from = h.world.tick;
  for (const ref of ground.flat()) structs.damage(ref, 1e9, from);
  const waves = h.host.build.collapse.waves;
  run(2500);
  expect([ours(structs), h.host.build.pending, h.host.build.fallen]).toEqual([0, 0, pieces - N * N]);
  expect(h.host.build.collapse.waves - waves).toBeGreaterThan(1);
  // Removing row by row would cost at least four bytes a row. Each client got the collapse for under two.
  expect([ours(s.world!.structs), ours(bob.world!.structs), same(s), same(bob)]).toEqual([0, 0, true, true]);
  const each = (h.server.stats.chunkBytes - sent) / 2;
  expect(each).toBeLessThan(pieces * 2);
  expect(each).toBeGreaterThan(20);

  // The fallen pieces carry the first foundation's position as their origin.
  expect(bob.rubble.length).toBe(pieces);
  expect(bob.rubble.filter((r) => r.cause === GONE_DESTROYED).length).toBe(N * N);
  const fell = bob.rubble.filter((r) => r.cause === GONE_FELL);
  expect(fell.length).toBe(pieces - N * N);
  expect(fell.every((r) => r.ox === began[0] && r.oy === began[1] && r.oz === began[2] && r.tick > from && r.tick < from + 60)).toBe(true);
  expect(new Set(bob.rubble.map((r) => `${r.kind} ${r.x} ${r.y} ${r.z}`)).size).toBe(pieces);
  expect(new Set(fell.map((r) => r.tick)).size).toBe(h.host.build.collapse.waves - waves);
  expect([s.rubble.length, app.falling!.taken, app.falling!.dropped, app.falling!.count]).toEqual([0, pieces, 0, 0]);
  expect(most).toBeGreaterThan(pieces / 2);
  expect(drawn).toBeGreaterThan(10);

  const cy = h.join("cy");
  run(1500);
  expect([same(cy), ours(cy.world!.structs), cy.rubble.length]).toEqual([true, 0, 0]);
  // A removal stamped 100 ticks ago is no longer news, so it adds no rubble.
  const old = structs.add(id("pillar_wood"), g.x + 20, g.y + 1.375, g.z + 10, 0, 9, 6250);
  run(300);
  expect(ours(bob.world!.structs)).toBe(1);
  const seen = bob.rubble.length;
  structs.damage(old, 1e9, h.world.tick - 100);
  run(300);
  expect([ours(bob.world!.structs), bob.rubble.length - seen, same(bob)]).toEqual([0, 0, true]);
  // A slot emptied and refilled before the next sync. Clients get the new piece, not a hole.
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
    /** Stands `far` metres along the yard and places a piece on the ground 3 m further on. */
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
  // Ada's foundation is at 13 m. Bob's attempts land 30, 49 and 51 m from it.
  expect(found(bob, "foundation", 40)).toBe(RESULT_ENEMY_NEAR);
  expect(found(bob, "pillar", 40)).toBe(RESULT_ENEMY_NEAR);
  expect(found(bob, "foundation", 59)).toBe(RESULT_ENEMY_NEAR);
  expect(found(bob, "foundation", 61)).toBe(RESULT_OK);
  expect(BUILD_REASONS[RESULT_ENEMY_NEAR]).toBe("Too near another tribe's foundation");
  // Bob's foundation at 64 m now keeps Ada off too. 8 m is 56 m from it, and 23 m is 41 m from it.
  expect(found(ada, "foundation", 5)).toBe(RESULT_OK);
  expect(found(ada, "foundation", 20)).toBe(RESULT_ENEMY_NEAR);
  // In one tribe she may build 17 m from his.
  h.say(ada, `tp ${(at.x - 5).toFixed(3)} ${(at.z + 1).toFixed(3)}`);
  h.say(bob, `tp ${(at.x - 5).toFixed(3)} ${(at.z + 3).toFixed(3)}`);
  h.say(ada, "tribe create Neighbours");
  h.say(ada, "tribe invite bob");
  h.say(bob, "tribe accept");
  expect(found(ada, "foundation", 44)).toBe(RESULT_OK);
  expect(h.host.items.audit()).toEqual([]);

  // Cy's pillar is at 23 m. Dee's attempts land 6, 8 and 12 m from it.
  const other = yard(["cy", "dee"]);
  const [cy, dee] = other.sessions as [ClientSession, ClientSession];
  expect(other.found(cy, "pillar", 20)).toBe(RESULT_OK);
  expect(other.found(dee, "foundation", 26)).toBe(RESULT_ENEMY_NEAR);
  expect(other.found(dee, "pillar", 12)).toBe(RESULT_ENEMY_NEAR);
  expect(other.found(dee, "foundation", 32)).toBe(RESULT_OK);
});
