import { expect, test } from "bun:test";
import { App } from "../../client/core/app.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { TRACER_MS } from "../../client/core/shots.ts";
import { KEY_ACTION, KEY_AMMO } from "../../client/core/ui/hud.ts";
import { corePack } from "../fixtures/pack.ts";
import { REWIND_TICKS } from "../../server/combat.ts";
import { dress } from "../../server/commands/combat.ts";
import { STUCK_TICKS } from "../../server/projectiles.ts";
import type { EntityRecord } from "../../server/records.ts";
import { ZONE_HEAD, ZONE_TORSO } from "../../shared/anim/human.ts";
import { boneToModel, rayCapsule, solve } from "../../shared/anim/skeleton.ts";
import { creaturePose } from "../../shared/anim/creature.ts";
import { AnimState, bodySeed } from "../../shared/anim/pose.ts";
import { buildRigs } from "../../shared/anim/rigs.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_DT } from "../../shared/coords.ts";
import { handleIndex } from "../../shared/ids.ts";
import { BOX_SELF, CMD_MOVE, CMD_SELECT, EVENT_HIT, EVENT_SHOT } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_PRIMARY, BTN_SPRINT } from "../../shared/sim/character.ts";
import { DRAW_SPEED_MIN, flyEnd, flyStep, launchSpeed, piece, type Flight } from "../../shared/sim/projectiles.ts";
import { ACT_HOLD, ACT_NONE } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = 1000 / 30;
const EYE = 1.62;

/** The survivor stands at the south end of a level range, looking north. */
function range(deep: number, link = {}, registry = reg) {
  const h = new Harness({}, 1, 60, { dev: true }, registry);
  const s = h.join("ada", link);
  h.run(500);
  h.say(s, "enablecheats");
  const pilot = h.pilots[0]!;
  const g = flatGround(h, 24, deep);
  const at = { x: g.x + 12, z: g.z + 1.5, y: g.y };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  pilot.yaw = 0;
  pilot.pitch = 0;
  h.run(300);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  /** A dummy `far` metres up the range, facing the shooter. */
  const dummy = (far: number, armor?: string): { e: number; rec: EntityRecord } => {
    const e = h.host.spawnCreature("core:dummy", at.x, at.z + far, 1);
    expect(e).toBeGreaterThanOrEqual(0);
    const drec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
    h.world.ents.yaw[e] = drec.yaw = 32768;
    if (armor) {
      for (const part of ["hat", "shirt", "gloves", "pants", "boots"]) expect(dress(h.host, drec, registry.index.get(`core:${armor}_${part}`)!)).toBe(true);
      h.host.refreshBody(drec);
    }
    h.run(200);
    return { e, rec: drec };
  };
  /** Waits until the weapon is loaded and ready. Returns its slot. */
  const arm = (kit: string, weapon: string, ms = 6000): number => {
    h.say(s, `kit ${kit}`);
    const slot = takeInHand(h, s, registry.index.get(`core:${weapon}`)!);
    h.run(ms);
    expect(h.host.items.inv(rec).loaded[slot]).toBeGreaterThan(0);
    expect(s.own.act).toBe(ACT_NONE);
    return slot;
  };
  return { h, s, pilot, rec, at, dummy, arm };
}

/** Aims from the shooter's eye at a point `far` metres north and `height` above the ground. */
function aim(pilot: Pilot, far: number, height: number, side = 0): void {
  pilot.yaw = Math.atan2(side, far);
  pilot.pitch = Math.atan2(height - EYE, Math.hypot(far, side));
}

function pull(h: Harness, pilot: Pilot, ms = 400): void {
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 3);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(ms);
}

/** Draws the bow for `ticks` and lets go. */
function loose(h: Harness, pilot: Pilot, ticks: number, ms = 1500): void {
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * ticks);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(ms);
}

/** Metres an arrow loosed at `draw` falls below its line of aim over `far` metres. */
function drop(far: number, draw: number): number {
  const t = far / launchSpeed(70, draw);
  return 0.5 * 9.81 * t * t;
}

