// Rows for the physics lane, system by system (server/lane.ts LANE_ROWS), read from the lane after each tick as the real
// server times it: 48 survivors knocked off their feet at once (FALLS_MOST), inside a closed stone room under its ceiling
// and on open ground, until every one has risen; a car at 15 m/s through a crowd of 40 survivors and 20 dodos; and a rex
// walking through 30 bodies lying on the ground, against the same walk on bare ground. Each throw is a car's blow: 6 to 14
// m/s along the ground, 1 to 3.5 up, and turning at up to 8 radians a second on each axis, the most a car's impact gives
// a body (server/vehicle-contacts.ts).
//
// `bun tools/bench/physics-rows.ts [--runs n] [--cpu] [falls|crowd|corpses]` runs these alone, n times each, and gives
// each figure's median over the runs and its spread. With --cpu the lane is timed by the process's CPU time, which a
// machine busy with other work does not stretch; without, by the wall clock, as the server times it.

import { readFileSync } from "node:fs";
import { GOAL_WALK } from "../../server/behavior.ts";
import { FALLS_MOST } from "../../server/falls.ts";
import { LANE_RESERVE_MS, LANE_ROW, LANE_ROWS, type LaneRowName } from "../../server/lane.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { RESULT_OK } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { F_ALIVE } from "../../shared/sim/entities.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { survivorKind } from "../../shared/sim/blockers.ts";
import { solidOf } from "../../shared/sim/vehicle-movers.ts";
import { Assets } from "../../client/core/assets/assets.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Characters } from "../../client/core/render/characters.ts";
import { BONE_FLOATS, FramePacket } from "../../client/core/render/packet.ts";
import { B_HEAD, B_HIPS, HUMAN, HUMAN_BONES } from "../../shared/anim/human.ts";
import { AnimState, bodySeed, CUE_DOWN } from "../../shared/anim/pose.ts";
import { Pose } from "../../shared/anim/clip.ts";
import { Solved, solve } from "../../shared/anim/skeleton.ts";
import { TAU } from "../../shared/math/scalar.ts";
import { humanHitPose } from "../../shared/anim/zones.ts";
import { Corpses, RISE_BLEND } from "../../client/core/ragdoll.ts";
import { REACT_FALL, REACT_RISE, reactAge, reactKind, TOPPLED } from "../../shared/anim/reactions.ts";
import { corePack } from "../../tests/fixtures/pack.ts";
import { boxBase, layBase } from "./base.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** How a run is timed and thrown: `clock` in ms, and the seed of its throws and its harness. */
export interface PhysicsRun {
  clock?: () => number;
  seed?: number;
}

/** The process's CPU time in ms, to the microsecond: a thread's own is counted only in whole milliseconds. */
export const cpuMs = (): number => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};
const wallMs = (): number => performance.now();

const TICK_MS = 1000 / 30;

/** The `q` quantile of `values`, 0 for none. */
const at = (values: readonly number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
};
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** Each tick's ms in every lane row and in all its physics, read from the lane once the tick is done. */
class Meter {
  readonly rows: number[][] = LANE_ROWS.map(() => []);
  readonly physics: number[] = [];
  private readonly h: Harness;
  private readonly tick: () => void;

  /** `before` runs before each tick and `after` after it, for what a scene counts or does. */
  constructor(h: Harness, clock: () => number, before?: () => void, after?: () => void) {
    this.h = h;
    const server = h.server, lane = server.lane, tick = (this.tick = server.tick.bind(server));
    lane.setClock(clock);
    server.tick = () => {
      before?.();
      tick();
      this.physics.push(lane.physicsMs);
      for (let k = 0; k < LANE_ROWS.length; k++) this.rows[k]!.push(lane.rowMs[k]!);
      after?.();
    };
  }

  row(name: LaneRowName): number[] {
    return this.rows[LANE_ROW[name]]!;
  }

  stop(): void {
    this.h.server.tick = this.tick;
  }
}

/** A world of flat ground 256 m a side with nothing wild on it, and `n` survivors who cannot be hurt. */
function flat(n: number, seed: number): { h: Harness; ents: number[]; sessions: ClientSession[] } {
  const h = new Harness({}, seed, 10, { dev: true, wild: false, map: writeMap(flatMap(4)) });
  const sessions = Array.from({ length: n }, (_, k) => h.join(`s${k}`));
  h.run(1500);
  const ents = sessions.map((s) => {
    const c = h.client(s)!;
    h.host.survival.gods.add(c.pid);
    return c.ent;
  });
  return { h, ents, sessions };
}

const NO_COLORS = new Uint8Array(64);
/** Ticks the crowd scene holds its car's speed and turn: until a car going straight is through. */
const DRIVE_TICKS = 200;

/**
 * Where bone `b`'s joint is in the world in bone rows `rows` (where the bone carries its rest point): in the pose the
 * rows begin with, carried by the body's own bone at `own` for a body drawn on one, or -1 for one drawn whole.
 */
