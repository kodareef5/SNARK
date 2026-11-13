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
import { rayCapsule } from "../../shared/anim/skeleton.ts";
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

/** A survivor with cheats at the south end of a level range, looking north up it. */
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
  /** A dummy `far` metres up the range, facing down it. */
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
  /** Take a weapon of a kit in hand and wait until it is loaded and ready. */
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

/** Point the pilot from the shooter's eye at a point `far` metres north and `height` above the ground. */
function aim(pilot: Pilot, far: number, height: number, side = 0): void {
  pilot.yaw = Math.atan2(side, far);
  pilot.pitch = Math.atan2(height - EYE, Math.hypot(far, side));
}

/** Press the trigger once and let the shot be resolved. */
function pull(h: Harness, pilot: Pilot, ms = 400): void {
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 3);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(ms);
}

/** Draw a bow for `ticks` and let go. */
function loose(h: Harness, pilot: Pilot, ticks: number, ms = 1500): void {
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * ticks);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(ms);
}

/** How far an arrow let go at `draw` falls below its line of aim by the time it has gone `far` metres. */
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
  // The round is spent, the rifle is worn by one use, and it reloads by itself: four and a half seconds.
  expect([inv.loaded[slot], inv.dur[slot]]).toEqual([0, 69]);
  expect(h.host.projectiles.flyingCount).toBe(0);
  h.run(4600);
  expect([inv.loaded[slot], inv.total(id("round_rifle"))]).toEqual([1, rounds - 1]);
  aim(pilot, 60, 1.25);
  h.run(100);
  pull(h, pilot, 4800);
  expect([combat.last.zone, combat.last.damage]).toEqual([ZONE_TORSO, 280]);
  // The one who fired is told where it landed: sixty metres off, at chest height.
  const told = s.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(told.map((ev) => ev.damage)).toEqual([840, 280]);
  expect(told[1]!.z - h.world.ents.z[h.ent(s)]!).toBeGreaterThan(59);
  // Flak on the chest: the piece counts five times, a sixth gets through, and the shirt is worn by what it stopped.
  h.host.death.die(bare.rec, 0);
  const clad = dummy(60, "flak");
  pull(h, pilot, 4800);
  expect(combat.last.victim).toBe(clad.rec.pid);
  expect(combat.last.damage).toBeCloseTo(280 / 6, 4);
  expect(combat.last.wear).toBe(Math.ceil((280 - 280 / 6) / 16));
  const dinv = h.host.items.inv(clad.rec);
  expect(dinv.dur[dinv.armor + 1]).toBe(120 - combat.last.wear);
  // A miss hits nothing and still costs the round.
  aim(pilot, 60, 3.2);
  h.run(100);
  const hits = combat.hits;
  pull(h, pilot, 4800);
  expect(combat.hits).toBe(hits);
  expect(h.host.projectiles.fired).toBe(4);
  // A creature takes seven tenths of a bullet.
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
  // Fully drawn, at the chest, thirty metres: aimed straight at it the arrow falls 0.9 m and lands low.
  aim(pilot, 30, 1.25);
  loose(h, pilot, 45);
  expect(shots.fired).toBe(1);
  expect(shots.lastEnd.on === d.e ? shots.lastEnd.y - h.world.ents.y[d.e]! : 0).toBeLessThan(0.6);
  // Held over by its drop, it lands where it was meant: all of its damage, to the chest and to the head.
  const before = combat.hits;
  aim(pilot, 30, 1.25 + drop(30, 1));
  loose(h, pilot, 45);
  expect(combat.hits).toBe(before + 1);
  expect([combat.last.zone, combat.last.damage, combat.last.victim]).toEqual([ZONE_TORSO, 55, d.rec.pid]);
  aim(pilot, 30, 1.66 + drop(30, 1));
  loose(h, pilot, 45);
  expect([combat.last.zone, combat.last.damage]).toEqual([ZONE_HEAD, 165]);
  // Half drawn it is slower, falls further, and does five eighths.
  aim(pilot, 30, 1.25 + drop(30, 0.5));
  loose(h, pilot, 19.5);
  expect(combat.last.zone).toBe(ZONE_TORSO);
  expect(combat.last.damage).toBeGreaterThan(55 * (0.25 + (0.75 * 17) / 36) - 0.01);
  expect(combat.last.damage).toBeLessThan(55 * (0.25 + (0.75 * 20) / 36) + 0.01);
  // Let go at once, the string is let down: nothing leaves.
  const fired = shots.fired;
  loose(h, pilot, 4);
  expect(shots.fired).toBe(fired);
  // Each shot nocked the next from the bag, and wore the bow.
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
  // Twenty arrows into the ground, twenty metres up the range.
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
  // Each is a thing in the world, tilted the way it flew: downward, pointing north.
  const kind = id("arrow_stuck");
  const standing: number[] = [];
  for (let e = 0; e < ents.cap; e++) if ((ents.flags[e]! & 1) !== 0 && ents.kind[e] === kind) standing.push(e);
  expect(standing.length).toBe(stood);
  for (const e of standing) {
    expect(ents.pitch[e]!).toBeLessThan(-200);
    expect(ents.y[e]! - h.world.hf.heightAt(ents.x[e]!, ents.z[e]!)).toBeLessThan(0.2);
  }
  // A client sees them as it sees anything.
  const remote = new RemoteSample();
  s.sampleRemote(remote);
  let seen = 0;
  for (let i = 0; i < remote.count; i++) if (remote.kind[i] === kind) seen++;
  expect(seen).toBe(stood);
  // Fired and not yet picked up, every one of them is off the books; walking over them puts them back on.
  expect(inv.total(id("arrow_stone")) + inv.loaded[inv.hotbar]!).toBe(had - 20);
  expect(h.host.items.audit()).toEqual([]);
  const first = standing[0]!;
  h.say(s, `tp ${ents.x[first]!.toFixed(3)} ${ents.z[first]!.toFixed(3)}`);
  h.run(400);
  expect(shots.recovered).toBeGreaterThanOrEqual(1);
  expect((ents.flags[first]! & 1) === 0 || ents.kind[first] !== kind).toBe(true);
  expect(inv.total(id("arrow_stone")) + inv.loaded[inv.hotbar]!).toBe(had - 20 + shots.recovered);
  expect(h.host.items.audit()).toEqual([]);
  // The rest stand for a minute from when they landed, and then are gone.
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  const left = shots.stuckCount;
  expect(left).toBe(stood - shots.recovered);
  h.run((STUCK_TICKS * 1000) / 30 + 500);
  expect(shots.stuckCount).toBe(0);
  for (const e of standing) expect((ents.flags[e]! & 1) === 0 || ents.kind[e] !== kind).toBe(true);
  expect(h.host.items.audit()).toEqual([]);
});

