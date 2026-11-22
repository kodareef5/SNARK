// Where a shot goes, end to end (shared/sim/aim.ts; planning/reference/weapons-plan.md, W1): a server and a predicting
// client on a link with latency and loss agree on every ray of every shot, cone, bloom, kick and sway alike, because both
// take it from the same body, buttons and seed. A third client is told each shot's end by the server, which is the
// server's own ray.
import { expect, test } from "bun:test";
import type { CombatEvent, LocalShot } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ItemDef } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { EVENT_HIT, EVENT_SHOT } from "../../shared/net/protocol.ts";
import { UNITS_PER_DEGREE, shotDir } from "../../shared/sim/aim.ts";
import { BTN_CROUCH, BTN_PRIMARY, BTN_PRONE, BTN_SECONDARY, BTN_SPRINT, stanceEye } from "../../shared/sim/character.ts";
import { lookDirection } from "../../shared/world/ray.ts";
import { flatGround } from "../fixtures/arena.ts";
import { takeInHand } from "../fixtures/gather.ts";
import { Harness } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const TICK_MS = 1000 / 30;
const FAR = 20;

interface Told {
  ox: number;
  oy: number;
  oz: number;
  /** Where a round ended, or an arrow's velocity. */
  ex: number;
  ey: number;
  ez: number;
  flies: boolean;
}

/** A predicted shot, and the look its tick's input sent, in wire units. */
interface Mine extends LocalShot {
  sentYaw: number;
  sentPitch: number;
}

/**
 * Ada shoots up a level range at a dummy FAR metres off, `latencyMs` from the server with `loss`; Eve stands behind her and
 * is told every shot. Each frame takes Ada's predicted shots and Eve's told ones, in order, then aims Ada at the dummy's
 * chest unless `level`, when she looks level up the range.
 */
function range(latencyMs: number, loss: number, registry: Registry = coreRegistry()) {
  const h = new Harness({}, 1, 60, { dev: true }, registry);
  const ada = h.join("ada", { latencyMs, loss });
  const eve = h.join("eve");
  h.run(600);
  h.say(ada, "enablecheats");
  h.say(eve, "enablecheats");
  const g = flatGround(h, 24, FAR + 6);
  const at = { x: g.x + 12, z: g.z + 2, y: g.y };
  h.say(ada, `tp ${at.x.toFixed(3)} ${at.z.toFixed(3)}`);
  h.say(eve, `tp ${(at.x - 8).toFixed(3)} ${(at.z - 1).toFixed(3)}`);
  h.run(400);
  const pa = h.pilots[0]!;
  const survivor = h.reg.move[h.reg.index.get("core:survivor")!]!;
  const dummy = h.host.spawnCreature("core:dummy", at.x, at.z + FAR, 1);
  const drec = h.host.records.byPid.get(h.world.ents.pid[dummy]!)!;
  h.world.ents.yaw[dummy] = drec.yaw = 32768;
  h.host.survival.gods.add(h.world.ents.pid[h.ent(eve)]!);
  h.host.survival.gods.add(drec.pid);
  h.run(200);
  const mine: Mine[] = [];
  const told: Told[] = [];
  const hits: CombatEvent[] = [];
  const aim = { level: false };
  const frame = (): void => {
    // The shots of the last update were sampled with the look the pilot still holds.
    const sentYaw = Math.round((pa.yaw / (2 * Math.PI)) * 65536) & 0xffff;
    const sentPitch = Math.round((pa.pitch / (Math.PI / 2)) * 16384);
    for (const s of ada.fired) mine.push({ ...s, sentYaw, sentPitch });
    ada.fired.length = 0;
    for (const ev of eve.events) if (ev.kind === EVENT_SHOT) told.push({ ox: ev.x, oy: ev.y, oz: ev.z, ex: ev.vx, ey: ev.vy, ez: ev.vz, flies: ev.flies });
    eve.events.length = 0;
    for (const ev of ada.events) if (ev.kind === EVENT_HIT) hits.push({ ...ev });
    ada.events.length = 0;
    if (aim.level) {
      pa.yaw = pa.pitch = 0;
      return;
    }
    const dx = at.x - ada.own.x;
    const dz = at.z + FAR - ada.own.z;
    pa.yaw = Math.atan2(dx, dz);
    // From the eye of the stance she is in: aimed from a standing eye while prone, a round clips the ground at the dummy's
    // feet, hitting or passing by the seed's luck.
    pa.pitch = Math.atan2(at.y + 1.25 - (ada.own.y + stanceEye(survivor, ada.own.stance)), Math.hypot(dx, dz));
  };
  return { h, ada, pa, mine, told, hits, frame, aim };
}

/** How far `p` lies from the ray from `o` along unit `d`, in metres. */
function offRay(o: readonly number[], d: readonly number[], p: readonly number[]): number {
  const v = [p[0]! - o[0]!, p[1]! - o[1]!, p[2]! - o[2]!];
  const t = v[0]! * d[0]! + v[1]! * d[1]! + v[2]! * d[2]!;
  return Math.hypot(v[0]! - d[0]! * t, v[1]! - d[1]! * t, v[2]! - d[2]! * t);
}

