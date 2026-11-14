import { expect, test } from "bun:test";
import { CombatModel, Feedback, HURT_MS, MARK_MS, NUMBER_BODY, NUMBER_HEAD, NUMBER_KILL, NUMBER_MS } from "../../client/core/feedback.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { RemoteSample, type ClientSession, type CombatEvent } from "../../client/core/session.ts";
import { handleIndex } from "../../shared/ids.ts";
import { KEY_BLOOD, KEY_DAMAGE, KEY_HIT_MARK, KEY_HURT, KEY_NOTICE, buildCombat } from "../../client/core/ui/combat.ts";
import { UiFrame } from "../../client/core/ui/nodes.ts";
import { S_DAMAGE_HEAD, S_HIT_KILL } from "../../client/core/ui/style.ts";
import type { Blow } from "../../server/combat.ts";
import type { EntityRecord } from "../../server/records.ts";
import { HumanAnim, AnimState, humanPose } from "../../shared/anim/pose.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { B_HAND_R, B_UPPER_ARM_R, B_UPPER_LEG_L, HUMAN_BONES, ZONE_HEAD, ZONE_LEG_L, ZONE_LEG_R, ZONE_TORSO } from "../../shared/anim/human.ts";
import { EVENT_DEATH, EVENT_HIT, EVENT_HURT, EVENT_KILL, SESSION_ALIVE, SESSION_DEAD } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY } from "../../shared/sim/character.ts";
import { ACT_NONE, ACT_SWING, HOLD_HANDS, HOLD_TOOL, SWING_TICKS } from "../../shared/sim/weapon.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { capsuleFree } from "../../shared/world/collide.ts";
import { HIT_NONE, castWorld } from "../../shared/world/ray.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = 1000 / 30;
/** Metres between the striker and its target. */
const APART = 1.5;

/** A level, open, dry spot with a second spot APART metres north of it and nothing between them. */
function levelGround(h: Harness): { x: number; z: number } {
  const w = h.world;
  const p = reg.move[id("survivor")]!;
  const spawn = w.spawns[0]!;
  for (let r = 6; r < 120; r += 3) {
    for (let k = 0; k < 16; k++) {
      const x = spawn.x + Math.sin((k * Math.PI) / 8) * r;
      const z = spawn.z + Math.cos((k * Math.PI) / 8) * r;
      const y = w.hf.heightAt(x, z);
      if (y < w.hf.seaLevel + 0.5) continue;
      let ok = true;
      for (let dz = -1; dz <= APART + 1 && ok; dz += 0.5) for (let dx = -1; dx <= 1 && ok; dx += 0.5) ok = Math.abs(w.hf.heightAt(x + dx, z + dz) - y) < 0.02;
      if (!ok || !capsuleFree(w, x, y, z, p.radius, p.height) || !capsuleFree(w, x, y, z + APART, p.radius, p.height)) continue;
      if (castWorld(w, x, y + 0.3, z - 1, 0, 0, 1, 6) !== HIT_NONE || castWorld(w, x, y + 1.6, z - 1, 0, 0, 1, 6) !== HIT_NONE) continue;
      return { x, z };
    }
  }
  throw new Error("no level ground near the spawn point");
}

/** A survivor with cheats on level ground, looking north. */
function setup(link = {}) {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada", link);
  h.run(500);
  h.say(s, "enablecheats");
  const pilot = h.pilots[0]!;
  const at = levelGround(h);
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  pilot.yaw = 0;
  h.run(300);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  /** The dummy faces the survivor. */
  const dummy = (): { e: number; rec: EntityRecord } => {
    const e = h.host.spawnCreature("core:dummy", at.x, at.z + APART, 1);
    expect(e).toBeGreaterThanOrEqual(0);
    const drec = h.host.records.byPid.get(h.world.ents.pid[e]!)!;
    h.world.ents.yaw[e] = drec.yaw = 32768;
    h.run(200);
    return { e, rec: drec };
  };
  return { h, s, pilot, rec, at, dummy };
}

