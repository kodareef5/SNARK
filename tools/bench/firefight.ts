// Rows for a firefight (planning/workstreams/plasma.md): 50 survivors within 40 m of each other holding automatic fire,
// 500 shots a second, each aimed at another of them. The server's tick with nobody firing and with each gun, turn about so
// that a busy machine weighs on each alike; what a shot costs by part; the rounds in the air; and what the shots add to a
// listener's line. Then a client's work on 256 rounds in the air among 2,048 bodies.
// `bun tools/bench/firefight.ts` runs these alone, on a small world of its own.

import { heapStats } from "bun:jsc";
import { Camera } from "../../client/core/render/camera.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { RemoteSample, type ClientSession } from "../../client/core/session.ts";
import { Shots } from "../../client/core/shots.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Client } from "../../server/game.ts";
import { contentFor, createHost, type Host } from "../../server/host.ts";
import { Rules } from "../../server/settings/rules.ts";
import { createWorld } from "../../server/world.ts";
import { HumanAnim } from "../../shared/anim/pose.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { TICK_RATE, YAW_UNITS } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { LoopbackNet, type LoopbackEnd } from "../../shared/net/loopback.ts";
import { EVENT_SHOT } from "../../shared/net/protocol.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { Rng } from "../../shared/rng.ts";
import type { CollisionWorld } from "../../shared/world/collide.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { buildCorePack } from "../pack/build.ts";
import { Bot } from "./bot.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** A gun the fight is held with: its item and its round, by name, and what its rows are held to (none: a baseline). */
export interface FirefightGun {
  readonly label: string;
  readonly weapon: string;
  readonly ammo: string;
  /** Most rounds in the air, and most KB/s twenty firing may add to a listener. */
  readonly flying?: number;
  readonly added?: number;
  /** Most milliseconds its median tick may be over the first gun's. */
  readonly over?: number;
}

/** The assault rifle is what the plasma rifle is held against. The sniper's round flies its ten seconds, and stands nowhere. */
export const FIREFIGHT_GUNS: readonly FirefightGun[] = [
  { label: "assault rifle", weapon: "rifle_assault", ammo: "round_advanced_rifle" },
  { label: "sniper's round", weapon: "rifle_sniper", ammo: "round_advanced_sniper" },
  { label: "plasma rifle", weapon: "rifle_plasma", ammo: "plasma_cell", flying: 700, added: 3, over: 0.5 },
];
export const SHOT_ROUNDS = [{ label: "arrows", ammo: "arrow_stone" }, { label: "plasma bolts", ammo: "plasma_cell", budget: 0.3 }];

const FIGHTERS = 50;
/** A shot every this many ticks from each: 10 a second. */
const EVERY = 3;
/** Half the degrees a shot is off the one aimed at: a share of them land. */
const WILD = 2;
/** Turns each takes, and the ticks of one. */
const TURNS = 5;
const TURN = 120;
const TO_UNITS = YAW_UNITS / (Math.PI * 2);
const median = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const high = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.99))] ?? 0;

/** Adds to `into[name]` the milliseconds every call of `owner[name]` takes, until the returned function is called. */
function timed(owner: object, name: string, into: Record<string, number>): () => void {
  const o = owner as Record<string, (...a: unknown[]) => unknown>;
  const real = o[name]!;
  into[name] = 0;
  o[name] = function (this: unknown, ...a: unknown[]): unknown {
    const t = performance.now();
    const out = real.apply(this, a);
    into[name]! += performance.now() - t;
    return out;
  };
  return () => void (o[name] = real);
}

/**
 * The fight, with each gun the content has: `centre` is where the 50 are gathered, and `run` steps the world. Those brought
 * from elsewhere are put back, so what follows finds the world as it was.
 */