/** The predicted shot's ray. */
function rayOf(s: LocalShot): { o: number[]; d: number[] } {
  const d = [0, 0, 0];
  shotDir(s.seed, 0, s.yaw, s.pitch, s.cone, d);
  return { o: [s.x, s.y, s.z], d };
}

/** Degrees between the shot's ray and the look it was pointed along. */
function wide(s: LocalShot): number {
  const look = [0, 0, 0];
  lookDirection(s.yaw, s.pitch, look);
  const { d } = rayOf(s);
  return (Math.acos(Math.min(1, look[0]! * d[0]! + look[1]! * d[1]! + look[2]! * d[2]!)) * 180) / Math.PI;
}

/** Every predicted shot was the server's, ray for ray: the same origin, and the server's end on the client's ray. */
function agree(mine: readonly LocalShot[], told: readonly Told[]): void {
  expect(told.length).toBe(mine.length);
  for (let i = 0; i < mine.length; i++) {
    const { o, d } = rayOf(mine[i]!);
    const t = told[i]!;
    expect(Math.hypot(t.ox - o[0]!, t.oy - o[1]!, t.oz - o[2]!)).toBeLessThan(0.01);
    if (t.flies) {
      const speed = Math.hypot(t.ex, t.ey, t.ez);
      expect(Math.hypot(t.ex / speed - d[0]!, t.ey / speed - d[1]!, t.ez / speed - d[2]!)).toBeLessThan(1e-5);
    } else expect(offRay(o, d, [t.ex, t.ey, t.ez])).toBeLessThan(0.01);
  }
}

test("at 100 ms with loss, a hundred pistol shots at a dummy 20 m off, from the hip and aimed, still and on the move, land where the client drew them", () => {
  const { h, ada, pa, mine, told, hits, frame } = range(100, 0.02);
  h.say(ada, "kit pistol");
  h.say(ada, "give round_pistol 100");
  const slot = takeInHand(h, ada, h.reg.index.get("core:pistol")!);
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!;
  h.run(3000, frame);
  // Bursts of six as fast as it fires, each its own way of standing: from the hip still, aimed still, from the hip at a
  // sprint, aimed and crouched at a walk, aimed prone. Those on the move go back and forth across the range.
  const ways = [0, BTN_SECONDARY, BTN_SPRINT, BTN_SECONDARY | BTN_CROUCH, BTN_SECONDARY | BTN_PRONE];
  const shotWay: number[] = [];
  const shotInBurst: number[] = [];
  let n = 0;
  for (let burst = 0; n < 100; burst++) {
    const way = ways[burst % ways.length]!;
    pa.buttons = way;
    pa.moveX = 0;
    // The stance settles, the bloom closes and the pistol reloads by itself, in 3.33 s (Simple Pistol). It is mended anyway.
    h.host.items.mend(rec, slot);
    h.run(3800, frame);
    for (let k = 0; k < 6 && n < 100; k++, n++) {
      if (way & (BTN_SPRINT | BTN_CROUCH)) pa.moveX = k % 2 === 0 ? 1 : -1;
      pa.buttons |= BTN_PRIMARY;
      h.run(TICK_MS * 2, frame);
      pa.buttons &= ~BTN_PRIMARY;
      h.run(TICK_MS * 12, frame);
      shotWay.push(way);
      shotInBurst.push(k);
    }
  }
  pa.buttons = 0;
  pa.moveX = 0;
  h.run(600, frame);
  expect(h.host.projectiles.fired).toBe(100);
  expect(mine.length).toBe(100);
  agree(mine, told);
  // Every hit the shooter was told of lies on the ray it drew for one of its shots.
  expect(hits.length).toBeGreaterThan(30);
  for (const ev of hits) expect(Math.min(...mine.map((s) => offRay(rayOf(s).o, rayOf(s).d, [ev.x, ev.y, ev.z])))).toBeLessThan(0.01);
  // The cone did something, and no ray left it: from the hip and moving some went wide.
  for (const s of mine) expect(wide(s)).toBeLessThanOrEqual(s.cone + 1e-6);
  const past = (t: Told): boolean => Math.hypot(t.ex - t.ox, t.ez - t.oz) > FAR + 1;
  expect(told.filter(past).length).toBeGreaterThan(5);
  // The first of each aimed burst standing or lying still goes within 0.4 degrees, or 0.24 prone, and hits.
  const steady = told.filter((_, i) => shotInBurst[i] === 0 && (shotWay[i] === BTN_SECONDARY || shotWay[i] === (BTN_SECONDARY | BTN_PRONE)));
  expect(steady.length).toBeGreaterThanOrEqual(6);
  expect(steady.filter(past)).toEqual([]);
  // A burst blooms: each shot's cone wider than the last's. A sprint is wider than any aim standing still.
  const cone = (way: number, k: number): number[] => mine.filter((_, i) => shotWay[i] === way && shotInBurst[i] === k).map((s) => s.cone);
  for (let k = 1; k < 6; k++) expect(Math.min(...cone(0, k))).toBeGreaterThan(Math.max(...cone(0, k - 1)));
  expect(Math.min(...cone(BTN_SPRINT, 0))).toBeGreaterThan(Math.max(...cone(BTN_SECONDARY, 0)));
  expect(h.host.items.audit()).toEqual([]);
});

