// Servers of one cluster in one process, sharing a folder under a test's own temporary folder, on a wall clock the test moves.

import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientSession } from "../../client/core/session.ts";
import { auditCluster } from "../../server/cluster/audit.ts";
import type { ClusterFolder } from "../../server/cluster/folder.ts";
import { openParcel } from "../../server/cluster/parcel.ts";
import type { HostOptions } from "../../server/host.ts";
import type { EntityRecord } from "../../server/records.ts";
import { loadConfig } from "../../server/settings/config.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { CMD_RESPAWN, CMD_TRAVEL } from "../../shared/net/protocol.ts";
import { TRAVEL_TERMINAL } from "../../shared/world/obelisks.ts";
import { Harness, asShipped, testKey } from "./net.ts";
import { coreRegistry } from "./world.ts";

/** The wall clock every server of a test reads. */
export interface Clock {
  ms: number;
}

export interface Server {
  h: Harness;
  log: string[];
  db: string;
  world: number;
  name: string;
  folder: string;
}

export interface ServerOptions {
  argv?: string[];
  host?: HostOptions;
  reg?: Registry;
  maxClients?: number;
  /** Its rules as the server ships them, with the suit at spawn and everyone's cheats (asShipped). */
  shipped?: boolean;
}

/** The key a page at world `world` has for `name`: two servers are two origins, and a browser has a key for each. */
export const keyAt = (name: string, world: number): Uint8Array => testKey(`${name}@${world}`);

export class TestCluster {
  readonly dir = mkdtempSync(join(tmpdir(), "snark-cluster-"));
  readonly reg = coreRegistry();

  /** Deletes every save and folder. */
  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  id(name: string): number {
    return this.reg.index.get(`core:${name}`)!;
  }

  /** A server of the cluster in folder `folder`, named `name`, with its save in the test folder. */
  server(name: string, folder: string, clock: Clock, opts: ServerOptions = {}): Server {
    const log: string[] = [];
    const db = join(this.dir, `${folder}-${name}.db`);
    const { rules } = loadConfig({}, ["-clusterid=test", `-ClusterDirOverride=${join(this.dir, folder)}`, `?SessionName=${name}`, ...(opts.argv ?? [])]);
    if (opts.shipped) asShipped(rules);
    const h = new Harness(opts.maxClients ? { maxClients: opts.maxClients } : {}, 1, 60, { dbPath: db, config: rules, log: (line) => log.push(line), ...opts.host }, opts.reg ?? this.reg);
    const cluster = h.host.cluster!;
    cluster.now = () => clock.ms;
    cluster.listening(0, "");
    return { h, log, db, world: cluster.world, name, folder };
  }

  /** A copy of the save as it is at its last commit, as a backup holds it. */
  backup(s: Server, as: string): string {
    const path = join(this.dir, as);
    s.h.host.persistence!.store.db.query("VACUUM INTO ?").run(path);
    return path;
  }

  /** Stops `s` as by a crash, puts `backup` in place of its save, and starts it again. */
  restore(s: Server, backup: string, clock: Clock, opts: ServerOptions = {}): Server {
    crash(s);
    for (const end of ["-wal", "-shm"]) rmSync(`${s.db}${end}`, { force: true });
    copyFileSync(backup, s.db);
    return this.server(s.name, s.folder, clock, opts);
  }

  /** Commits every server named, then asks whether the cluster balances. The lines that say it does not, or none. */
  audit(...servers: Server[]): string[] {
    commit(...servers);
    const a = auditCluster(servers[0]!.h.host.cluster!.folder, this.reg);
    return a.ok ? [] : a.lines;
  }

  /** Joins `name` on `s` with the key that page has, and makes a survivor carrying 40 stone and a hatchet. */
  survivor(s: Server, name: string): { session: ClientSession; me: EntityRecord } {
    const session = s.h.join(name, {}, { key: keyAt(name, s.world) });
    s.h.run(300);
    const me = rec(s, name)!;
    s.h.host.items.mint(me, s.h.reg.index.get("core:stone")!, 40);
    s.h.host.items.mint(me, s.h.reg.index.get("core:hatchet")!, 1, 3);
    s.h.run(100);
    return { session, me };
  }
}

/** A server stopped as by a crash: what it had not committed is lost, and it writes nothing more. */
export function crash(s: Server): void {
  s.h.host.persistence!.close();
  s.h.host.cluster!.stop();
}

/** Each server says it is running and looks at what it sent, as it does every few seconds. */
export function beat(...servers: Server[]): void {
  for (const s of servers) s.h.host.cluster!.step(0);
}

export function commit(...servers: Server[]): void {
  for (const s of servers) s.h.host.persistence!.commit();
}

export function rec(s: Server, name: string): EntityRecord | undefined {
  const pid = s.h.host.persistence!.survivors.get(name);
  return pid === undefined ? undefined : s.h.host.records.byPid.get(pid);
}

/** Sets `session`'s body down `dx`, `dz` metres from where it stands, and says where it stands then. */
export function shift(s: Server, session: ClientSession, dx: number, dz: number): [number, number] {
  const ents = s.h.world.ents;
  const e = s.h.ent(session);
  const x = ents.x[e]! + dx;
  const z = ents.z[e]! + dz;
  ents.setPosition(e, x, s.h.world.hf.heightAt(x, z), z);
  s.h.run(200);
  const now = s.h.ent(session);
  return [ents.x[now]!, ents.z[now]!];
}

/** How far `session`'s body stands from `at`, on the ground's plane. */
export function from(s: Server, session: ClientSession, at: readonly number[]): number {
  const e = s.h.ent(session);
  return Math.hypot(s.h.world.ents.x[e]! - at[0]!, s.h.world.ents.z[e]! - at[1]!);
}

/** Sets a travel terminal down two metres in front of `session`'s body, as a map's obelisk has one, and gives its ref. */
export function terminal(s: Server, session: ClientSession): number {
  const reg = s.h.reg;
  const kind = reg.index.get(TRAVEL_TERMINAL)!;
  const e = s.h.ent(session);
  const x = s.h.world.ents.x[e]!;
  const z = s.h.world.ents.z[e]! + 2;
  return s.h.world.structs.add(kind, x, s.h.world.hf.heightAt(x, z) + reg.halfY[kind]!, z, 0, 0, reg.maxHp[kind]!);
}

/** Asks, at the terminal `at` (one set down in front of it if not given), to travel to world `to`. The ticket, or the refusal's code. */
export function travel(s: Server, session: ClientSession, to: number, at = terminal(s, session)): Uint8Array | number {
  let code = -1;
  session.onResult = (seq, c) => void (seq !== 0 && (code = c));
  session.command(CMD_TRAVEL, (w) => {
    w.u16(to);
    w.u32(at >>> 0);
  });
  s.h.run(400);
  return session.travelled ? session.travelled.ticket : code;
}

/** A survivor that arrived chooses the `index`th place of its spawn screen and rises there. */
export function rise(s: Server, session: ClientSession, index = 0): void {
  s.h.run(200);
  session.command(CMD_RESPAWN, (w) => (w.u8(index), w.u8(session.placesList)));
  s.h.run(300);
}

/** Where record `pid` is among the running servers and the files still sealed: exactly one place, when nothing is lost or doubled. */
export function places(pid: number, folder: ClusterFolder, ...servers: Server[]): string[] {
  const out: string[] = [];
  for (const s of servers) if (s.h.host.records.byPid.has(pid)) out.push(`world ${s.world}`);
  for (const p of folder.places()) if (p.by === 0 && openParcel(folder.read(p)!).head.pids.includes(pid)) out.push("sealed");
  return out;
}