export function benchFirefight(section: Section, record: Row, host: Host, centre: readonly [number, number], run: (ticks: number, times: number[] | null) => void, all: readonly FirefightGun[]): void {
  const { world, projectiles: shots, combat } = host;
  const ents = world.ents;
  const reg = world.reg;
  section(`Firefight: ${FIGHTERS} survivors within 40 m hold automatic fire, ${(FIGHTERS * TICK_RATE) / EVERY} shots a second`);
  const fighters = host.game.clients.filter((c): c is Client => !!c?.active && c.ent >= 0).slice(0, FIGHTERS);
  record("survivors in the fight", fighters.length, "");
  const home = fighters.map((c) => [ents.x[c.ent]!, ents.y[c.ent]!, ents.z[c.ent]!] as const);
  const spot = new Rng(404);
  for (const c of fighters) {
    host.survival.gods.add(c.pid);
    const x = centre[0] + 26 + spot.range(0, 40);
    const z = centre[1] + spot.range(-20, 20);
    ents.setPosition(c.ent, x, world.hf.heightAt(x, z), z);
  }
  run(90, null);
  const sent = (): number => fighters.reduce((n, c) => n + (c.conn as LoopbackEnd).bytesSent, 0);
  const aim = new Rng(505);
  let most = 0;
  /** Steps `ticks` with the first `firing` of them shooting, each tick's time and its shots' into `times`. Returns the KB/s each of the 50 was sent. */
  const hold = (gun: FirefightGun | null, firing: number, ticks: number, times: number[] | null): number => {
    const weapon = gun ? reg.index.get(`core:${gun.weapon}`)! : 0;
    const ammo = gun ? reg.index.get(`core:${gun.ammo}`)! : 0;
    const before = sent();
    const one: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const t = performance.now();
      for (let k = 0; gun && k < firing && k < fighters.length; k++) {
        const c = fighters[k]!;
        if ((world.tick + k) % EVERY !== 0 || c.ent < 0) continue;
        const rec = host.records.byPid.get(c.pid);
        const at = fighters[(k + 1 + aim.int(fighters.length - 1)) % fighters.length]!;
        if (!rec || at.ent < 0) continue;
        const dx = ents.x[at.ent]! - ents.x[c.ent]!;
        const dy = ents.y[at.ent]! - ents.y[c.ent]!;
        const dz = ents.z[at.ent]! - ents.z[c.ent]!;
        const wild = (WILD / 360) * YAW_UNITS;
        ents.yaw[c.ent] = (Math.round(Math.atan2(dx, dz) * TO_UNITS + aim.range(-wild, wild)) + YAW_UNITS) % YAW_UNITS;
        ents.pitch[c.ent] = Math.round(Math.atan2(dy, Math.hypot(dx, dz)) * TO_UNITS + aim.range(-wild, wild));
        shots.launch(c, rec, weapon, 0, ammo, 1);
      }
      const launched = performance.now() - t;
      one.length = 0;
      run(1, one);
      times?.push(launched + one[0]!);
      if (shots.flyingCount > most) most = shots.flyingCount;
    }
    return (sent() - before) / fighters.length / (ticks / TICK_RATE) / 1024;
  };
  /** Steps until nothing a turn fired is still in the air. */
  const clear = (): void => {
    run(15, null);
    for (let i = 0; i < 330 && shots.flyingCount > 0; i++) run(1, null);
  };
  const guns = all.filter((g) => reg.index.has(`core:${g.weapon}`) && reg.index.has(`core:${g.ammo}`));
  const quiet = { ticks: [] as number[], kb: [] as number[] };
  const arms = guns.map((gun) => ({ gun, ticks: [] as number[], kb: [] as number[], twenty: [] as number[], most: 0, fired: 0, struck: 0 }));
  hold(null, 0, TURN, null);
  for (let turn = 0; turn < TURNS; turn++) {
    quiet.kb.push(hold(null, 0, TURN, quiet.ticks));
    for (const a of arms) {
      a.twenty.push(hold(a.gun, 20, TURN, null));
      clear();
      most = 0;
      const fired = shots.fired;
      const struck = shots.struck;
      a.kb.push(hold(a.gun, FIGHTERS, TURN, a.ticks));
      a.fired += shots.fired - fired;
      a.struck += shots.struck - struck;
      a.most = Math.max(a.most, most);
      clear();
    }
  }
  const still = median(quiet.ticks);
  const line = median(quiet.kb);
  record("nobody firing: tick time, median", still, "ms", 8);
  record("nobody firing: tick time, 99th percentile", high(quiet.ticks), "ms", 16);
  record("nobody firing: downstream per listener", line, "KB/s");
  let first = -1;
  for (const a of arms) {
    const label = a.gun.label;
    const whole = median(a.ticks);
    record(`${label}: shots fired`, a.fired, "");
    record(`${label}: shots that hit a body`, a.struck, "");
    record(`${label}: rounds in the air at most`, a.most, "", a.gun.flying ?? null);
    record(`${label}: tick and its shots, median`, whole, "ms", 8);
    record(`${label}: tick and its shots, 99th percentile`, high(a.ticks), "ms", 16);
    record(`${label}: that median over nobody firing`, whole - still, "ms");
    if (first < 0) first = whole;
    else if (a.gun.over !== undefined) record(`${label}: that median over the first gun's`, whole - first, "ms", a.gun.over);
    record(`${label}: 20 firing add to a listener`, median(a.twenty) - line, "KB/s", a.gun.added ?? null);
    record(`${label}: all firing add to a listener`, median(a.kb) - line, "KB/s");
    // What a shot costs, by part. The parts nest in the launch and in the step, so they are timed in a run of their own.
    const ms: Record<string, number> = {};
    const undo = [timed(shots, "launch", ms), timed(shots, "aim", ms), timed(shots, "tell", ms), timed(shots, "step", ms), timed(combat, "castBodies", ms), timed(combat, "land", ms), timed(combat, "eye", ms)];
    const before = shots.fired;
    hold(a.gun, FIGHTERS, 300, null);
    for (const u of undo) u();
    const each = (name: string): number => (ms[name]! * 1000) / Math.max(1, shots.fired - before);
    record(`${label}: a shot's launch`, each("launch"), "us");
    record(`${label}: of a shot, its aim and its eye`, each("aim") + each("eye"), "us");
    record(`${label}: of a shot, the bodies cast against`, each("castBodies"), "us");
    record(`${label}: of a shot, its landing`, each("land"), "us");
    record(`${label}: of a shot, the telling`, each("tell"), "us");
    record(`${label}: flying rounds stepped, a tick`, ms.step! / 300, "ms");
    clear();
  }
  fighters.forEach((c, i) => c.ent >= 0 && ents.setPosition(c.ent, home[i]![0], home[i]![1], home[i]![2]));
  run(30, null);
}