/** Looks at a point `height` metres above the target's feet and swings once. Returns the blow that landed, or null. */
function swingAt(h: Harness, pilot: Pilot, height: number): Blow | null {
  pilot.pitch = Math.atan2(height - 1.62, APART);
  h.run(100);
  const before = h.host.combat.hits;
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 8);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(TICK_MS * (SWING_TICKS + 6));
  return h.host.combat.hits === before + 1 ? { ...h.host.combat.last } : null;
}

const HEAD = 1.66;
const CHEST = 1.25;
const SHIN = 0.45;

test("a punch lands where it is aimed: a head counts three times, and the one who threw it is told where, which part and how much", () => {
  const { h, s, pilot, rec, dummy } = setup();
  const d = dummy();
  const health = (): number => h.host.survival.value(d.rec, V_HEALTH);
  const full = health();
  const corrections = s.stats.corrections + s.stats.stateCorrections;

  const head = swingAt(h, pilot, HEAD)!;
  expect([head.zone, head.damage, head.blocked, head.killed, head.by, head.victim]).toEqual([ZONE_HEAD, 24, 0, false, rec.pid, d.rec.pid]);
  const chest = swingAt(h, pilot, CHEST)!;
  expect([chest.zone, chest.damage]).toEqual([ZONE_TORSO, 8]);
  const shin = swingAt(h, pilot, SHIN)!;
  expect([ZONE_LEG_L, ZONE_LEG_R]).toContain(shin.zone);
  expect(shin.damage).toBe(8);
  // 24 + 8 + 8, less the little it mended meanwhile.
  expect(full - health()).toBeGreaterThan(39);
  expect(full - health()).toBeLessThanOrEqual(40);
  // 2.6 m is over its head.
  expect(swingAt(h, pilot, 2.6)).toBeNull();

  const hits = s.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(hits.map((ev) => [ev.zone, ev.damage, ev.kill, ev.blocked])).toEqual([[ZONE_HEAD, 24, false, false], [ZONE_TORSO, 8, false, false], [shin.zone, 8, false, false]]);
  const ents = h.world.ents;
  for (const ev of hits) {
    expect(Math.hypot(ev.x - ents.x[d.e]!, ev.z - ents.z[d.e]!)).toBeLessThan(0.5);
    expect(ev.y - ents.y[d.e]!).toBeGreaterThan(0.2);
    expect(ev.y - ents.y[d.e]!).toBeLessThan(1.9);
  }
  expect(hits[0]!.y).toBeGreaterThan(hits[1]!.y);
  expect(hits[1]!.y).toBeGreaterThan(hits[2]!.y);
  // The client predicted each swing, so the server corrected nothing.
  expect(s.stats.corrections + s.stats.stateCorrections).toBe(corrections);
  expect(s.own.act).toBe(ACT_NONE);
  expect(h.host.items.audit()).toEqual([]);
});

