// A client's picture of rounds that go off (client/core/shots.ts): it flies another's from where the server says, ahead
// by its age; it ends none by its own judgement, but when the blast with the round's number comes; its own takes the
// number it is told; and every blast reaches the fire with the seed every client draws it from.

import { expect, test } from "bun:test";
import type { Blasts } from "../../client/core/render/blasts.ts";
import type { Camera } from "../../client/core/render/camera.ts";
import type { Characters } from "../../client/core/render/characters.ts";
import type { FramePacket } from "../../client/core/render/packet.ts";
import { ClientSession, RemoteSample } from "../../client/core/session.ts";
import { AWAIT_MS, Shots } from "../../client/core/shots.ts";
import { ZONE_NONE } from "../../shared/anim/human.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { BOLTS_MOST, packBolt, writeBolt } from "../../shared/net/bolts.ts";
import { BitWriter } from "../../shared/net/codec.ts";
import { EVENT_BLAST, EVENT_BOLTS, EVENT_HIT, EVENT_ROCKET, EVENT_SHOT, S_EVENT } from "../../shared/net/protocol.ts";
import { SURFACE_BUILT, SURFACE_GROUND, MADE_WOOD, blastSeed, writeBlast, writeRocket } from "../../shared/net/rockets.ts";
import { shotDir } from "../../shared/sim/aim.ts";
import type { Connection } from "../../shared/net/transport.ts";
import { corePack } from "../fixtures/pack.ts";
import { coreRegistry, flatWorld, type TestWorld } from "../fixtures/world.ts";

const reg = coreRegistry();
const ROCKET = reg.index.get("core:rocket")!;
const LAUNCHER = reg.index.get("core:rocket_launcher")!;
const GRENADE = reg.index.get("core:grenade")!;
const SPEED = reg.ammoSpeed[ROCKET]!;
const TICK_MS = 1000 / TICK_RATE;

/** What the fire was told, in order: the call and its numbers. */
class Fire {
  readonly calls: [string, ...number[]][] = [];
  fly(...a: number[]): void { this.calls.push(["fly", ...a]); }
  at(...a: number[]): void { this.calls.push(["at", ...a]); }
  end(...a: number[]): void { this.calls.push(["end", ...a]); }
  launch(mx: number, my: number, mz: number, vx: number, vy: number, vz: number, dx: number, dy: number, dz: number, seed: number, own: boolean, nowMs: number): void {
    this.calls.push(["launch", mx, my, mz, vx, vy, vz, dx, dy, dz, seed, own ? 1 : 0, nowMs]);
  }
  burst(...a: number[]): void { this.calls.push(["burst", ...a]); }
  of(name: string): number[][] { return this.calls.filter((c) => c[0] === name).map((c) => c.slice(1) as number[]); }
}

/** A session that reads what the test sends it, and the shots it feeds, on flat ground with a wall across z = `wall`. */
function client(wall = 0): { session: ClientSession; shots: Shots; fire: Fire; world: TestWorld; send: (write: (w: BitWriter) => void) => void } {
  const conn: Connection = { send: () => {}, close: () => {}, open: true, onMessage: null, onClose: null };
  const session = new ClientSession(conn, { name: "ada", key: new Uint8Array(16), registry: reg, resolveMap: () => null });
  const world = flatWorld(4);
  if (wall > 0) for (let x = 90; x <= 110; x += 3) for (const y of [1.5, 4.5]) world.structs.add(world.kind("core:wall"), x, y, wall, 0, 0, 1);
  const shots = new Shots(reg, corePack());
  const fire = new Fire();
  shots.fire = fire as unknown as Blasts;
  const w = new BitWriter(4096);
  const send = (write: (w: BitWriter) => void): void => {
    w.reset();
    w.u8(S_EVENT);
    write(w);
    expect(w.overflow).toBe(false);
    conn.onMessage!(0, w.bytes().slice());
  };
  return { session, shots, fire, world, send };
}