/** Bob walks a beat across the range while Ada, `latencyMs` away from the server each way, shoots at where she sees him. */
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
  // Bob faces south, toward Ada, and runs his beat sideways: six metres each way.
  pb.yaw = Math.PI;
  h.run(400);
  const brec = h.host.records.byPid.get(h.world.ents.pid[h.ent(bob)]!)!;
  h.host.survival.gods.add(brec.pid);
  const remote = new RemoteSample();
  const seen = { x: 0, y: 0, z: 0, ok: false };
  /** Where Ada's own screen has Bob, this frame. */
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
  /** Each frame: Bob turns at the ends of his beat, and Ada keeps her aim on the chest of the Bob she sees, led by `lead` seconds of his walking. */
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

/** How fast a survivor is going, as the server has it. */
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
    // Twelve shots, some of them just as he turns: a round every seven tenths of a second, a reload when the six are gone.
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
    // He was running for most of them: six metres a second across a body half a metre wide.
    expect(moving).toBeGreaterThanOrEqual(8);
    expect(hit).toBe(fired);
    // How far back the server looked: further the further away she is, and never past the cap.
    const back = h.world.tick - combat.viewTick(h.client(ada)!);
    expect(back).toBeGreaterThanOrEqual(1.5);
    expect(back).toBeLessThanOrEqual(REWIND_TICKS);
    if (latencyMs >= 50) expect(back).toBeGreaterThan(4);
  }
});