test("a rifle round arrives the tick it is fired: a head, a chest, flak, and a creature each take what the formula says", () => {
  const { h, s, pilot, rec, dummy, arm } = range(64);
  const bare = dummy(60);
  const slot = arm("rifle", "rifle");
  const inv = h.host.items.inv(rec);
  const rounds = inv.total(id("round_rifle"));
  const combat = h.host.combat;
  aim(pilot, 60, 1.66);
  h.run(100);
  pull(h, pilot);
  expect([combat.last.zone, combat.last.damage, combat.last.victim]).toEqual([ZONE_HEAD, 840, bare.rec.pid]);
  // The rifle reloads by itself in four and a half seconds.
  expect([inv.loaded[slot], inv.dur[slot]]).toEqual([0, 69]);
  expect(h.host.projectiles.flyingCount).toBe(0);
  h.run(4600);
  expect([inv.loaded[slot], inv.total(id("round_rifle"))]).toEqual([1, rounds - 1]);
  aim(pilot, 60, 1.25);
  h.run(100);
  pull(h, pilot, 4800);
  expect([combat.last.zone, combat.last.damage]).toEqual([ZONE_TORSO, 280]);
  const told = s.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(told.map((ev) => ev.damage)).toEqual([840, 280]);
  expect(told[1]!.z - h.world.ents.z[h.ent(s)]!).toBeGreaterThan(59);
  // A flak piece counts five times, so a sixth gets through. The shirt loses one durability for each sixteen points stopped.
  h.host.death.die(bare.rec, 0);
  const clad = dummy(60, "flak");
  pull(h, pilot, 4800);
  expect(combat.last.victim).toBe(clad.rec.pid);
  expect(combat.last.damage).toBeCloseTo(280 / 6, 4);
  expect(combat.last.wear).toBe(Math.ceil((280 - 280 / 6) / 16));
  const dinv = h.host.items.inv(clad.rec);
  expect(dinv.dur[dinv.armor + 1]).toBe(120 - combat.last.wear);
  aim(pilot, 60, 3.2);
  h.run(100);
  const hits = combat.hits;
  pull(h, pilot, 4800);
  expect(combat.hits).toBe(hits);
  expect(h.host.projectiles.fired).toBe(4);
  h.host.death.die(clad.rec, 0);
  const e = h.host.spawnCreature("core:grazer", h.world.ents.x[h.ent(s)]!, h.world.ents.z[h.ent(s)]! + 6, 1);
  aim(pilot, 6, 0.8);
  h.run(60);
  pull(h, pilot, 100);
  expect(combat.last.victim).toBe(h.world.ents.pid[e]!);
  expect(combat.last.damage).toBeCloseTo(280 * 0.7, 3);
  expect(h.host.items.audit()).toEqual([]);
});

test("an arrow flies and falls: aimed above its mark by its drop it lands on it, harder and flatter the longer the draw", () => {
  const { h, pilot, rec, dummy, arm } = range(44);
  const d = dummy(30);
  const slot = arm("bow", "bow", 2000);
  const inv = h.host.items.inv(rec);
  const combat = h.host.combat;
  const shots = h.host.projectiles;
  const arrows = inv.total(id("arrow_stone"));
  // Aimed straight at the chest at thirty metres, a fully drawn arrow falls 0.9 m and lands low.
  aim(pilot, 30, 1.25);
  loose(h, pilot, 45);
  expect(shots.fired).toBe(1);
  expect(shots.lastEnd.on === d.e ? shots.lastEnd.y - h.world.ents.y[d.e]! : 0).toBeLessThan(0.6);
  const before = combat.hits;
  aim(pilot, 30, 1.25 + drop(30, 1));
  loose(h, pilot, 45);
  expect(combat.hits).toBe(before + 1);
  expect([combat.last.zone, combat.last.damage, combat.last.victim]).toEqual([ZONE_TORSO, 55, d.rec.pid]);
  aim(pilot, 30, 1.66 + drop(30, 1));
  loose(h, pilot, 45);
  expect([combat.last.zone, combat.last.damage]).toEqual([ZONE_HEAD, 165]);
  // Damage runs from a quarter undrawn to all of it at 36 ticks of draw, so half drawn is about five eighths.
  aim(pilot, 30, 1.25 + drop(30, 0.5));
  loose(h, pilot, 19.5);
  expect(combat.last.zone).toBe(ZONE_TORSO);
  expect(combat.last.damage).toBeGreaterThan(55 * (0.25 + (0.75 * 17) / 36) - 0.01);
  expect(combat.last.damage).toBeLessThan(55 * (0.25 + (0.75 * 20) / 36) + 0.01);
  // A draw of four ticks is too short to fire.
  const fired = shots.fired;
  loose(h, pilot, 4);
  expect(shots.fired).toBe(fired);
  expect(inv.loaded[slot]).toBe(1);
  expect(inv.total(id("arrow_stone"))).toBe(arrows - fired);
  expect(inv.dur[slot]).toBe(50 - fired);
  expect(DRAW_SPEED_MIN).toBeCloseTo(38 / 70, 6);
  expect(h.host.items.audit()).toEqual([]);
});

