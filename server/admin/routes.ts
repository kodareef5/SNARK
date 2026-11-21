// The /admin/ page and what it asks for, behind the admin pages' gate (gate.ts); the sound board answers its own paths
// under /admin/ (server/sound-board.ts). Every answer is made at most once a second however many pages ask, and the
// tribes' bases only when a chunk's cells have changed, so pages polling cost the tick thread next to nothing.
//
//   /admin/                 the page (client/admin), and /admin/admin.js its script
//   /admin/stats.json       stats.ts Stats: the loop's last two minutes by the second, and the state of the server now
//   /admin/minutes.json     the meter's minutes, from=<n> those from the n-th on, and `next` to ask from after them
//   /admin/ticks.json       parts.ts TickReport: where the ticks' time went by part, and the long ticks part by part
//   /admin/survivors.json   survivors.ts Survivors: every survivor, where each is, and its recent deaths
//   /admin/bases.bin        bases.ts: the tribes' bases at level=<0 to 3> of the players' map cells
//   /admin/overview.json   stats, online positions and recent chat for the cluster dashboard
//   /admin/chat.json       recent accepted player text chat
//   /admin/terrain.rgba    a small relief map for the cluster dashboard
//   /admin/content.json     the names the interface shows for the content's ids, where they are not the id's own words
//   /admin/log/...          the survivor log's reads (log-routes.ts)

import { existsSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_TERRAIN_SIDE, type AdminOverview, type Stats, type Survivors } from "../../shared/admin.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { mapHeightfield, type MapData } from "../../shared/world/mapfile.ts";
import { paintRelief } from "../../shared/world/relief.ts";
import type { Host } from "../host.ts";
import { boardAsked } from "../sound-board.ts";
import { basesOf, basesVersion } from "./bases.ts";
import { adminAsked, adminPath, refused, type AdminGate } from "./gate.ts";
import { SupplyRoutes } from "./supply-routes.ts";
import { LogRoutes } from "./log-routes.ts";
import type { TickMeter } from "./meter.ts";
import { BackupList, bodiesOf, statsOf } from "./stats.ts";
import { onlinePositions, survivorsOf, type RunStart } from "./survivors.ts";

const FRESH = { "cache-control": "no-store" };
const JSON_HEADERS = { ...FRESH, "content-type": "application/json" };
/** The page's own files, by the path they are asked for at, and their type. */
const FILES: Readonly<Record<string, [string, string]>> = {
  "/admin/": ["index.html", "text/html; charset=utf-8"],
  "/admin/index.html": ["index.html", "text/html; charset=utf-8"],
  "/admin/admin.js": ["admin.js", "text/javascript"],
  "/admin/admin.js.map": ["admin.js.map", "application/json"],
};

export interface AdminOptions {
  host: Host;
  meter: TickMeter;
  /** The built page's folder, client/dist/admin. */
  dir: string;
  start: RunStart;
  terrain?: Uint8Array<ArrayBuffer>;
  /** Wall ms. */
  now?: () => number;
}

/** Paint the preview while the map's colour data is available at startup. */
export function adminTerrain(map: MapData): Uint8Array<ArrayBuffer> {
  const side = ADMIN_TERRAIN_SIDE;
  const pixels = new Uint32Array(side * side);
  paintRelief(mapHeightfield(map), defaultPalette(), 0, 0, 0, side, pixels);
  return new Uint8Array(pixels.buffer);
}

/** A value made at most once a second. */
class EverySecond<T> {
  private at = -1;
  private value: T | null = null;
  private readonly make: () => T;
  constructor(make: () => T) {
    this.make = make;
  }

  get(now: number): T {
    const second = Math.floor(now / 1000);
    if (this.value === null || second !== this.at) {
      this.value = this.make();
      this.at = second;
    }
    return this.value;
  }

  /** Lets go of `value` if it is the one kept, so that the next request makes another. */
  forget(value: T): void {
    if (this.value === value) this.value = null;
  }
}

export class AdminPages {
  private readonly o: AdminOptions;
  private readonly now: () => number;
  private readonly backups = new BackupList();
  private readonly stats: EverySecond<Stats>;
  private readonly statsJson: EverySecond<string>;
  private readonly overview: EverySecond<string>;
  private readonly chat: EverySecond<string>;
  private terrainGzip: Uint8Array<ArrayBuffer> | null = null;
  private readonly ticks: EverySecond<string>;
  private readonly survivors: EverySecond<Promise<string>>;
  /** The newest of each level's bases and the version of the cells it was made from, which is looked at once a second. */
  private readonly bases = new Map<number, { version: number; bytes: Uint8Array }>();
  private readonly version: EverySecond<number>;
  /** The whole run of minutes, made again when a minute closes. */
  private minutesAll: { count: number; json: string } = { count: -1, json: "" };
  /** The wall time of each tick a death was at, as the survivor log has it, null where it has none. A tick's never changes. */
  private readonly walls = new Map<number, number | null>();
  private content = "";
  private readonly log: LogRoutes;
  /** The drop book's page: the one part of these pages that may change the world (supply-routes.ts). */
  readonly supply: SupplyRoutes;