test("armor stops most of a blow on the part it covers, is worn by what it stops, and does nothing for a part left bare", () => {
  const { h, s, pilot } = setup();
  expect(h.say(s, "dummy steel")[0]).toContain("no armor");
  const lines = h.say(s, "dummy flak");
  expect(lines).toEqual(["a dummy in flak"]);
  const ents = h.world.ents;
  let far = -1;
  for (let e = 0; e < ents.cap; e++) if (ents.kind[e] === id("dummy") && (ents.flags[e]! & 1) !== 0) far = e;
  const drec = h.host.records.byPid.get(ents.pid[far]!)!;
  const inv = h.host.items.inv(drec);
  expect([...inv.item.subarray(inv.armor, inv.armor + 5)]).toEqual(["hat", "shirt", "gloves", "pants", "boots"].map((p) => id(`flak_${p}`)));
  expect([...ents.gear[far]!.subarray(1)]).toEqual([...inv.item.subarray(inv.armor, inv.armor + 5)]);
  expect(Math.hypot(ents.x[far]! - ents.x[h.ent(s)]!, ents.z[far]! - ents.z[h.ent(s)]!)).toBeCloseTo(3, 1);
  // The console's dummy stands 3 m off, so the survivor steps up to it.
  h.say(s, `tp ${ents.x[far]!.toFixed(3)} ${(ents.z[far]! - APART).toFixed(3)}`);
  const durable = (slot: number): number => inv.dur[inv.armor + slot]!;
  const whole = durable(0);
  expect(whole).toBe(120);

  // A flak piece rates 100 and counts five times against a blow on its part, so a sixth gets through.
  const head = swingAt(h, pilot, HEAD)!;
  expect(head.zone).toBe(ZONE_HEAD);
  expect(head.damage).toBeCloseTo(24 / 6, 5);
  expect(head.blocked).toBeCloseTo(20, 5);
  expect([head.wear, durable(0)]).toEqual([2, whole - 2]);
  const chest = swingAt(h, pilot, CHEST)!;
  expect(chest.damage).toBeCloseTo(8 / 6, 5);
  expect([chest.wear, durable(1)]).toEqual([1, whole - 1]);
  // The same blow to a leg, with the pants (slot 3) on and then off.
  const covered = swingAt(h, pilot, SHIN)!;
  expect(covered.damage).toBeCloseTo(8 / 6, 5);
  expect(durable(3)).toBe(whole - 1);
  expect(h.host.items.burn(drec, inv.armor + 3, 1)).toBe(true);
  const bare = swingAt(h, pilot, SHIN)!;
  expect([bare.damage, bare.blocked, bare.wear]).toEqual([8, 0, 0]);
  // A worn-out piece stops nothing and stays in its slot.
  h.host.items.wear(drec, inv.armor + 1, 1000);
  expect(durable(1)).toBe(0);
  expect(swingAt(h, pilot, CHEST)!.damage).toBe(8);
  expect(inv.item[inv.armor + 1]).toBe(id("flak_shirt"));
  // The client gets the damage that got through, rounded, and whether armor blocked any.
  const hits = s.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(hits.map((ev) => [ev.damage, ev.blocked])).toEqual([[4, true], [1, true], [1, true], [8, false], [8, false]]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a weapon in hand strikes with its own damage and reach and is worn by each blow; worn out, it is a bare hand", () => {
  const { h, s, pilot, rec, dummy } = setup();
  const d = dummy();
  h.say(s, "kit tools");
  const slot = takeInHand(h, s, id("hatchet"));
  h.run(TICK_MS * 20);
  const inv = h.host.items.inv(rec);
  expect(inv.dur[slot]).toBe(60);
  expect(h.world.ents.hold[h.ent(s)]).toBe(HOLD_TOOL);
  expect(s.own.held).toBe(id("hatchet"));
  const blow = swingAt(h, pilot, CHEST)!;
  expect([blow.zone, blow.damage]).toEqual([ZONE_TORSO, 20]);
  expect(inv.dur[slot]).toBe(59);
  expect(swingAt(h, pilot, HEAD)!.damage).toBe(60);
  // Quality 2 multiplies the damage by 1.45.
  inv.set(slot, id("hatchet"), 1, 2, 60, 0);
  expect(swingAt(h, pilot, CHEST)!.damage).toBeCloseTo(20 * 1.45, 5);
  h.host.items.wear(rec, slot, 1000);
  expect(swingAt(h, pilot, CHEST)!.damage).toBe(8);
  expect(inv.dur[slot]).toBe(0);
  // A spear reaches 2.7 m. A hand does not.
  h.say(s, `tp ${h.world.ents.x[d.e]!.toFixed(3)} ${(h.world.ents.z[d.e]! - 2.7).toFixed(3)}`);
  const far = (height: number): Blow | null => {
    pilot.pitch = Math.atan2(height - 1.62, 2.7);
    const before = h.host.combat.hits;
    pilot.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * 8);
    pilot.buttons &= ~BTN_PRIMARY;
    h.run(TICK_MS * (SWING_TICKS + 6));
    return h.host.combat.hits === before + 1 ? { ...h.host.combat.last } : null;
  };
  expect(far(CHEST)).toBeNull();
  takeInHand(h, s, id("spear"), 1);
  h.run(TICK_MS * 20);
  expect(far(CHEST)!.damage).toBe(30);
  expect(h.host.items.audit()).toEqual([]);
});

