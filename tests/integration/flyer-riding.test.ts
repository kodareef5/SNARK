// Riding a pteranodon as ARK's is ridden (planning/reference/flyers-plan.md, FL2; FUNCTIONS.md sections 4, 5, 8 and 10):
// its keys in the whole client, the barrel roll's hits, its bite in the air, getting off in the air, the water that throws
// a rider off, a rider's weight on it, and the cues others see.

import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { AnimState, CUE_LAND, CUE_ROLL, CUE_TAKEOFF } from "../../shared/anim/pose.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { BTN_BRAKE, BTN_JUMP, BTN_PRIMARY, BTN_ROLL, BTN_USE, MF_NO_JUMP, MF_NO_SPRINT, MF_WINDED, MODE_FLYER, MODE_SWIM, MODE_WALK } from "../../shared/sim/character.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { PROVING_POOL } from "../../shared/world/proving.ts";
import { groundUnder } from "../../shared/world/collide.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { Harness } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const PTERA = id("pteranodon");
const p = reg.tamedMove[PTERA]!;

/**
 * Ada on a link of `latencyMs`, through the whole client or as a pilot, on a saddled pteranodon of her tribe that stood
 * beside her at (x, z), which she has got on. `app` makes her a whole client.
 */
function ridden(opts: { app?: boolean; x?: number; z?: number; latencyMs?: number } = {}) {
  const h = new Harness({}, 1, 60, { dev: true });
  const x = opts.x ?? 256;
  const z = opts.z ?? 244;
  const s = h.join("ada", { latencyMs: opts.latencyMs ?? 60 }, { manual: opts.app === true });
  const app = opts.app ? new App(s, h.reg, corePack()) : null;
  const run = (ms: number, each?: (now: number) => void): void =>
    h.run(ms, (now) => {
      app?.frame(now, 640, 360);
      each?.(now);
    });
  run(500);
  s.text("enablecheats");
  run(300);
  s.text(`tp ${x} ${z}`);
  run(300);
  const ents = h.world.ents;
  const c = h.client(s)!;
  const me = h.host.records.byPid.get(c.pid)!;
  const e = h.host.spawnCreature("core:pteranodon", x, z + 4, 1);
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  rec.team = me.team;
  rec.saddle = id("saddle_pteranodon");
  h.host.refreshBody(rec);
  run(300);
  expect(h.host.riding.mount(c, e)).toBe(RESULT_OK);
  // Its 150 stamina is full in a few seconds.
  run(7000);
  expect([s.driving, s.own.kind, ents.mode[e], ents.stamina[e]]).toEqual([e, PTERA, MODE_WALK, 150000]);
  const pilot = h.pilots[0]!;
  const ground = (): number => groundUnder(h.world.hf, ents.x[e]!, ents.z[e]!, p.radius);
  const health = (r = rec): number => h.host.survival.value(r, V_HEALTH);
  const speed = (): number => Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!);
  return { h, s, app, run, c, pilot, ents, e, rec, me, ground, health, speed };
}

/** Taps a key of the whole client. */
function tap(app: App, run: (ms: number) => void, code: string): void {
  app.key(code, true);
  run(50);
  app.key(code, false);
}