test("an arrow that misses stands where it landed about half the time, is seen by anyone, is picked up by walking over it, and is gone in a minute", () => {
  const { h, s, pilot, rec, at, arm } = range(44);
  arm("bow", "bow", 2000);
  const inv = h.host.items.inv(rec);
  const shots = h.host.projectiles;
  const ents = h.world.ents;
  const had = inv.total(id("arrow_stone")) + 1;
  for (let n = 0; n < 20; n++) {
    aim(pilot, 20, 0, (n % 5) - 2);
    loose(h, pilot, 40, 1100);
    expect(shots.lastEnd.on).toBe(-1);
    expect(Math.hypot(shots.lastEnd.x - at.x, shots.lastEnd.z - at.z)).toBeGreaterThan(12);
  }
  expect(shots.fired).toBe(20);
  const stood = shots.stuckCount;
  expect(stood).toBeGreaterThanOrEqual(5);
  expect(stood).toBeLessThanOrEqual(15);
  // A stuck arrow is an entity, pitched down the way it flew.
  const kind = id("arrow_stuck");
  const standing: number[] = [];
  for (let e = 0; e < ents.cap; e++) if ((ents.flags[e]! & 1) !== 0 && ents.kind[e] === kind) standing.push(e);
  expect(standing.length).toBe(stood);
  for (const e of standing) {
    expect(ents.pitch[e]!).toBeLessThan(-200);
    expect(ents.y[e]! - h.world.hf.heightAt(ents.x[e]!, ents.z[e]!)).toBeLessThan(0.2);
  }
  const remote = new RemoteSample();
  s.sampleRemote(remote);
  let seen = 0;
  for (let i = 0; i < remote.count; i++) if (remote.kind[i] === kind) seen++;
  expect(seen).toBe(stood);
  // A fired arrow is off the ledger until someone walks over it.
  expect(inv.total(id("arrow_stone")) + inv.loaded[inv.hotbar]!).toBe(had - 20);
  expect(h.host.items.audit()).toEqual([]);
  const first = standing[0]!;
  h.say(s, `tp ${ents.x[first]!.toFixed(3)} ${ents.z[first]!.toFixed(3)}`);
  h.run(400);
  expect(shots.recovered).toBeGreaterThanOrEqual(1);
  expect((ents.flags[first]! & 1) === 0 || ents.kind[first] !== kind).toBe(true);
  expect(inv.total(id("arrow_stone")) + inv.loaded[inv.hotbar]!).toBe(had - 20 + shots.recovered);
  expect(h.host.items.audit()).toEqual([]);
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const left = shots.stuckCount;
  expect(left).toBe(stood - shots.recovered);
  h.run((STUCK_TICKS * 1000) / 30 + 500);
  expect(shots.stuckCount).toBe(0);
  for (const e of standing) expect((ents.flags[e]! & 1) === 0 || ents.kind[e] !== kind).toBe(true);
  expect(h.host.items.audit()).toEqual([]);
});

/** Bob strafes across the range while Ada, `latencyMs` from the server each way, aims at where she sees him. */
function strafing(latencyMs: number, sprint = true) {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada", { latencyMs });
  const bob = h.join("bob", { latencyMs: 20 });
  h.run(600);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const g = flatGround(h, 24, 18);
  const at = { x: g.x + 12, z: g.z + 1.5 };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(bob, `tp ${at.x.toFixed(3)} ${(at.z + 14).toFixed(3)}`);
  const [pa, pb] = [h.pilots[0]!, h.pilots[1]!];
  pb.yaw = Math.PI;
  h.run(400);
  const brec = h.host.records.byPid.get(h.world.ents.pid[h.ent(bob)]!)!;
  h.host.survival.gods.add(brec.pid);
  const remote = new RemoteSample();
  const seen = { x: 0, y: 0, z: 0, ok: false };
  /** Sets `seen` to where Ada's client draws Bob this frame. */
  const look = (): void => {
    ada.sampleRemote(remote);
    seen.ok = false;
    for (let i = 0; i < remote.count; i++) {
      if (remote.id[i] !== handleIndex(bob.ownHandle)) continue;
      seen.x = remote.x[i]!;
      seen.y = remote.y[i]!;
      seen.z = remote.z[i]!;
      seen.ok = true;
    }
  };
  /** Each frame Bob turns at the ends of his beat, and Ada aims at the chest of the Bob she sees, led by `lead` seconds of his walking. */
  const frame = (lead = 0, over = 0) => (): void => {
    const bx = h.world.ents.x[h.ent(bob)]!;
    if (bx > at.x + 6) pb.moveX = -1;
    else if (bx < at.x - 6) pb.moveX = 1;
    else if (pb.moveX === 0) pb.moveX = 1;
    pb.buttons = sprint ? BTN_SPRINT : 0;
    look();
    if (!seen.ok) return;
    // Facing south, his right is +X.
    const vx = pb.moveX * speedOf(h, bob);
    const dx = seen.x + vx * lead - ada.own.x;
    const dz = seen.z - ada.own.z;
    pa.yaw = Math.atan2(dx, dz);
    pa.pitch = Math.atan2(seen.y + 1.2 + over - (ada.own.y + EYE), Math.hypot(dx, dz));
  };
  return { h, ada, bob, pa, pb, brec, frame, at };
}