test("taking something in hand takes a moment, and a swing asked for meanwhile waits for it", () => {
  const { h, s, pilot, rec, dummy } = setup();
  dummy();
  h.say(s, "kit tools");
  pilot.pitch = Math.atan2(CHEST - 1.62, APART);
  pilot.buttons |= BTN_PRIMARY;
  const before = h.host.combat.hits;
  const slot = takeInHand(h, s, id("hatchet"));
  // The first blow is the hatchet's 20, not a punch thrown while it was half drawn.
  h.run(TICK_MS * 30);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(TICK_MS * 20);
  expect(h.host.combat.hits).toBeGreaterThan(before);
  expect(h.host.items.inv(rec).dur[slot]).toBeLessThan(60);
  expect(h.host.combat.last.damage).toBe(20);
});

test("one survivor kills another: the victim is told what hurt it and from where, then who killed it; the killer has the experience", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  const bob = h.join("bob");
  h.run(500);
  h.say(ada, "enablecheats");
  h.say(bob, "enablecheats");
  const at = levelGround(h);
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(bob, `tp ${at.x.toFixed(3)} ${(at.z + APART).toFixed(3)}`);
  // Ada looks north at Bob, who looks east.
  h.pilots[0]!.yaw = 0;
  h.pilots[1]!.yaw = Math.PI / 2;
  h.run(300);
  const arec = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!;
  const brec = h.host.records.byPid.get(h.world.ents.pid[h.ent(bob)]!)!;
  h.host.items.mint(brec, id("berry"), 5);
  const xp = arec.xp;
  // Four blows of 24 to the head leave 4 health. The fifth kills.
  for (let n = 0; n < 4; n++) expect(swingAt(h, h.pilots[0]!, HEAD)!.zone).toBe(ZONE_HEAD);
  expect(h.host.survival.value(brec, V_HEALTH)).toBeLessThan(5);
  expect(bob.sessionState).toBe(SESSION_ALIVE);
  const hurts = bob.events.filter((ev) => ev.kind === EVENT_HURT);
  expect(hurts.map((ev) => [ev.damage, ev.zone])).toEqual([[24, ZONE_HEAD], [24, ZONE_HEAD], [24, ZONE_HEAD], [24, ZONE_HEAD]]);
  // The blow came from the south, a bearing of half a turn (128 of 256).
  expect(hurts[0]!.bearing).toBe(128);
  const last = swingAt(h, h.pilots[0]!, HEAD)!;
  expect(last.killed).toBe(true);
  // The last blow's damage is the health that was left.
  expect(last.damage).toBeLessThan(5);
  expect(bob.sessionState).toBe(SESSION_DEAD);
  expect(brec.dead).toBe(true);
  const death = bob.events.find((ev) => ev.kind === EVENT_DEATH)!;
  expect([death.name, death.item, death.zone, death.bearing]).toEqual(["ada", 0, ZONE_HEAD, 128]);
  expect(death.far).toBeGreaterThan(0.8);
  expect(death.far).toBeLessThan(1.6);
  const hit = ada.events.filter((ev) => ev.kind === EVENT_HIT);
  expect(hit.length).toBe(5);
  expect(hit[4]!.kill).toBe(true);
  const kill = ada.events.find((ev) => ev.kind === EVENT_KILL)!;
  expect([kill.name, kill.level, kill.xp]).toEqual(["bob", 1, 10]);
  expect(arec.xp).toBe(xp + 10);
  expect(h.host.items.inv(brec).used()).toBe(0);
  const cache = [...h.host.records.byPid.values()].find((r) => r.kind === id("cache"))!;
  expect(h.host.items.inv(cache).total(id("berry"))).toBe(5);
  expect(h.host.death.count).toBe(1);
  expect(h.host.items.audit()).toEqual([]);
});