test("in the whole client on a 60 ms link, ARK's keys fly it: mounted on the ground it stays down; Space takes it up and down; it climbs by the look, sprints, brakes to a hover and rolls; spent it is put down and stays down; too heavy, Space does nothing; nothing is corrected", () => {
  const r = ridden({ app: true });
  const { h, s, app, run, ents, e, rec, ground, speed } = r;
  const c = app!.controls;
  const settled = s.stats.corrections;
  // Got on where it stood, it stays there and is sent no jump.
  run(1000);
  expect([ents.mode[e], c.wing, c.buttons & BTN_JUMP]).toEqual([MODE_WALK, false, 0]);
  // Space: it rises to a hover a few feet up, its jump sent every tick.
  tap(app!, run, "Space");
  run(2000);
  const hover = ents.y[e]! - ground();
  expect([ents.mode[e], c.wing, c.buttons & BTN_JUMP, hover > 1.2, hover < 1.6]).toEqual([MODE_FLYER, true, BTN_JUMP, true, true]);
  // South over the open plaza, climbing by the look.
  c.yaw = Math.PI;
  c.pitch = 0.5;
  app!.key("KeyW", true);
  run(4000);
  expect(ents.y[e]! - ground()).toBeGreaterThan(10);
  // Level, sprinting: tamed, 1,897.5 units a second.
  c.pitch = 0;
  app!.key("ShiftLeft", true);
  let fastest = 0;
  run(3000, () => void (fastest = Math.max(fastest, speed())));
  app!.key("ShiftLeft", false);
  expect(fastest).toBeCloseTo(p.flySpeed * p.flySprintMul, 1);
  // X held brakes it to a stop where it is.
  app!.key("KeyX", true);
  run(1000);
  const at = [ents.x[e]!, ents.y[e]!, ents.z[e]!];
  run(1000);
  expect([ents.x[e], ents.y[e], ents.z[e], ents.mode[e], c.buttons & BTN_BRAKE]).toEqual([...at, MODE_FLYER, BTN_BRAKE]);
  app!.key("KeyX", false);
  app!.key("KeyW", false);
  // C rolls at once, and held does not roll again before its 7 s; let go, it sends no roll.
  const before = ents.stamina[e]!;
  app!.key("KeyC", true);
  run(1000);
  expect([before - ents.stamina[e]! > 90000, ents.rollWait[e]! > 150, c.buttons & BTN_ROLL]).toEqual([true, true, BTN_ROLL]);
  app!.key("KeyC", false);
  run(100);
  expect(c.buttons & BTN_ROLL).toBe(0);
  // Space again: it goes down and sets down unhurt, and stays down.
  const health = r.health();
  tap(app!, run, "Space");
  run(6000);
  expect([ents.mode[e], ents.y[e]! - ground() < 0.01, c.wing, r.health()]).toEqual([MODE_WALK, true, false, health]);
  // Up again, sprinting round until it is spent: put down where it is, its toggle off.
  tap(app!, run, "Space");
  c.pitch = 0.4;
  app!.key("KeyW", true);
  run(3000);
  c.pitch = 0;
  app!.key("ShiftLeft", true);
  let spent = false;
  for (let t = 0; t < 40000 && ents.mode[e] === MODE_FLYER; t += 100) {
    run(100, () => void (c.yaw += 0.006));
    spent ||= (ents.mflags[e]! & MF_WINDED) !== 0;
  }
  app!.key("ShiftLeft", false);
  app!.key("KeyW", false);
  run(500);
  expect([spent, ents.mode[e], ents.y[e]! - ground() < 0.01, c.wing, c.buttons & BTN_JUMP, r.health()]).toEqual([true, MODE_WALK, true, false, 0, health]);
  // Its stamina comes back after 10 s, and it does not go up again by itself.
  run(16000);
  expect([ents.mflags[e]! & MF_WINDED, ents.mode[e]]).toEqual([0, MODE_WALK]);
  // Too heavy (300 stones of 0.5 over its 120), Space does nothing and the toggle goes back off.
  h.host.items.mint(rec, id("stone"), 300);
  run(500);
  expect(ents.mflags[e]! & MF_NO_JUMP).toBe(MF_NO_JUMP);
  tap(app!, run, "Space");
  run(1000);
  expect([ents.mode[e], c.wing]).toEqual([MODE_WALK, false]);
  expect(s.stats.corrections - settled).toBe(0);
});

type Ride = ReturnType<typeof ridden>;

/** Steers by the look alone toward (x, `up` metres over the ground or water there, z), its jump held, until within `near` metres or `ms` pass. */
function flyTo(r: Ride, x: number, up: number, z: number, near = 2, ms = 20000): boolean {
  const { h, s, pilot, run } = r;
  const y = Math.max(groundUnder(h.world.hf, x, z, p.radius), h.world.hf.seaLevel) + up;
  pilot.moveZ = 1;
  pilot.buttons = BTN_JUMP;
  for (let t = 0; t < ms; t += 100) {
    const [dx, dy, dz] = [x - s.own.x, y - s.own.y, z - s.own.z];
    if (Math.hypot(dx, dy, dz) < near) return true;
    pilot.yaw = Math.atan2(dx, dz);
    pilot.pitch = Math.max(-1.3, Math.min(1.3, Math.atan2(dy, Math.hypot(dx, dz))));
    run(100);
  }
  return false;
}

/** Comes to a hover where it is, facing `yaw`. */
function hover(r: Ride, yaw: number): void {
  r.pilot.moveZ = 0;
  r.pilot.pitch = 0;
  r.pilot.yaw = yaw;
  r.pilot.buttons = BTN_JUMP;
  r.run(3000);
  expect([r.ents.mode[r.e], r.speed()]).toEqual([MODE_FLYER, 0]);
}