test("an arrow at a runner must be led by its flight and by nothing else: led so, it hits at any latency within the cap", () => {
  for (const latencyMs of [0, 75]) {
    // He walks: a sprint would run out of breath partway through, and his pace must hold for the lead to be right.
    const { h, ada, pa, brec, frame, bob } = strafing(latencyMs, false);
    h.say(ada, "kit bow");
    takeInHand(h, ada, id("bow"));
    h.run(2500, frame());
    const combat = h.host.combat;
    // Fourteen metres at seventy metres a second: a fifth of a second of his walking, nine decimetres, and two of drop.
    const flight = 14 / 70;
    let hit = 0;
    let tried = 0;
    for (let n = 0; n < 8; n++) {
      pa.buttons |= BTN_PRIMARY;
      h.run(1500, frame(flight, drop(14, 1)));
      // Let go only while he runs steadily: a turn during the flight is his luck, not her aim.
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
  // A spot on the shore: dry ground with the sea a few metres off in some direction.
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
  // The same shot from a crossbow goes through the surface and on to the bottom.
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
  // The same content with one change: the tranquilizer dart leaves at 1,000 m/s, thirty-three metres a tick.
  const defs = CORE_CONTENT.map((d): Def => (d.id === "core:dart_tranq" ? { ...(d as ItemDef), ammo: { ...(d as ItemDef).ammo!, speed: 1000 } } : d));
  const fast = compileContent(defs).registry!;
  const { h, s, pilot, rec, at, dummy } = range(64, {}, fast);
  const k = (name: string): number => fast.index.get(`core:${name}`)!;
  h.say(s, "kit rifle");
  const slot = takeInHand(h, s, k("rifle"));
  // Darts, not rounds.
  const inv = h.host.items.inv(rec);
  h.run(200);
  h.host.items.load(rec, slot, k("dart_tranq"), 1);
  h.run(300);
  expect([inv.ammo[slot], inv.loaded[slot]]).toEqual([k("dart_tranq"), 1]);
  // A wall across the range at forty metres, ten centimetres thick.
  const wall = k("wall");
  for (let i = -2; i <= 2; i++) h.world.structs.add(wall, at.x + i * 3, at.y + 1.5, at.z + 40, 0, 0, 1500);
  const shots = h.host.projectiles;
  aim(pilot, 40, 1.4);
  h.run(100);
  pull(h, pilot, 5200);
  expect(shots.fired).toBe(1);
  expect(shots.lastEnd.on).toBe(-1);
  expect(shots.lastEnd.z).toBeCloseTo(at.z + 39.9, 1);
  // A body in front of the wall takes it, wherever in its piece the body stands.
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
  // Ten thousand shots at an upright capsule over level ground, each flown both ways: by the tick, in straight pieces, and by the millisecond.
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
    // Aimed near the capsule, held over by about the drop, with some error.
    const t = far / speed;
    const up = 1.0 + 0.5 * g * t * t + (rng.float() - 0.5) * 2.4;
    const len = Math.hypot(side, up - EYE, far);
    const v = [(side / len) * speed, ((up - EYE) / len) * speed, (far / len) * speed];
    // The capsule: from the knees to the head, a quarter metre thick, standing straight ahead.
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
  // From her eye, an arrow, flying north at full speed.
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
  // Both clients are driven a frame at a time, so everything they do is done with frames running.
  const say = (who: App, line: string): void => {
    who.session.text(line);
    run(200);
  };
  /** Move what is carried to a hotbar slot and take it in hand. */
  const hold = (item: number, hotbar: number): void => {
    const inv = s.inventory!;
    const from = inv.item.indexOf(item);
    const to = inv.hotbar + hotbar;
    if (from !== to) s.command(CMD_MOVE, (w) => (w.bits(BOX_SELF, 1), w.u8(from), w.bits(BOX_SELF, 1), w.u8(to), w.u16(0), w.u16(item)));
    run(150);
    s.command(CMD_SELECT, (w) => w.u8(hotbar));
    run(150);
  };
  say(app, "enablecheats");
  say(eve, "enablecheats");
  const g = flatGround(h, 24, 44);
  const at = { x: g.x + 12, z: g.z + 1.5 };
  say(app, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  // Eve stands off to one side, looking across the range.
  say(eve, `tp ${(at.x + 8).toFixed(3)} ${(at.z + 10).toFixed(3)}`);
  eve.controls.yaw = -Math.PI / 2;
  say(app, "kit bow");
  say(app, "kit rifle");
  run(200);
  const meshes = (p: typeof packet): string[] => [...p!.drawMesh.subarray(0, p!.drawCount)].filter((_, d) => (p!.drawFlags[d]! & DRAW_SKINNED) !== 0).map((m) => pack.header.meshes[m]!.id);
  const f = app.ui.frame;

  // The bow in hand: the line above the hotbar says what is on the string and what is in the bag.
  hold(id("bow"), 0);
  run(1500);
  expect(f.find(KEY_AMMO)!.text).toBe("stone arrow  1 / 39");
  expect(f.find(KEY_ACTION)).toBeNull();
  // Drawing: the bar under the crosshair fills.
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
  // Let go: the arrow is in the air on her own screen within a frame or two, before the server could have said so.
  app.controls.mouseButton(0, false);
  run(70);
  expect(app.shots.flying.length).toBe(1);
  expect(h.host.projectiles.fired).toBe(0);
  expect(meshes(packet)).toContain("core:arrow");
  const mine = app.shots.flying[0]!;
  expect(Math.hypot(mine.vx, mine.vy, mine.vz)).toBeCloseTo(70, 0);
  // The server flies it too, and Eve is told and draws her own picture of it.
  run(130);
  expect(h.host.projectiles.fired).toBe(1);
  expect(eve.shots.flying.length).toBe(1);
  expect(meshes(seen)).toContain("core:arrow");
  // Both pictures end where the arrow comes down, about where the server's did.
  run(2500);
  expect(app.shots.flying.length).toBe(0);
  expect(eve.shots.flying.length).toBe(0);
  expect(h.host.projectiles.lastEnd.on).toBe(-1);
  // The bar showed the next arrow being nocked, and the line counts one fewer.
  expect(f.find(KEY_AMMO)!.text).toBe("stone arrow  1 / 38");

  // Arrows into the ground until one stands: it is drawn tilted, by both, as a thing in the world.
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

  // The rifle: a round leaves a line for a moment, on her screen at once and on Eve's when told.
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
  // The reload shows as a bar of its own.
  expect(f.find(KEY_ACTION)).not.toBeNull();
  expect(eve.session.events.length).toBe(0);
  // Aiming narrows the view and slows the mouse to match.
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
