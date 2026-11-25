// Rows for the jet (planning/workstreams/jet.md): its flight step against a helicopter's, its seeker's scan among 30,000
// creatures, its weapons idle and at full use, what a jet at full speed adds to every rewound shot of a fifty-gun fight,
// and what the far view's list adds to each snapshot.
// `bun tools/bench/jet.ts` runs these alone, on small worlds of their own.

import { HELICOPTER, HELICOPTER_VEHICLE } from "../../content/vehicles/helicopter.ts";
import { JET, JET_VEHICLE } from "../../content/vehicles/jet.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Client } from "../../server/game.ts";
import { contentFor, createHost, type Host } from "../../server/host.ts";
import { Rules } from "../../server/settings/rules.ts";
import { Sky, type SkyPoint, type SkyTaken, type SkyTarget } from "../../server/sky.ts";
import { lockScan, scanLock, type LockPick } from "../../server/vehicle-lock.ts";
import { createWorld } from "../../server/world.ts";
import { HumanAnim } from "../../shared/anim/pose.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { hashBytes } from "../../shared/hash.ts";
import { LoopbackNet } from "../../shared/net/loopback.ts";
import { Rng } from "../../shared/rng.ts";
import { BTN_PRIMARY, BTN_SECONDARY, MODE_FLYER } from "../../shared/sim/character.ts";
import { EntityStore } from "../../shared/sim/entities.ts";
import { createHelicopter, stepHelicopter, type HelicopterInput, type HelicopterState } from "../../shared/sim/helicopter.ts";
import { createJet, stepJet, type JetInput, type JetState } from "../../shared/sim/jet.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { StaticHelicopterWorld } from "../../shared/world/helicopter.ts";
import { StaticJetWorld } from "../../shared/world/jet.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { buildCorePack } from "../pack/build.ts";
import { Bot } from "./bot.ts";
import { ASSAULT_RIFLE, benchFirefight } from "./firefight.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const median = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const high = (a: number[]): number => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * 0.99))] ?? 0;

/** Each jet and each helicopter over the same open ground and among the same pillars, the jets turning at 150 m/s. */
function flight(section: Section, record: Row): void {
  section("Jet flight: 4 jets turning at 150 m/s against 4 helicopters, through the same terrain and solids");
  for (const [nearby, low] of [[false, false], [true, false], [false, true]] as const) {
    const dims = { chunksX: 32, chunksZ: 32 }, hf = new Heightfield(dims, 2, -16, 1 / 256); hf.heights.fill(4096);
    const structs = new StructureStore(dims, new Float32Array([0, .12]), new Float32Array([0, 1.2]), new Float32Array([0, .12]));
    const jets: JetState[] = [], helis: HelicopterState[] = [];
    for (let i = 0; i < 4; i++) {
      // Low, the jets skim 8 m over the ground.
      const x = 500 + i * 300, z = 1000, y = low ? 8 : 60;
      jets.push({ ...createJet(JET, x, y, z), grounded: false, engineOn: true, vz: 150, gear: 0, nozzle: 0, spool: 1, throttle: 1 });
      helis.push(Object.assign(createHelicopter(HELICOPTER, x, 12, 200 + i * 56), { grounded: false, engineOn: true, rotorRpm: HELICOPTER.rotorRpm, collective: HELICOPTER.mass / HELICOPTER.liftMass }));
      // Pillars beside each one's way: their broad phase is met, their solids not.
      if (nearby) for (let k = 0; k < 40; k++) for (const side of [-1, 1]) structs.add(1, x + side * 14, y, z + k * 40, 0, 0, 100);
      if (nearby) for (const sx of [-1, 1]) for (const sz of [-1, 1]) structs.add(1, x + sx * 4.25, 15.15, 200 + i * 56 - .3 + sz * 4.25, 0, 0, 100);
    }
    const jw = new StaticJetWorld({ hf, structs }), hw = new StaticHelicopterWorld({ hf, structs });
    const idle: HelicopterInput = { right: 0, forward: 0, yaw: 0, climb: 0, brake: false, cruise: false, direct: false, pilot: true };
    const jetTimes: number[] = [], heliTimes: number[] = [];
    for (let tick = 0; tick < 900; tick++) {
      // A slow weave about the heading, so the controls bank and pull and the substeps follow the turn.
      const input: JetInput = { throttle: 1, roll: 0, aimYaw: Math.sin(tick / 60) * .6, aimPitch: .02, climb: 0, afterburner: true, airbrake: false, vtol: false, pilot: true };
      let t = performance.now();
      for (const s of jets) {
        if (low) input.aimPitch = Math.max(-.08, Math.min(.08, (8 - s.y) * .01 - s.vy * .01));
        stepJet(s, input, JET_VEHICLE, jw);
      }
      const jet = performance.now() - t;
      t = performance.now();
      for (const s of helis) stepHelicopter(s, idle, HELICOPTER_VEHICLE, hw);
      const heli = performance.now() - t;
      if (tick >= 120) { jetTimes.push(jet); heliTimes.push(heli); }
      // Back over the same ground before the edge.
      for (const s of jets) if (s.z > 1700) s.z -= 600;
    }
    const name = low ? "8 m over the ground" : nearby ? "among pillars" : "open air";
    record(`${name}: 4 jets a tick, median`, median(jetTimes), "ms");
    record(`${name}: 4 jets a tick, p99`, high(jetTimes), "ms", 1.25);
    record(`${name}: a jet's step, median`, median(jetTimes) * 1000 / 4, "us");
    record(`${name}: a helicopter's step, median`, median(heliTimes) * 1000 / 4, "us");
    record(`${name}: a jet's step over a helicopter's`, (median(jetTimes) - median(heliTimes)) * 1000 / 4, "us", 0);
  }
}