/** Rounds in the air a client draws at most (client/core/shots.ts). */
const FLYING = 256;
const BODIES = 2048;
/** Frames timed, after as many again that are not: the first are the compiler's. */
const FRAMES = 300;

/**
 * A client's work on shots: `FLYING` rounds of each ammunition kept in the air among `BODIES` survivors, 60 frames a
 * second. The step that flies them and the draw that queues them are timed apart from the frame that holds them.
 */
export function benchShots(section: Section, record: Row, scene: Scene, cam: Camera, world: CollisionWorld, reg: Registry, pack: Pack, rounds: readonly { label: string; ammo: string; budget?: number }[]): void {
  section(`Client shots (headless): ${FLYING} rounds in the air among ${BODIES} survivors in view`);
  const survivor = reg.index.get("core:survivor")!;
  const crowd = new RemoteSample();
  const put = new Rng(606);
  for (let i = 0; i < BODIES; i++) {
    crowd.id[i] = i + 1;
    crowd.kind[i] = survivor;
    crowd.x[i] = cam.x + put.range(-150, 150);
    crowd.z[i] = cam.z + put.range(-150, 150);
    crowd.y[i] = world.hf.heightAt(crowd.x[i]!, crowd.z[i]!);
  }
  crowd.count = BODIES;
  const kept = scene.shots;
  for (const round of rounds) {
    const ammo = reg.index.get(`core:${round.ammo}`);
    if (ammo === undefined) continue;
    const shots = new Shots(reg, pack);
    scene.shots = shots;
    const speed = reg.ammoSpeed[ammo]!;
    const events: unknown[] = [];
    const session = { fired: [], inventory: null, held: -1, events } as unknown as ClientSession;
    const aim = new Rng(707);
    const ms = { draw: 0 };
    const undo = timed(shots, "draw", ms);
    const stepped: number[] = [];
    const drawn: number[] = [];
    let most = 0;
    let objects = 0;
    for (let f = 0; f < FRAMES * 2; f++) {
      if (f === FRAMES) {
        Bun.gc(true);
        objects = heapStats().objectCount;
      }
      const now = f * (1000 / 60);
      const tick = 200 + f / 2;
      crowd.tick = tick;
      // As many leave each frame as keep the air full: nearly level, from among the crowd, each its own way.
      for (let n = shots.flying.length; n < FLYING; n++) {
        const yaw = aim.float() * Math.PI * 2;
        const x = cam.x + aim.range(-120, 120);
        const z = cam.z + aim.range(-120, 120);
        events.push({ kind: EVENT_SHOT, x, y: world.hf.heightAt(x, z) + 1.5, z, item: ammo, flies: true, vx: Math.sin(yaw) * speed, vy: speed * 0.02, vz: Math.cos(yaw) * speed, back: 2, rays: 1, seed: 0, silenced: false });
      }
      const t = performance.now();
      shots.absorb(session, world, now);
      shots.step(world, crowd, tick, now);
      const flown = performance.now() - t;
      if (shots.flying.length > most) most = shots.flying.length;
      ms.draw = 0;
      scene.build(cam, crowd);
      if (f < FRAMES) continue;
      stepped.push(flown);
      drawn.push(ms.draw);
    }
    const made = heapStats().objectCount - objects;
    undo();
    record(`${round.label}: rounds in the air at most`, most, "");
    // A tick comes every other frame, so half the frames fly nothing: the mean and the worst say more than the median.
    const whole = stepped.map((s, i) => s + drawn[i]!);
    const mean = (a: number[]): number => a.reduce((n, v) => n + v, 0) / a.length;
    record(`${round.label}: told and flown a frame, mean`, mean(stepped), "ms");
    record(`${round.label}: drawn a frame, mean`, mean(drawn), "ms");
    record(`${round.label}: a frame's shots in all, mean`, mean(whole), "ms");
    record(`${round.label}: a frame's shots in all, 99th percentile`, high(whole), "ms", round.budget ?? null);
    // Not collected first: what the frames made and left for the collector, less whatever it took meanwhile.
    record(`${round.label}: objects left by ${FRAMES} frames`, made, "");
  }
  scene.shots = kept;
}

