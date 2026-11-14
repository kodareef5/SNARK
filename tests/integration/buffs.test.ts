import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../client/core/app.ts";
import { KEY_BANNER, KEY_BUFF, KEY_OUT, KEY_VITAL } from "../../client/core/ui/hud.ts";
import { MAX_BUFFS } from "../../server/buffs.ts";
import { createHost } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { EVENT_KILL } from "../../shared/net/protocol.ts";
import { BTN_PRIMARY, MF_NO_SPRINT, MF_OUT, MF_ROOTED, STANCE_PRONE } from "../../shared/sim/character.ts";
import { V_HEALTH, V_TORPOR } from "../../shared/sim/vitals.ts";
import { ACT_NONE } from "../../shared/sim/weapon.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness, type Pilot } from "../fixtures/net.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-buffs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const TICK_MS = 1000 / 30;
const EYE = 1.62;

/** A survivor with cheats at the south end of a level range, looking north. */
function range() {
  const h = new Harness({}, 1, 60, { dev: true });
  const s = h.join("ada");
  h.run(500);
  h.say(s, "enablecheats");
  const pilot = h.pilots[0]!;
  const g = flatGround(h, 24, 30);
  const at = { x: g.x + 12, z: g.z + 1.5 };
  h.say(s, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  pilot.yaw = 0;
  h.run(300);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  const spawn = (kind: string, far: number, level = 1): { e: number; rec: EntityRecord } => {
    const e = h.host.spawnCreature(`core:${kind}`, at.x, at.z + far, level);
    expect(e).toBeGreaterThanOrEqual(0);
    return { e, rec: h.host.records.byPid.get(h.world.ents.pid[e]!)! };
  };
  const arm = (kit: string, weapon: string, ms: number): number => {
    h.say(s, `kit ${kit}`);
    const slot = takeInHand(h, s, id(weapon));
    h.run(ms);
    return slot;
  };
  return { h, s, pilot, rec, at, spawn, arm };
}

function aim(pilot: Pilot, far: number, height: number): void {
  pilot.yaw = 0;
  pilot.pitch = Math.atan2(height - EYE, far);
}

function loose(h: Harness, pilot: Pilot, ms = 1200): void {
  pilot.buttons |= BTN_PRIMARY;
  h.run(TICK_MS * 45);
  pilot.buttons &= ~BTN_PRIMARY;
  h.run(ms);
}

test("tranquilizer arrows: torpor at once and more to come, a creature goes down at its most and gets up when it has all gone", () => {
  const { h, s, pilot, rec, spawn, arm } = range();
  const survival = h.host.survival;
  const g = spawn("grazer", 8, 1);
  const ents = h.world.ents;
  // A grazer wanders, and runs when hurt, so the test holds it still.
  h.host.creatures.mind.stay(g.e, h.world.tick + 1e6);
  survival.gods.add(g.rec.pid);
  const slot = arm("bow", "bow", 400);
  h.host.items.load(rec, slot, id("arrow_tranq"), 1);
  h.run(900);
  const torpor = (): number => survival.value(g.rec, V_TORPOR);
  const most = g.rec.vitals!.max[V_TORPOR]! / 1e6;
  expect(most).toBeCloseTo(150 * (1 + 0.06 * g.rec.genome!.wild[8]!), 3);
  expect(torpor()).toBe(0);
  survival.gods.delete(g.rec.pid);
  const health = survival.value(g.rec, V_HEALTH);
  let shots = 0;
  // Each arrow does 20 damage, 40 torpor at once (twice the damage) and 50 more over five seconds (10 a second).
  let tries = 0;
  while (!g.rec.out && shots < 12 && tries++ < 40) {
    // A hit makes it run faster than the aim can lead, so it is held still again before each shot.
    h.host.creatures.mind.stay(g.e, h.world.tick + 1e6);
    h.run(300);
    aim(pilot, Math.hypot(ents.x[g.e]! - ents.x[h.ent(s)]!, ents.z[g.e]! - ents.z[h.ent(s)]!), 0.9);
    pilot.yaw = Math.atan2(ents.x[g.e]! - ents.x[h.ent(s)]!, ents.z[g.e]! - ents.z[h.ent(s)]!);
    const before = h.host.combat.hits;
    loose(h, pilot, 250);
    if (h.host.combat.hits === before) continue;
    shots++;
    if (shots === 1) {
      expect(h.host.combat.last.damage).toBe(20);
      expect(torpor()).toBeGreaterThan(40);
      expect(torpor()).toBeLessThan(47);
      expect(g.rec.buffs.map((b) => b.buff)).toEqual([id("tranquilized")]);
      expect(g.rec.buffs[0]!.torpor).toBeCloseTo(10, 5);
      expect(g.rec.buffs[0]!.by).toBe(rec.pid);
    }
  }
  expect(g.rec.out).toBe(true);
  // A creature of 150 torpor takes about two arrows.
  expect(shots).toBeGreaterThanOrEqual(2);
  expect(shots).toBeLessThanOrEqual(4);
  expect(health - survival.value(g.rec, V_HEALTH)).toBeLessThanOrEqual(20 * shots);
  expect(ents.mflags[g.e]! & MF_OUT).toBe(MF_OUT);
  h.run(6000);
  const [x, z] = [ents.x[g.e]!, ents.z[g.e]!];
  h.run(3000);
  expect([ents.x[g.e]!, ents.z[g.e]!]).toEqual([x, z]);
  expect(g.rec.buffs.length).toBe(0);
  // Torpor falls 0.6 a second, so it is out for minutes.
  const left = torpor();
  expect(left).toBeGreaterThan(100);
  h.run(((left / 0.6) * 1000) / 2);
  expect(g.rec.out).toBe(true);
  expect(torpor()).toBeCloseTo(left / 2, -1);
  h.run(((left / 0.6) * 1000) / 2 + 2000);
  expect(g.rec.out).toBe(false);
  expect(torpor()).toBe(0);
  expect(ents.mflags[g.e]! & MF_OUT).toBe(0);
  expect(h.host.items.audit()).toEqual([]);
});

test("a survivor knocked out lies down, can do nothing, sees the dark, and comes round; flak keeps most of a dart out", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = corePack();
  const app = new App(h.join("bob", {}, { manual: true }), h.reg, pack);
  app.frame(0, 1280, 720);
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  run(500);
  const s = app.session;
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(s)]!)!;
  const survival = h.host.survival;
  const f = app.ui.frame;
  const e = h.ent(s);
  const ents = h.world.ents;
  // 150 of his 200 torpor. It falls 4 a second.
  survival.add(rec, V_TORPOR, 150);
  run(300);
  expect(f.find(KEY_VITAL + 11)!.value).toBeGreaterThan(0.7);
  expect(f.find(KEY_OUT)).toBeNull();
  run(5000);
  expect(survival.value(rec, V_TORPOR)).toBeCloseTo(150 - 4 * 5.3, 0);
  expect(rec.out).toBe(false);
  survival.add(rec, V_TORPOR, 200);
  app.controls.key("KeyW", true);
  app.controls.mouseButton(0, true);
  const [x, z] = [ents.x[e]!, ents.z[e]!];
  run(1500);
  expect(rec.out).toBe(true);
  expect(ents.mflags[e]! & MF_OUT).toBe(MF_OUT);
  // His own client predicts the same state, so the server corrects nothing.
  expect(ents.stance[e]).toBe(STANCE_PRONE);
  expect(Math.hypot(ents.x[e]! - x, ents.z[e]! - z)).toBeLessThan(0.3);
  expect([ents.act[e], s.own.act]).toEqual([ACT_NONE, ACT_NONE]);
  expect(s.own.stance).toBe(STANCE_PRONE);
  const corrections = s.stats.corrections;
  run(1000);
  expect(s.stats.corrections).toBe(corrections);
  expect(f.find(KEY_OUT)!.alpha).toBeGreaterThan(0.5);
  expect(f.find(KEY_BANNER)!.text).toBe("UNCONSCIOUS");
  // 200 torpor at 4 a second is gone in fifty seconds.
  run(51000);
  expect(rec.out).toBe(false);
  expect(f.find(KEY_OUT)).toBeNull();
  run(1500);
  expect(Math.hypot(ents.x[e]! - x, ents.z[e]! - z)).toBeGreaterThan(2);
  app.controls.release();
});