test("a barrel roll does ARK's 50 once to each body it passes, by the damage rules; not to its rider, nor to what it passes out of reach", () => {
  const r = ridden();
  const { h, run, pilot, ents, e, rec, me } = r;
  pilot.buttons = BTN_JUMP;
  run(1000);
  // Hovering south over the plaza, two dodos are put down: one 4 m ahead, one 8 m to the side of its way.
  hover(r, Math.PI);
  const [x, z] = [ents.x[e]!, ents.z[e]!];
  const ahead = h.host.spawnCreature("core:dodo", x, z - 4, 100);
  const aside = h.host.spawnCreature("core:dodo", x + 8, z - 4, 100);
  const [a, b] = [ahead, aside].map((d) => h.host.records.byPid.get(ents.pid[d]!)!);
  const before = [r.health(a), r.health(b), r.health(me)];
  const combat = h.host.combat;
  const hits = combat.hits;
  pilot.buttons = BTN_JUMP | BTN_ROLL;
  run(150);
  pilot.buttons = BTN_JUMP;
  run(2000);
  // Its burst carried it over the first, and the whole second of the roll hit it once.
  expect(ents.z[e]!).toBeLessThan(z - 3.5);
  expect([combat.hits - hits, combat.last.by, combat.last.victim, combat.last.damage]).toEqual([1, rec.pid, a.pid, expect.closeTo(50, 4)]);
  expect([r.health(a) < before[0]! - 45, r.health(b), r.health(me)]).toEqual([true, before[1], before[2]]);
});

test("it bites in the air, for its 5 stamina, predicted with nothing corrected", () => {
  const r = ridden();
  const { h, s, run, pilot, ents, e, rec } = r;
  // Bob stands where it stood; it hovers over him, looking straight down.
  const bob = h.join("bob");
  run(800);
  h.say(bob, "enablecheats");
  h.say(bob, `tp ${ents.x[e]!.toFixed(3)} ${ents.z[e]!.toFixed(3)}`);
  pilot.buttons = BTN_JUMP;
  pilot.pitch = -1.5;
  run(3000);
  expect([ents.mode[e], r.speed()]).toEqual([MODE_FLYER, 0]);
  const settled = [s.stats.corrections, s.stats.stateCorrections];
  const him = h.host.records.byPid.get(h.client(bob)!.pid)!;
  const [health, stamina, hits, from] = [r.health(him), ents.stamina[e]!, h.host.combat.hits, h.world.tick];
  pilot.buttons = BTN_JUMP | BTN_PRIMARY;
  run(100);
  pilot.buttons = BTN_JUMP;
  run(900);
  // Flying costs 11 units a tick; the bite 5 points more.
  expect([h.host.combat.hits - hits, h.host.combat.last.by, h.host.combat.last.victim, r.health(him) < health]).toEqual([1, rec.pid, him.pid, true]);
  expect(stamina - ents.stamina[e]!).toBe((h.world.tick - from) * 11 + 5000);
  // Its rider's client spent the same, ticks ahead, or a snapshot would have put its stamina right.
  run(500);
  expect([s.stats.corrections - settled[0]!, s.stats.stateCorrections - settled[1]!]).toEqual([0, 0]);
});

test("got off 40 m up with the use key, the rider falls to the ground and is killed by it, and the pteranodon falls and is hurt once", () => {
  const r = ridden();
  const { h, s, c, run, pilot, ents, e, me } = r;
  pilot.buttons = BTN_JUMP;
  run(1000);
  expect(flyTo(r, 256, 40, 200)).toBe(true);
  hover(r, Math.PI);
  const rider = h.ent(s);
  const [mine, its] = [r.health(me), r.health()];
  pilot.buttons = BTN_JUMP | BTN_USE;
  run(100);
  pilot.buttons = 0;
  let blows = 0;
  let last = its;
  let falling = false;
  run(6000, () => {
    const now = r.health();
    if (now < last) blows++;
    last = now;
    falling ||= ents.mode[e] === MODE_WALK && ents.vy[e]! < -10;
  });
  const down = (i: number): boolean => ents.y[i]! - groundUnder(h.world.hf, ents.x[i]!, ents.z[i]!, 0.3) < 0.05;
  expect([c.drive, s.driving, h.host.riding.dismounted, falling, ents.mode[e], down(e), blows, r.health() < its]).toEqual([-1, -1, 1, true, MODE_WALK, true, 1, true]);
  // A survivor of 100 health does not live through 40 m (D385); the mount's 210 does.
  expect([down(rider), r.health(me), mine, me.dead]).toEqual([true, 0, 100, true]);
});