/** Horizontal speed on the server. */
function speedOf(h: Harness, s: ClientSession): number {
  const e = h.ent(s);
  return Math.hypot(h.world.ents.vx[e]!, h.world.ents.vz[e]!);
}

test("lag compensation: at every latency within the cap, a shot aimed at the body on the shooter's own screen hits it, though it has since moved on", () => {
  for (const latencyMs of [0, 25, 50, 75, 100]) {
    const { h, ada, pa, brec, frame, bob } = strafing(latencyMs);
    h.say(ada, "kit pistol");
    takeInHand(h, ada, id("pistol"));
    h.run(3500, frame());
    const combat = h.host.combat;
    const arec = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!;
    const inv = h.host.items.inv(arec);
    let fired = 0;
    let hit = 0;
    let moving = 0;
    // The pistol holds six rounds, so the twelve shots include a reload.
    for (let n = 0; n < 12; n++) {
      if (inv.loaded[inv.hotbar] === 0) h.run(2600, frame());
      const before = combat.hits;
      if (speedOf(h, bob) > 4) moving++;
      pa.buttons |= BTN_PRIMARY;
      h.run(TICK_MS * 2, frame());
      pa.buttons &= ~BTN_PRIMARY;
      h.run(700, frame());
      fired++;
      if (combat.hits > before && combat.last.victim === brec.pid) hit++;
    }
    expect(h.host.projectiles.fired).toBe(fired);
    // He was sprinting for most shots, at six metres a second across a body half a metre wide.
    expect(moving).toBeGreaterThanOrEqual(8);
    expect(hit).toBe(fired);
    const back = h.world.tick - combat.viewTick(h.client(ada)!);
    expect(back).toBeGreaterThanOrEqual(1.5);
    expect(back).toBeLessThanOrEqual(REWIND_TICKS);
    if (latencyMs >= 50) expect(back).toBeGreaterThan(4);
  }
});

test("an arrow at a runner must be led by its flight and by nothing else: led so, it hits at any latency within the cap", () => {
  for (const latencyMs of [0, 75]) {
    // He walks, because a sprint would run out of stamina partway and the lead needs a steady pace.
    const { h, ada, pa, brec, frame, bob } = strafing(latencyMs, false);
    h.say(ada, "kit bow");
    takeInHand(h, ada, id("bow"));
    h.run(2500, frame());
    const combat = h.host.combat;
    // Fourteen metres at 70 m/s is a fifth of a second: 0.9 m of his walking and 0.2 m of drop.
    const flight = 14 / 70;
    let hit = 0;
    let tried = 0;
    for (let n = 0; n < 8; n++) {
      pa.buttons |= BTN_PRIMARY;
      h.run(1500, frame(flight, drop(14, 1)));
      // She lets go only while he moves steadily, because a turn during the flight would dodge a correct lead.
      const off = (): number => Math.abs(h.world.ents.x[h.ent(bob)]! - h.world.ents.x[h.ent(ada)]!);
      for (let wait = 0; wait < 80 && (speedOf(h, bob) < 4.4 || off() > 3); wait++) h.run(50, frame(flight, drop(14, 1)));
      expect(ada.own.act).toBe(ACT_HOLD);
      const before = combat.hits;
      pa.buttons &= ~BTN_PRIMARY;
      h.run(1200, frame(flight, drop(14, 1)));
      tried++;
      if (combat.hits > before && combat.last.victim === brec.pid) hit++;
    }
    expect(hit).toBe(tried);
  }
});