function jointAt(rows: Float32Array, b: number, own: number): number[] {
  const o = b * BONE_FLOATS, r = b * 3;
  const q = [0, 1, 2].map((row) => rows[o + row * 4]! * HUMAN.rest[r]! + rows[o + row * 4 + 1]! * HUMAN.rest[r + 1]! + rows[o + row * 4 + 2]! * HUMAN.rest[r + 2]! + rows[o + row * 4 + 3]!);
  if (own < 0) return q;
  const m = own * BONE_FLOATS;
  return [0, 1, 2].map((row) => rows[m + row * 4]! * q[0]! + rows[m + row * 4 + 1]! * q[1]! + rows[m + row * 4 + 2]! * q[2]! + rows[m + row * 4 + 3]!);
}

/** Puts body `e` at (x, y, z), as a teleport does. */
function put(h: Harness, e: number, x: number, y: number, z: number): void {
  h.world.ents.setPosition(e, x, y, z);
  h.world.history.discontinuity(e);
}

/**
 * Two players watching a scene, and what each draws of the survivors in it that are down: by their falls once their
 * checkpoints come, toppling meanwhile, and as the renderer draws them on one bone and on all. Each fall is set beside
 * where the server has its body (one of `bodies`) at the tick the watcher has stepped it to.
 */
class Watching {
  private readonly h: Harness;
  private readonly sessions: readonly ClientSession[];
  private readonly bodies: readonly number[];
  private readonly heard: number[];
  /** The pack the server poses with (tests/fixtures/net.ts), so a watcher's poses are the server's. */
  private readonly pack = corePack();
  private readonly cam = new Camera();
  private readonly st = new AnimState();
  private readonly views: { remote: RemoteSample; drawn: Corpses; waits: Map<number, number>; characters: Characters; packet: FramePacket; downAt: Map<number, number> }[];
  /** Where the server had each body down, by tick. */
  private readonly truth = new Map<number, Float64Array>();
  private readonly apart: number[] = [];
  private standing = 0;
  private toppled = 0;
  private longest = 0;
  private submitted = 0;
  private undrawn = 0;
  /** Toppled, or down before their fall came, and drawn with the head well over the hips: 0.62 m standing, 0.3 lying. */
  private upright = 0;
  /** Laid falls drawn whole: how far the head or hips lie from the server's; drawn on one bone: how far the hips do. */
  private readonly wholeOff: number[] = [];
  private readonly oneBoneHips: number[] = [];
  /** By body and tick, where the server has a laid fall's head and hips: tick, head, hips. */
  private readonly joints = new Map<number, Float64Array>();
  /** By body and tick, where the server's hit body has its head while a topple or a rise poses it: tick, head. */
  private readonly posed = new Map<number, Float64Array>();
  private readonly pose = new Pose(HUMAN_BONES);
  private readonly hit = new Solved(HUMAN_BONES);
  /** Toppling or getting up: how far a drawn head is from the server's, whole (after a rise's hand-off) and on one bone. */
  private readonly risingWhole: number[] = [];
  private readonly handOff: number[] = [];
  private readonly risingOne: number[] = [];
  /** At each rise, how far the server's hit head moves from the ragdoll's the tick before. */
  private readonly snaps: number[] = [];
  /**
   * And how far a drawn head pops between draws, by watcher, body and whether drawn whole: how far it moves beyond how far
   * the server's moved between the same ticks, for a watcher's clock may step several ticks at once.
   */
  private readonly lastHead = new Map<string, number[]>();
  private readonly steps: number[] = [];
  private readonly stepsOne: number[] = [];
  /** The most poses a watcher kept of bodies down or getting up, which bodies on one bone share. */
  private lyingKept = 0;

  constructor(h: Harness, sessions: readonly ClientSession[], bodies: readonly number[]) {
    this.h = h; this.sessions = sessions; this.bodies = bodies;
    this.heard = sessions.map((s) => s.stats.bytesIn);
    this.views = sessions.map(() => ({
      remote: new RemoteSample(), drawn: new Corpses(h.world.anims, undefined, (k) => survivorKind(h.reg, k), (k) => solidOf(h.reg, k)), waits: new Map<number, number>(),
      characters: new Characters(h.reg, this.pack, new Assets(h.reg, this.pack)), packet: new FramePacket(), downAt: new Map<number, number>(),
    }));
  }

