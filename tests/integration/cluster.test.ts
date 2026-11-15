// Servers of one cluster, two or three in one process with one folder: survivors travel between them with what they carry,
// and nothing is lost or made twice whichever server stops, is restored from a backup, or is raced (planning/architecture/transfers.md).

import { afterAll, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { auditCluster } from "../../server/cluster/audit.ts";
import { TICKET_SECONDS } from "../../server/cluster/cluster.ts";
import { ClusterFolder } from "../../server/cluster/folder.ts";
import { hex, openParcel, parcelRecords, sealParcel, PARCEL_FORMAT, type ParcelHead } from "../../server/cluster/parcel.ts";
import type { HostOptions } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { pidWorld } from "../../shared/ids.ts";
import { CMD_TRAVEL, REJECT_FULL, REJECT_TRAVEL, RESULT_DENIED } from "../../shared/net/protocol.ts";
import { Rng } from "../../shared/rng.ts";
import { rollWild } from "../../shared/sim/genome.ts";
import { FLAG_BLUEPRINT } from "../../shared/sim/items.ts";
import { V_FOOD } from "../../shared/sim/vitals.ts";
import { Harness, testKey } from "../fixtures/net.ts";
import { coreRegistry } from "../fixtures/world.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-cluster-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;

/** The wall clock every server of a test reads. */
interface Clock {
  ms: number;
}

interface Server {
  h: Harness;
  log: string[];
  db: string;
  world: number;
}

/** A server of the cluster in `folder`, named `name`, with its save in the test folder. */
function server(name: string, folder: string, clock: Clock, opts: { argv?: string[]; host?: HostOptions; reg?: Registry; maxClients?: number } = {}): Server {
  const log: string[] = [];
  const db = join(dir, `${folder}-${name}.db`);
  const { rules } = loadConfig({}, ["-clusterid=test", `-ClusterDirOverride=${join(dir, folder)}`, `?SessionName=${name}`, ...(opts.argv ?? [])]);
  const h = new Harness(opts.maxClients ? { maxClients: opts.maxClients } : {}, 1, 60, { dbPath: db, config: rules, log: (line) => log.push(line), ...opts.host }, opts.reg ?? reg);
  const cluster = h.host.cluster!;
  cluster.now = () => clock.ms;
  cluster.listening(0, "");
  return { h, log, db, world: cluster.world };
}

/** A server stopped as by a crash: nothing more is written, and what it had not committed is lost. */
function crash(s: Server): void {
  s.h.host.persistence!.close();
  s.h.host.cluster!.stop();
}

/** The same server started again on its save. */
function restart(s: Server, name: string, folder: string, clock: Clock, opts: Parameters<typeof server>[3] = {}): Server {
  return server(name, folder, clock, opts);
}

function rec(s: Server, name: string): EntityRecord | undefined {
  const pid = s.h.host.persistence!.survivors.get(name);
  return pid === undefined ? undefined : s.h.host.records.byPid.get(pid);
}

/** Asks to travel to world `to`. Returns the ticket the server sent, or the code it refused with. */
function travel(s: Server, session: ClientSession, to: number): Uint8Array | number {
  let code = -1;
  session.onResult = (seq, c) => void (seq !== 0 && (code = c));
  session.command(CMD_TRAVEL, (w) => w.u16(to));
  s.h.run(400);
  return session.travelled ? session.travelled.ticket : code;
}

function audit(...servers: Server[]): string[] {
  const a = auditCluster(servers[0]!.h.host.cluster!.folder, reg);
  return a.ok ? [] : a.lines;
}

function commit(...servers: Server[]): void {
  for (const s of servers) s.h.host.persistence!.commit();
}

const keyAt = (name: string, world: number): Uint8Array => testKey(`${name}@${world}`);

test("a survivor goes from one map to another and back with its level, engrams, look, tribe and all it carries, while its base and tames stay", () => {
  const clock = { ms: Date.now() };
  const a = server("Island", "trip", clock);
  const b = server("Miami", "trip", clock);
  expect([a.world, b.world]).toEqual([1, 2]);
  const ada = a.h.join("ada", {}, { key: keyAt("ada", 1) });
  a.h.run(300);
  const me = rec(a, "ada")!;
  const { items, tribes, records } = a.h.host;
  expect(tribes.create(me, "Raptors")).toBe("");
  const team = me.team;
  expect(Math.floor(team / (1 << 20))).toBe(1);
  me.xp = 12345;
  me.engrams.push(id("engram-waterskin"));
  const look = me.look!.slice();
  items.mint(me, id("stone"), 40);
  items.mint(me, id("hatchet"), 1, 3);
  const inv = items.inv(me);
  const hatchet = inv.item.indexOf(id("hatchet"));
  items.wear(me, hatchet, 7);
  items.mint(me, id("hatchet"), 1, 2, 0, -1, "", FLAG_BLUEPRINT);
  items.mint(me, id("berry"), 10);
  const berry = inv.item.indexOf(id("berry"));
  const spoilLeft = inv.spoilAt[berry]! - a.h.world.tick;
  // A fertilised egg taken up: its item stands for its record, which goes with it.
  const egg = records.create(id("egg_dodo"), "dodo egg");
  egg.genome = rollWild(new Rng(5), 5, reg.colorSet[id("dodo")]!);
  egg.x = a.h.world.ents.x[a.h.ent(ada)]! + 1;
  egg.z = a.h.world.ents.z[a.h.ent(ada)]!;
  egg.y = a.h.world.hf.heightAt(egg.x, egg.z);
  egg.egg = { species: id("dodo"), span: 9000, hatchAt: a.h.world.tick + 9000, carrier: 0 };
  a.h.host.death.place(egg);
  expect(a.h.host.eggs.takeUp(me, egg)).toBe(0);
  const eggLeft = egg.egg.hatchAt;
  // A base and a tame stay behind, the tribe's.
  const wall = a.h.world.structs.add(id("wall"), 250, 1.5, 230, 0, team, 500);
  const pet = a.h.host.records.byPid.get(a.h.world.ents.pid[a.h.host.spawnCreature("core:dodo", 240, 240, 4)]!)!;
  pet.team = team;
  a.h.run(300);
  const carried = new Map(items.held(me));
  const pid = me.pid;
  expect(audit(a, b)).toEqual([]);

  const ticket = travel(a, ada, b.world);
  expect(ticket).toBeInstanceOf(Uint8Array);
  expect([records.byPid.has(pid), records.byPid.has(egg.pid), ada.state]).toEqual([false, false, "closed"]);
  expect(items.audit()).toEqual([]);
  // Away from the island, the tribe there lists nobody and is gone; its base and tame keep their team.
  expect([tribes.byId.has(team), a.h.world.structs.chunks[Math.floor(wall / 65536)]!.owner[wall & 0xffff], pet.team]).toEqual([false, team, team]);
  commit(a, b);
  expect(audit(a, b)).toEqual([]);

  clock.ms += 30_000;
  const there = b.h.join("ada", {}, { key: keyAt("ada", 2), ticket: ticket as Uint8Array });
  b.h.run(400);
  expect(there.state).toBe("active");
  const at = rec(b, "ada")!;
  expect([at.pid, at.xp, at.engrams.includes(id("engram-waterskin")), [...at.look!], at.team]).toEqual([pid, 12345, true, [...look], team]);
  expect(b.h.host.tribes.of(at)).toMatchObject({ id: team, name: "Raptors", owner: pid });
  const binv = b.h.host.items.inv(at);
  expect(new Map(b.h.host.items.held(at))).toEqual(carried);
  const h2 = binv.item.indexOf(id("hatchet"));
  expect([binv.quality[h2], binv.dur[h2]]).toEqual([3, inv.dur[hatchet]!]);
  expect(binv.flags.includes(FLAG_BLUEPRINT)).toBe(true);
  // The berries spoil on: what was left less the half minute in transit.
  const b2 = binv.item.indexOf(id("berry"));
  expect(Math.abs(binv.spoilAt[b2]! - b.h.world.tick - (spoilLeft - 30 * TICK_RATE))).toBeLessThanOrEqual(TICK_RATE);
  const held = b.h.host.records.byPid.get(egg.pid)!;
  expect([held.egg!.carrier, held.egg!.hatchAt, binv.ref![binv.item.indexOf(id("dodo_egg_fertile"))]]).toEqual([egg.pid, eggLeft, egg.pid]);
  // Where it arrives is the map's spawn point.
  expect(Math.hypot(b.h.world.ents.x[b.h.ent(there)]! - b.h.world.spawn.x, b.h.world.ents.z[b.h.ent(there)]! - b.h.world.spawn.z)).toBeLessThan(8);
  expect(b.h.host.items.audit()).toEqual([]);
  commit(a, b);
  expect(audit(a, b)).toEqual([]);

  // And back, with the egg and all.
  b.h.run(1000);
  const back = travel(b, there, a.world);
  expect(back).toBeInstanceOf(Uint8Array);
  commit(a, b);
  const home = a.h.join("ada", {}, { key: keyAt("ada", 1), ticket: back as Uint8Array });
  a.h.run(400);
  expect(home.state).toBe("active");
  const again = rec(a, "ada")!;
  expect([again.pid, again.xp, again.team, again.rank]).toEqual([pid, 12345, team, 2]);
  expect(new Map(items.held(again))).toEqual(carried);
  expect(tribes.of(again)).toMatchObject({ id: team, name: "Raptors", owner: pid });
  expect(a.h.host.tribes.may(again, a.h.world.structs.chunks[Math.floor(wall / 65536)]!.owner[wall & 0xffff]!)).toBe(true);
  expect(a.h.host.tribes.may(again, pet.team)).toBe(true);
  commit(a, b);
  expect(audit(a, b)).toEqual([]);
  // Both saves record both transfers, each a burn on leaving and a mint on arriving.
  expect(a.h.host.persistence!.transferRows.map((t) => t.dir)).toEqual([0, 1]);
  expect(b.h.host.persistence!.transferRows.map((t) => t.dir)).toEqual([1, 0]);
  expect(items.sent[id("stone")]).toBe(40);
  expect(items.received[id("stone")]).toBe(40);
  a.h.host.shutdown();
  b.h.host.shutdown();
});