test("a flame arrow sets its mark burning: eight health a second for eight seconds, nothing stepped, and the kill is the archer's", () => {
  const { h, s, pilot, rec, spawn, arm } = range();
  const survival = h.host.survival;
  const d = spawn("dummy", 10);
  h.world.ents.yaw[d.e] = 32768;
  const slot = arm("bow", "bow", 400);
  h.host.items.load(rec, slot, id("arrow_flame"), 1);
  h.run(900);
  const full = survival.value(d.rec, V_HEALTH);
  aim(pilot, 10, 1.25 + 0.1);
  loose(h, pilot, 300);
  expect(h.host.combat.last.damage).toBe(55);
  expect(d.rec.buffs.map((b) => [b.buff, b.by])).toEqual([[id("burning"), rec.pid]]);
  // The burn changes the health rate and steps nothing. The rate is 0.2 mending less 8 burning a second, in millionths per tick.
  const v = d.rec.vitals!;
  expect(v.rate[V_HEALTH]).toBe(Math.round(((0.2 - 8) * 1e6) / 30));
  const began = d.rec.buffs[0]!.until - 8 * 30;
  h.run(4000);
  const mid = h.world.tick;
  expect(survival.value(d.rec, V_HEALTH)).toBeCloseTo(full - 55 - (7.8 * (mid - began)) / 30, 1);
  h.run(5000);
  expect(d.rec.buffs.length).toBe(0);
  expect(v.rate[V_HEALTH]).toBe(Math.round((0.2 * 1e6) / 30));
  const after = h.world.tick;
  expect(survival.value(d.rec, V_HEALTH)).toBeCloseTo(full - 55 - 8 * 8 + (0.2 * (after - began)) / 30, 1);
  // A second flame arrow restarts the eight seconds. It does not add to the time left.
  aim(pilot, 10, 1.25 + 0.1);
  loose(h, pilot, 300);
  h.run(2000);
  loose(h, pilot, 300);
  expect(d.rec.buffs.length).toBe(1);
  expect(d.rec.buffs[0]!.until - h.world.tick).toBeGreaterThan(7 * 30);
  expect(d.rec.buffs[0]!.until - h.world.tick).toBeLessThanOrEqual(8 * 30);

  h.host.death.die(d.rec, 0);
  const g = spawn("grazer", 10);
  // Knocked out first, so it lies still for the shot.
  survival.add(g.rec, V_TORPOR, 10000);
  survival.add(g.rec, V_HEALTH, -(survival.value(g.rec, V_HEALTH) - 70));
  // The wait lets the next arrow nock.
  h.run(1000);
  const xp = rec.xp;
  const ents = h.world.ents;
  pilot.yaw = Math.atan2(ents.x[g.e]! - ents.x[h.ent(s)]!, ents.z[g.e]! - ents.z[h.ent(s)]!);
  pilot.pitch = Math.atan2(0.9 - EYE + 0.1, Math.hypot(ents.x[g.e]! - ents.x[h.ent(s)]!, ents.z[g.e]! - ents.z[h.ent(s)]!));
  const hits = h.host.combat.hits;
  loose(h, pilot, 200);
  expect(h.host.combat.hits).toBe(hits + 1);
  // The arrow takes 55 of its 70 health. The last 15 take two seconds of burning.
  expect(h.host.records.byPid.has(g.rec.pid)).toBe(true);
  h.run(2500);
  expect(h.host.records.byPid.has(g.rec.pid)).toBe(false);
  expect(rec.xp).toBeGreaterThan(xp);
  expect(s.events.some((ev) => ev.kind === EVENT_KILL && ev.name === "grazer")).toBe(true);
  expect(h.host.items.inv(rec).total(id("hide"))).toBeGreaterThanOrEqual(4);
  expect(h.host.items.audit()).toEqual([]);
});