  /** After each server tick. */
  after(): void {
    const h = this.h, ents = h.world.ents, T = h.world.tick, st = this.st;
    for (const e of this.bodies) {
      const pose = h.host.falls.poseOf(e);
      if (!pose) continue;
      let ring = this.truth.get(e);
      if (!ring) this.truth.set(e, (ring = new Float64Array(64 * 4).fill(-1)));
      const o = (T & 63) * 4;
      ring[o] = T; ring[o + 1] = ents.x[e]!; ring[o + 2] = ents.y[e]!; ring[o + 3] = ents.z[e]!;
      // Its pose lies about its place, facing its fall's way, as a client lays it (client/core/render/characters.ts lain).
      let joints = this.joints.get(e);
      if (!joints) this.joints.set(e, (joints = new Float64Array(64 * 7).fill(-1)));
      const j = (T & 63) * 7, yaw = h.host.falls.yawOf(e), c = Math.cos(yaw), sn = Math.sin(yaw);
      joints[j] = T;
      [B_HEAD, B_HIPS].forEach((b, k) => {
        const mx = pose.pos[b * 3]!, my = pose.pos[b * 3 + 1]!, mz = pose.pos[b * 3 + 2]!;
        joints![j + 1 + k * 3] = ents.x[e]! + c * mx + sn * mz; joints![j + 2 + k * 3] = ents.y[e]! + my; joints![j + 3 + k * 3] = ents.z[e]! - sn * mx + c * mz;
      });
    }
    // Toppling or getting up, the server judges a shot on the body its reaction word poses (shared/anim/zones.ts rayBody).
    for (const e of this.bodies) {
      if (reactKind(ents.react[e]!) < REACT_FALL || !h.world.anim) continue;
      st.unpack(ents.anim[e]!, ents.cue[e]!, ents.emote[e]!, ents.react[e]!, h.world.history.strideOf(e, T, h.world));
      st.seed = bodySeed(e);
      st.facing = ents.yaw[e]! / 65536;
      humanHitPose(h.world.anim, st, T, ents.x[e]!, ents.y[e]!, ents.z[e]!, ents.yaw[e]!, h.host.falls.riseFrom(e, T), this.pose);
      solve(HUMAN, this.pose, this.hit);
      let ring = this.posed.get(e);
      if (!ring) this.posed.set(e, (ring = new Float64Array(64 * 4).fill(-1)));
      const o = (T & 63) * 4, a = (ents.yaw[e]! * TAU) / 65536, c = Math.cos(a), sn = Math.sin(a);
      const lx = this.hit.pos[B_HEAD * 3]!, lz = this.hit.pos[B_HEAD * 3 + 2]!;
      ring[o] = T; ring[o + 1] = ents.x[e]! + c * lx + sn * lz; ring[o + 2] = ents.y[e]! + this.hit.pos[B_HEAD * 3 + 1]!; ring[o + 3] = ents.z[e]! - sn * lx + c * lz;
      const laid = this.joints.get(e), was = ((T - 1) & 63) * 7;
      if (reactKind(ents.react[e]!) === REACT_RISE && reactAge(ents.react[e]!, T) === 0 && laid && laid[was] === T - 1) {
        this.snaps.push(Math.hypot(ring[o + 1]! - laid[was + 1]!, ring[o + 2]! - laid[was + 2]!, ring[o + 3]! - laid[was + 3]!));
      }
    }
    this.sessions.forEach((s, k) => {
      const { remote, drawn, waits, characters, packet, downAt } = this.views[k]!;
      s.sampleRemote(remote);
      drawn.update(remote, s.world!, 0, 0, new Map(), s.corpseMotions);
      // The renderer is given the checkpoints as the game gives them (client/core/app.ts).
      characters.corpseMotions = s.corpseMotions;
      characters.begin();
      characters.corpses(packet, this.cam, remote, s.world!);
      this.lyingKept = Math.max(this.lyingKept, characters.lyingKept);
      // Each tick, each body toppling or getting up, drawn whole and on one bone, set beside the server's at the tick drawn.
      for (let i = 0; i < remote.count; i++) {
        const id = remote.id[i]!, word = remote.react[i]!, ring = this.posed.get(id);
        if (reactKind(word) < REACT_FALL || !ring) continue;
        const t0 = Math.floor(remote.tick), a = (t0 & 63) * 4, b = ((t0 + 1) & 63) * 4;
        if (ring[a] !== t0 || ring[b] !== t0 + 1) continue;
        const f = remote.tick - t0, server = [1, 2, 3].map((j) => ring[a + j]! + (ring[b + j]! - ring[a + j]!) * f);
        for (const rigid of [true, false]) {
          characters.begin(); packet.beginFrame();
          st.unpack(remote.anim[i]!, remote.cue[i]!, remote.emote[i]!, word, remote.stride[i]!);
          st.seed = bodySeed(id);
          if (!characters.add(packet, remote.kind[i]!, remote.x[i]!, remote.y[i]!, remote.z[i]!, remote.yaw[i]!, st, remote.tick, null, 0, NO_COLORS, 0, null, 0, id, false, false, 1, rigid)) continue;
          const head = jointAt(packet.bones, B_HEAD, rigid ? HUMAN_BONES : -1);
          const off = Math.hypot(head[0]! - server[0]!, head[1]! - server[1]!, head[2]! - server[2]!);
          // A rise's first ticks hand the body over from how its ragdoll lay, drawn whole, as the server's head moves from
          // its ragdoll's to its rise's.
          const handing = reactKind(word) === REACT_RISE && reactAge(word, remote.tick) <= RISE_BLEND + 1;
          if (rigid) this.risingOne.push(off);
          else (handing ? this.handOff : this.risingWhole).push(off);
          const key = `${k} ${id} ${rigid}`, last = this.lastHead.get(key);
          if (last && last[6] !== remote.tick && !handing) (rigid ? this.stepsOne : this.steps).push(Math.hypot(head[0]! - last[0]! - server[0]! + last[3]!, head[1]! - last[1]! - server[1]! + last[4]!, head[2]! - last[2]! - server[2]! + last[5]!));
          this.lastHead.set(key, [...head, ...server, remote.tick]);
        }
      }
      // Every third tick, each body down a half second, drawn as the renderer would draw it, on one bone and on all. A
      // topple counts while it lies all the way down, before it rises.
      for (let i = 0; i < remote.count && T % 3 === 0; i++) {
        const id = remote.id[i]!, since = downAt.get(id), word = remote.react[i]!;
        if (since === undefined || remote.tick - since < 15) continue;
        if (reactKind(word) === REACT_FALL ? Math.abs(reactAge(word, remote.tick) - TOPPLED) > 20 : (remote.cue[i]! & CUE_DOWN) === 0) continue;
        const fall = characters.humanFall(id), truth = this.joints.get(id);
        for (const rigid of [true, false]) {
          characters.begin(); packet.beginFrame();
          st.unpack(remote.anim[i]!, remote.cue[i]!, remote.emote[i]!, word, remote.stride[i]!);
          st.seed = bodySeed(id);
          const dropped = packet.dropped;
          this.submitted++;
          if (!characters.add(packet, remote.kind[i]!, remote.x[i]!, remote.y[i]!, remote.z[i]!, remote.yaw[i]!, st, remote.tick, null, 0, NO_COLORS, 0, null, 0, id, false, false, 1, rigid) || packet.dropped !== dropped) {
            this.undrawn++;
            continue;
          }
          // On one bone the body rides its own bone after the shared pose; on all, its bones come first.
          const own = rigid ? HUMAN_BONES : -1, head = jointAt(packet.bones, B_HEAD, own), hips = jointAt(packet.bones, B_HIPS, own);
          const at = fall?.down && truth ? (fall.clock & 63) * 7 : -1, shift = fall?.down ? this.shift(id, fall.clock, remote.tick) : null;
          if (at >= 0 && truth![at] === fall!.clock && shift) {
            // A laid fall: whole, its head and hips where a shot is judged against them (server/combat.ts): about where
            // the body is at the tick drawn, posed as at the tick its ragdoll has reached; on one bone, its hips.
            const off = Math.hypot(hips[0]! - truth![at + 4]! - shift[0]!, hips[1]! - truth![at + 5]! - shift[1]!, hips[2]! - truth![at + 6]! - shift[2]!);
            if (rigid) this.oneBoneHips.push(off);
            else this.wholeOff.push(Math.max(off, Math.hypot(head[0]! - truth![at + 1]! - shift[0]!, head[1]! - truth![at + 2]! - shift[1]!, head[2]! - truth![at + 3]! - shift[2]!)));
          } else if (!fall && head[1]! - hips[1]! > 0.45) this.upright++;
        }
      }
      for (let i = 0; i < remote.count; i++) {
        const id = remote.id[i]!, fall = drawn.humans.of(id), ring = this.truth.get(id);
        if (fall?.down && ring && ring[(fall.clock & 63) * 4] === fall.clock) {
          const o = (fall.clock & 63) * 4;
          this.apart.push(Math.hypot(fall.x - ring[o + 1]!, fall.y - ring[o + 2]!, fall.z - ring[o + 3]!));
        }
        // Down as a ragdoll (its cue), or toppled past the fall budget (its reaction alone).
        const cheap = reactKind(remote.react[i]!) === REACT_FALL;
        if ((remote.cue[i]! & CUE_DOWN) === 0 && !cheap) { waits.delete(id); downAt.delete(id); continue; }
        if (!downAt.has(id)) downAt.set(id, remote.tick);
        if (cheap || fall) { waits.delete(id); continue; }
        if (drawn.humans.waiting(id, remote.tick) === 0) { this.standing++; continue; }
        this.toppled++;
        const ticks = (waits.get(id) ?? 0) + 1;
        waits.set(id, ticks);
        if (ticks > this.longest) this.longest = ticks;
      }
    });
  }