const packed = new Uint32Array(5);
/** A rocket told as the server tells it: from (x, y, z) level along +Z. */
const rocket = (id: number, age: number, own = false, x = 100, y = 20, z = 100) => (w: BitWriter): void => {
  w.u8(EVENT_ROCKET);
  packBolt(x, y, z, 0, 0, 1, packed, 0);
  writeRocket(w, packed, 0, ROCKET, id, age, own);
};
const blast = (id: number, x: number, y: number, z: number, item = ROCKET, surface = SURFACE_GROUND, made = 0) => (w: BitWriter): void => {
  w.u8(EVENT_BLAST);
  writeBlast(w, x, y, z, 0, 1, 0, reg.ammoBlast[item]! || 6, item, id, surface, made);
};

const hit = (damage: number) => (w: BitWriter): void => {
  w.u8(EVENT_HIT);
  w.f32(100);
  w.f32(20);
  w.f32(125);
  w.bits(ZONE_NONE, 4);
  w.u16(damage);
  w.bool(false);
  w.bool(false);
  w.u16(0); // A body hit names no structure.
};

/** Frames of 60 a second for `ms`, from `from`. Returns the time reached. */
function run(c: ReturnType<typeof client>, from: number, ms: number, remote: RemoteSample | null = null): number {
  let now = from;
  for (const end = from + ms; now < end; now += 1000 / 60) {
    c.shots.absorb(c.session, c.world, now);
    c.shots.step(c.world, remote, 1000 + now / TICK_MS, now);
  }
  return now;
}

test("a delayed frame keeps rocket endings and hit feedback through plasma fire", () => {
  const c = client();
  const ammo = reg.index.get("core:plasma_cell")!;
  const volley = Array.from({ length: 100 }, (_, i) => i + 1);
  for (const id of volley) c.send(rocket(id, 0));
  c.send(hit(150));
  for (const id of volley) c.send(blast(id, 100, 20, 125));
  const bolts = (from: number) => (w: BitWriter): void => {
    w.u8(EVENT_BOLTS);
    w.u8(BOLTS_MOST);
    for (let n = 0; n < BOLTS_MOST; n++) {
      packBolt(from + n, 3, 12, 0, 0, 1, packed, 0);
      writeBolt(w, packed, 0, ammo, 0, 0, n === 0 ? 0 : ammo);
    }
  };
  c.send(bolts(0));
  const waiting = c.session.events.length;
  c.send(bolts(BOLTS_MOST));
  expect(c.session.events.length).toBe(waiting);
  const kept = c.session.events.filter((ev) => ev.kind === EVENT_SHOT);
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.map((ev) => ev.x)).toEqual(kept.map((_, i) => 2 * BOLTS_MOST - kept.length + i));
  c.shots.absorb(c.session, c.world, 800);
  expect(c.fire.of("fly").map((call) => call[0])).toEqual(volley);
  expect(c.fire.of("end").map((call) => call[0])).toEqual(volley);
  expect(c.fire.of("burst")).toHaveLength(volley.length);
  expect(c.shots.flying.every((f) => f.ammo === ammo)).toBe(true);
  expect(c.session.events.map((ev) => [ev.kind, ev.damage])).toEqual([[EVENT_HIT, 150]]);
});

test("a stalled frame bounds blast and hit feedback and retains the latest of each", () => {
  const c = client();
  const fill = (from: number): void => {
    for (let i = from; i < from + 500; i++) {
      c.send(blast(i, 100, 20, 125));
      c.send(hit(i));
    }
  };
  fill(1);
  const waiting = c.session.events.length;
  fill(501);
  expect(c.session.events.length).toBe(waiting);
  const last = c.session.events.slice(-2);
  expect(last.map((ev) => [ev.kind, ev.id, ev.damage])).toEqual([[EVENT_BLAST, 1000, 0], [EVENT_HIT, 0, 1000]]);
});

