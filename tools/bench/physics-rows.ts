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
import { Corpses } from "../../client/core/ragdoll.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { CUE_DOWN } from "../../shared/anim/pose.ts";
import { survivorKind } from "../../shared/sim/blockers.ts";
import { solidOf } from "../../shared/sim/vehicle-movers.ts";
import { boxBase } from "./base.ts";

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

/** Puts body `e` at (x, y, z), as a teleport does. */
function put(h: Harness, e: number, x: number, y: number, z: number): void {
  h.world.ents.setPosition(e, x, y, z);
  h.world.history.discontinuity(e);
}

/**
 * 48 survivors standing in rows, `walled` inside an 18 m stone room (floor, walls round with a door, ceiling 0.95 m over
 * their heads) or on open ground, knocked down at once as the game knocks a body down (Host.knock): as ragdolls while
 * the fall budget has room, and toppled by their reactions past it, as a car's blow throws a body; then stepped until
 * every one has risen. The same throws either way.
 */
export function benchFalls(section: Section, record: Row, walled: boolean, run: PhysicsRun = {}): void {
  const clock = run.clock ?? wallMs, seed = run.seed ?? 1;
  section(`${FALLS_MOST} survivors knocked down at once ${walled ? "inside a closed stone room" : "on open flat ground"}`);
  const { h, ents: bodies } = flat(FALLS_MOST, seed);
  try {
    const reg = h.reg, [x0, z0] = [119, 119];
    const pieces = boxBase(reg, "stone", x0, 0, z0, 6, 6, 97);
    if (walled) for (const [kind, x, y, z, yaw] of pieces) h.world.structs.add(kind, x, y, z, yaw, 1, 100000);
    const floor = walled ? 2 * reg.halfY[pieces[0]![0]]! : 0;
    bodies.forEach((e, k) => put(h, e, x0 + 1.5 + (k % 8) * 2.15, floor, z0 + 2 + Math.floor(k / 8) * 2.8));
    h.run(1000);
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
    });
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
  } finally {
    h.host.shutdown();
  }
}

/**
 * A car someone drives at 15 m/s along +Z through 60 bodies, 4 abreast 0.8 m apart and 15 deep 1.2 m apart, every third
 * a dodo; until every survivor it knocked down has risen.
 */
export function benchCrowd(section: Section, record: Row, run: PhysicsRun = {}): void {
  const clock = run.clock ?? wallMs, seed = run.seed ?? 1;
  section("A car at 15 m/s through a crowd of 40 survivors and 20 dodos, two players watching");
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
    const heard = lookers.map((s) => s.stats.bytesIn);
    // Each watcher draws the bodies as a client does: a fall once its checkpoint has come, a topple while it waits.
    const watchers = lookers.map(() => ({ remote: new RemoteSample(), drawn: new Corpses(h.world.anims, undefined, (k) => survivorKind(h.reg, k), (k) => solidOf(h.reg, k)), waits: new Map<number, number>() }));
    let standing = 0, toppled = 0, longest = 0;
    // Where the server had each body down, by tick, to set beside where a watcher draws it at the tick it has stepped to.
    const truth = new Map<number, Float64Array>(), apart: number[] = [];
    // Held at 15 m/s before every tick until it is through, then let roll.
    const carZ: number[] = [];
    const meter = new Meter(h, clock, () => {
      carZ.push(ents.z[car]!);
      if (ents.z[car]! >= 150) return;
      ents.vz[car] = 15;
      ents.vx[car] = 0;
    }, () => {
      const T = h.world.tick;
      for (const e of crowd) {
        if (!falls.poseOf(e!)) continue;
        let ring = truth.get(e!);
        if (!ring) truth.set(e!, (ring = new Float64Array(64 * 4).fill(-1)));
        const o = (T & 63) * 4;
        ring[o] = T; ring[o + 1] = ents.x[e!]!; ring[o + 2] = ents.y[e!]!; ring[o + 3] = ents.z[e!]!;
      }
      lookers.forEach((s, k) => {
        const { remote, drawn, waits } = watchers[k]!;
        s.sampleRemote(remote);
        drawn.update(remote, s.world!, 0, 0, new Map(), s.corpseMotions);
        for (let i = 0; i < remote.count; i++) {
          const id = remote.id[i]!, fall = drawn.humans.of(id), ring = truth.get(id);
          if (fall?.down && ring && ring[(fall.clock & 63) * 4] === fall.clock) {
            const o = (fall.clock & 63) * 4;
            apart.push(Math.hypot(fall.x - ring[o + 1]!, fall.y - ring[o + 2]!, fall.z - ring[o + 3]!));
          }
          if ((remote.cue[i]! & CUE_DOWN) === 0 || fall) { waits.delete(id); continue; }
          if (drawn.humans.waiting(id, remote.tick) === 0) { standing++; continue; }
          toppled++;
          const ticks = (waits.get(id) ?? 0) + 1;
          waits.set(id, ticks);
          if (ticks > longest) longest = ticks;
        }
      });
    });
    while (meter.physics.length < 12 * 30 && (ents.z[car]! < 150 || falls.count > 0)) h.run(TICK_MS);
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
    record("watchers: kilobytes a second received, the busier", Math.max(...lookers.map((s, k) => (s.stats.bytesIn - heard[k]!) / 1024 / seconds)), "", null);
    record("watchers: bodies down but drawn standing, body-ticks", standing, "", 0);
    record("watchers: bodies drawn toppling while their fall came, body-ticks", toppled, "", null);
    record("watchers: longest wait for a fall's checkpoint, ticks", longest, "", null);
    record("watchers: a body drawn down from where the server has it, median", at(apart, 0.5) * 100, "cm", null);
    record("watchers: a body drawn down from where the server has it, 90th percentile", at(apart, 0.9) * 100, "cm", null);
    record("watchers: a body drawn down from where the server has it, 99th percentile", at(apart, 0.99) * 100, "cm", null);
    record("watchers: a body drawn down from where the server has it, the most", at(apart, 1) * 100, "cm", null);
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
    if (want("crowd")) benchCrowd(section, record, run);
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