  /** How far the server had body `e` move from tick `clock` to `tick`, which may fall between ticks; null where not kept. */
  private shift(e: number, clock: number, tick: number): number[] | null {
    const ring = this.truth.get(e), t0 = Math.floor(tick), a = (clock & 63) * 4, b = (t0 & 63) * 4, c = ((t0 + 1) & 63) * 4;
    if (!ring || ring[a] !== clock || ring[b] !== t0 || ring[c] !== t0 + 1) return null;
    const k = tick - t0;
    return [1, 2, 3].map((j) => ring[b + j]! + (ring[c + j]! - ring[b + j]!) * k - ring[a + j]!);
  }

  /** Records what the watchers saw over `seconds`. */
  record(record: Row, seconds: number): void {
    const apart = this.apart;
    record("watchers: kilobytes a second received, the busier", Math.max(...this.sessions.map((s, k) => (s.stats.bytesIn - this.heard[k]!) / 1024 / seconds)), "", null);
    record("watchers: bodies down but drawn standing, body-ticks", this.standing, "", 0);
    record("watchers: bodies down handed to the renderer, body-draws", this.submitted, "", null);
    record("watchers: of them not drawn, for want of room", this.undrawn, "", 0);
    record("watchers: toppled or waiting, drawn upright", this.upright, "", 0);
    record("watchers: a laid fall drawn whole, head or hips from the server's, median", at(this.wholeOff, 0.5) * 100, "cm", null);
    record("watchers: a laid fall drawn whole, head or hips from the server's, the most", at(this.wholeOff, 1) * 100, "cm", null);
    record("watchers: a laid fall on one bone, hips from the server's, the most", at(this.oneBoneHips, 1) * 100, "cm", null);
    record("watchers: bodies drawn toppling while their fall came, body-ticks", this.toppled, "", null);
    record("watchers: longest wait for a fall's checkpoint, ticks", this.longest, "", null);
    record("watchers: toppling or getting up, drawn whole, head from the server's, 99th percentile", at(this.risingWhole, 0.99) * 100, "cm", null);
    record("watchers: toppling or getting up, drawn whole, head from the server's, the most", at(this.risingWhole, 1) * 100, "cm", null);
    record("server: getting up, the hit head's move from the ragdoll's, median", at(this.snaps, 0.5) * 100, "cm", null);
    record("server: getting up, the hit head's move from the ragdoll's, the most", at(this.snaps, 1) * 100, "cm", null);
    record("watchers: getting up, the hand-off from the ragdoll, head from the server's, the most", at(this.handOff, 1) * 100, "cm", null);
    record("watchers: toppling or getting up, on one bone, head from the server's, 99th percentile", at(this.risingOne, 0.99) * 100, "cm", null);
    record("watchers: toppling or getting up, on one bone, head from the server's, the most", at(this.risingOne, 1) * 100, "cm", null);
    record("watchers: toppling or getting up, drawn whole, the most a head pops between draws", at(this.steps, 1) * 100, "cm", null);
    record("watchers: poses kept of bodies down or getting up, the most", this.lyingKept, "", null);
    record("watchers: toppling or getting up, on one bone, the most a head pops between draws", at(this.stepsOne, 1) * 100, "cm", null);
    record("watchers: simulated hips from the server's hips, median", at(apart, 0.5) * 100, "cm", null);
    record("watchers: simulated hips from the server's hips, 90th percentile", at(apart, 0.9) * 100, "cm", null);
    record("watchers: simulated hips from the server's hips, 99th percentile", at(apart, 0.99) * 100, "cm", null);
    record("watchers: simulated hips from the server's hips, the most", at(apart, 1) * 100, "cm", null);
  }
}

