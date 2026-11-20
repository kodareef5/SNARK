// The cluster dashboard's discovery and per-world reads. Each world authorizes its own data, and credentials are sent
// only to worlds on this origin. A new sign-in invalidates any reads still in flight.

import { ADMIN_TERRAIN_SIDE, type AdminOverview } from "../../../shared/admin.ts";
import { defaultPalette } from "../../../shared/pack/palette.ts";
import type { LiveWorld } from "../wiki/world.ts";
import { baseSquares, readBases, type BaseSquare } from "./bases.ts";
import { inChannel } from "./chat.ts";
import { pictureExtent } from "./ground.ts";
import { verdict, type Verdict } from "./health.ts";

interface AdminAddress {
  link: string;
  local: boolean;
}

interface AdminResponse {
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

type Fetch = (path: string, authorization?: string) => Promise<AdminResponse>;
type Resolve = (worldAddress: string) => AdminAddress | null;

const palette = defaultPalette();
const side = ADMIN_TERRAIN_SIDE;

export interface ClusterWorld {
  world: LiveWorld;
  admin: AdminAddress;
  status: string;
  cover: string;
  health: Verdict | null;
  locked: boolean;
  overview: AdminOverview | null;
  ground: Uint8ClampedArray<ArrayBuffer> | null;
  groundRun: number;
  bases: BaseSquare[];
  basesAt: number;
}

function unavailable(card: ClusterWorld, status: string, cover: string): void {
  card.overview = null;
  card.health = null;
  card.status = status;
  card.cover = cover;
}

function clearMap(card: ClusterWorld): void {
  card.ground = null;
  card.bases = [];
  card.basesAt = 0;
}

export function counts(card: ClusterWorld): { players: number; max: number } {
  return card.overview ? { players: card.overview.stats.online.now, max: card.overview.stats.online.max } : card.world;
}

/** Pixel coordinates on the square relief image, which pads the map's shorter side. */
export function preview(card: ClusterWorld) {
  if (!card.overview) return null;
  const { stats, positions } = card.overview;
  const { west, north, side: metres } = pictureExtent(stats.map);
  const scale = side / metres;
  return {
    ground: card.ground,
    points: positions.map(({ x, z, name }) => ({ x: (west - x) * scale, y: (north - z) * scale, name })),
    bases: card.bases.map((base) => {
      const size = Math.max(1, base.size * scale);
      return { x: (west - base.x) * scale - size, y: (north - base.z) * scale - size, size, colour: `#${base.colour.toString(16).padStart(6, "0")}` };
    }),
  };
}

export class ClusterAdmin {
  readonly worlds = new Map<string, ClusterWorld>();
  discovered = false;
  private authorization = "";
  private run = 0;
  private busy = false;
  private readonly get: Fetch;
  private readonly resolve: Resolve;

  constructor(get: Fetch, resolve: Resolve) {
    this.get = get;
    this.resolve = resolve;
  }

  get signedIn(): boolean {
    return this.authorization !== "";
  }

  signIn(auth: string): void {
    this.authorization = auth;
    this.run++;
    this.busy = false;
    for (const card of this.worlds.values()) {
      if (!card.admin.local) continue;
      card.locked = false;
      clearMap(card);
      unavailable(card, "Connecting", "Loading map…");
    }
  }

  totals(): { players: number; max: number; locked: number } {
    let players = 0, max = 0, locked = 0;
    for (const card of this.worlds.values()) {
      const count = counts(card);
      players += count.players;
      max += count.max;
      if (card.locked) locked++;
    }
    return { players, max, locked };
  }

  chat(world: string, channel: string) {
    const visible = world ? [...this.worlds.values()].filter((card) => card.admin.link === world) : [...this.worlds.values()];
    const readable = visible.filter((card) => card.overview).length;
    const lines = visible.flatMap((card) => (card.overview?.chat ?? []).slice().reverse()
      .filter((line) => inChannel(line, channel))
      .map((line) => ({ ...line, world: card.world.name })))
      .sort((a, b) => b.at - a.at).slice(0, 200);
    const note = readable === 0 ? "Chat is unavailable for these worlds." :
      readable < visible.length ? `Showing chat from ${readable} of ${visible.length} worlds.` :
        lines.length ? "" : "No recent messages in this selection.";
    return { lines, note };
  }