test("what acts on a body: a stun roots it, an injury slows it and mends, god mode is a buff, and the client is shown each", () => {
  const h = new Harness({}, 1, 60, { dev: true });
  const pack = corePack();
  const app = new App(h.join("ada", {}, { manual: true }), h.reg, pack);
  app.frame(0, 1280, 720);
  const run = (ms: number): void => h.run(ms, (now) => void app.frame(now, 1280, 720));
  const say = (line: string): void => {
    app.session.text(line);
    run(200);
  };
  run(500);
  const s = app.session;
  say("enablecheats");
  const e = h.ent(s);
  const ents = h.world.ents;
  const rec = h.host.records.byPid.get(ents.pid[e]!)!;
  const buffs = h.host.buffs;
  const f = app.ui.frame;
  const marks = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < 16; i++) {
      const n = f.find(KEY_BUFF + i);
      if (n) out.push(n.text);
    }
    return out;
  };
  expect(marks()).toEqual([]);

  app.controls.key("KeyW", true);
  run(600);
  say("buff stunned");
  expect(ents.mflags[e]! & (MF_ROOTED | MF_NO_SPRINT)).toBe(MF_ROOTED | MF_NO_SPRINT);
  expect(marks()).toEqual(["Stunned  3s"]);
  run(400);
  const [x, z] = [ents.x[e]!, ents.z[e]!];
  run(1000);
  expect(Math.hypot(ents.x[e]! - x, ents.z[e]! - z)).toBeLessThan(0.05);
  expect(marks()[0]).toMatch(/^Stunned {2}[12]s$/);
  run(2000);
  expect(buffs.rooted(rec)).toBe(false);
  expect(ents.mflags[e]! & MF_ROOTED).toBe(0);
  expect(marks()).toEqual([]);
  expect(Math.hypot(ents.x[e]! - x, ents.z[e]! - z)).toBeGreaterThan(2);
  app.controls.key("KeyW", false);

  // Health under 30 gives the injury. Mending past 30 ends it.
  expect(ents.speedQ[e]).toBe(1000);
  say("hurt 75");
  expect(buffs.has(rec, id("injured"))).toBe(true);
  expect(ents.speedQ[e]).toBe(800);
  expect(marks()).toEqual(["Injured"]);
  // At 0.2 health a second, the five points take twenty-five seconds.
  run(20000);
  expect(buffs.has(rec, id("injured"))).toBe(true);
  run(6000);
  expect(buffs.has(rec, id("injured"))).toBe(false);
  expect(ents.speedQ[e]).toBe(1000);

  h.host.survival.add(rec, V_HEALTH, 100);
  say("god");
  expect(marks()).toEqual(["God"]);
  const health = h.host.survival.value(rec, V_HEALTH);
  say("hurt 50");
  say("buff burning 5");
  run(3000);
  expect(h.host.survival.value(rec, V_HEALTH)).toBeGreaterThanOrEqual(health);
  expect(marks().sort()).toEqual(["Burning  2s", "God"]);
  say("god");
  expect(marks()).toEqual(["Burning  2s"]);
  expect(h.host.survival.gods.has(rec.pid)).toBe(false);
  // With god mode off, the last 2 s of the fire burn.
  run(2500);
  expect(h.host.survival.value(rec, V_HEALTH)).toBeLessThan(health - 8);
  expect(marks()).toEqual([]);
  say("buff stunned 60");
  expect(s.log.at(-1)!.text).toBe("core:stunned on");
  say("buff off stunned");
  expect(buffs.rooted(rec)).toBe(false);
  say("buff off stunned");
  expect(s.log.at(-1)!.text).toBe("you are not under core:stunned");
  say("buff nonsense");
  expect(s.log.at(-1)!.text).toBe('no buff "nonsense"');
  for (let n = 0; n < MAX_BUFFS + 4; n++) buffs.give(rec, id("tranquilized"), 0, 30, 0.01);
  expect(rec.buffs.length).toBe(MAX_BUFFS);
  say("suicide");
  expect(rec.dead).toBe(true);
  expect(rec.buffs.length).toBe(0);
});

