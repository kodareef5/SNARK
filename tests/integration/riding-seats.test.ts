// Riding on seats (server/riding.ts over server/occupancy.ts): a saddled creature is a host of the seats its saddle
// declares, as a car is of its own. Getting on and off are short claims checked at both ends, getting off is tested
// against the world, passengers sit behind and may look and aim, nobody carjacks a creature, and none of it is a
// misprediction on a lossy link.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { FLOOR_THICK } from "../../content/building.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HEAD, HUMAN, HUMAN_BONES, ZONE_HEAD } from "../../shared/anim/human.ts";
import { createMountMotion, mountPose } from "../../shared/anim/mount.ts";
import { AnimState, bodySeed } from "../../shared/anim/pose.ts";
import { anchorFrame, SEAT_FLOATS, seatOn } from "../../shared/anim/seat.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { GEAR_WORN } from "../../shared/sim/entities.ts";
import { mounted } from "../fixtures/flyer/course.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import type { LinkOptions } from "../../shared/net/loopback.ts";
import { CMD_ORDER, ORDER_UNSADDLE, RESULT_BUSY, RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_JUMP, BTN_SPRINT, BTN_USE, MF_ROOTED, MODE_FLYER, MODE_WALK, STANCE_STAND } from "../../shared/sim/character.ts";
import type { Seat } from "../../shared/sim/seats.ts";
import { V_TORPOR } from "../../shared/sim/vitals.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { flatGround } from "../fixtures/arena.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const core = coreRegistry();
const id = (reg: Registry, name: string): number => reg.index.get(`core:${name}`)!;

/** A large mount's passenger saddle, as the vehicles' reviewer sketched it: the rider steers, two sit behind on no socket. */
const THREE: Seat[] = [
  { id: "rider", driver: true, socket: "seat", anchor: [0, 2.57, 0.7], entry: [1.7, 0, 0.7] },
  { id: "passenger_left", anchor: [0.35, 2.45, -0.15], entry: [1.7, 0, -0.15] },
  { id: "passenger_right", anchor: [-0.35, 2.45, -0.15], entry: [-1.7, 0, -0.15] },
];
let three: Registry | null = null;
function threeSeats(): Registry {
  if (three) return three;
  const content = CORE_CONTENT.map((d) => (d.type === "item" && d.id === "core:saddle_parasaur" ? { ...d, saddle: { ...d.saddle!, seats: THREE } } : d));
  const { registry, errors } = compileContent(content);
  if (!registry) throw new Error(errors.join("\n"));
  return (three = registry);
}

/**
 * Survivors of one tribe on flat ground, the first 2.5 m west of a saddled `species` of theirs that faces north and
 * stays; each joins over `link`.
 */
function yard(species: string, names: string[], opts: { reg?: Registry; link?: LinkOptions; dbPath?: string } = {}) {
  const reg = opts.reg ?? core;
  const h = new Harness({}, 1, 60, { dev: true, ...(opts.dbPath ? { dbPath: opts.dbPath } : {}) }, reg);
  const sessions = names.map((n) => h.join(n, opts.link ?? {}));
  h.run(500);
  const g = flatGround(h, 40, 30);
  const at = { x: g.x + 20, y: g.y, z: g.z + 15 };
  sessions.forEach((s, i) => {
    h.say(s, "enablecheats");
    h.say(s, `tp ${(at.x - 2.5).toFixed(3)} ${(at.z - 1.5 + i * 1.5).toFixed(3)}`);
  });
  if (names.length > 1) {
    h.say(sessions[0]!, "tribe create Riders");
    for (const s of sessions.slice(1)) {
      h.say(sessions[0]!, `tribe invite ${names[sessions.indexOf(s)]}`);
      h.say(s, "tribe accept");
    }
  }
  const recs = sessions.map((s) => h.host.records.byPid.get(h.client(s)!.pid)!);
  const e = h.host.spawnCreature(`core:${species}`, at.x, at.z, 1);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  rec.team = recs[0]!.team;
  rec.saddle = id(reg, `saddle_${species}`);
  h.world.ents.yaw[e] = 0;
  h.host.refreshBody(rec);
  h.host.creatures.claimed(e);
  h.host.creatures.mind.stay(e, 0xffffffff);
  h.run(300);
  for (const r of recs) expect(r.team).toBe(rec.team);
  return { h, reg, sessions, recs, e, rec, at, clients: sessions.map((s) => h.client(s)!) };
}