/** The seeker over a 16 km world of 30,000 creatures, a twentieth of them flying, looking every way. */
function scan(section: Section, record: Row): void {
  section("Jet seeker: one scan among 30,000 creatures on a 16 km map");
  const reg = compileContent(CORE_CONTENT).registry!;
  const dims = { chunksX: 250, chunksZ: 250 }, hf = new Heightfield(dims, 8, -16, 1 / 64);
  hf.heights.fill(16 * 64);
  const structs = new StructureStore(dims, new Float32Array([0]), new Float32Array([0]), new Float32Array([0]));
  const ents = new EntityStore(dims, 32768, 32768, reg.vehicle);
  const rng = new Rng(5), size = 250 * 64, raptor = reg.index.get("core:raptor")!, ptera = reg.index.get("core:pteranodon") ?? raptor;
  for (let i = 0; i < 30000; i++) {
    const flyer = i % 20 === 0, e = ents.create(flyer ? ptera : raptor, rng.range(0, size), flyer ? rng.range(40, 200) : 0, rng.range(0, size), 0);
    if (flyer) ents.mode[e] = MODE_FLYER;
  }
  const world = { hf, structs, ents, reg, dims }, sky = new Sky(), out: LockPick = { entity: -1, gen: 0, sky: null, x: 0, y: 0, z: 0, angle: 0 };
  const times: number[] = [], chunks: number[] = [], casts: number[] = [];
  for (let k = 0; k < 2000; k++) {
    const ox = rng.range(2000, size - 2000), oz = rng.range(2000, size - 2000), yaw = rng.range(0, Math.PI * 2), pitch = rng.range(-.3, .3);
    const t = performance.now();
    scanLock(world, sky, 1, ox, 150, oz, Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch), .26, 1800, -1, -1, out);
    if (k >= 200) { times.push(performance.now() - t); chunks.push(lockScan.chunks); casts.push(lockScan.casts); }
  }
  record("a scan, median", median(times), "ms", .05);
  record("a scan, p99", high(times), "ms");
  record("chunks it looks in, median", median(chunks), "");
  record("world casts it makes, median", median(casts), "");
}

/** A craft in the sky that runs from the nose at 200 m/s: a missile chases it its whole life. */
function runner(start: number, x: number, z: number): SkyTarget {
  const where = (t: number, o: SkyPoint): void => { o.x = x; o.y = 300; o.z = z + 900 + (t - start) * 200 / TICK_RATE; o.vx = o.vy = 0; o.vz = 200; };
  const NONE: SkyTaken = { taken: 0, blocked: false, killed: false };
  return {
    name: "bench craft", lockable: true, radius: 10,
    at(t, o) { where(t, o); return true; },
    ray: () => Infinity,
    gap(px, py, pz, t) { const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }; where(t, p); return Math.hypot(px - p.x, py - p.y, pz - p.z) - 10; },
    take: () => NONE,
  };
}