test("killing a creature gives the killer what it yields and the experience of it; hurt and not killed, it runs", () => {
  const { h, s, pilot, rec, at } = setup();
  const e = h.host.spawnCreature("core:grazer", at.x, at.z + APART, 7);
  expect(e).toBeGreaterThanOrEqual(0);
  const ents = h.world.ents;
  const grec = h.host.records.byPid.get(ents.pid[e]!)!;
  const level = grec.genome!.level;
  const inv = h.host.items.inv(rec);
  const xp = rec.xp;
  // A box body has one part, so any hit is to its torso.
  pilot.pitch = Math.atan2(0.8 - 1.62, APART);
  const before = h.host.combat.hits;
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 8);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(TICK_MS * 4);
  expect(h.host.combat.hits).toBe(before + 1);
  expect([h.host.combat.last.zone, h.host.combat.last.damage, h.host.combat.last.killed]).toEqual([ZONE_TORSO, 8, false]);
  const z0 = ents.z[e]!;
  h.run(1500);
  expect(ents.z[e]! - z0).toBeGreaterThan(3);
  // It is held still so it can be reached. It runs faster than a survivor swings.
  h.host.creatures.mind.stay(e, h.world.tick + 1e6);
  h.run(400);
  h.host.survival.add(grec, V_HEALTH, -(h.host.survival.value(grec, V_HEALTH) - 1));
  h.say(s, `tp ${ents.x[e]!.toFixed(3)} ${(ents.z[e]! - 1.3).toFixed(3)}`, 60);
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 12);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(400);
  expect(h.host.combat.last.killed).toBe(true);
  expect(h.host.records.byPid.has(grec.pid)).toBe(false);
  const hide = inv.total(id("hide"));
  const meat = inv.total(id("meat"));
  expect(hide).toBeGreaterThanOrEqual(4);
  expect(hide).toBeLessThanOrEqual(9);
  expect(meat).toBeGreaterThanOrEqual(3);
  expect(meat).toBeLessThanOrEqual(6);
  expect(rec.xp - xp).toBeCloseTo(4 * (1 + 0.1 * (level - 1)), 1);
  const kill = s.events.find((ev) => ev.kind === EVENT_KILL)!;
  expect([kill.name, kill.level]).toEqual(["grazer", level]);
  expect(h.host.items.audit()).toEqual([]);
});

test("a swing lands on a standing target at 150 ms of latency as it does at none, and the swing is seen by others", () => {
  const { h, s, pilot, dummy } = setup({ latencyMs: 75 });
  dummy();
  const watcher = h.join("cyd");
  h.run(600);
  const head = swingAt(h, pilot, HEAD)!;
  expect([head.zone, head.damage]).toEqual([ZONE_HEAD, 24]);
  // The watcher gets the swing in the anim word: the act in the low three bits and the hold above them.
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 6);
  const st = new AnimState();
  let seen = false;
  const remote = new RemoteSample();
  h.run(TICK_MS * 10, () => {
    watcher.sampleRemote(remote);
    for (let i = 0; i < remote.count; i++) {
      if (remote.id[i] !== handleIndex(s.ownHandle)) continue;
      st.unpack(remote.anim[i]!);
      if ((st.action & 7) === ACT_SWING && st.action >>> 3 === HOLD_HANDS) seen = true;
    }
  });
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(800);
  expect(seen).toBe(true);
  // The client predicted its own swing, so no state correction arrived.
  expect(s.stats.stateCorrections).toBe(0);
});