test("a told rocket is flown ahead by its age, and its fire is told when it left", () => {
  const c = client();
  c.send(rocket(7, 30));
  c.shots.absorb(c.session, c.world, 5000);
  expect(c.shots.flying.length).toBe(1);
  const f = c.shots.flying[0]!;
  expect([f.id, f.key, f.own, f.age]).toEqual([7, 7, false, 30]);
  expect(f.z).toBeCloseTo(100 + SPEED, 2);
  // It has fallen as far as a second of its gravity takes it.
  expect(f.y).toBeCloseTo(20 - 0.5 * reg.ammoGravity[ROCKET]!, 1);
  const [key, , , , , , vz, gravity, flame, born] = c.fire.of("fly")[0]!;
  expect([key, gravity, born]).toEqual([7, reg.ammoGravity[ROCKET]!, 5000 - 30 * TICK_MS]);
  expect(vz).toBeCloseTo(SPEED, 3);
  expect(flame).toBeCloseTo(0.9, 5);
  // Told so late, it is not seen to leave: no launcher flashes, and it is drawn on its path.
  expect(c.fire.of("launch").length).toBe(0);
  expect([f.ox, f.oy, f.oz]).toEqual([0, 0, 0]);
  expect(c.session.events.length).toBe(0);
});

test("a rocket told as it leaves flashes its launcher, ahead of the eye", () => {
  const c = client();
  c.send(rocket(3, 1));
  c.shots.absorb(c.session, c.world, 100);
  const [mx, my, mz, , , vz, dx, dy, dz, seed, own] = c.fire.of("launch")[0]!;
  expect([dx, own]).toEqual([0, 0]);
  expect([dy, dz]).toEqual([expect.closeTo(0, 3), expect.closeTo(1, 6)]);
  expect([mx, mz! > 100.5, my! < 20, vz! < 100]).toEqual([100, true, true, true]);
  expect(seed).toBe(blastSeed(0, 100, 20, 100));
});

test("a duplicate tell of a rocket already flying is ignored", () => {
  const c = client();
  c.send(rocket(7, 2));
  let now = run(c, 0, 100);
  c.send(rocket(7, 5));
  now = run(c, now, 100);
  expect(c.shots.flying.length).toBe(1);
  expect(c.fire.of("fly").length).toBe(1);
  // Another number is another round.
  c.send(rocket(8, 0));
  run(c, now, 50);
  expect(c.shots.flying.map((f) => f.id)).toEqual([7, 8]);
});

test("a remote rocket that meets a wall waits for its blast, and ends when that comes", () => {
  const c = client(130);
  c.send(rocket(9, 0, false, 100, 1.5, 100));
  let now = run(c, 0, 700);
  // It met the wall half a second in: it is not drawn, its fire is out, and it is kept.
  expect(c.shots.flying.length).toBe(1);
  const f = c.shots.flying[0]!;
  expect(f.waits).toBeGreaterThan(0);
  expect(f.z).toBeCloseTo(129.9, 0);
  expect(c.fire.of("end").map((e) => e[0])).toEqual([9]);
  expect(c.fire.of("burst").length).toBe(0);
  const at = c.fire.of("at").length;
  c.shots.draw({ loose: () => true, ownRounds: -1 } as unknown as Characters, {} as FramePacket, { x: 0, y: 0, z: 0, boxVisible: () => true } as unknown as Camera, 1000);
  expect(c.fire.of("at").length).toBe(at);
  c.send(blast(9, 100, 1.5, 129.9, ROCKET, SURFACE_BUILT, MADE_WOOD));
  now = run(c, now, 20);
  expect(c.shots.flying.length).toBe(0);
  const [look, x, , z, , ny, , radius, surface, made] = c.fire.of("burst")[0]!;
  expect([look, x, ny, radius, surface, made]).toEqual([reg.burstLook[ROCKET]!, 100, 1, 7.5, SURFACE_BUILT, MADE_WOOD]);
  expect(z).toBeCloseTo(129.9, 1);
  // Its fire was put out once, where it met the wall.
  expect(c.fire.of("end").length).toBe(1);
});

