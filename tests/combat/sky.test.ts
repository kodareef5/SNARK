// Craft in the sky met analytically (server/sky.ts): a round, a flying round and a blast meet a target that is no body
// in the chunk lists, judged where it was at the shooter's view tick, and the shooter is told as of a hit on a body.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import type { Source } from "../../server/combat.ts";
import { Sky, type SkyPoint, type SkyTaken, type SkyTarget } from "../../server/sky.ts";
import { EVENT_BLAST, EVENT_HIT } from "../../shared/net/protocol.ts";
import { MADE_METAL, SURFACE_VEHICLE } from "../../shared/net/rockets.ts";
import { stanceEye } from "../../shared/sim/character.ts";
import { DMG_EXPLOSIVE } from "../../shared/sim/damage.ts";
import { V_HEALTH } from "../../shared/sim/vitals.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../fixtures/map.ts";
import { Harness } from "../fixtures/net.ts";

/** A ball hanging still in the sky: what it was asked and what it took. A share of each blow is stopped by `soak`. */
class Ball implements SkyTarget {
  readonly name = "ball";
  readonly lockable = true;
  readonly radius: number;
  live = true;
  soak = 0;
  health = 1e6;
  readonly asked: number[] = [];
  readonly took: { amount: number; share: number; heavy: boolean }[] = [];
  readonly x: number;
  readonly y: number;
  readonly z: number;
  constructor(x: number, y: number, z: number, radius: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.radius = radius;
  }
  at(t: number, out: SkyPoint): boolean {
    this.asked.push(t);
    out.x = this.x;
    out.y = this.y;
    out.z = this.z;
    out.vx = out.vy = out.vz = 0;
    return this.live;
  }
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, _t = 0): number {
    const px = ox - this.x, py = oy - this.y, pz = oz - this.z;
    const b = px * dx + py * dy + pz * dz;
    const c = px * px + py * py + pz * pz - this.radius * this.radius;
    if (c <= 0) return 0;
    const disc = b * b - c;
    if (b >= 0 || disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t <= maxT ? t : Infinity;
  }
  gap(x: number, y: number, z: number): number {
    return Math.hypot(x - this.x, y - this.y, z - this.z) - this.radius;
  }
  take(src: Source, share: number, heavy: boolean): SkyTaken {
    const amount = src.base * src.quality * (src.far ?? 1) * src.draw * share;
    const taken = amount * (1 - this.soak);
    this.health -= taken;
    this.took.push({ amount, share, heavy });
    return { taken, blocked: this.soak > 0 && amount > 0, killed: this.health <= 0 };
  }
}

/** Ada with a poor line, standing in the middle of a level map, and a way to fire a round from her eye at a point. */
function range() {
  const h = new Harness({}, 1, 60, { dev: true, map: writeMap(flatMap(8)), log: () => {} });
  const s = h.join("ada", { latencyMs: 90 });
  h.run(500);
  h.say(s, "enablecheats");
  h.say(s, "tp 256 256");
  h.run(500);
  const c = h.client(s)!;
  const rec = h.host.records.byPid.get(c.pid)!;
  const ents = h.world.ents;
  const pilot = h.pilots[0]!;
  const reg = h.reg;
  const item = (name: string): number => reg.index.get(`core:${name}`)!;
  const eye = (): { x: number; y: number; z: number } => {
    const me = h.ent(s);
    return { x: ents.x[me]!, y: ents.y[me]! + stanceEye(reg.move[ents.kind[me]!]!, ents.stance[me]!), z: ents.z[me]! };
  };
  /** Turns her to (x, y, z), lets the aim settle, and fires one round of `ammo` from `weapon`. */
  const fire = (weapon: string, ammo: string, x: number, y: number, z: number): void => {
    const e = eye();
    pilot.yaw = Math.atan2(x - e.x, z - e.z);
    pilot.pitch = Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z));
    h.run(500);
    h.host.projectiles.launch(c, rec, item(weapon), 0, item(ammo), 1);
  };
  /** Runs until no round flies. */
  const land = (): void => {
    for (let k = 0; k < 400 && h.host.projectiles.flyingCount > 0; k++) h.run(1000 / 30);
  };
  const told = (session: ClientSession, kind: number) => session.events.filter((e) => e.kind === kind);
  return { h, s, c, eye, fire, land, told, item };
}

test("a pistol round meets a craft in the sky at the shooter's view tick, and the shooter is told", () => {
  const { h, s, c, eye, fire, told } = range();
  const e = eye();
  const ball = new Ball(e.x, e.y + 25, e.z + 30, 5);
  ball.soak = 0.75;
  const judged: { t: number; view: number; now: number }[] = [];
  const ray = ball.ray.bind(ball);
  ball.ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, t = 0): number => {
    judged.push({ t, view: h.host.combat.viewTick(c), now: h.world.tick });
    return ray(ox, oy, oz, dx, dy, dz, maxT);
  };
  h.host.combat.sky.add(ball);
  fire("pistol", "round_pistol", ball.x, ball.y, ball.z);
  h.run(400);
  expect(ball.took.map((t) => [t.share, t.heavy])).toEqual([[1, false]]);
  expect(ball.took[0]!.amount).toBeGreaterThan(0);
  expect(h.host.combat.sky.hits).toBe(1);
  // Judged at the tick she saw, which her line puts behind the server's.
  expect(judged.length).toBe(1);
  expect(judged[0]!.t).toBe(judged[0]!.view);
  expect(judged[0]!.t).toBeLessThan(judged[0]!.now);
  // Told as a hit with no zone, its shield's stop as armor's, nothing built struck.
  const hits = told(s, EVENT_HIT);
  expect(hits.length).toBe(1);
  expect([hits[0]!.blocked, hits[0]!.kill, hits[0]!.struck, hits[0]!.damage]).toEqual([true, false, 0, Math.round(ball.took[0]!.amount * 0.25)]);
  expect(Math.hypot(hits[0]!.x - ball.x, hits[0]!.y - ball.y, hits[0]!.z - ball.z)).toBeLessThan(ball.radius + 0.01);
});

