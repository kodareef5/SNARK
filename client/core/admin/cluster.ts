// The cluster dashboard's discovery and per-world reads. Each world authorizes its own data, and credentials are sent
// only to the chosen world on this origin. Clearing sign-ins invalidates private reads still in flight.

import { ADMIN_TERRAIN_SIDE, type AdminChatLine, type AdminOverview } from "../../../shared/admin.ts";
import { CHUNK_SIZE } from "../../../shared/coords.ts";
import { defaultPalette } from "../../../shared/pack/palette.ts";
import { Heightfield } from "../../../shared/world/heightfield.ts";
import { readHead, type MapHead } from "../../../shared/world/mapfile.ts";
import { MapWater } from "../../../shared/world/water.ts";
import type { LiveWorld } from "../wiki/world.ts";
import { baseSquares, readBases, type BaseSquare } from "./bases.ts";
import { inChannel } from "./chat.ts";
import { groundPicture, pictureExtent } from "./ground.ts";
import { verdict, type Verdict } from "./health.ts";

export interface ClusterSiteWorld extends LiveWorld {
  readonly id?: number | "local";
}

export interface AdminAddress {
  link: string;
  api: string | null;
  publicBase: string | null;
}

interface AdminResponse {
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

type Fetch = (path: string, authorization?: string) => Promise<AdminResponse>;
type Resolve = (world: ClusterSiteWorld) => AdminAddress | null;
type ClusterView = "overview" | "chat";

const palette = defaultPalette();
const paper = palette.slice();
for (let i = 0; i < paper.length; i += 4) {
  const tone = (palette[i]! * .22 + palette[i + 1]! * .68 + palette[i + 2]! * .1 - 135) * .2;
  paper[i] = 238 + tone;
  paper[i + 1] = 228 + tone;
  paper[i + 2] = 211 + tone;
}
const side = ADMIN_TERRAIN_SIDE;

export interface ClusterWorld {
  world: ClusterSiteWorld;
  admin: AdminAddress;
  status: string;
  cover: string;
  health: Verdict | null;
  locked: boolean;
  overview: AdminOverview | null;
  messages: AdminChatLine[] | null;
  publicGround: Uint8ClampedArray<ArrayBuffer> | null;
  publicHead: string;
  publicAt: number;
  ground: Uint8ClampedArray<ArrayBuffer> | null;
  groundRun: number;
  bases: BaseSquare[];
  basesAt: number;
}

function unavailable(card: ClusterWorld, status: string, cover: string): void {
  card.overview = null;
  card.messages = null;
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
  const ground = card.publicGround ?? card.ground;
  if (!card.overview) return ground ? { ground, points: [], bases: [] } : null;
  const { stats, positions } = card.overview;
  const { west, north, side: metres } = pictureExtent(stats.map);
  const scale = side / metres;
  return {
    ground,
    points: positions.map(({ x, z, name }) => ({ x: (west - x) * scale, y: (north - z) * scale, name })),
    bases: card.bases.map((base) => {
      const size = Math.max(1, base.size * scale);
      return { x: (west - base.x) * scale - size, y: (north - base.z) * scale - size, size, colour: `#${base.colour.toString(16).padStart(6, "0")}` };
    }),
  };
}

/** The game's public head contains terrain and water but no live positions. */
export function publicGround(head: MapHead): Uint8ClampedArray<ArrayBuffer> {
  const { dims, minY, stepY, coarse, water } = head;
  const hf = new Heightfield(dims, CHUNK_SIZE, minY, stepY, coarse.heights, coarse.tint);
  hf.seaLevel = head.seaLevel;
  if (water && coarse.bodies) {
    const { chunksX, chunksZ } = dims;
    const bodies = coarse.bodies;
    const cells = Uint16Array.from({ length: chunksX * chunksZ }, (_, i) => bodies[(Math.floor(i / chunksX) + 1) * (chunksX + 1) + i % chunksX + 1]!);
    hf.water = MapWater.fromGrid(dims, minY, stepY, CHUNK_SIZE, water.bodies, cells);
  }
  return groundPicture(hf, paper, side);
}

export class ClusterAdmin {
  readonly worlds = new Map<string, ClusterWorld>();
  discovered = false;
  private authorization = new WeakMap<ClusterWorld, string>();
  private signingIn: ClusterWorld | null = null;
  private run = 0;
  private busy = false;
  private readonly get: Fetch;
  private readonly resolve: Resolve;
  private readonly view: ClusterView;

  constructor(get: Fetch, resolve: Resolve, view: ClusterView, worlds: readonly ClusterSiteWorld[] = []) {
    this.get = get;
    this.resolve = resolve;
    this.view = view;
    this.discover(worlds);
  }

  get signedIn(): boolean {
    return [...this.worlds.values()].some((card) => this.authorization.has(card));
  }

  get authenticating(): boolean {
    return this.signingIn !== null;
  }

  async signIn(key: string, auth: string): Promise<void> {
    const card = this.worlds.get(key);
    const api = card?.admin.api;
    if (!card || !api || !card.locked || !auth || this.signingIn) return;
    this.signingIn = card;
    this.busy = true;
    const run = ++this.run;
    const accepted = await this.loadProtected(card, (file) => this.get(api + file, auth), run);
    if (this.run !== run) return;
    if (accepted) this.authorization.set(card, auth);
    card.locked = !accepted;
    this.signingIn = null;
    this.busy = false;
  }