/**
 * 48 survivors standing in rows, `walled` inside an 18 m stone room (floor, walls round with a door, ceiling 0.95 m over
 * their heads) or on open ground, knocked down at once as the game knocks a body down (Host.knock): as ragdolls while
 * the fall budget has room, and toppled by their reactions past it, as a car's blow throws a body; then stepped until
 * every one has risen. The same throws either way.
 */
export function benchFalls(section: Section, record: Row, walled: boolean, run: PhysicsRun = {}): void {
  const clock = run.clock ?? wallMs, seed = run.seed ?? 1;
  section(`${FALLS_MOST} survivors knocked down at once ${walled ? "inside a closed stone room" : "on open flat ground"}, two players watching`);
  const { h, ents: all, sessions } = flat(FALLS_MOST + 2, seed);
  try {
    const bodies = all.slice(0, FALLS_MOST);
    const reg = h.reg, [x0, z0] = [119, 119];
    const pieces = boxBase(reg, "stone", x0, 0, z0, 6, 6, 97);
    if (walled) layBase(h.world.structs, pieces, 1, 100000);
    const floor = walled ? 2 * reg.halfY[pieces[0]![0]]! : 0;
    bodies.forEach((e, k) => put(h, e, x0 + 1.5 + (k % 8) * 2.15, floor, z0 + 2 + Math.floor(k / 8) * 2.8));
    // Two players outside the room, one each side.
    put(h, all[FALLS_MOST]!, x0 - 8, 0, z0 + 9);
    put(h, all[FALLS_MOST + 1]!, x0 + 26, 0, z0 + 9);
    h.run(1000);
    const watching = new Watching(h, sessions.slice(FALLS_MOST), bodies);
    const falls = h.host.falls, reactions = h.host.reactions, ents = h.world.ents, rng = new Rng(seed);
    const toppledBefore = reactions.stats.toppled;
    const t0 = clock();
    for (const e of bodies) {
      const a = rng.range(0, Math.PI * 2), speed = rng.range(6, 14);
      ents.vx[e] = Math.sin(a) * speed; ents.vy[e] = rng.range(1, 3.5); ents.vz[e] = Math.cos(a) * speed;
      h.host.knock(e, rng.range(-8, 8), rng.range(-8, 8), rng.range(-8, 8));
    }
    const knockMs = clock() - t0;
    // The falls the budget let start as ragdolls; the rest toppled by their reactions.
    const knocked = falls.count, toppled = reactions.stats.toppled - toppledBefore;
    // Bodies stepped in each tick, and of them those moving as it began.
    const down: number[] = [], moving: number[] = [];
    const meter = new Meter(h, clock, () => {
      down.push(falls.count);
      moving.push(falls.moving);
    }, () => watching.after());
    while (meter.physics.length < 10 * 30 && falls.count > 0) h.run(TICK_MS);
    meter.stop();
    const fell = meter.row("falls"), physics = meter.physics;
    // Microseconds a body a tick: while all move, and over the whole fall.
    const allMoving = fell.filter((_, t) => moving[t] === knocked && knocked > 0).map((ms) => (ms * 1000) / knocked);
    record("knocked down", knocked + toppled, "", null);
    record("laid as ragdolls", knocked, "", null);
    record("toppled past the fall budget", toppled, "", null);
    record("the 48 knocks, their ragdolls laid", knockMs, "ms", null);
    record("falls row a tick, median", at(fell, 0.5), "ms", null);
    record("falls row a tick, 99th percentile", at(fell, 0.99), "ms", null);
    record("falls row, the worst tick", at(fell, 1), "ms", null);
    record("physics a tick, median", at(physics, 0.5), "ms", LANE_RESERVE_MS);
    record("physics a tick, 99th percentile", at(physics, 0.99), "ms", LANE_RESERVE_MS);
    record("physics, the worst tick", at(physics, 1), "ms", LANE_RESERVE_MS * 2);
    record("a fall a tick while every ragdoll moves, median", at(allMoving, 0.5), "us", null);
    record("a fall a tick over the whole fall, mean", (sum(fell) * 1000) / Math.max(1, sum(down)), "us", null);
    record("ticks every ragdoll moved", allMoving.length, "", null);
    record("ticks until every one had risen", fell.length, "", null);
    record("risen at the most a fall may last, not at rest", fell.length >= 120 ? down.at(-1) ?? 0 : 0, "", null);
    watching.record(record, meter.physics.length / TICK_RATE);
  } finally {
    h.host.shutdown();
  }
}