test("water stops what is fired into it; what is fired from a crossbow goes on under it, slowly", () => {
  const { h, s, pilot, rec } = range(20);
  const w = h.world;
  // Finds a spot on the shore, with the sea a few metres off toward `yaw`.
  let shore: { x: number; z: number; yaw: number } | null = null;
  for (let x = 40; x < w.hf.sizeX - 40 && !shore; x += 8) {
    for (let z = 40; z < w.hf.sizeZ - 40 && !shore; z += 8) {
      const y = w.hf.heightAt(x, z);
      if (y < w.hf.seaLevel + 0.4 || y > w.hf.seaLevel + 2.5) continue;
      for (let k = 0; k < 8 && !shore; k++) {
        const a = (k * Math.PI) / 4;
        if (w.hf.heightAt(x + Math.sin(a) * 14, z + Math.cos(a) * 14) < w.hf.seaLevel - 2.5 && w.hf.heightAt(x + Math.sin(a) * 9, z + Math.cos(a) * 9) < w.hf.seaLevel - 0.5) shore = { x, z, yaw: a };
      }
    }
  }
  expect(shore).not.toBeNull();
  h.say(s, `tp ${shore!.x} ${shore!.z}`);
  h.say(s, "kit bow");
  h.say(s, "kit crossbow");
  takeInHand(h, s, id("bow"));
  h.run(2000);
  pilot.yaw = shore!.yaw;
  pilot.pitch = Math.atan2(w.hf.seaLevel - 1.5 - (w.hf.heightAt(shore!.x, shore!.z) + EYE), 12);
  const shots = h.host.projectiles;
  loose(h, pilot, 45);
  expect(shots.fired).toBe(1);
  expect(shots.lastEnd.on).toBe(-2);
  expect(shots.lastEnd.y).toBeCloseTo(w.hf.seaLevel, 3);
  expect(shots.stuckCount).toBe(0);
  takeInHand(h, s, id("crossbow"), 1);
  h.run(4000);
  expect(h.host.items.inv(rec).loaded[h.host.items.inv(rec).hotbar + 1]).toBe(1);
  pull(h, pilot, 3000);
  expect(shots.fired).toBe(2);
  expect(shots.lastEnd.on).toBe(-1);
  expect(shots.lastEnd.y).toBeLessThan(w.hf.seaLevel - 0.4);
  expect(h.host.items.audit()).toEqual([]);
});

test("nothing tunnels: at a thousand metres a second a dart still stops at a wall a hand thick, and at the body in front of one", () => {
  // 1,000 m/s is thirty-three metres a tick.
  const defs = CORE_CONTENT.map((d): Def => (d.id === "core:dart_tranq" ? { ...(d as ItemDef), ammo: { ...(d as ItemDef).ammo!, speed: 1000 } } : d));
  const fast = compileContent(defs).registry!;
  const { h, s, pilot, rec, at, dummy } = range(64, {}, fast);
  const k = (name: string): number => fast.index.get(`core:${name}`)!;
  h.say(s, "kit rifle");
  const slot = takeInHand(h, s, k("rifle"));
  const inv = h.host.items.inv(rec);
  h.run(200);
  h.host.items.load(rec, slot, k("dart_tranq"), 1);
  h.run(300);
  expect([inv.ammo[slot], inv.loaded[slot]]).toEqual([k("dart_tranq"), 1]);
  // The wall is 0.2 m thick, so its near face is 39.9 m off.
  const wall = k("wall");
  for (let i = -2; i <= 2; i++) h.world.structs.add(wall, at.x + i * 3, at.y + 1.5, at.z + 40, 0, 0, 1500);
  const shots = h.host.projectiles;
  aim(pilot, 40, 1.4);
  h.run(100);
  pull(h, pilot, 5200);
  expect(shots.fired).toBe(1);
  expect(shots.lastEnd.on).toBe(-1);
  expect(shots.lastEnd.z).toBeCloseTo(at.z + 39.9, 1);
  // A body in front of the wall is hit wherever it stands within a tick's flight.
  for (const far of [9, 20, 33.4, 39]) {
    const d = dummy(far);
    aim(pilot, far, 1.25);
    h.run(100);
    const before = h.host.combat.hits;
    pull(h, pilot, 5200);
    expect(h.host.combat.hits).toBe(before + 1);
    expect([h.host.combat.last.victim, h.host.combat.last.zone]).toEqual([d.rec.pid, ZONE_TORSO]);
    expect(h.host.combat.last.damage).toBe(26);
    h.host.death.die(d.rec, 0);
  }
  expect(shots.flyingCount).toBe(0);
});