  signOut(): void {
    this.run++;
    this.busy = false;
    for (const card of this.worlds.values()) {
      if (!this.authorization.has(card) && card !== this.signingIn) continue;
      card.locked = false;
      if (!card.publicGround) card.publicAt = 0;
      clearMap(card);
      unavailable(card, "Connecting", "Loading map…");
    }
    this.signingIn = null;
    this.authorization = new WeakMap();
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
    const readable = visible.filter((card) => card.messages).length;
    const lines = visible.flatMap((card) => (card.messages ?? []).slice().reverse()
      .filter((line) => inChannel(line, channel))
      .map((line) => ({ ...line, world: card.world.name })))
      .sort((a, b) => b.at - a.at).slice(0, 200);
    let note = lines.length ? "" : "No recent messages in this selection.";
    if (!visible.length) note = this.discovered ? "No worlds are running." : "Waiting for worlds…";
    else if (readable === 0) note = visible.some((card) => card.locked) ? "Sign in to read chat for these worlds." : "Chat is unavailable for this selection.";
    else if (readable < visible.length) note = `Showing chat from ${readable} of ${visible.length} worlds.`;
    return { lines, note };
  }

  async refresh(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    const run = ++this.run;
    let discovered = false;
    try {
      const reply = await this.get("/worlds.json");
      if (reply.status === 200) {
        const worlds = await reply.json() as ClusterSiteWorld[];
        if (this.run !== run) return false;
        this.discover(worlds);
        discovered = true;
      }
    } catch {
      // Keep the last known world list and retry discovery.
    }
    if (this.run !== run) return false;
    this.discovered = discovered;
    await Promise.all([...this.worlds.values()].map((world) => this.refreshWorld(world, run)));
    if (this.run !== run) return false;
    this.busy = false;
    return true;
  }

  private discover(worlds: readonly ClusterSiteWorld[]): void {
    const seen = new Set<string>();
    for (const world of worlds) {
      const admin = this.resolve(world);
      if (!admin || seen.has(admin.link)) continue;
      seen.add(admin.link);
      const card = this.worlds.get(admin.link);
      if (card && card.world.address === world.address && card.world.mapId === world.mapId) card.world = world;
      else this.worlds.set(admin.link, {
        world, admin, locked: false, health: null, overview: null, messages: null,
        ground: null, groundRun: -1, publicGround: null, publicHead: "", publicAt: 0, bases: [], basesAt: 0,
        status: admin.api ? "Connecting" : "Remote", cover: admin.api ? "Loading map…" : "Map and chat are available on its own host.",
      });
    }
    for (const key of this.worlds.keys()) if (!seen.has(key)) this.worlds.delete(key);
  }

  private async refreshWorld(card: ClusterWorld, run: number): Promise<void> {
    const api = card.admin.api;
    if (!api) return;
    const auth = this.authorization.get(card);
    const get = (file: string): Promise<AdminResponse> => this.get(api + file, auth);
    if (!card.locked) await this.loadProtected(card, get, run);
    if (this.view !== "overview" || this.run !== run) return;
    await this.loadPublicGround(card, run);
    if (this.run === run && card.overview && !card.publicGround) await this.loadGround(card, get, run);
  }

  private async loadProtected(card: ClusterWorld, get: Fetch, run: number): Promise<boolean> {
    try {
      const reply = await get(this.view === "chat" ? "chat.json" : "overview.json");
      if (this.run !== run) return false;
      if (reply.status === 401 || reply.status === 429) {
        this.authorization.delete(card);
        card.locked = true;
        clearMap(card);
        const purpose = this.view === "chat" ? "Sign in to read this world's chat." : "Sign in to see live positions and health.";
        const note = this.signingIn === card ? "The password was rejected." : purpose;
        unavailable(card, reply.status === 429 ? "Rate limited" : "Locked",
          reply.status === 429 ? "Wait a while before trying to sign in again." : note);
        return false;
      }
      if (reply.status !== 200) {
        clearMap(card);
        unavailable(card, "Unavailable", reply.status === 404 ? "World admin is unavailable." : `World admin answered ${reply.status}.`);
        return false;
      }
      const body = await reply.json();
      if (this.run !== run) return false;
      if (this.view === "chat") {
        card.messages = body as AdminChatLine[];
        card.status = "Connected";
        card.cover = "";
        return true;
      }
      const overview = body as AdminOverview;
      if (card.groundRun !== overview.stats.world.startedAt) {
        clearMap(card);
        if (card.groundRun >= 0) card.publicAt = 0;
        card.groundRun = overview.stats.world.startedAt;
      }
      card.health = verdict(overview.stats);
      card.overview = overview;
      card.status = "Connected";
      card.cover = "";
      await this.loadBases(card, get, run, overview.stats.map);
      return this.run === run;
    } catch {
      if (this.run === run) {
        clearMap(card);
        unavailable(card, "Unavailable", "The world did not answer.");
      }
      return false;
    }
  }

  private async loadPublicGround(card: ClusterWorld, run: number): Promise<void> {
    if (!card.admin.publicBase || Date.now() - card.publicAt < 60_000) return;
    card.publicAt = Date.now();
    try {
      const index = await this.get(card.admin.publicBase + "map.json");
      if (index.status !== 200 || this.run !== run) return;
      const { head } = await index.json() as { head: string };
      if (!/^map\/head\.[a-f0-9]{16}\.part$/.test(head) || head === card.publicHead) return;
      card.publicGround = null;
      const r = await this.get(card.admin.publicBase + head);
      if (r.status !== 200 || this.run !== run) return;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (this.run !== run) return;
      card.publicGround = publicGround(readHead(bytes));
      card.publicHead = head;
    } catch {
      // The public preview can be fetched again independently of the protected data.
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