/**
 * A car someone drives at 15 m/s along +Z through 60 bodies, 4 abreast 0.8 m apart and 15 deep 1.2 m apart, every third
 * a dodo; until every survivor it knocked down has risen.
 */
export function benchCrowd(section: Section, record: Row, run: PhysicsRun = {}, drive: "straight" | "turning" | "braking" = "straight"): void {
  const clock = run.clock ?? wallMs, seed = run.seed ?? 1;
  const how = drive === "turning" ? ", turning as it meets it" : drive === "braking" ? ", braking to a stop in it" : "";
  section(`A car at 15 m/s through a crowd of 40 survivors and 20 dodos${how}, two players watching`);
  const { h, ents: all, sessions } = flat(43, seed);
  try {
    // The last two stand by the road and watch; what they can draw is part of the cost.
    const ents = h.world.ents, bodies = all.slice(0, 41), [driver, ...crowd] = bodies;
    const lookers = sessions.slice(41), [w1, w2] = all.slice(41);
    put(h, w1!, 122, 0, 96);
    put(h, w2!, 135, 0, 102);
    const dodos: number[] = [];
    let s = 0;
    for (let k = 0; k < 60; k++) {
      const x = 126.8 + (k % 4) * 0.8, z = 90 + Math.floor(k / 4) * 1.2;
      if (k % 3 !== 2) put(h, crowd[s++]!, x, 0, z);
      else {
        const e = h.host.spawnCreature("core:dodo", x, z, 1);
        h.host.creatures.mind.stay(e, 0xffffffff);
        dodos.push(e);
      }
    }
    // The driver's own car, so its tribe's blows land on the crowd's.
    const team = h.host.records.byPid.get(ents.pid[driver!]!)!.team;
    const car = h.host.spawnVehicle("core:compact", 128, 50, team);
    put(h, driver!, 129.6, 0, 50.12);
    const c = h.server.clients.find((c) => c?.ent === driver)!;
    if (h.host.urban.mount(c, car) !== RESULT_OK) throw new Error("the driver could not get in");
    h.run(1500);
    const falls = h.host.falls, contacts = h.host.urban.contacts!, sent = h.host.corpseMotion.stats;
    const met = contacts.contacts, over = contacts.runOvers, bytes = sent.bytes, checkpoints = sent.checkpoints, corrections = sent.corrections;
    const watching = new Watching(h, lookers, crowd as number[]);
    // Held before every tick until it would be through, then let roll: at 15 m/s; turning 0.7 rad/s from the crowd's first
    // rank; or braking at 9 m/s² from its third.
    const carZ: number[] = [], v = ents.vrow[car]!;
    let speed = 15, held = 0;
    const meter = new Meter(h, clock, () => {
      carZ.push(ents.z[car]!);
      if (held++ >= DRIVE_TICKS) return;
      if (drive === "braking" && ents.z[car]! > 92.5) speed = Math.max(0, speed - 9 / TICK_RATE);
      if (drive === "turning") ents.vehicleYawRate[v] = ents.z[car]! > 86 ? 0.7 : 0;
      const yaw = drive === "turning" ? ents.vehicleYaw[v]! : 0;
      ents.vx[car] = Math.sin(yaw) * speed;
      ents.vz[car] = Math.cos(yaw) * speed;
    }, () => watching.after());
    while (meter.physics.length < 12 * 30 && (held < DRIVE_TICKS || falls.count > 0)) h.run(TICK_MS);
    record("car's turn at the end, degrees", (ents.vehicleYaw[v]! * 180) / Math.PI, "", null);
    meter.stop();
    // The strike: from its front at the crowd's first rank until a second after it is through the last.
    const strike = (row: number[]): number[] => row.filter((_, t) => carZ[t]! > 86 && carZ[t]! < 107 + 15);
    const fell = meter.row("falls").filter((_, t) => carZ[t]! > 86);
    record("survivors knocked down", falls.stats.fell, "", null);
    record("dodos run over", contacts.runOvers - over, "", null);
    record("dodos dead", dodos.filter((e) => (ents.flags[e]! & F_ALIVE) === 0).length, "", null);
    record("contacts resolved", contacts.contacts - met, "", null);
    record("contacts row in the strike, median", at(strike(meter.row("contacts")), 0.5), "ms", null);
    record("contacts row in the strike, worst tick", at(strike(meter.row("contacts")), 1), "ms", null);
    record("falls row from the strike until all rose, median", at(fell, 0.5), "ms", null);
    record("falls row from the strike until all rose, worst tick", at(fell, 1), "ms", null);
    record("corpses row, worst tick", at(meter.row("corpses"), 1), "ms", null);
    record("physics in the strike, median", at(strike(meter.physics), 0.5), "ms", LANE_RESERVE_MS);
    record("physics, the worst tick", at(meter.physics, 1), "ms", LANE_RESERVE_MS * 2);
    record("ticks timed", meter.physics.length, "", null);
    const seconds = meter.physics.length / TICK_RATE;
    record("checkpoints sent to all 43 players", sent.checkpoints - checkpoints, "", null);
    record("of them corrections of bodies a player already lays", sent.corrections - corrections, "", null);
    record("checkpoints sent to all 43 players, kilobytes", (sent.bytes - bytes) / 1024, "", null);
    watching.record(record, seconds);
  } finally {
    h.host.shutdown();
  }
}