if (import.meta.main) {
  // A kilometre of rolling ground, the 50 and a herd about them: enough for a fight, and built in a second.
  const dims = { chunksX: 16, chunksZ: 16 };
  const rules = new Rules();
  const reg = contentFor(compileContent(CORE_CONTENT).registry!, rules);
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.heights[j * hf.nx + i] = Math.round((40 + 6 * Math.sin((i * hf.cell) / 90) * Math.cos((j * hf.cell) / 70) + 32) * 64);
  hf.tint.fill(12);
  const world = createWorld(reg, dims, hf, "bench:fight", hashBytes(new Uint8Array(hf.heights.buffer, 0, 4096)), { x: 512, z: 512, yaw: 0 }, 16384);
  const host = createHost(reg, { world, config: rules, game: { maxClients: 64 } });
  const pack = parsePack(buildCorePack());
  const centre = [480, 512] as const;
  const herd = new Rng(11);
  for (let n = 0; n < 150; n++) host.spawnCreature("core:grazer", centre[0] + herd.range(-120, 160), centre[1] + herd.range(-140, 140), 1 + herd.int(30));
  const net = new LoopbackNet(7);
  host.game.sessions.listen(net);
  // Each has stood here before, so none is asked to make a survivor.
  const stood = new Rng(12);
  const places = new Map<string, { x: number; y: number; z: number; yaw: number }>();
  for (let i = 0; i < FIGHTERS; i++) {
    const x = centre[0] + 26 + stood.range(0, 40);
    const z = centre[1] + stood.range(-20, 20);
    places.set(`bot${i}`, { x, y: hf.heightAt(x, z), z, yaw: 0 });
  }
  host.game.sessions.savedPosition = (name) => places.get(name) ?? null;
  const bots: Bot[] = [];
  for (let i = 0; i < FIGHTERS; i++) bots.push(new Bot(net, `bot${i}`, reg.baseHash, 100 + i));
  let now = 0;
  const run = (ticks: number, times: number[] | null): void => {
    for (let i = 0; i < ticks; i++) {
      now += 1000 / TICK_RATE;
      net.advance(now);
      const t = performance.now();
      host.game.tick();
      times?.push(performance.now() - t);
      for (const b of bots) b.update(world.tick);
    }
  };
  const rows: { name: string; value: number; unit: string; budget: number | null }[] = [];
  const record: Row = (name, value, unit, budget = null) => {
    rows.push({ name, value, unit, budget });
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${verdict}`);
  };
  const section: Section = (title) => console.log(`\n${title}`);
  run(300, null);
  // Zone hits need bodies posed with the clips a real server has. The bots said hello with none.
  world.anim = new HumanAnim(pack.clips);
  benchFirefight(section, record, host, centre, run, FIREFIGHT_GUNS);
  const scene = new Scene({ dims, hf, structs: world.structs }, reg, pack);
  const cam = new Camera();
  cam.x = centre[0] + 46;
  cam.z = centre[1];
  cam.y = hf.heightAt(cam.x, cam.z) + 1.7;
  benchShots(section, record, scene, cam, world, reg, pack, SHOT_ROUNDS);
  host.shutdown();
  process.exit(rows.some((r) => r.budget !== null && r.value > r.budget) ? 1 : 0);
}