/** Presses the use key as a player does, looking at entity `e`. */
function press(h: Harness, s: ClientSession, e: number): void {
  const ents = h.world.ents, me = h.ent(s), pilot = h.pilots[h.sessions.indexOf(s)]!;
  const [dx, dz] = [ents.x[e]! - ents.x[me]!, ents.z[e]! - ents.z[me]!];
  pilot.yaw = Math.atan2(dx, dz);
  pilot.pitch = -0.1;
  h.run(150);
  pilot.buttons = BTN_USE;
  h.run(100);
  pilot.buttons = 0;
  h.run(300);
}

test("getting on is a claim of four ticks, checked when it is pressed and again when it lands: walked out of reach meanwhile, she is not seated", () => {
  const { h, clients, e } = yard("raptor", ["ada"]);
  const c = clients[0]!, riding = h.host.riding, ents = h.world.ents;
  expect(riding.mount(c, e)).toBe(RESULT_OK);
  // Pressed, not yet on: the claim waits four ticks.
  expect([riding.riding(c), c.drive, riding.occupancy.pending(c.pid)?.kind, riding.occupancy.pending(c.pid)!.dueAt - h.world.tick]).toEqual([false, -1, "enter", 4]);
  h.run(100);
  expect(riding.riding(c)).toBe(false);
  h.run(70);
  expect([riding.riding(c), c.drive, ents.seat[c.ent], ents.seatSlot[c.ent], riding.occupancy.pending(c.pid)]).toEqual([true, e, e + 1, 1, null]);
  riding.dismount(c);
  h.run(300);
  expect(riding.riding(c)).toBe(false);
  // Off again, and carried 9 m away before the claim lands.
  expect(riding.mount(c, e)).toBe(RESULT_OK);
  ents.setPosition(c.ent, ents.x[e]! - 9, ents.y[c.ent]!, ents.z[e]!);
  h.run(300);
  expect([riding.riding(c), c.drive, ents.seat[c.ent], riding.occupancy.pending(c.pid), riding.mounted]).toEqual([false, -1, 0, null, 1]);
});

test("getting off is tested against the world: a wall on the seat's side sets her down on the other, and she is never set off a ledge", () => {
  const { h, reg, sessions, clients, e } = yard("raptor", ["ada"]);
  const c = clients[0]!, riding = h.host.riding, ents = h.world.ents, world = h.world;
  const p = reg.move[id(reg, "survivor")]!;
  // She rides it facing north, which it turns to as she looks there.
  const pilot = h.pilots[0]!;
  const ride = (): void => {
    pilot.yaw = 0;
    expect(riding.mount(c, e)).toBe(RESULT_OK);
    h.run(800);
    expect([riding.riding(c), ents.yaw[e]! < 300 || ents.yaw[e]! > 65236]).toEqual([true, true]);
  };
  const off = (): void => {
    pilot.buttons = BTN_USE;
    h.run(100);
    pilot.buttons = 0;
    h.run(300);
    void sessions;
    expect([riding.riding(c), ents.seat[c.ent], ents.stance[c.ent], capsuleFree(world, ents.x[c.ent]!, ents.y[c.ent]!, ents.z[c.ent]!, p.radius, p.height)]).toEqual([false, 0, STANCE_STAND, true]);
  };
  // In the open she gets off by the seat's side, the raptor's left, which is east as it faces north.
  ride();
  off();
  expect(ents.x[c.ent]! - ents.x[e]!).toBeGreaterThan(0.9);
  // A wall there: she gets off on its right.
  ride();
  const [mx, my, mz] = [ents.x[e]!, ents.y[e]!, ents.z[e]!];
  expect(world.structs.add(id(reg, "wall_stone"), mx + 1.4, my + 1.5, mz, 16384, 99, 10000)).toBeGreaterThanOrEqual(0);
  off();
  expect(ents.x[c.ent]! - ents.x[e]!).toBeLessThan(-0.9);
  // On a stone floor 3 m up 8 m west, at its east edge: east of the raptor is a drop she is not set down over.
  ride();
  const top = my + 3, lx = mx - 8;
  for (const dx of [-1.5, -4.5]) expect(world.structs.add(id(reg, "ceiling_stone"), lx + dx + 0.8, top - FLOOR_THICK / 2, mz, 0, 99, 10000)).toBeGreaterThanOrEqual(0);
  ents.setPosition(e, lx, top + 0.05, mz);
  h.run(600);
  expect(Math.abs(ents.y[e]! - top)).toBeLessThan(0.1);
  off();
  expect([ents.x[c.ent]! - ents.x[e]! < -0.9, Math.abs(ents.y[c.ent]! - top) < 0.3]).toEqual([true, true]);
});