test("a rocket whose blast never comes is dropped quietly after its wait", () => {
  const c = client(130);
  c.send(rocket(9, 0, false, 100, 1.5, 100));
  let now = run(c, 0, 520);
  expect(c.shots.flying[0]!.waits).toBeGreaterThan(0);
  now = run(c, now, AWAIT_MS - 100);
  expect(c.shots.flying.length).toBe(1);
  run(c, now, 200);
  expect(c.shots.flying.length).toBe(0);
  expect(c.fire.of("burst").length).toBe(0);
});

test("a blast ends its rocket in the air, wherever this client had flown it to", () => {
  const c = client();
  c.send(rocket(4, 0));
  let now = run(c, 0, 300);
  expect(c.shots.flying[0]!.waits).toBe(0);
  c.send(blast(4, 100, 19.9, 121));
  now = run(c, now, 20);
  expect(c.shots.flying.length).toBe(0);
  expect(c.fire.of("end").map((e) => e[0])).toEqual([4]);
  expect(c.shots.ends.length).toBe(1);
});

test("rockets skip the body grid until an arrow needs it", () => {
  const c = client();
  const crowd = new RemoteSample();
  crowd.count = 1;
  crowd.id[0] = 5;
  crowd.kind[0] = reg.index.get("core:survivor")!;
  [crowd.x[0], crowd.y[0], crowd.z[0]] = [100, 0, 120];
  const kinds = crowd.kind;
  let reads = 0;
  Object.defineProperty(crowd, "kind", { get: () => { reads++; return kinds; } });
  c.send(rocket(2, 0, false, 100, 1, 100));
  const shot = c.session.events[0]!;
  const start = run(c, 0, 100, crowd);
  expect(reads).toBe(0);
  c.session.events.push({ ...shot, kind: EVENT_SHOT, item: reg.index.get("core:arrow_stone")!, id: 0, vz: 70 });
  const end = run(c, start, 600, crowd);
  expect(reads).toBeGreaterThan(0);
  reads = 0;
  run(c, end, 100, crowd);
  expect(reads).toBe(0);
  // The arrow stopped at the body; the rocket flew through where it is drawn and on.
  expect(c.shots.flying.map((f) => [f.id, f.waits])).toEqual([[2, 0]]);
  expect(c.shots.flying[0]!.z).toBeGreaterThan(125);
  expect(c.fire.of("end").length).toBe(0);
});

test("the shooter's own rocket takes its tell's number, and no second one starts", () => {
  const c = client();
  const d = [0, 0, 0];
  shotDir(11, 0, 0, 0, 0, d);
  c.session.fired.push({ x: 100, y: 20, z: 100, yaw: 0, pitch: 0, cone: 0, seed: 11, draw: 1, ammo: ROCKET, weapon: LAUNCHER });
  let now = run(c, 0, 100);
  expect(c.shots.flying.length).toBe(1);
  const mine = c.shots.flying[0]!;
  expect([mine.own, mine.id, mine.key < 0]).toEqual([true, 0, true]);
  // Its launcher flashed as it was fired, and the view is shaken for it.
  expect(c.fire.of("launch").map((l) => l[10])).toEqual([1]);
  const key = mine.key;
  c.send(rocket(21, 3, true));
  now = run(c, now, 50);
  expect(c.shots.flying.length).toBe(1);
  expect([mine.id, mine.key]).toEqual([21, key]);
  expect(c.fire.of("fly").map((f) => f[0])).toEqual([key]);
  // Its blast ends it under the name its fire knows it by.
  c.send(blast(21, 100, 20, 112));
  run(c, now, 20);
  expect(c.shots.flying.length).toBe(0);
  expect(c.fire.of("end").map((e) => e[0])).toEqual([key]);
});