test("flown a tick at a time, a shot lands where one flown a thousand times a second does", () => {
  const rng = new Rng(9);
  const g = 9.81;
  let differ = 0;
  let onTarget = 0;
  const shots = 10000;
  for (let n = 0; n < shots; n++) {
    const far = 4 + rng.float() * 76;
    const side = (rng.float() - 0.5) * 1.6;
    const draw = rng.float();
    const speed = launchSpeed(70, draw);
    // Aimed near the capsule, raised by about the drop, with some error.
    const t = far / speed;
    const up = 1.0 + 0.5 * g * t * t + (rng.float() - 0.5) * 2.4;
    const len = Math.hypot(side, up - EYE, far);
    const v = [(side / len) * speed, ((up - EYE) / len) * speed, (far / len) * speed];
    // Returns 1 for the capsule (0.5 to 1.6 m up, radius 0.25), 2 for the ground, 0 for neither.
    const hits = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number): number => {
      const tc = rayCapsule(ox, oy, oz, dx, dy, dz, 0, 0.5, far, 0, 1.6, far, 0.25);
      const tg = dy < 0 && oy + dy * length <= 0 ? -oy / dy : Infinity;
      return tc >= 0 && tc <= length && tc <= tg ? 1 : tg <= length ? 2 : 0;
    };
    const f: Flight = { x: 0, y: EYE, z: 0, vx: v[0]!, vy: v[1]!, vz: v[2]! };
    let coarse = 0;
    for (let tick = 0; tick < 300 && coarse === 0; tick++) {
      flyStep(f, g);
      coarse = hits(piece.x, piece.y, piece.z, piece.dx, piece.dy, piece.dz, piece.length);
      flyEnd(f, g);
    }
    let fine = 0;
    let [x, y, z, vy] = [0, EYE, 0, v[1]!];
    const dt = 0.001;
    for (let step = 0; step < 300 * TICK_DT * 1000 && fine === 0; step++) {
      const sx = v[0]! * dt;
      const sy = vy * dt - 0.5 * g * dt * dt;
      const sz = v[2]! * dt;
      const l = Math.hypot(sx, sy, sz);
      fine = hits(x, y, z, sx / l, sy / l, sz / l, l);
      x += sx;
      y += sy;
      z += sz;
      vy -= g * dt;
    }
    if (coarse !== fine) differ++;
    if (fine === 1) onTarget++;
  }
  // Enough of them hit and enough miss for the comparison to mean something.
  expect(onTarget).toBeGreaterThan(shots * 0.15);
  expect(onTarget).toBeLessThan(shots * 0.85);
  expect(differ / shots).toBeLessThan(0.005);
});

test("whoever is near a shot is told of it, and the one who fired is not", () => {
  const { h, s, pilot, arm, at } = range(44);
  const other = h.join("cyd");
  h.run(500);
  h.say(other, "enablecheats");
  h.say(other, `tp ${(at.x + 5).toFixed(3)} ${at.z.toFixed(3)}`);
  arm("bow", "bow", 2000);
  aim(pilot, 30, 1.5);
  loose(h, pilot, 45);
  const heard = other.events.filter((ev) => ev.kind === EVENT_SHOT);
  expect(heard.length).toBe(1);
  expect(s.events.filter((ev) => ev.kind === EVENT_SHOT).length).toBe(0);
  const shot = heard[0]!;
  expect(Math.hypot(shot.x - at.x, shot.z - at.z)).toBeLessThan(0.1);
  expect(shot.y - at.y).toBeCloseTo(EYE, 1);
  expect([shot.item, shot.flies]).toEqual([id("arrow_stone"), true]);
  expect(Math.hypot(shot.vx, shot.vy, shot.vz)).toBeCloseTo(70, 0);
  expect(shot.vz).toBeGreaterThan(69);
});