/** A wild rex walking 70 m on bare ground, then back through 30 bodies (dodos, raptors, parasaurs) lying in its way. */
export function benchRexCorpses(section: Section, record: Row, run: PhysicsRun = {}): void {
  const clock = run.clock ?? wallMs, seed = run.seed ?? 1;
  section("A rex walking through 30 bodies lying on the ground, and the same walk on bare ground");
  // One survivor out of its sight, near enough that the creatures round it are awake.
  const { h, ents: [watcher] } = flat(1, seed);
  try {
    const ents = h.world.ents, mind = h.host.creatures.mind, corpses = h.host.corpses;
    put(h, watcher!, 178, 0, 105);
    const rex = h.host.spawnCreature("core:rex", 128, 68, 30);
    mind.stay(rex, 0xffffffff);
    h.run(1500);
    const walk = (z: number): { meter: Meter; woke: number } => {
      let woke = 0;
      const meter = new Meter(h, clock, undefined, () => {
        for (const b of corpses.bodies.values()) if (b.fall && !b.fall.still) woke++;
      });
      mind.goTo(rex, 128, z, GOAL_WALK);
      while (meter.physics.length < 60 * 30 && !mind.arrived(rex)) h.run(TICK_MS);
      meter.stop();
      mind.stay(rex, 0xffffffff);
      return { meter, woke };
    };
    const bare = walk(140);
    const kinds = ["core:dodo", "core:raptor", "core:parasaur"];
    const lying: number[] = [];
    for (let k = 0; k < 30; k++) {
      const e = h.host.spawnCreature(kinds[k % 3]!, 125.5 + (k % 3) * 2.5, 90 + Math.floor(k / 3) * 3, 1);
      mind.stay(e, 0xffffffff);
      lying.push(e);
    }
    h.run(300);
    const me = h.host.records.byPid.get(ents.pid[watcher!]!)!;
    for (const e of lying) h.host.survival.hurt(h.host.records.byPid.get(ents.pid[e]!)!, 1e6, me.pid);
    for (let t = 0; t < 20 * 10 && [...corpses.bodies.values()].some((b) => b.fall && !b.fall.still); t++) h.run(TICK_MS);
    const before = new Map([...corpses.bodies.values()].map((b) => [b, b.z]));
    const through = walk(68);
    // How far along its way the rex took a body: its legs shove one aside, never carry it.
    const carried = Math.max(0, ...[...before].map(([b, z]) => Math.abs(b.z - z)));
    record("bodies lying", corpses.bodies.size, "", null);
    record("bare ground: creatures row a tick, median", at(bare.meter.row("creatures"), 0.5), "ms", null);
    record("bare ground: creatures row, worst tick", at(bare.meter.row("creatures"), 1), "ms", null);
    record("through the bodies: creatures row a tick, median", at(through.meter.row("creatures"), 0.5), "ms", null);
    record("through the bodies: creatures row, worst tick", at(through.meter.row("creatures"), 1), "ms", null);
    record("through the bodies: corpses row a tick, median", at(through.meter.row("corpses"), 0.5), "ms", 0.05);
    record("through the bodies: corpses row, worst tick", at(through.meter.row("corpses"), 1), "ms", 0.5);
    record("through the bodies: physics, the worst tick", at(through.meter.physics, 1), "ms", LANE_RESERVE_MS);
    record("bodies the rex woke, in body-ticks moving", through.woke, "", null);
    record("the farthest it moved a body along its way", carried, "m", null);
    record("ticks of the walk on bare ground", bare.meter.physics.length, "", null);
    record("ticks of the walk through the bodies", through.meter.physics.length, "", null);
    record("rex's distance short of where it was sent", Math.abs(ents.z[rex]! - 68), "m", null);
  } finally {
    h.host.shutdown();
  }
}