test("skimming the water throws its rider off, and it floats unhurt there; so does setting down on deep water", () => {
  const seen = (["skim", "set down"] as const).map((how) => {
    // Six metres up from the pool's east shore.
    const probe = new Harness({}, 1, 60, { dev: true });
    const sea = probe.world.hf.seaLevel;
    let edge = PROVING_POOL.x;
    while (probe.world.hf.heightAt(edge, PROVING_POOL.z) < sea + 0.3) edge += 0.25;
    probe.host.shutdown();
    const r = ridden({ x: edge + 6, z: PROVING_POOL.z - 4 });
    const { h, s, c, run, pilot, ents, e, me } = r;
    pilot.buttons = BTN_JUMP;
    run(1500);
    const health = [r.health(), r.health(me)];
    let skimmed = false;
    expect(flyTo(r, PROVING_POOL.x + (how === "skim" ? 3 : 0), 4, PROVING_POOL.z)).toBe(true);
    hover(r, -Math.PI / 2);
    if (how === "skim") {
      // West over the deep water, nose down: it can go no lower than the surface.
      pilot.pitch = -0.4;
      pilot.moveZ = 1;
      for (let t = 0; t < 8000 && s.driving === e; t += 100) run(100, () => void (skimmed ||= ents.y[e]! <= sea + 0.01));
    } else {
      pilot.buttons = 0;
      for (let t = 0; t < 6000 && s.driving === e; t += 100) run(100);
      skimmed = true;
    }
    pilot.moveZ = 0;
    pilot.buttons = 0;
    run(3000);
    const rider = h.ent(s);
    const deep = sea - groundUnder(h.world.hf, ents.x[e]!, ents.z[e]!, p.radius) > 2;
    return [how, skimmed, c.drive, s.driving, deep, ents.mode[e], ents.mode[rider], r.health() === health[0], r.health(me) === health[1]];
  });
  expect(seen).toEqual([
    ["skim", true, -1, -1, true, MODE_SWIM, MODE_SWIM, true, true],
    ["set down", true, -1, -1, true, MODE_SWIM, MODE_SWIM, true, true],
  ]);
});

test("a rider's pack weighs 0.85 on it: 135 kg leaves it able to fly but not sprint, 150 kg is too heavy to take off", () => {
  const r = ridden();
  const { h, run, pilot, ents, e, me } = r;
  expect(ents.mflags[e]! & (MF_NO_SPRINT | MF_NO_JUMP)).toBe(0);
  // 270 stones of 0.5: 114.75 of its 120, past the 85% that stops a sprint.
  h.host.items.mint(me, id("stone"), 270);
  run(300);
  expect(ents.mflags[e]! & (MF_NO_SPRINT | MF_NO_JUMP)).toBe(MF_NO_SPRINT);
  pilot.buttons = BTN_JUMP;
  run(1500);
  expect(ents.mode[e]).toBe(MODE_FLYER);
  pilot.buttons = 0;
  run(3000);
  expect(ents.mode[e]).toBe(MODE_WALK);
  // 30 more: 127.5.
  h.host.items.mint(me, id("stone"), 30);
  run(300);
  expect(ents.mflags[e]! & MF_NO_JUMP).toBe(MF_NO_JUMP);
  pilot.buttons = BTN_JUMP;
  run(1500);
  expect(ents.mode[e]).toBe(MODE_WALK);
});

test("its take-off, barrel roll and setting down are cued, the same on the server and to a client watching", () => {
  const r = ridden();
  const { h, run, pilot, ents, e } = r;
  const bob = h.join("bob");
  run(1500);
  const st = new AnimState();
  const out = new RemoteSample();
  const server: number[] = [];
  const watched: number[] = [];
  const note = (list: number[], cue: number): void => void (cue !== 0 && list[list.length - 1] !== cue && list.push(cue));
  const each = (): void => {
    st.unpack(0, ents.cue[e]!);
    note(server, st.cue);
    bob.sampleRemote(out);
    for (let i = 0; i < out.count; i++) {
      if (out.id[i] !== e) continue;
      st.unpack(0, out.cue[i]!);
      note(watched, st.cue);
    }
  };
  pilot.buttons = BTN_JUMP;
  run(2000, each);
  pilot.buttons = BTN_JUMP | BTN_ROLL;
  run(150, each);
  pilot.buttons = BTN_JUMP;
  run(2000, each);
  pilot.buttons = 0;
  run(3000, each);
  expect(ents.mode[e]).toBe(MODE_WALK);
  expect([server, watched]).toEqual([
    [CUE_TAKEOFF, CUE_ROLL, CUE_LAND],
    [CUE_TAKEOFF, CUE_ROLL, CUE_LAND],
  ]);
});