  async refresh(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    const run = ++this.run;
    this.discovered = false;
    try {
      const reply = await this.get("/worlds.json");
      if (reply.status === 200) {
        const worlds = await reply.json() as LiveWorld[];
        if (this.run !== run) return false;
        this.discover(worlds);
        this.discovered = true;
      }
    } catch {
      // Keep the last known world list and retry discovery.
    }
    if (this.run !== run) return false;
    await Promise.all([...this.worlds.values()].map((world) => this.refreshWorld(world, run)));
    if (this.run !== run) return false;
    this.busy = false;
    return true;
  }

  private discover(worlds: readonly LiveWorld[]): void {
    const seen = new Set<string>();
    for (const world of worlds) {
      const admin = this.resolve(world.address);
      if (!admin || seen.has(admin.link)) continue;
      seen.add(admin.link);
      const card = this.worlds.get(admin.link);
      if (card) card.world = world;
      else this.worlds.set(admin.link, {
        world, admin, locked: false, health: null, overview: null, ground: null, groundRun: -1, bases: [], basesAt: 0,
        status: admin.local ? "Connecting" : "Separate origin",
        cover: admin.local ? "Loading map…" : "Open world admin to see its map and chat.",
      });
    }
    for (const key of this.worlds.keys()) if (!seen.has(key)) this.worlds.delete(key);
  }

  private async refreshWorld(card: ClusterWorld, run: number): Promise<void> {
    if (!card.admin.local || card.locked) return;
    const get = (file: string): Promise<AdminResponse> => this.get(card.admin.link + file, this.authorization);
    try {
      const reply = await get("overview.json");
      if (this.run !== run) return;
      if (reply.status === 401 || reply.status === 429) {
        card.locked = true;
        unavailable(card, "Sign-in required", reply.status === 429 ? "Too many attempts. Wait a while, then sign in again." : "This world needs its admin password.");
        return;
      }
      if (reply.status !== 200) {
        unavailable(card, "Unavailable", reply.status === 404 ? "Admin is disabled or this world needs an update." : `Admin answered ${reply.status}.`);
        return;
      }
      const overview = await reply.json() as AdminOverview;
      if (this.run !== run) return;
      if (card.groundRun !== overview.stats.world.startedAt) {
        clearMap(card);
        card.groundRun = overview.stats.world.startedAt;
      }
      card.health = verdict(overview.stats);
      card.overview = overview;
      await Promise.all([this.loadGround(card, get, run), this.loadBases(card, get, run, overview.stats.map)]);
    } catch {
      if (this.run === run) unavailable(card, "Unavailable", "The world did not answer.");
    }
  }

  private async loadGround(card: ClusterWorld, get: Fetch, run: number): Promise<void> {
    if (card.ground) return;
    try {
      const r = await get("terrain.rgba");
      if (r.status !== 200) return;
      const bytes = new Uint8ClampedArray(await r.arrayBuffer());
      if (this.run === run && bytes.length === side * side * 4) card.ground = bytes;
    } catch {
      // Positions can still be drawn while terrain is unavailable.
    }
  }

  private async loadBases(card: ClusterWorld, get: Fetch, run: number, map: AdminOverview["stats"]["map"]): Promise<void> {
    if (Date.now() - card.basesAt < 20_000) return;
    try {
      const r = await get("bases.bin?level=3");
      if (r.status !== 200) return;
      const chunks = readBases(new Uint8Array(await r.arrayBuffer()));
      if (this.run !== run || !chunks) return;
      card.bases = baseSquares(map, chunks, palette, 0);
      card.basesAt = Date.now();
    } catch {
      // The next poll can retry independently of the map and chat.
    }
  }
}