test("a round meets whichever is nearer along it, a body or a craft in the sky", () => {
  const { h, eye, fire } = range();
  const e = eye();
  const health = (pid: number): number => h.host.survival.value(h.host.records.byPid.get(pid)!, V_HEALTH);
  // A dummy 10 m off with the ball 30 m beyond it, in line: the dummy takes the round.
  const near = h.host.spawnCreature("core:dummy", e.x, e.z + 10, 1);
  const nearPid = h.world.ents.pid[near]!;
  h.run(300);
  const was = health(nearPid);
  const behind = new Ball(e.x, e.y, e.z + 40, 3);
  h.host.combat.sky.add(behind);
  const chest = h.world.ents.y[near]! + h.reg.bodyHeight[h.world.ents.kind[near]!]! * 0.6;
  fire("pistol", "round_pistol", e.x, chest, e.z + 10);
  h.run(300);
  expect(health(nearPid)).toBeLessThan(was);
  expect(behind.took).toEqual([]);
  h.host.combat.sky.remove(behind);
  // The ball 6 m off in front of the dummy: the ball takes it, and the dummy nothing.
  const front = new Ball(e.x, chest, e.z + 6, 1.5);
  h.host.combat.sky.add(front);
  const then = health(nearPid);
  fire("pistol", "round_pistol", e.x, chest, e.z + 10);
  h.run(300);
  expect(front.took.length).toBe(1);
  expect(health(nearPid)).toBeGreaterThanOrEqual(then);
});

test("a rocket flies into a craft in the sky and goes off on its hull, which takes the blast as a heavy blow", () => {
  const { h, s, eye, fire, land, told } = range();
  const e = eye();
  const ball = new Ball(e.x, e.y, e.z + 40, 5);
  h.host.combat.sky.add(ball);
  fire("rocket_launcher", "rocket", ball.x, ball.y, ball.z);
  land();
  h.run(300);
  // One blow: the blast, at full strength on the hull, and heavy.
  expect(ball.took.map((t) => [t.share, t.heavy])).toEqual([[1, true]]);
  const blasts = told(s, EVENT_BLAST);
  expect(blasts.map((b) => [b.surface, b.made])).toEqual([[SURFACE_VEHICLE, MADE_METAL]]);
  expect(ball.gap(blasts[0]!.x, blasts[0]!.y, blasts[0]!.z)).toBeLessThan(0.5);
});

test("an arrow in flight is stopped by a craft in the sky and does its own harm", () => {
  const { h, eye, fire, land } = range();
  const e = eye();
  const ball = new Ball(e.x, e.y + 2, e.z + 25, 4);
  h.host.combat.sky.add(ball);
  fire("bow", "arrow_stone", ball.x, ball.y, ball.z);
  land();
  expect(ball.took.map((t) => [t.share, t.heavy])).toEqual([[1, false]]);
  expect(h.host.projectiles.flyingCount).toBe(0);
});

test("a craft not in the sky at the tick a round is judged is passed through", () => {
  const { h, eye, fire } = range();
  const e = eye();
  const ball = new Ball(e.x, e.y + 25, e.z + 30, 5);
  ball.live = false;
  h.host.combat.sky.add(ball);
  fire("pistol", "round_pistol", ball.x, ball.y, ball.z);
  h.run(300);
  expect(ball.asked.length).toBeGreaterThan(0);
  expect(ball.took).toEqual([]);
  expect(h.host.combat.sky.hits).toBe(0);
});

test("a blast fades on a craft in the sky as on a body: whole within a metre of its hull, nothing past its reach", () => {
  const sky = new Sky();
  const ball = new Ball(0, 100, 0, 4);
  sky.add(ball);
  const src: Source = { by: null, x: 0, z: 0, item: 0, base: 400, type: DMG_EXPLOSIVE, quality: 1, draw: 1, attack: 1, torporInstant: 0, torporOver: 0, torporSeconds: 0, buff: 0 };
  const marks: SkyTaken[] = [];
  sky.marker = (_by, _x, _y, _z, got) => void marks.push(got);
  // 0.5 m from its hull, then 5.5 m of a 10 m blast, then 11 m: past its reach.
  sky.blast(src, 4.5, 100, 0, 10, 0);
  sky.blast(src, 9.5, 100, 0, 10, 0);
  sky.blast(src, 15, 100, 0, 10, 0);
  expect(ball.took.map((t) => [Number(t.share.toFixed(4)), t.heavy])).toEqual([[1, true], [0.5, true]]);
  expect([sky.hits, marks.length]).toEqual([2, 2]);
  // A blow that brings one down takes it from the list while the blast walks it: the next is still met.
  const other = new Ball(0, 100, 8, 4);
  sky.add(other);
  ball.health = 1;
  const take = ball.take.bind(ball);
  ball.take = (s, share, heavy) => {
    const got = take(s, share, heavy);
    sky.remove(ball);
    return got;
  };
  sky.blast(src, 0, 100, 4, 10, 0);
  expect([sky.targets.length, other.took.length]).toEqual([1, 1]);
  // Nothing in the sky: no target is asked anything.
  const empty = new Sky();
  empty.blast(src, 0, 0, 0, 10, 0);
  expect(empty.ray(0, 0, 0, 0, 1, 0, 100, 0)).toBeNull();
  expect(empty.hits).toBe(0);
});
