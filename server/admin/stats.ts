// What the admin page says of a server's health, read from what the process already holds: the loop's timing (meter.ts),
// survivors online, bodies in the world by kind, memory, the save and its backups, the map, the settings not at their
// default and what modules cost. Nothing here writes to the world.

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Backup, Bodies, LogState, ModuleCost, SaveState, Stats } from "../../shared/admin.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { F_ALIVE, F_PLAYER, F_PROP } from "../../shared/sim/entities.ts";
import { mapLabel } from "../cluster/cluster.ts";
import type { Host } from "../host.ts";
import { backupsFolder } from "../persist/backup.ts";
import { changedSettings } from "../settings/rules.ts";
import { TICK_MS, type Gauges, type TickMeter } from "./meter.ts";

/** The group a body is counted in, by what its kind is. */
function groupOf(def: { type: string; class?: string } | null | undefined, flags: number, team: number): string {
  if ((flags & F_PLAYER) !== 0) return "survivors";
  if (!def) return "other";
  if (def.type === "species") {
    if (def.class === "creature") return team === 0 ? "wild creatures" : "tamed creatures";
    return `${def.class}s`;
  }
  if ((flags & F_PROP) !== 0 && def.class) return `${def.class}s`;
  return def.type;
}

/** Every body in the world counted: one pass over the entity slots, about a microsecond a hundred of them. */
export function bodiesOf(host: Host): Bodies {
  const { ents, reg } = host.world;
  const byKind = new Map<number, number>();
  const groupOfKind = new Map<number, string>();
  const groups: Record<string, number> = {};
  for (let e = 0; e < ents.cap; e++) {
    const flags = ents.flags[e]!;
    if ((flags & F_ALIVE) === 0) continue;
    const kind = ents.kind[e]!;
    const group = groupOf(reg.defs[kind] as { type: string; class?: string } | null, flags, ents.team[e]!);
    groups[group] = (groups[group] ?? 0) + 1;
    // A kind is listed under the group of its first body; a creature's tamed and wild are one kind.
    const key = kind * 2 + (group === "tamed creatures" ? 1 : 0);
    byKind.set(key, (byKind.get(key) ?? 0) + 1);
    if (!groupOfKind.has(key)) groupOfKind.set(key, group);
  }
  const kinds = [...byKind].map(([key, n]) => ({ id: reg.ids[key >> 1] ?? "?", group: groupOfKind.get(key)!, n })).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
  return { count: ents.count, max: ents.max, reserve: ents.reserve, refused: ents.refused, groups, kinds };
}

const BACKUP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-t(\d+)$/;

/** The backups beside a save, newest first, read again only when their folder changed. */
export class BackupList {
  private stamp = -1;
  private list: Backup[] = [];

  read(dbPath: string): Backup[] {
    const folder = backupsFolder(dbPath);
    const stamp = existsSync(folder) ? statSync(folder).mtimeMs : 0;
    if (stamp === this.stamp) return this.list;
    this.stamp = stamp;
    this.list = [];
    for (const name of stamp === 0 ? [] : readdirSync(folder)) {
      const m = BACKUP.exec(name);
      const file = join(folder, name, "world.db");
      if (!m || !existsSync(file)) continue;
      this.list.push({ name, at: Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`), tick: Number(m[5]), bytes: statSync(file).size });
    }
    this.list.sort((a, b) => b.at - a.at);
    return this.list;
  }
}

function fileBytes(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

export function saveOf(host: Host, backups: BackupList): SaveState | null {
  const p = host.persistence;
  if (!p) return null;
  const path = p.store.path;
  const f = p.failing;
  return {
    file: basename(path),
    bytes: fileBytes(path) + fileBytes(`${path}-wal`),
    commits: p.commits,
    failing: f ? { seconds: (host.world.tick - f.since) / TICK_RATE, tries: f.tries, code: f.code, error: f.error } : null,
    checkpoint: { ms: p.keeper.last.ms, pages: p.keeper.last.pages },
    backups: backups.read(path),
  };
}

/** What each module's handlers have cost since the start, from the bus's own timing. */
export function modulesOf(host: Host): ModuleCost[] {
  const out = new Map<string, ModuleCost>(host.modules.names.map((name) => [name, { name, handlers: 0, calls: 0, ms: 0, worst: 0, off: 0 }]));
  for (const h of host.bus.stats()) {
    const m = out.get(h.module) ?? { name: h.module, handlers: 0, calls: 0, ms: 0, worst: 0, off: 0 };
    out.set(h.module, m);
    m.handlers++;
    m.calls += h.calls;
    m.ms += h.ms;
    m.worst = Math.max(m.worst, h.worst);
    if (h.off) m.off++;
  }
  return [...out.values()];
}

/** The survivor log's span and whether it is on, without its folder. */
export function logOf(host: Host): LogState {
  const { folder: _, ...span } = host.survivorLog.span();
  return span;
}

/** What a minute keeps besides its ticks (meter.ts). */
export function gaugesOf(host: Host): Gauges {
  const mem = process.memoryUsage();
  return { online: host.game.playerCount, bodies: host.world.ents.count, rss: mem.rss, heap: mem.heapUsed, commits: host.persistence?.commits ?? 0 };
}

/** The whole answer of /admin/stats.json. `bodies` is counted by the caller, which keeps it for a second. */
export function statsOf(host: Host, meter: TickMeter, bodies: Bodies, backups: BackupList, now = Date.now()): Stats {
  const { world, rules, game } = host;
  const mem = process.memoryUsage();
  return {
    at: now,
    world: { name: rules.text("SessionName") || mapLabel(world.reg, world.mapId), dev: host.dev, tick: world.tick, startedAt: meter.startedAt, cluster: host.cluster ? host.cluster.serverName(host.cluster.world) : "" },
    map: { id: world.mapId, label: mapLabel(world.reg, world.mapId), sizeX: world.hf.sizeX, sizeZ: world.hf.sizeZ, chunksX: world.dims.chunksX, chunksZ: world.dims.chunksZ },
    ticks: { rate: TICK_RATE, budget: TICK_MS, ran: meter.ticks, dropped: meter.dropped, seconds: meter.secondColumns() },
    online: { now: game.playerCount, max: game.opts.maxClients },
    bodies,
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    save: saveOf(host, backups),
    log: logOf(host),
    settings: changedSettings(rules),
    modules: modulesOf(host),
  };
}