test("the shooter's own rocket ends on the world at once, and still takes its number", () => {
  const c = client(108);
  c.session.fired.push({ x: 100, y: 1.5, z: 100, yaw: 0, pitch: 0, cone: 0, seed: 11, draw: 1, ammo: ROCKET, weapon: LAUNCHER });
  let now = run(c, 0, 200);
  // It met the wall before the server told of it: its fire is out, and it waits.
  expect(c.shots.flying.map((f) => f.waits > 0)).toEqual([true]);
  expect(c.fire.of("end").length).toBe(1);
  c.send(rocket(30, 4, true, 100, 1.5, 100));
  now = run(c, now, 20);
  expect(c.shots.flying.map((f) => f.id)).toEqual([30]);
  c.send(blast(30, 100, 1.5, 107.9));
  run(c, now, 20);
  expect([c.shots.flying.length, c.fire.of("burst").length, c.fire.of("end").length]).toEqual([0, 1, 1]);
});

test("its own round never given a number ends by this client's own judgement", () => {
  const c = client();
  c.session.fired.push({ x: 100, y: 12, z: 100, yaw: 0, pitch: 0, cone: 0, seed: 11, draw: 1, ammo: ROCKET, weapon: LAUNCHER });
  run(c, 0, 1400);
  // Told the old way, as when every number is in the air: it flew a second unnumbered, and now ends by itself.
  expect(c.shots.flying.map((f) => [f.rocket, f.waits])).toEqual([[false, 0]]);
  expect(c.fire.of("end").length).toBe(0);
  run(c, 1400, 3800);
  expect(c.shots.flying.length).toBe(0);
  expect(c.fire.of("end").length).toBe(1);
});

test("every blast reaches the fire, with one seed for the same round and place", () => {
  const a = client(), b = client();
  for (const c of [a, b]) {
    c.send(blast(17, 140.3, 2.1, 90.7));
    c.send(blast(0, 60, 0, 61, GRENADE));
    c.send(blast(18, 140.3, 2.1, 90.7));
    c.shots.absorb(c.session, c.world, 40);
  }
  const seeds = (c: typeof a): number[] => c.fire.of("burst").map((x) => x[10]!);
  expect(seeds(a)).toEqual(seeds(b));
  expect(new Set(seeds(a)).size).toBe(3);
  // The seed is of the place as it was read, which every client reads alike.
  const first = a.fire.of("burst")[0]!;
  expect(first[10]).toBe(blastSeed(17, first[1]!, first[2]!, first[3]!));
  expect(a.fire.of("burst").map((x) => x[0])).toEqual([reg.burstLook[ROCKET]!, reg.burstLook[GRENADE]!, reg.burstLook[ROCKET]!]);
  // With the fire drawn, the old cube is not.
  expect(a.shots.blasts.length).toBe(0);
  // Without it, the cube stands in.
  const bare = client();
  bare.shots.fire = null;
  bare.send(blast(0, 60, 0, 61, GRENADE));
  bare.shots.absorb(bare.session, bare.world, 40);
  expect(bare.shots.blasts.map((x) => x.radius)).toEqual([6]);
});

test("a flying rocket's fire is told each frame where its tail is drawn", () => {
  const c = client();
  c.send(rocket(5, 0));
  run(c, 0, 400);
  const drawn: number[][] = [];
  const bodies = { loose: (_p: FramePacket, _mesh: number, x: number, y: number, z: number) => (drawn.push([x, y, z]), true), ownRounds: -1 } as unknown as Characters;
  c.shots.draw(bodies, {} as FramePacket, { x: 1, y: 2, z: 3, boxVisible: () => true } as unknown as Camera, 1000.5);
  const at = c.fire.of("at");
  expect(at.length).toBe(1);
  expect(at[0]![0]).toBe(5);
  // The fire has the world's place, the mesh the same less the camera's.
  expect(drawn[0]!.map((v, k) => v + [1, 2, 3][k]!)).toEqual(at[0]!.slice(1, 4));
  expect(at[0]![6]).toBeCloseTo(1, 3);
});
