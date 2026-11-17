// Eight driven cars collide with 32 creatures in their lanes alongside 16 impact-launched parasaur corpses.
// Host timings exclude client prediction/rendering; memory includes the eight loopback clients.
// Run separately from parallel test/build jobs: bun tools/bench/collision.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { parsePack } from "../../shared/pack/pack.ts";
import { joinClips } from "../../shared/anim/clip.ts";
import { hashBytes } from "../../shared/hash.ts";
import { makeHandle } from "../../shared/ids.ts";
import { S_CORPSE } from "../../shared/net/protocol.ts";
import type { LoopbackEnd } from "../../shared/net/loopback.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { frozenPack } from "../../tests/fixtures/pack.ts";
import { ART } from "../art/source.ts";

const percentile = (values: number[], q: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(q * values.length))]!;
export function collisionEncounter(creatureFile = join(import.meta.dir, "../../assets/source/core/creatures/parasaur/parasaur.snpk")) {
  const loadBefore = loadavg();
  const source = new Uint8Array(readFileSync(creatureFile)), creature = parsePack(source), pack = frozenPack();
  if (!creature.header.rigs.find(r => r.id === "core:parasaur")?.ragdoll) throw new Error("encounter requires the authored parasaur ragdoll");
  const old = { ...pack.clips, clips: pack.clips.clips.filter(c => !c.id.startsWith("core:parasaur/")) };
  const clips = joinClips([old, creature.clips]), rigs = [...pack.header.rigs.filter(r => r.id !== "core:parasaur"), ...creature.header.rigs];
  const h = new Harness({}, 1729, 60, { dev: true, clips, rigs, map: writeMap(flatMap(4)) });
  try {
    const sessions = Array.from({ length: 8 }, (_, i) => h.join(`collision-driver-${i}`)); h.run(600);
    const ents = h.world.ents, cars: number[] = [], creatures: number[] = [];
    for (let i = 0; i < sessions.length; i++) {
      const c = h.client(sessions[i]!)!, x = 32 + (i % 4) * 24, z = 32 + Math.floor(i / 4) * 80;
      const car = h.host.spawnVehicle("core:compact", x, z, 0); cars.push(car);
      ents.setPosition(c.ent, x + 1.8, 0, z + .12);
      h.world.history.discontinuity(c.ent);
      if (h.host.urban.mount(c, car) !== 0) throw new Error(`encounter driver ${i} could not board`);
      h.host.survival.gods.add(c.pid);
      for (let j = 0; j < 4; j++) {
        const e = h.host.spawnCreature(j % 2 ? "core:raptor" : "core:parasaur", x + (j % 2 ? .45 : -.45), z + 10 + j * 4, 40);
        h.host.creatures.mind.stay(e, 0xffffffff); creatures.push(e);
      }
      // Authored solid columns on each side of the drive lane exercise ordinary broadphase gathering.
      const pillar = h.reg.index.get("core:pillar")!;
      for (let j = 0; j < 6; j++) h.world.structs.add(pillar, x + (j % 2 ? 5 : -5), 1.5, z + 8 + j * 5, 0, 0, 10000);
    }
    h.run(1400);
    if (sessions.some((s, i) => h.client(s)!.drive !== cars[i])) throw new Error("encounter boarding did not commit");
    for (const p of h.pilots) p.moveZ = 1;
    // Warm the complete host and shared prediction path before timed impacts.
    h.run(500);
    const contactStart = h.host.urban.contacts!.contacts;
    const origins = [...cars, ...creatures].map(e => ({ e, handle: makeHandle(e, ents.gen[e]!), pid: ents.pid[e]!, x: ents.x[e]!, z: ents.z[e]!, distance: 0, damage: 0, hits: 0, touched: false, beforeContact: 0 }));
    // Four lanes also have a raptor approach under its real AI; the other 28 targets keep the original contact load.
    const approaching = Array.from({ length: 4 }, (_, i) => origins[8 + i * 4 + 3]!);
    approaching.forEach((p, i) => { const driver = h.ent(sessions[i]!); h.host.creatures.mind.provoke(p.e, ents.x[driver]!, ents.z[driver]!, driver); });
    const collisionPair = h.host.urban.collisionPair.bind(h.host.urban);
    h.host.urban.collisionPair = pair => {
      for (const p of origins) if (p.pid === pair.a.pid || p.pid === pair.b.pid) p.touched = true;
      collisionPair(pair);
    };
    const hurt = h.host.survival.hurt.bind(h.host.survival);
    h.host.survival.hurt = (rec, points, by, cause, impact) => {
      const taken = hurt(rec, points, by, cause, impact), target = origins.find(p => p.pid === rec.pid);
      if (target && taken > 0) { target.damage += taken; target.hits++; }
      return taken;
    };
    const clients = sessions.map(s => h.client(s)!), sent = clients.map(c => (c.conn as LoopbackEnd).bytesSent);
    const corpseBytes = clients.map(() => 0);
    clients.forEach((c, i) => { const send = c.conn.send.bind(c.conn); c.conn.send = (channel, bytes) => { if (bytes[0] === S_CORPSE) corpseBytes[i]! += bytes.length; send(channel, bytes); }; });
    Bun.gc(true); const memoryBefore = process.memoryUsage(), retainedBefore = memoryBefore.heapUsed;
    for (let i = 0; i < 16; i++) {
      const car = cars[i % 8]!, x = ents.x[car]! + (i < 8 ? -2 : 2), z = ents.z[car]! + 7;
      const e = h.host.spawnCreature("core:parasaur", x, z, 1), rec = h.host.records.byPid.get(ents.pid[e]!)!;
      h.host.survival.hurt(rec, 1e6, 0, undefined, { victimPid: rec.pid, victimHandle: makeHandle(e, ents.gen[e]!), vx: i % 2 ? 6 : -6, vy: 5, vz: 9, wx: .5, wy: 1, wz: 1.5 });
    }
    const times: number[] = [], contactTimes: number[] = [], activeCars: number[] = [], movingCorpses: number[] = [], liveCreatures: number[] = [];
    let peakRss = memoryBefore.rss;
    const tick = h.server.tick.bind(h.server);
    h.server.tick = () => {
      // Last completed tick before any contact, excluding the collision's correction/knockback itself.
      for (const p of origins) if (!p.touched) p.beforeContact = p.distance;
      const beforeContacts = h.host.urban.contacts!.contacts, start = performance.now(); tick();
      const elapsed = performance.now() - start; times.push(elapsed);
      if (h.host.urban.contacts!.contacts > beforeContacts) contactTimes.push(elapsed);
      for (const p of origins) if (ents.resolve(p.handle) === p.e) p.distance = Math.max(p.distance, Math.hypot(ents.x[p.e]! - p.x, ents.z[p.e]! - p.z));
      let active = 0, moving = 0, living = 0;
      for (const e of cars) if (Math.hypot(ents.vx[e]!, ents.vy[e]!, ents.vz[e]!) > .01) active++;
      for (const b of h.host.corpses.bodies.values()) if (b.moving || b.drop !== null) moving++;
      for (const e of creatures) if ((ents.flags[e]! & 1) !== 0 && h.reg.defs[ents.kind[e]!]!.type === "species") living++;
      activeCars.push(active); movingCorpses.push(moving); liveCreatures.push(living);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    };
    const seconds = 6; h.run(seconds * 1000); peakRss = Math.max(peakRss, process.memoryUsage().rss); Bun.gc(true);
    const report = {
      fixture: "g1-eight-cars-32-colliding-creatures-16-parasaur-impacts-v3", creatureHash: hashBytes(source).toString(16), machine: cpus()[0]?.model, bun: Bun.version, loadBefore, loadAfter: loadavg(),
      ticks: times.length, hostMs: { median: percentile(times, .5), p95: percentile(times, .95), p99: percentile(times, .99), max: Math.max(...times) },
      contactTicks: contactTimes.length, contactHostMs: contactTimes.length ? { median: percentile(contactTimes, .5), p95: percentile(contactTimes, .95), p99: percentile(contactTimes, .99), max: Math.max(...contactTimes) } : null,
      counts: { cars: cars.length, activeCarsMin: Math.min(...activeCars), activeCarsMedian: percentile(activeCars, .5), livingCreatureMin: Math.min(...liveCreatures), movingCorpsesMax: Math.max(...movingCorpses), movingCorpsesMedian: percentile(movingCorpses, .5) },
      interactions: { contacts: h.host.urban.contacts!.contacts - contactStart, damagedCars: origins.slice(0, 8).filter(p => p.damage > 0).length,
        damagedCreatures: origins.slice(8).filter(p => p.damage > 0).length, creatureTravelMax: Math.max(...origins.slice(8).map(p => p.distance)),
        carTravelMin: Math.min(...origins.slice(0, 8).map(p => p.distance)), approachingContacts: approaching.filter(p => p.touched && p.beforeContact > .5).length,
        approachTravelMin: Math.min(...approaching.map(p => p.beforeContact)), hits: origins.filter(p => p.hits).map(p => ({ pid: p.pid, damage: p.damage, hits: p.hits, distance: p.distance })) },
      clients: clients.map((c, i) => ({ bytesPerSecond: ((c.conn as LoopbackEnd).bytesSent - sent[i]!) / seconds, corpseBytes: corpseBytes[i] })),
      // Bun's heapUsed describes the last collection, so an uncollected sample is not an allocation high-water mark.
      memoryBytes: { retainedHeapGrowth: process.memoryUsage().heapUsed - retainedBefore, sampledProcessRssGrowth: peakRss - memoryBefore.rss }, faults: h.server.stats.faults,
    };
    return report;
  } finally { h.host.shutdown(); }
}
export function benchCollision(section: (title: string) => void, record: (name: string, value: number, unit: string, budget?: number | null) => void, creatureFile?: string) {
  if (!ART && creatureFile === undefined) {
    section("Collision encounter: skipped, authored ragdolls require assets (ART)");
    return null;
  }
  section("Collision encounter: eight driven cars, 32 creatures and 16 impact-launched parasaur bodies");
  const report = collisionEncounter(creatureFile);
  const dir = join(import.meta.dir, "../../artifacts"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "collision-encounter.json"), JSON.stringify(report, null, 2) + "\n");
  if (report.faults || report.interactions.contacts < 8 || report.interactions.damagedCreatures < 8 || report.interactions.creatureTravelMax < .5 || report.interactions.carTravelMin < 3 || report.counts.movingCorpsesMax < 16 || report.interactions.approachingContacts < 4) throw new Error("collision encounter workload invalid; see artifacts/collision-encounter.json");
  record("collision encounter: host tick, median", report.hostMs.median, "ms", 8);
  record("collision encounter: host tick, p99", report.hostMs.p99, "ms", 16);
  record("collision encounter: contacts", report.interactions.contacts, "");
  record("collision encounter: approaching creatures hit", report.interactions.approachingContacts, "");
  record("collision encounter: least travel before contact", report.interactions.approachTravelMin, "m");
  return report;
}
if (import.meta.main) {
  const arg = process.argv.indexOf("--creature-pack");
  const report = benchCollision(console.log, (name, value, unit, budget) => {
    console.log(`${name}: ${value.toFixed(3)} ${unit}${budget == null ? "" : ` (budget ${budget})`}`);
    if (budget != null && value > budget) process.exitCode = 1;
  }, arg >= 0 ? process.argv[arg + 1] : undefined);
  if (report) console.log(JSON.stringify(report, null, 2));
}