test("a swing takes the upper body and leaves the legs walking", () => {
  const anim = new HumanAnim(corePack().clips);
  const st = new AnimState();
  st.setMotion(0, 4.2, 0, 0);
  const walking = new Pose(HUMAN_BONES);
  const swinging = new Pose(HUMAN_BONES);
  const differs = (a: Pose, b: Pose, from: number, to: number): boolean => {
    for (let i = from * 4; i < to * 4; i++) if (Math.abs(a.rot[i]! - b.rot[i]!) > 1e-4) return true;
    return false;
  };
  for (const hold of [HOLD_HANDS, HOLD_TOOL]) {
    st.setAction(ACT_NONE, hold, 0);
    humanPose(anim, st, 100 + 5, walking);
    st.setAction(ACT_SWING, hold, 100);
    humanPose(anim, st, 100 + 5, swinging);
    expect(differs(walking, swinging, B_UPPER_ARM_R, B_HAND_R + 1)).toBe(true);
    expect(differs(walking, swinging, B_UPPER_LEG_L, B_UPPER_LEG_L + 8)).toBe(false);
    expect([...swinging.root]).toEqual([...walking.root]);
    // At the tick it begins and from the tick it ends, the pose equals the walking pose.
    for (const tick of [100, 100 + SWING_TICKS, 100 + SWING_TICKS + 20]) {
      humanPose(anim, st, tick, swinging);
      st.setAction(ACT_NONE, hold, 0);
      humanPose(anim, st, tick, walking);
      st.setAction(ACT_SWING, hold, 100);
      expect(differs(walking, swinging, 0, HUMAN_BONES)).toBe(false);
    }
  }
  // The packed word keeps the act and the hold. The start tick wraps at 256.
  st.setAction(ACT_SWING, HOLD_TOOL, 100 + 256 * 3);
  const back = new AnimState();
  back.unpack(st.pack());
  expect([back.action & 7, back.action >>> 3, back.actionStart]).toEqual([ACT_SWING, HOLD_TOOL, 100]);
});