/** A small world of 50 survivors about a middle, as the firefight's, built in a second. */
function fightWorld(): { host: Host; run: (ticks: number, times: number[] | null) => void; centre: readonly [number, number]; clients: () => Client[] } {
  const dims = { chunksX: 16, chunksZ: 16 }, rules = new Rules();
  const reg = contentFor(compileContent(CORE_CONTENT).registry!, rules);
  const hf = new Heightfield(dims, TERRAIN_CELL, -32, 1 / 64);
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) hf.heights[j * hf.nx + i] = Math.round((40 + 6 * Math.sin((i * hf.cell) / 90) * Math.cos((j * hf.cell) / 70) + 32) * 64);
  hf.tint.fill(12);
  const world = createWorld(reg, dims, hf, "bench:jet", hashBytes(new Uint8Array(hf.heights.buffer, 0, 4096)), { x: 512, z: 512, yaw: 0 }, 16384);
  const host = createHost(reg, { world, config: rules, game: { maxClients: 64 }, hangar: null });
  const centre = [480, 512] as const, net = new LoopbackNet(7), stood = new Rng(12);
  host.game.sessions.listen(net);
  const places = new Map<string, { x: number; y: number; z: number; yaw: number }>();
  for (let i = 0; i < 50; i++) {
    const x = centre[0] + 26 + stood.range(0, 40), z = centre[1] + stood.range(-20, 20);
    places.set(`bot${i}`, { x, y: hf.heightAt(x, z), z, yaw: 0 });
  }
  host.game.sessions.savedPosition = (name) => places.get(name) ?? null;
  const bots: Bot[] = [];
  for (let i = 0; i < 50; i++) bots.push(new Bot(net, `bot${i}`, reg.baseHash, 100 + i));
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
  run(300, null);
  world.anim = new HumanAnim(parsePack(buildCorePack()).clips);
  return { host, run, centre, clients: () => host.game.clients.filter((c): c is Client => !!c?.active && c.ent >= 0) };
}

/** One of the 50 at a jet's controls, its buttons held as `buttons()` says; the weapons' step timed into `times`. */
function pilotJet(host: Host, c: Client, x: number, z: number, buttons: () => number, times: number[]): number {
  const e = host.spawnVehicle("core:jet", x, z, 0, 0);
  if (e < 0) throw new Error("no room for the bench's jet");
  const entry = JET_VEHICLE.seats[0]!.entry, ents = host.world.ents;
  ents.setPosition(c.ent, x + entry[0], host.world.hf.heightAt(x, z), z + entry[2]);
  if (host.urban.mount(c, e) !== 0) throw new Error("the bench's pilot did not get in");
  const weapons = host.vehicleWeapons, step = weapons.step.bind(weapons);
  weapons.step = () => {
    if (c.drive === e) { c.heldButtons = buttons(); c.inputAt = host.world.tick; }
    const t = performance.now();
    step();
    times.push(performance.now() - t);
  };
  return e;
}

/** The weapons' step with a pilot holding nothing, then the cannon held, a lock held and a missile let go each time it forms. */
function weapons(section: Section, record: Row, f: ReturnType<typeof fightWorld>): void {
  section("Jet weapons: a pilot among the fight, idle, then the cannon, the seeker and six missiles at once");
  const { host, run, centre } = f, pilot = f.clients()[0]!;
  let held = 0;
  const times: number[] = [];
  pilotJet(host, pilot, centre[0] - 60, centre[1] - 200, () => held, times);
  run(60, null);
  times.length = 0;
  run(300, null);
  record("idle: the weapons' step, median", median(times), "ms", .002);
  record("idle: the weapons' step, p99", high(times), "ms");
  const sky = host.combat.sky, craft = runner(host.world.tick, centre[0] - 60, centre[1] - 200);
  sky.add(craft);
  let most = 0, tick = 0;
  const busy: number[] = [];
  // Every 46 ticks: 45 held to lock, then let go to fire.
  const busyButtons = (): number => (tick++ % 46 === 45 ? BTN_PRIMARY : BTN_PRIMARY | BTN_SECONDARY);
  held = 0;
  const step = host.vehicleWeapons.step;
  host.vehicleWeapons.step = () => { held = busyButtons(); step(); most = Math.max(most, host.vehicleWeapons.flying.length); };
  times.length = 0;
  run(46 * 6 + 120, null);
  busy.push(...times.slice(46 * 5));
  sky.remove(craft);
  record("missiles in the air at once, most", most, "");
  record("cannon, seeker and missiles: the weapons' step, median", median(busy), "ms", .1);
  record("cannon, seeker and missiles: the weapons' step, p99", high(busy), "ms", .3);
  record("cannon rounds fired", host.vehicleWeapons.rounds, "");
}