  constructor(o: AdminOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
    this.stats = new EverySecond(() => statsOf(o.host, o.meter, bodiesOf(o.host), this.backups, this.now()));
    this.statsJson = new EverySecond(() => JSON.stringify(this.stats.get(this.now())));
    this.overview = new EverySecond(() => JSON.stringify({
      stats: this.stats.get(this.now()),
      positions: onlinePositions(o.host),
      chat: o.host.chat.recentLines(),
    } satisfies AdminOverview));
    this.chat = new EverySecond(() => JSON.stringify(o.host.chat.recentLines()));
    this.ticks = new EverySecond(() => JSON.stringify(o.host.game.parts.report()));
    // A list that failed is not the second's answer: the next request makes it again.
    this.survivors = new EverySecond(() => {
      const made = this.survivorsJson();
      made.catch(() => this.survivors.forget(made));
      return made;
    });
    this.version = new EverySecond(() => basesVersion(o.host.tactical.summaries));
    this.log = new LogRoutes(o.host, this.now);
    this.supply = new SupplyRoutes(o.host, this.now);
  }

  /**
   * The answer to a request for an admin page that is not the sound board's, or null for any other request. `pathname`
   * is the request's path, or for a server reached at a path of its host the part of it under that path.
   */
  answer(req: Request, who: string, gate: AdminGate, pathname: string): Response | Promise<Response> | null {
    if (!adminAsked(pathname) || boardAsked(pathname)) return null;
    const no = refused(req, who, gate);
    if (no) return no;
    const at = adminPath(pathname)!;
    const url = new URL(req.url);
    if (at === "/admin") return new Response(null, { status: 308, headers: { location: `admin/${url.search}` } });
    const file = FILES[at];
    if (file) {
      const path = join(this.o.dir, file[0]);
      return existsSync(path) ? new Response(Bun.file(path), { headers: { ...FRESH, "content-type": file[1] } }) : new Response("build the client first", { status: 404 });
    }
    const now = this.now();
    if (at === "/admin/stats.json") return new Response(this.statsJson.get(now), { headers: JSON_HEADERS });
    if (at === "/admin/overview.json") return new Response(this.overview.get(now), { headers: JSON_HEADERS });
    if (at === "/admin/chat.json") return new Response(this.chat.get(now), { headers: JSON_HEADERS });
    if (at === "/admin/terrain.rgba") return this.terrainImage(req);
    if (at === "/admin/survivors.json") return this.survivors.get(now).then((text) => new Response(text, { headers: JSON_HEADERS }));
    if (at === "/admin/minutes.json") return new Response(this.minutes(Number(url.searchParams.get("from") ?? 0)), { headers: JSON_HEADERS });
    if (at === "/admin/ticks.json") return new Response(this.ticks.get(now), { headers: JSON_HEADERS });
    if (at === "/admin/content.json") return new Response(this.labels(), { headers: JSON_HEADERS });
    if (at === "/admin/bases.bin") {
      const level = Number(url.searchParams.get("level") ?? 3);
      if (!(level >= 0 && level <= 3 && Number.isInteger(level))) return new Response("level is 0 to 3", { status: 400 });
      return new Response(this.basesAt(level, now), { headers: { ...FRESH, "content-type": "application/octet-stream" } });
    }
    return this.log.answer(at, url) ?? this.supply.answer(req, at, url) ?? new Response("not found", { status: 404 });
  }

  private terrainImage(req: Request): Response {
    const raw = this.o.terrain;
    if (!raw) return new Response("terrain not available", { status: 404 });
    const gzip = /(?:^|,)[ ]*gzip(?:[ ]*,|$)/i.test(req.headers.get("accept-encoding") ?? "");
    if (gzip) this.terrainGzip ??= Bun.gzipSync(raw);
    return new Response(gzip ? this.terrainGzip : raw, {
      headers: { ...FRESH, "content-type": "application/octet-stream", vary: "accept-encoding", ...(gzip ? { "content-encoding": "gzip" } : {}) },
    });
  }

  /**
   * The survivors, each death's time as the survivor log reads its tick, asked of the log once for each tick it has not
   * been asked yet. Where the log has none, the time from this run's start stands (survivors.ts), or none.
   */
  private async survivorsJson(): Promise<string> {
    const s: Survivors = survivorsOf(this.o.host, this.o.start, this.now());
    const log = this.o.host.survivorLog;
    const ask = [...new Set(s.survivors.flatMap((r) => r.deaths.map((d) => d.tick)))].filter((t) => !this.walls.has(t));
    if (ask.length > 0 && log.span().from !== null) {
      try {
        const got = await log.wallsAt(ask);
        ask.forEach((t, i) => this.walls.set(t, got[i] ?? null));
      } catch {
        // The log's thread failed: this run's times stand, and the next answer asks again.
      }
    }
    for (const r of s.survivors) for (const d of r.deaths) d.at = this.walls.get(d.tick) ?? d.at;
    return JSON.stringify(s);
  }

  /** Each content id whose interface name is not its own words, by id: made once, as the content does not change while it runs. */
  private labels(): string {
    if (this.content !== "") return this.content;
    const reg = this.o.host.world.reg;
    const labels: Record<string, string> = {};
    for (const d of reg.defs) {
      const label = (d as { label?: unknown } | null)?.label;
      if (d && typeof label === "string" && label !== "") labels[d.id] = label;
    }
    return (this.content = JSON.stringify({ labels }));
  }

  private minutes(from: number): string {
    const meter = this.o.meter;
    if (!(from > 0) || !Number.isInteger(from)) {
      if (this.minutesAll.count !== meter.minutes.count) this.minutesAll = { count: meter.minutes.count, json: JSON.stringify(meter.minuteColumns()) };
      return this.minutesAll.json;
    }
    return JSON.stringify(meter.minuteColumns(from));
  }

  private basesAt(level: number, now: number): Uint8Array {
    const version = this.version.get(now);
    const had = this.bases.get(level);
    if (had && had.version === version) return had.bytes;
    const bytes = basesOf(this.o.host.tactical.summaries, level);
    this.bases.set(level, { version, bytes });
    return bytes;
  }
}