export function benchPhysicsRows(section: Section, record: Row): void {
  benchFalls(section, record, true);
  benchFalls(section, record, false);
  benchCrowd(section, record);
  benchRexCorpses(section, record);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const runsAt = argv.indexOf("--runs");
  const runs = runsAt >= 0 ? Number(argv[runsAt + 1]) : 3;
  const clock = argv.includes("--cpu") ? cpuMs : wallMs;
  const only = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--runs");
  const want = (name: string): boolean => only.length === 0 || only.includes(name);
  // Each figure by its section and name, a value a run.
  const kept = new Map<string, { unit: string; budget: number | null; values: number[] }>();
  let title = "";
  const section: Section = (t) => (title = t);
  const record: Row = (name, value, unit, budget = null) => {
    const key = `${title}\n${name}`;
    const row = kept.get(key) ?? { unit, budget, values: [] };
    row.values.push(value);
    kept.set(key, row);
  };
  const load = (): string => readFileSync("/proc/loadavg", "utf8").split(" ")[0]!;
  console.log(`timed by ${clock === cpuMs ? "the process's CPU time" : "the wall clock"}, ${runs} runs`);
  for (let r = 1; r <= runs; r++) {
    const from = load(), run = { clock, seed: r };
    if (want("falls")) {
      benchFalls(section, record, true, run);
      benchFalls(section, record, false, run);
    }
    if (want("crowd")) for (const drive of ["straight", "turning", "braking"] as const) benchCrowd(section, record, run, drive);
    if (want("corpses")) benchRexCorpses(section, record, run);
    console.log(`run ${r}: load ${from} at its start, ${load()} at its end`);
  }
  let last = "";
  const fixed = (v: number): string => v.toFixed(Math.abs(v) < 10 ? 3 : 1);
  for (const [key, row] of kept) {
    const [head, name] = key.split("\n") as [string, string];
    if (head !== last) console.log(`\n${(last = head)}`);
    const mid = at(row.values, 0.5);
    const verdict = row.budget === null ? "" : mid <= row.budget ? `  ok (budget ${row.budget})` : `  MISS (budget ${row.budget})`;
    console.log(`  ${name.padEnd(56)} ${fixed(mid).padStart(9)} ${row.unit.padEnd(3)} [${fixed(Math.min(...row.values))} to ${fixed(Math.max(...row.values))}]  ${row.values.map(fixed).join(" ")}${verdict}`);
  }
}