test("no carjacking a creature: its one seat taken, a tribe mate is told it is busy, and a claim to pull its rider off is refused", () => {
  const { h, clients, e, recs } = yard("raptor", ["ada", "bob"]);
  const [ada, bob] = clients as [typeof clients[0], typeof clients[0]];
  const riding = h.host.riding;
  expect(riding.mount(ada, e)).toBe(RESULT_OK);
  h.run(300);
  expect([riding.riding(ada), riding.riderOf(e)]).toEqual([true, recs[0]]);
  expect(riding.mount(bob, e)).toBe(RESULT_BUSY);
  riding.occupancy.bindActor(bob.pid, 9999, h.world.tick);
  const pid = h.world.ents.pid[e]!;
  expect(riding.occupancy.begin({ actor: bob.pid, actorEpoch: 9999, requestId: 1, host: pid, seat: "rider", kind: "carjack" }, h.world.tick, 4)).toEqual({ ok: false, reason: "no-carjack" });
  h.run(300);
  expect([riding.riding(ada), riding.riding(bob), riding.riderOf(e)]).toEqual([true, false, recs[0]]);
});

test("a saddle of three seats: one steers and two ride behind, pinned where they sit; their packs weigh on the mount; a passenger keeps the saddle on and falls off knocked out", () => {
  const reg = threeSeats();
  const { h, sessions, clients, recs, e, rec } = yard("parasaur", ["ada", "bob", "cy"], { reg });
  const [ada, bob, cy] = clients as [typeof clients[0], typeof clients[0], typeof clients[0]];
  const riding = h.host.riding, ents = h.world.ents;
  for (const c of clients) expect(riding.mount(c, e)).toBe(RESULT_OK);
  h.run(400);
  expect([ents.seatSlot[ada.ent], ents.seatSlot[bob.ent], ents.seatSlot[cy.ent], ada.drive, bob.drive, cy.drive]).toEqual([1, 2, 3, e, -1, -1]);
  // Seats on no socket sit at their anchors, turned as the mount faces.
  const frame = new Float64Array(SEAT_FLOATS);
  const pinned = (c: typeof ada, seat: Seat): number => {
    anchorFrame(seat.anchor, ents.x[e]!, ents.y[e]!, ents.z[e]!, (ents.yaw[e]! / 65536) * Math.PI * 2, frame);
    return Math.hypot(ents.x[c.ent]! - frame[0]!, ents.y[c.ent]! - frame[1]!, ents.z[c.ent]! - frame[2]!);
  };
  expect([pinned(bob, THREE[1]!) < 1e-3, pinned(cy, THREE[2]!) < 1e-3]).toEqual([true, true]);
  // She rides it north with both behind her, and nobody's prediction is corrected; they go with it.
  const settled = sessions.map((s) => s.stats.corrections);
  const z0 = ents.z[e]!;
  h.pilots[0]!.yaw = 0;
  h.pilots[0]!.moveZ = 127;
  h.pilots[1]!.yaw = Math.PI / 2;
  h.run(2500);
  h.pilots[0]!.moveZ = 0;
  h.run(500);
  expect(ents.z[e]! - z0).toBeGreaterThan(4);
  expect([pinned(bob, THREE[1]!) < 1e-3, pinned(cy, THREE[2]!) < 1e-3]).toEqual([true, true]);
  expect(sessions.map((s, i) => s.stats.corrections - settled[i]!)).toEqual([0, 0, 0]);
  // A passenger looks where it will.
  expect(Math.abs(((ents.yaw[bob.ent]! - 16384 + 32768) & 0xffff) - 32768)).toBeLessThan(200);
  // Neither the mount's bite nor a passenger's shot finds whoever sits on it, nor the mount under a passenger.
  const combat = h.host.combat;
  expect(combat.castBodies(e, ents.x[e]!, ents.y[e]! + 3.2, ents.z[e]! + 3, 0, 0, -1, 6)).not.toBe(ada.ent);
  expect([bob.ent, cy.ent, e]).not.toContain(combat.castBodies(bob.ent, ents.x[bob.ent]!, ents.y[bob.ent]! + 1.2, ents.z[bob.ent]!, 0, -1, 0, 4));
  // Bob's 300 kg on its 255 roots it, and off it, it is free.
  h.host.items.mint(recs[1]!, id(reg, "stone"), 600);
  h.run(200);
  expect(ents.mflags[e]! & MF_ROOTED).toBe(MF_ROOTED);
  riding.dismount(bob);
  h.run(300);
  expect([riding.riding(bob), ents.mflags[e]! & MF_ROOTED]).toEqual([false, 0]);
  // With nobody steering and Cy behind, the saddle stays on.
  riding.dismount(ada);
  h.run(300);
  let code = -1;
  sessions[0]!.onResult = (seq, result) => void (seq !== 0 && (code = result));
  sessions[0]!.command(CMD_ORDER, (w: BitWriter) => (w.u32(e), w.u8(ORDER_UNSADDLE)));
  h.run(200);
  expect([code, rec.saddle]).toEqual([RESULT_BUSY, id(reg, "saddle_parasaur")]);
  // Cy, knocked out, falls off beside it.
  h.host.survival.add(recs[2]!, V_TORPOR, recs[2]!.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(300);
  expect([recs[2]!.out, riding.riding(cy), ents.seat[cy.ent], Math.abs(ents.y[cy.ent]! - groundUnder(h.world.hf, ents.x[cy.ent]!, ents.z[cy.ent]!, 0.3)) < 0.1]).toEqual([true, false, 0, true]);
});

test("a bola'd rider stays on and steers (D450); one knocked out falls off and her inputs move nothing", () => {
  const { h, clients, recs, e } = yard("raptor", ["ada"]);
  const c = clients[0]!, riding = h.host.riding, ents = h.world.ents;
  expect(riding.mount(c, e)).toBe(RESULT_OK);
  h.run(300);
  expect(h.host.entangle.give(recs[0]!, id(core, "entangled"), 0)).toBe(true);
  h.run(100);
  const z0 = ents.z[e]!;
  h.pilots[0]!.yaw = 0;
  h.pilots[0]!.moveZ = 127;
  h.run(1500);
  expect([riding.riding(c), ents.z[e]! - z0 > 3]).toEqual([true, true]);
  h.host.survival.add(recs[0]!, V_TORPOR, recs[0]!.vitals!.max[V_TORPOR]! / 1e6 + 1);
  h.run(300);
  const z1 = ents.z[e]!;
  h.run(1000);
  expect([riding.riding(c), c.drive, ents.seat[c.ent], Math.abs(ents.z[e]! - z1) < 0.5]).toEqual([false, -1, 0, true]);
});

test("on a 60 ms link that loses 2% of its packets, getting on, riding, flying and getting off are never corrected", () => {
  for (const species of ["raptor", "pteranodon"]) {
    const { h, sessions, e } = yard(species, ["ada"], { link: { latencyMs: 60, loss: 0.02 } });
    const s = sessions[0]!, pilot = h.pilots[0]!;
    h.run(1000);
    const settled = [s.stats.corrections, s.stats.stateCorrections];
    press(h, s, e);
    h.run(500);
    expect(s.driving).toBe(e);
    pilot.yaw = 0;
    pilot.pitch = species === "pteranodon" ? 0.4 : 0;
    pilot.moveZ = 127;
    if (species === "pteranodon") pilot.buttons = BTN_JUMP;
    h.run(4000);
    if (species === "pteranodon") expect(h.world.ents.mode[e]).toBe(MODE_FLYER);
    pilot.moveZ = 0;
    pilot.pitch = 0;
    pilot.buttons = 0;
    h.run(species === "pteranodon" ? 6000 : 1000);
    expect(h.world.ents.mode[e]).toBe(MODE_WALK);
    press(h, s, e);
    h.run(500);
    expect(s.driving).toBe(-1);
    pilot.moveZ = 127;
    h.run(1500);
    expect([species, s.stats.corrections - settled[0]!, s.stats.stateCorrections - settled[1]!]).toEqual([species, 0, 0]);
    h.host.shutdown();
  }
});

test("in the whole client the riding camera is behind the look, on a boom as long as the mount is big, and drawn in by a wall", () => {
  const seen = (["raptor", "parasaur"] as const).map((species) => {
    const h = new Harness({}, 1, 60, { dev: true });
    const app = new App(h.join("ada", {}, { manual: true }), h.reg, corePack());
    const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
    run(600);
    const s = app.session;
    s.text("enablecheats");
    run(300);
    const g = flatGround(h, 60, 30);
    s.text(`tp ${(g.x + 30).toFixed(3)} ${(g.z + 8).toFixed(3)}`);
    run(300);
    const me = h.host.records.byPid.get(h.client(s)!.pid)!;
    const e = h.host.spawnCreature(`core:${species}`, g.x + 30, g.z + 11, 1);
    const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
    rec.team = me.team;
    rec.saddle = id(core, `saddle_${species}`);
    h.host.refreshBody(rec);
    h.host.creatures.claimed(e);
    h.host.creatures.mind.stay(e, 0xffffffff);
    app.controls.yaw = 0;
    app.controls.pitch = -0.1;
    run(400);
    expect(app.hud.prompt.startsWith("E  ride")).toBe(true);
    app.key("KeyE", true);
    run(80);
    app.key("KeyE", false);
    run(1200);
    expect(s.driving).toBe(e);
    const ents = h.world.ents, cam = app.cam;
    const back = Math.hypot(cam.x - ents.x[e]!, cam.z - ents.z[e]!);
    // Behind it: south of a mount that faces north, a little above its rider's head.
    const behind = ents.z[e]! - cam.z > back * 0.9 && cam.y > ents.y[h.ent(s)]! + 1;
    // A wall three storeys high 2.2 m behind it draws the camera in to its near side.
    for (const up of [1.5, 4.5, 7.5]) expect(h.world.structs.add(id(core, "wall_stone"), ents.x[e]!, ents.y[e]! + up, ents.z[e]! - 2.2, 0, 99, 10000)).toBeGreaterThanOrEqual(0);
    run(300);
    const walled = ents.z[e]! - cam.z;
    h.host.shutdown();
    return { species, back, behind, walled };
  });
  for (const v of seen) expect([v.species, v.behind, v.walled > 0 && v.walled < 2.1]).toEqual([v.species, true, true]);
  expect(seen[0]!.back).toBeGreaterThan(4);
  expect(seen[1]!.back).toBeGreaterThan(seen[0]!.back * 1.5);
});

test("on the pteranodon in a hard bank, its rider is pinned in her seat's whole frame and a shot at her head as it is drawn there finds her head", () => {
  const m = mounted(60, ["bob"]);
  const { h, e } = m;
  const ents = h.world.ents, pilot = h.pilots[0]!;
  const rider = h.ent(m.ada), shooter = h.ent(m.others[0]!);
  const anim = h.world.anims[ents.kind[e]!]!;
  const seat = h.reg.saddleSeats[ents.gear[e]![GEAR_WORN]!]![0]!;
  const frame = new Float64Array(SEAT_FLOATS), st = new AnimState();
  const seatNow = (): void => {
    st.unpack(ents.anim[e]!, ents.cue[e]!);
    st.seed = bodySeed(e);
    seatOn(anim, seat, st, h.world.tick, ents.x[e]!, ents.y[e]!, ents.z[e]!, (ents.yaw[e]! / 65536) * Math.PI * 2, frame);
  };
  // Up, sprinting, then the look swung hard round: the chest, and the seat on it, bank.
  pilot.buttons = BTN_JUMP;
  pilot.moveZ = 127;
  pilot.pitch = 0.4;
  h.run(4000);
  pilot.pitch = 0;
  pilot.buttons = BTN_JUMP | BTN_SPRINT;
  h.run(2000);
  let tilt = 0;
  for (let t = 0; t < 2000 && tilt < 0.25; t += 50) {
    pilot.yaw += 0.12;
    h.run(50);
    seatNow();
    tilt = Math.acos(Math.min(1, frame[7]!));
  }
  expect([ents.mode[e], tilt > 0.25]).toEqual([MODE_FLYER, true]);
  // Where she is pinned is her seat's origin as the flyer is posed now.
  expect(Math.hypot(ents.x[rider]! - frame[0]!, ents.y[rider]! - frame[1]!, ents.z[rider]! - frame[2]!)).toBeLessThan(1e-3);
  // Her head as every client draws her: astride, in the seat's frame.
  const pose = new Pose(HUMAN_BONES), solved = new Solved(HUMAN_BONES);
  mountPose(createMountMotion(), { role: "ride", tick: 0, startTick: 0, durationTicks: 1 }, pose);
  solve(HUMAN, pose, solved);
  const [lx, ly, lz] = [solved.pos[B_HEAD * 3]!, solved.pos[B_HEAD * 3 + 1]! + 0.1, solved.pos[B_HEAD * 3 + 2]!];
  const head = [0, 1, 2].map((r) => frame[r]! + frame[3 + r * 3]! * lx + frame[4 + r * 3]! * ly + frame[5 + r * 3]! * lz);
  // A ray from 6 m off, square to the seat's forward and level, through that point.
  const [fx, fz] = [frame[5]!, frame[11]!];
  const [sx, sz] = [-fz / Math.hypot(fx, fz), fx / Math.hypot(fx, fz)];
  const combat = h.host.combat;
  expect([combat.castBodies(shooter, head[0]! - sx * 6, head[1]!, head[2]! - sz * 6, sx, 0, sz, 12), combat.zone]).toEqual([rider, ZONE_HEAD]);
  // The same ray 0.45 m over it passes over her.
  expect(combat.castBodies(shooter, head[0]! - sx * 6, head[1]! + 0.45, head[2]! - sz * 6, sx, 0, sz, 12)).not.toBe(rider);
});

test("seats are not saved: a rider when the server stops comes back standing beside the mount, not up in its seat", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-ride-seat-")), dbPath = join(dir, "world.db");
  let active: Harness | null = null;
  try {
    const { h, clients, e } = yard("parasaur", ["ada"], { dbPath });
    active = h;
    const c = clients[0]!, pid = c.pid, mount = h.world.ents.pid[e]!;
    expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
    h.run(300);
    expect(h.host.riding.riding(c)).toBe(true);
    h.host.shutdown();
    active = null;
    const again = new Harness({}, 1, 60, { dev: true, dbPath });
    active = again;
    again.join("ada");
    again.run(800);
    const back = again.client(again.sessions[0]!)!, ents = again.world.ents, m = again.host.records.entOf.get(mount)!;
    expect([back.pid, again.host.riding.riding(back), ents.seat[back.ent]]).toEqual([pid, false, 0]);
    const ground = groundUnder(again.world.hf, ents.x[back.ent]!, ents.z[back.ent]!, 0.4);
    expect([Math.abs(ents.y[back.ent]! - ground) < 0.1, Math.hypot(ents.x[back.ent]! - ents.x[m]!, ents.z[back.ent]! - ents.z[m]!) > 1.4]).toEqual([true, true]);
  } finally {
    active?.host.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