/** The fight's rows with and without a jet at full speed in the history every rewound shot pads its search by. */
function rewind(section: Section, record: Row, f: ReturnType<typeof fightWorld>, jet: boolean): Map<string, number> {
  const { host, run, centre } = f, rows = new Map<string, number>();
  const capture: Row = (name, value) => void rows.set(name, value);
  const ents = host.world.ents;
  let e = -1, angle = 0;
  if (jet) {
    e = host.spawnVehicle("core:jet", centre[0], centre[1] + 300, 0, 0);
    if (e < 0) throw new Error("no room for the bench's fast jet");
  }
  const tick = host.game.tick.bind(host.game);
  // Round a 400 m circle 250 m up at 160 m/s, a tick at a time: the history sees it go 5.3 m each.
  host.game.tick = () => {
    if (e >= 0) {
      angle += 160 / 400 / TICK_RATE;
      ents.setPosition(e, centre[0] + Math.sin(angle) * 400, 290, centre[1] + Math.cos(angle) * 400);
      ents.vx[e] = Math.cos(angle) * 160; ents.vz[e] = -Math.sin(angle) * 160; ents.vy[e] = 0;
    }
    tick();
  };
  benchFirefight(() => {}, capture, host, centre, run, [ASSAULT_RIFLE]);
  host.game.tick = tick;
  section(jet ? "Rewind: the fight with a jet at 160 m/s in the history" : "Rewind: the fight with nothing fast in the history");
  return rows;
}

/** What 16 far entities in every view add to the snapshots of the 50. */
function far(section: Section, record: Row, f: ReturnType<typeof fightWorld>): void {
  section("Far view: 16 far entities put in the views of the 50");
  const { host, run, centre } = f, ents: number[] = [];
  for (let k = 0; k < 16; k++) {
    const e = host.spawnVehicle("core:helicopter", centre[0] - 400 + (k % 4) * 60, centre[1] - 380 + Math.floor(k / 4) * 60, 0, 0);
    if (e >= 0) ents.push(e);
  }
  const step = host.vehicleWeapons.step;
  let on = false;
  host.vehicleWeapons.step = () => { step(); if (on) for (const e of ents) host.game.replication.far(e, 2000); };
  const without: number[] = [], withFar: number[] = [];
  for (let turn = 0; turn < 6; turn++) {
    on = turn % 2 === 1;
    run(30, null);
    run(150, on ? withFar : without);
  }
  const clients = f.clients().length;
  record("far entities put in", ents.length, "");
  record("tick, without them, median", median(without), "ms");
  record("tick, with them, median", median(withFar), "ms");
  record("what they add to each snapshot", (median(withFar) - median(without)) * 1000 / clients, "us", 3);
  host.vehicleWeapons.step = step;
}

/** All the jet's rows, or one part of them: flight, scan, weapons or rewind. */
export function benchJets(section: Section, record: Row, part?: string): void {
  if (!part || part === "flight") flight(section, record);
  if (!part || part === "scan") scan(section, record);
  if (part === "flight" || part === "scan") return;
  if (!part || part === "weapons") {
    const fight = fightWorld();
    weapons(section, record, fight);
    far(section, record, fight);
    fight.host.shutdown();
  }
  if (part === "weapons") return;
  const plain = fightWorld(), without = rewind(section, () => {}, plain, false);
  plain.host.shutdown();
  const fast = fightWorld(), withJet = rewind(section, () => {}, fast, true);
  fast.host.shutdown();
  section("Rewind: what a jet at 160 m/s adds to a fight of 50 with the assault rifle");
  const key = (row: string): string => `${ASSAULT_RIFLE.label}: ${row}`;
  for (const row of ["tick and its shots, median", "tick and its shots, 99th percentile", "of a shot, the bodies cast against"]) {
    record(`without the jet: ${row}`, without.get(key(row)) ?? NaN, row.startsWith("of") ? "us" : "ms");
    record(`with the jet: ${row}`, withJet.get(key(row)) ?? NaN, row.startsWith("of") ? "us" : "ms");
  }
  record("the jet adds to the tick, median", (withJet.get(key("tick and its shots, median")) ?? NaN) - (without.get(key("tick and its shots, median")) ?? NaN), "ms", .15);
  record("the jet adds to the tick, p99", (withJet.get(key("tick and its shots, 99th percentile")) ?? NaN) - (without.get(key("tick and its shots, 99th percentile")) ?? NaN), "ms", .5);
}

if (import.meta.main) {
  const rows: { value: number; budget: number | null }[] = [];
  const record: Row = (name, value, unit, budget = null) => {
    rows.push({ value, budget });
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    console.log(`  ${name.padEnd(62)} ${value.toFixed(value < 10 ? 4 : 1).padStart(12)} ${unit}${verdict}`);
  };
  const only = process.argv.indexOf("--only"), part = only >= 0 ? process.argv[only + 1] : undefined;
  benchJets((title) => console.log(`\n${title}`), record, part);
  process.exit(rows.some((r) => r.budget !== null && r.value > r.budget) ? 1 : 0);
}