test("the client shows shots: its own arrow at once, another's when told, the line of a round, an arrow standing where it landed, the draw bar, and a narrowed view when aiming", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = corePack();
  const app = new App(h.join("ada", { latencyMs: 40 }, { manual: true }), h.reg, pack);
  const eve = new App(h.join("eve", { latencyMs: 40 }, { manual: true }), h.reg, pack);
  let packet = app.frame(0, 1280, 720);
  let seen = eve.frame(0, 1280, 720);
  const run = (ms: number): void =>
    h.run(ms, (now) => {
      packet = app.frame(now, 1280, 720);
      seen = eve.frame(now, 1280, 720);
    });
  run(500);
  const s = app.session;
  // Both clients are driven frame by frame, so every wait runs frames.
  const say = (who: App, line: string): void => {
    who.session.text(line);
    run(200);
  };
  const hold = (item: number, hotbar: number): void => {
    const inv = s.inventory!;
    const from = inv.item.indexOf(item);
    const to = inv.hotbar + hotbar;
    if (from !== to) s.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.varint(from), w.bits(BOX_SELF, 1), w.varint(to), w.u16(0), w.u16(item)));
    run(150);
    s.command(CMD_SELECT, (w) => w.u8(hotbar));
    run(150);
  };
  say(app, "enablecheats");
  say(eve, "enablecheats");
  const g = flatGround(h, 24, 44);
  const at = { x: g.x + 12, z: g.z + 1.5 };
  say(app, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  say(eve, `tp ${(at.x + 8).toFixed(3)} ${(at.z + 10).toFixed(3)}`);
  eve.controls.yaw = -Math.PI / 2;
  say(app, "kit bow");
  say(app, "kit rifle");
  run(200);
  const meshes = (p: typeof packet): string[] => [...p!.drawMesh.subarray(0, p!.drawCount)].filter((_, d) => (p!.drawFlags[d]! & DRAW_SKINNED) !== 0).map((m) => pack.header.meshes[m]!.id);
  const f = app.ui.frame;

  // The ammo line reads loaded / in the bag.
  hold(id("bow"), 0);
  run(1500);
  expect(f.find(KEY_AMMO)!.text).toBe("stone arrow  1 / 39");
  expect(f.find(KEY_ACTION)).toBeNull();
  app.controls.yaw = 0;
  app.controls.pitch = 0.05;
  app.controls.mouseButton(0, true);
  run(400);
  const part = f.find(KEY_ACTION)!.value;
  expect(part).toBeGreaterThan(0.2);
  expect(part).toBeLessThan(0.6);
  run(1200);
  expect(f.find(KEY_ACTION)!.value).toBe(1);
  expect(app.shots.flying.length).toBe(0);
  // Her own arrow is drawn within a frame or two, before the server has fired it.
  app.controls.mouseButton(0, false);
  run(70);
  expect(app.shots.flying.length).toBe(1);
  expect(h.host.projectiles.fired).toBe(0);
  expect(meshes(packet)).toContain("core:arrow");
  const mine = app.shots.flying[0]!;
  expect(Math.hypot(mine.vx, mine.vy, mine.vz)).toBeCloseTo(70, 0);
  run(130);
  expect(h.host.projectiles.fired).toBe(1);
  expect(eve.shots.flying.length).toBe(1);
  expect(meshes(seen)).toContain("core:arrow");
  run(2500);
  expect(app.shots.flying.length).toBe(0);
  expect(eve.shots.flying.length).toBe(0);
  expect(h.host.projectiles.lastEnd.on).toBe(-1);
  expect(f.find(KEY_AMMO)!.text).toBe("stone arrow  1 / 38");

  app.controls.pitch = -0.2;
  for (let n = 0; n < 12 && h.host.projectiles.stuckCount === 0; n++) {
    app.controls.mouseButton(0, true);
    run(1300);
    app.controls.mouseButton(0, false);
    run(1500);
  }
  expect(h.host.projectiles.stuckCount).toBeGreaterThan(0);
  expect(app.shots.flying.length).toBe(0);
  expect(meshes(packet)).toContain("core:arrow");
  eve.controls.yaw = Math.atan2(at.x - (at.x + 8), 6);
  run(300);
  expect(meshes(seen)).toContain("core:arrow");

  hold(id("rifle"), 1);
  run(5200);
  expect(f.find(KEY_AMMO)!.text).toBe("rifle round  1 / 29");
  app.controls.pitch = 0;
  app.controls.mouseButton(0, true);
  run(50);
  app.controls.mouseButton(0, false);
  expect(app.shots.tracers.length).toBe(1);
  expect(meshes(packet)).toContain("core:tracer");
  run(TRACER_MS + 120);
  expect(app.shots.tracers.length).toBe(0);
  expect(meshes(packet)).not.toContain("core:tracer");
  // The action bar also shows the reload.
  expect(f.find(KEY_ACTION)).not.toBeNull();
  expect(eve.session.events.length).toBe(0);
  // Aiming narrows the view and slows the mouse by the same ratio.
  const wide = app.cam.fovY;
  app.controls.mouseButton(2, true);
  run(600);
  expect(app.cam.fovY).toBeLessThan(wide * 0.85);
  expect(app.controls.zoom).toBeCloseTo(app.cam.fovY / wide, 5);
  app.controls.mouseButton(2, false);
  run(600);
  expect(app.cam.fovY).toBeCloseTo(wide, 2);
  expect(s.stats.undecodable).toBe(0);
});