test("arrows from the hip at a walk, and a scoped long rifle's swaying rounds, standing and prone, leave as the client drew them", () => {
  const { h, ada, pa, mine, told, frame } = range(75, 0.01);
  h.say(ada, "kit bow");
  takeInHand(h, ada, h.reg.index.get("core:bow")!);
  h.run(1500, frame);
  for (let k = 0; k < 6; k++) {
    pa.moveX = k % 2 === 0 ? 1 : -1;
    pa.buttons = BTN_PRIMARY;
    h.run(TICK_MS * 30, frame);
    pa.buttons = 0;
    h.run(900, frame);
  }
  pa.moveX = 0;
  h.run(600, frame);
  expect(mine.length).toBe(6);
  expect(told.every((t) => t.flies)).toBe(true);
  agree(mine, told);
  expect(mine.every((s) => s.cone > 1.2)).toBe(true);

  // The rifle with its scope fitted, aimed through it, standing and prone.
  h.say(ada, "kit rifle");
  const rec = h.host.records.byPid.get(h.world.ents.pid[h.ent(ada)]!)!;
  const slot = takeInHand(h, ada, h.reg.index.get("core:rifle")!);
  const inv = h.host.items.inv(rec);
  expect(h.host.items.attach(rec, slot, inv.item.indexOf(h.reg.index.get("core:scope")!))).toBe(true);
  h.run(5000, frame);
  const before = mine.length;
  const stances = [0, BTN_PRONE, 0, BTN_PRONE];
  for (const stance of stances) {
    pa.buttons = BTN_SECONDARY | stance;
    h.run(1500, frame);
    pa.buttons |= BTN_PRIMARY;
    h.run(TICK_MS * 2, frame);
    pa.buttons &= ~BTN_PRIMARY;
    h.run(4800, frame);
  }
  pa.buttons = 0;
  h.run(600, frame);
  const rifle = mine.slice(before);
  expect(rifle.length).toBe(4);
  agree(mine, told);
  // Aimed and still its cone is nothing, so where each went from the look sent is the sway alone: some, within the
  // rifle's reach standing, and a fifth of that prone.
  const reach = 0.35 * Math.hypot(1, 0.7);
  rifle.forEach((s, i) => {
    expect(s.cone).toBe(0);
    const off = Math.hypot(s.yaw - s.sentYaw, s.pitch - s.sentPitch) / UNITS_PER_DEGREE;
    expect(off).toBeGreaterThan(0.001);
    expect(off).toBeLessThanOrEqual((stances[i] === BTN_PRONE ? 0.2 : 1) * reach + 1e-9);
  });
});

/** The core content with a gun that fires ten times a second and kicks 3 degrees a shot, back at 1 a second, and no cone. */
function kicking(): Registry {
  const pistol = CORE_CONTENT.find((d) => d.id === "core:pistol" && d.type === "item") as ItemDef;
  const gun: ItemDef = { ...pistol, id: "core:test_kicker", weapon: { ...pistol.weapon!, interval: 0.1, spread: undefined, recoil: { kick: 3, recover: 1 } } };
  const made = compileContent([...CORE_CONTENT, gun as Def]);
  expect(made.errors).toEqual([]);
  return made.registry!;
}

test("a client that sends a level look while kicked is still shot along the kick, and drew it there too", () => {
  const { h, ada, pa, mine, told, frame, aim } = range(100, 0, kicking());
  aim.level = true;
  h.say(ada, "give test_kicker 1");
  h.say(ada, "give round_pistol 30");
  takeInHand(h, ada, h.reg.index.get("core:test_kicker")!);
  // It loads in the pistol's 3.33 s (Simple Pistol).
  h.run(4000, frame);
  for (let k = 0; k < 4; k++) {
    pa.buttons = BTN_PRIMARY;
    h.run(TICK_MS * 2, frame);
    pa.buttons = 0;
    h.run(TICK_MS * 2, frame);
  }
  h.run(1000, frame);
  expect(mine.length).toBe(4);
  expect(mine.every((s) => s.sentPitch === 0 && s.cone === 0)).toBe(true);
  agree(mine, told);
  // Each round left higher than the last, though every look sent was level: by what was left of the kicks before it.
  const rise = told.map((t) => (Math.atan2(t.ey - t.oy, Math.hypot(t.ex - t.ox, t.ez - t.oz)) * 180) / Math.PI);
  expect(rise[0]!).toBeCloseTo(0, 4);
  for (let i = 1; i < 4; i++) expect(rise[i]! - rise[i - 1]!).toBeGreaterThan(2.5);
});