test("what the server reports is shown and fades: a mark, a number over the place, the side harm came from, red edges, a line", () => {
  const event = (kind: number, more: Partial<CombatEvent>): CombatEvent => ({ kind, x: 0, y: 0, z: 0, zone: 0, damage: 0, kill: false, blocked: false, bearing: 0, name: "", item: 0, far: 0, level: 0, xp: 0, flies: false, vx: 0, vy: 0, vz: 0, back: 0, ...more });
  const session = { events: [] as CombatEvent[] } as unknown as ClientSession;
  const fb = new Feedback();
  const m = new CombatModel();
  const cam = new Camera();
  cam.y = 1.6;
  cam.update();
  const f = new UiFrame();
  const show = (now: number, alive = true): void => {
    fb.absorb(session, reg, now);
    fb.fill(m, cam, 0, alive, now);
    f.begin(16 / 9);
    buildCombat(f, m);
  };
  show(1000);
  expect(f.count).toBe(0);

  session.events.push(event(EVENT_HIT, { x: 0, y: 1.6, z: 5, zone: ZONE_HEAD, damage: 24 }));
  show(1000);
  expect(session.events.length).toBe(0);
  expect([m.mark, m.markHead, m.markKill, m.numberCount]).toEqual([1, true, false, 1]);
  expect(m.numbers[0]).toMatchObject({ text: "24", kind: NUMBER_HEAD, alpha: 1 });
  expect(m.numbers[0]!.u).toBeCloseTo(0.5, 3);
  expect(m.numbers[0]!.v).toBeCloseTo(0.5, 3);
  for (let i = 0; i < 4; i++) expect(f.find(KEY_HIT_MARK + i)).not.toBeNull();
  const number = f.find(KEY_DAMAGE)!;
  expect([number.text, number.style]).toEqual(["24", S_DAMAGE_HEAD]);
  expect(number.x + number.w / 2).toBeCloseTo(f.width / 2, 0);
  // The mark goes first. The number rises, and fades over the second half of NUMBER_MS.
  show(1000 + MARK_MS + 1);
  expect(m.mark).toBe(0);
  expect(f.find(KEY_HIT_MARK)).toBeNull();
  expect(m.numbers[0]!.v).toBeLessThan(0.5);
  show(1000 + NUMBER_MS * 0.75);
  expect(m.numbers[0]!.alpha).toBeCloseTo(0.5, 2);
  expect(f.find(KEY_DAMAGE)!.alpha).toBeCloseTo(0.5, 2);
  show(1000 + NUMBER_MS);
  expect(m.numberCount).toBe(0);
  // A hit behind the camera gets a mark and no number.
  session.events.push(event(EVENT_HIT, { x: 0, y: 1.6, z: -5, zone: ZONE_TORSO, damage: 8 }));
  show(5000);
  expect([m.mark, m.numberCount]).toEqual([1, 0]);
  session.events.push(event(EVENT_HIT, { x: 0, y: 1.6, z: 5, zone: ZONE_TORSO, damage: 3, kill: true }), event(EVENT_KILL, { name: "grazer", level: 7, xp: 6.4 }));
  show(6000);
  expect(f.find(KEY_HIT_MARK)!.style).toBe(S_HIT_KILL);
  expect(m.numbers[m.numberCount - 1]!.kind).toBe(NUMBER_KILL);
  expect(f.find(KEY_NOTICE)!.text).toBe("Killed grazer (level 7)  +6.4 xp");
  expect(NUMBER_BODY).toBe(0);

  // Bearing 64 is harm from the left of this camera.
  session.events.push(event(EVENT_HURT, { damage: 25, bearing: 64, zone: ZONE_TORSO }));
  show(20000);
  expect([m.hurtCount, m.blood]).toEqual([1, 0.5]);
  const mark = f.find(KEY_HURT)!;
  expect(mark.x + mark.w / 2).toBeLessThan(f.width / 2 - 50);
  expect(mark.y + mark.h / 2).toBeCloseTo(f.height / 2, 0);
  expect(f.find(KEY_BLOOD)!.alpha).toBeGreaterThan(0);
  expect(f.find(KEY_BLOOD + 7)).not.toBeNull();
  show(20000 + HURT_MS / 2);
  expect(f.find(KEY_HURT)!.alpha).toBeCloseTo(0.5, 2);
  expect(m.blood).toBeLessThan(0.5);
  show(20000 + 4000);
  expect([m.hurtCount, m.blood]).toEqual([0, 0]);
  expect(f.find(KEY_BLOOD)).toBeNull();
  // Bearing 128 is harm from behind, marked below the crosshair.
  session.events.push(event(EVENT_HURT, { damage: 5, bearing: 128 }));
  show(30000);
  expect(f.find(KEY_HURT)!.y + 7).toBeGreaterThan(f.height / 2 + 50);

  // The death notice stays up while dead and goes once alive again.
  session.events.push(event(EVENT_DEATH, { damage: 12, bearing: 0, zone: ZONE_HEAD, name: "bob", item: id("hatchet"), far: 2.34, kill: true }));
  show(40000, false);
  expect(f.find(KEY_NOTICE)!.text).toBe("Killed by bob with hatchet: 12 to the head from 2.3 m");
  show(40000 + 60000, false);
  expect(f.find(KEY_NOTICE)!.alpha).toBe(1);
  show(40000 + 61000, true);
  expect(f.find(KEY_NOTICE)).toBeNull();
  session.events.push(event(EVENT_HIT, { x: 0, y: 1.6, z: 5, damage: 9 }), event(EVENT_HURT, { damage: 60, bearing: 30 }), event(EVENT_KILL, { name: "a creature with a very long name", level: 120, xp: 99 }));
  fb.absorb(session, reg, 200000);
  for (const aspect of [9 / 16, 4 / 3, 16 / 9, 32 / 9]) {
    cam.aspect = aspect;
    cam.update();
    fb.fill(m, cam, 0, true, 200000);
    f.begin(aspect);
    buildCombat(f, m);
    expect(f.count).toBeGreaterThan(12);
    for (let i = 0; i < f.count; i++) {
      const n = f.nodes[i]!;
      expect(n.x).toBeGreaterThanOrEqual(-0.5);
      expect(n.y).toBeGreaterThanOrEqual(-0.5);
      expect(n.x + n.w).toBeLessThanOrEqual(f.width + 0.5);
      expect(n.y + n.h).toBeLessThanOrEqual(f.height + 0.5);
      expect(n.alpha).toBeGreaterThan(0);
      expect(n.alpha).toBeLessThanOrEqual(1);
    }
  }
});