test("a creature that came as a model is hit where its capsules are, in the pose it is in: its head for half as much again, its body for what the round does", () => {
  // `still` keeps the parasaur where it is put, so the test can compute where its head is.
  const wild = CORE_CONTENT.find((d) => d.id === "core:parasaur")!;
  const { registry } = compileContent([...CORE_CONTENT, { ...wild, id: "core:parasaur_still", still: true } as Def]);
  const { h, s, pilot, at, arm } = range(64, {}, registry!);
  const kind = registry!.index.get("core:parasaur_still")!;
  // Thirty metres up the range, turned a quarter turn to face +X, so it stands side on.
  const e = h.host.spawnCreature("core:parasaur_still", at.x, at.z + 30, 150);
  expect(e).toBeGreaterThanOrEqual(0);
  const rec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
  h.world.ents.yaw[e] = rec.yaw = 16384;
  h.run(300);
  const rig = buildRigs(corePack().header.rigs, corePack().clips).get("core:parasaur")!;
  const st = new AnimState();
  st.unpack(h.world.ents.anim[e]!);
  st.seed = bodySeed(e);
  // The middle of a bone's capsule, in model space. The creature faces +X, so model z runs along world +X.
  const middle = (bone: string): number[] => {
    creaturePose(rig, st, h.world.tick, registry!.runAt[kind]!, rig.a);
    solve(rig, rig.a, rig.solved);
    const b = rig.names.indexOf(bone);
    const out = [0, 0, 0];
    boneToModel(rig.solved, b, (rig.capA[b * 3]! + rig.capB[b * 3]!) / 2, (rig.capA[b * 3 + 1]! + rig.capB[b * 3 + 1]!) / 2, (rig.capA[b * 3 + 2]! + rig.capB[b * 3 + 2]!) / 2, out);
    return out;
  };
  arm("rifle", "rifle");
  const combat = h.host.combat;
  const health = (): number => h.host.survival.value(rec, V_HEALTH);
  const full = health();
  const body = middle("Body");
  aim(pilot, 30 - body[0]!, body[1]!, body[2]!);
  h.run(100);
  pull(h, pilot, 4800);
  expect([combat.last.victim, combat.last.zone, combat.last.damage]).toEqual([rec.pid, ZONE_TORSO, 280]);
  // It has mended a little in the seconds the rifle took to reload.
  expect(full - health()).toBeGreaterThan(270);
  expect(full - health()).toBeLessThanOrEqual(280);
  // The head is where the idle clip has it at this tick.
  st.unpack(h.world.ents.anim[e]!);
  const head = middle("Head");
  aim(pilot, 30 - head[0]!, head[1]!, head[2]!);
  h.run(100);
  pull(h, pilot, 4800);
  expect([combat.last.zone, combat.last.damage]).toEqual([ZONE_HEAD, 420]);
  // A shot over its back, inside its bounding box, hits nothing.
  const before = combat.hits;
  aim(pilot, 30, rig.mid * 2.4, -1.5);
  h.run(100);
  pull(h, pilot, 4800);
  expect(combat.hits).toBe(before);

  const pack = corePack();
  const scene = new Scene(s.world!, registry!, pack);
  const remote = new RemoteSample();
  s.sampleRemote(remote);
  const cam = new Camera();
  cam.x = s.own.x;
  cam.y = s.own.y + EYE;
  cam.z = s.own.z;
  cam.aspect = 16 / 9;
  const packet = scene.build(cam, remote);
  const mesh = pack.meshIndex.get("core:parasaur")!;
  let drawn = 0;
  for (let d = 0; d < packet.drawCount; d++) if (packet.drawMesh[d] === mesh && (packet.drawFlags[d]! & DRAW_SKINNED) !== 0) drawn += packet.drawInstances[d]!;
  expect([drawn, packet.boneCount >= rig.bones, scene.characters.has(kind)]).toEqual([1, true, true]);
});