test("torpor and being out survive a restart; a save from before torpor loads with none", () => {
  const dbPath = join(dir, "torpor.db");
  let host = createHost(reg, { dbPath, clips: corePack().clips, startingCreatures: 0, dev: true });
  const e = host.spawnCreature("core:grazer", 256, 250, 5);
  const rec = host.records.byPid.get(host.world.ents.pid[e]!)!;
  const pid = rec.pid;
  host.survival.add(rec, V_TORPOR, 10000);
  expect(rec.out).toBe(true);
  for (let n = 0; n < 60; n++) host.game.tick();
  const torpor = host.survival.value(rec, V_TORPOR);
  const tick = host.world.tick;
  expect(torpor).toBeLessThan(rec.vitals!.max[V_TORPOR]! / 1e6);
  host.shutdown();

  host = createHost(reg, { dbPath, clips: corePack().clips, dev: true });
  const back = host.records.byPid.get(pid)!;
  expect(back.out).toBe(true);
  expect(host.world.tick).toBe(tick);
  expect(host.survival.value(back, V_TORPOR)).toBeCloseTo(torpor, 3);
  const be = host.records.entOf.get(pid)!;
  host.refreshBody(back);
  expect(host.world.ents.mflags[be]! & MF_OUT).toBe(MF_OUT);
  const ticks = Math.ceil((torpor / 0.6) * 30) + 5;
  for (let n = 0; n < ticks; n++) host.game.tick();
  expect(back.out).toBe(false);
  expect(host.world.ents.mflags[be]! & MF_OUT).toBe(0);
  host.shutdown();
});
