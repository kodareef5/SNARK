// A page of a map it takes in parts (client/core/mapload.ts): a map of 36 sectors and 9 overviews off the lattice, a link
// whose answers the test orders, fails and damages on a clock of its own, a loader on it, and that loader with a session
// on a server as the shell wires them. Used by tests/world/page-*.test.ts.

import type { Answer, Get } from "../../client/core/fetched.ts";
import { MapLoader, type Place } from "../../client/core/mapload.ts";
import type { WantFrom } from "../../client/core/map-want.ts";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { OVERVIEW_CHUNKS, mapTops, partsOf, readHead, resolveNodes, squareOf, type MapData, type MapHead, type MapPart, type MapStatic, type NodeScatter, type NodeZoned } from "../../shared/world/mapfile.ts";
import { encodeStreets, heldSide, kindsByte } from "../../shared/world/streets.ts";
import { MapWater } from "../../shared/world/water.ts";
import { coreRegistry } from "./world.ts";

export const PER = CHUNK_SIZE / TERRAIN_CELL;
export const SIDE = 80;
/** The lattice's column and row of the map's first chunk: sectors start 8 chunks in, overviews 8 chunks in. */
export const FRAME = 2040;

/**
 * Hills of 80 by 80 chunks, their corner off the lattice's sectors and overviews: 36 sectors, the outer ones 8 chunks
 * wide, on 9 overviews. Noise on every sample, so a stand-in is never the map's own by luck. Statics in every sector,
 * `dense` of them in one sector so its reading takes several steps; trees scattered and zoned; a lake across the corner
 * of four overviews in the north-west; streets listed in a row of sectors; ground classes; and its tops.
 */
export function pagedMap(dense = 0): MapData {
  const rng = new Rng(7001);
  const dims = { chunksX: SIDE, chunksZ: SIDE, frameX: FRAME, frameZ: FRAME };
  const n = SIDE * PER + 1;
  const [minY, stepY] = [-32, 1 / 256];
  const hill = (x: number, z: number): number => 9 + 4 * Math.sin(x / 97) * Math.cos(z / 131) + 1.5 * Math.sin((x + 2 * z) / 23);
  const heights = Uint16Array.from({ length: n * n }, (_, k) => Math.round((hill((k % n) * TERRAIN_CELL, Math.floor(k / n) * TERRAIN_CELL) - minY) / stepY) + rng.int(24));
  const tint = Uint8Array.from({ length: n * n }, () => 1 + rng.int(200));
  const gx = (n + 1) >> 1;
  const ground = Uint8Array.from({ length: gx * gx }, (_, k) => ((k % gx) >> 3) % 3 === 0 ? 1 : (Math.floor(k / gx) >> 4) % 4 === 0 ? 2 : 0);
  const kinds = ["core:wall", "core:crate", "core:pillar"];
  const size = SIDE * CHUNK_SIZE;
  const statics: MapStatic[] = [];
  for (let i = 0; i < 9000; i++) {
    const x = rng.int(size * 512) / 512, z = rng.int(size * 512) / 512;
    statics.push({ kind: kinds[i % 3]!, x, y: hill(x, z) + rng.int(40 * 512) / 512, z, yaw: rng.int(65536) });
  }
  // One sector's worth of crates on a lattice, in the sector from chunk 24 to 40 a side.
  for (let i = 0; i < dense; i++) {
    const x = 24 * CHUNK_SIZE + 3 + (i % 200) * 5, z = 24 * CHUNK_SIZE + 3 + (Math.floor(i / 200) % 200) * 5;
    statics.push({ kind: "core:crate", x, y: hill(x, z) + 2 + Math.floor(i / 40000) * 3, z, yaw: (i * 77) & 0xffff });
  }
  // Pieces on sectors' and overviews' edges, and on the map's.
  for (const e of [8, 24, 40, 56, 72]) {
    statics.push({ kind: "core:wall", x: e * CHUNK_SIZE, y: 20, z: 700, yaw: 3 }, { kind: "core:wall", x: 900, y: 20, z: e * CHUNK_SIZE, yaw: 4 }, { kind: "core:wall", x: e * CHUNK_SIZE - 1 / 4096, y: 21, z: e * CHUNK_SIZE, yaw: 5 });
  }
  statics.push({ kind: "core:wall", x: size, y: 3, z: size, yaw: 1 }, { kind: "core:crate", x: 0, y: 3, z: 0, yaw: 2 });
  const bits = (count: number): Uint8Array => Uint8Array.from({ length: Math.ceil(count / 8) }, () => rng.int(256));
  const scatter: NodeScatter = { seed: 5, perChunk: 12, kinds: [["core:tree", 3], ["core:rock", 1]], allowCell: 8, allow: bits((SIDE * 8) ** 2), out: bits(SIDE * SIDE * 12) };
  const zone = Uint8Array.from({ length: (SIDE * 4) ** 2 }, (_, k) => Math.floor(k / (SIDE * 4) / 30 + (k % (SIDE * 4)) / 50) % 3);
  const zoned: NodeZoned = { seed: 6, perChunk: 8, zones: [{ bare: 1, kinds: [["core:palm", 2]] }, { bare: 0, kinds: [["core:fig", 1], ["core:fern", 1]] }], zoneCell: 16, zone, out: bits(SIDE * SIDE * 8) };
  const cell = 8, across = size / cell;
  const grid = new Uint16Array(across * across);
  for (let j = 25; j < 88; j++) for (let i = 40; i < 110; i++) if ((i + j) % 5 !== 0) grid[j * across + i] = 1 + (i % 2);
  const water = MapWater.fromGrid(dims, minY, stepY, cell, [{ name: "Edge Lake", level: 11000 }, { name: "", level: 10900 }], grid);
  // Streets listed in the second row of sectors, a street along x in each.
  const side = heldSide(4, 1.5, 2, kindsByte(1, 1, 0));
  const first = Math.floor(FRAME / SECTOR_CHUNKS);
  const streets = [0, 1, 2, 3, 4, 5].map((c) => {
    const [col, row] = [first + c, first + 1];
    const [x0, z0] = [(col * SECTOR_CHUNKS - FRAME) * CHUNK_SIZE, (row * SECTOR_CHUNKS - FRAME) * CHUNK_SIZE];
    const lo = Math.max(0, x0) - x0 + 10, hi = Math.min(size, x0 + 1024) - x0 - 10;
    return { col, row, bytes: encodeStreets({ x0, z0, stretches: [{ type: 3, flags: 0, seed: 70 + c, sides: [side, side], xz: Float64Array.of(lo, 500, hi, 500) }], corners: [] }) };
  });
  const map = resolveNodes({ id: "test:paged", dims, minY, stepY, seaLevel: 0, heights, tint, ground, statics, nodes: [scatter, zoned], spawns: [{ name: "Middle", x: 2600, z: 2600, yaw: 0 }], water, streets }, coreRegistry());
  return { ...map, tops: mapTops(map, coreRegistry()) };
}

/** Metres from (x, z) to a part's square. */
export function offOf(head: MapHead, p: MapPart, x: number, z: number): number {
  const sq = squareOf(head.dims, p.kind === "overview" || p.kind === "tops" ? OVERVIEW_CHUNKS : SECTOR_CHUNKS, p.col, p.row)!;
  return Math.hypot(Math.max(sq.cx0 * CHUNK_SIZE - x, x - sq.cx1 * CHUNK_SIZE, 0), Math.max(sq.cz0 * CHUNK_SIZE - z, z - sq.cz1 * CHUNK_SIZE, 0));
}

/** Says `line` where PAGE_SAY is set: what a run measured, for one read by hand. */
export const say = (line: string): void => void (process.env.PAGE_SAY && console.log(line));

/** A turn of the event loop: every promise the last answers started runs its course. */
export const turn = (): Promise<void> => new Promise((go) => setImmediate(go));

interface Waiting {
  readonly url: string;
  readonly done: (r: Answer) => void;
  readonly at: number;
}

/**
 * A map's head and parts behind a link the test answers by hand, on a clock the test moves: which request is answered,
 * when, and whether with its bytes, a failure or damage. It counts each part's asks.
 */
export class Link {
  readonly head: MapHead;
  /** A url's bytes, or null for one the map does not have. */
  readonly read: (url: string) => Uint8Array | null;
  /** Where set, no log is kept of the asks: a long run's own memory stays level. */
  quietLog = false;
  readonly waiting: Waiting[] = [];
  /** Asks of each url, and the order they came in with the clock's time. */
  readonly asks = new Map<string, number>();
  readonly log: { url: string; at: number }[] = [];
  /** Bytes answered whole. */
  bytes = 0;
  now = 0;
  private readonly timers: { at: number; go: () => void }[] = [];
  /** Pauses the loader waits in (LoaderOptions.pause), answered by `step` or at once where `eager`. */
  readonly pauses: (() => void)[] = [];
  eager = true;
  /** Urls whose next answer is damaged, once each. */
  readonly damaged = new Set<string>();

  constructor(file: Uint8Array, read?: (url: string) => Uint8Array | null) {
    this.head = readHead(file);
    const files = read ? null : new Map(partsOf(file).map((p) => [`map/${p.name}`, p.bytes]));
    this.read = read ?? ((url) => files!.get(url) ?? null);
  }

  readonly get: Get = (url) =>
    new Promise<Answer>((done) => {
      this.asks.set(url, (this.asks.get(url) ?? 0) + 1);
      if (!this.quietLog) this.log.push({ url, at: this.now });
      this.waiting.push({ url, done, at: this.now });
    });

  readonly wait = (ms: number): Promise<void> => new Promise((go) => void this.timers.push({ at: this.now + ms, go }));

  readonly pause = (): Promise<void> => (this.eager ? Promise.resolve() : new Promise((go) => void this.pauses.push(go)));

  /** Answers the waiting request at `k`: with its bytes, with a 503, or with its bytes damaged. */
  answer(k = 0, how: "ok" | "fail" | "damage" = "ok"): void {
    const w = this.waiting.splice(k, 1)[0];
    if (!w) return;
    const body = this.read(w.url);
    if (!body) return w.done(new Response("not found", { status: 404 }) as unknown as Answer);
    if (how === "fail") return w.done(new Response("not now", { status: 503 }) as unknown as Answer);
    if (how === "damage") {
      const bad = body.slice();
      bad[bad.length >> 1]! ^= 0x55;
      return w.done(new Response(bad) as unknown as Answer);
    }
    this.bytes += body.length;
    w.done(new Response(body.slice() as Uint8Array<ArrayBuffer>) as unknown as Answer);
  }

  /** Takes one of the pauses waiting, the `k`-th. */
  step(k = 0): void {
    this.pauses.splice(k, 1)[0]?.();
  }

  /** Moves the clock on by `ms`, each timer due called in its order with a turn after it. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const t = this.timers[0];
      if (!t || t.at > end) break;
      this.timers.shift();
      this.now = Math.max(this.now, t.at);
      t.go();
      await turn();
    }
    this.now = end;
  }

  /** Requests `drain` leaves waiting, where set: a part the test keeps back. */
  keepBack: ((url: string) => boolean) | null = null;

  /** Answers every request and pause, those they bring on too, moving the clock by `ms` a round, until none is left for `quiet` rounds. */
  async drain(ms = 0, quiet = 3): Promise<void> {
    const next = (): number => this.waiting.findIndex((w) => !this.keepBack?.(w.url));
    for (let still = 0; still < quiet; ) {
      await turn();
      if (next() < 0 && this.pauses.length === 0) still++;
      else still = 0;
      while (this.pauses.length > 0) (this.step(), await turn());
      for (let k = next(); k >= 0; k = next()) (this.answer(k), await turn());
      if (ms > 0) await this.advance(ms);
    }
  }

  /** How often each part was asked for, by its kind: parts asked once, and the asks past the first. */
  refetches(): { parts: number; again: number } {
    let parts = 0, again = 0;
    for (const n of this.asks.values()) (parts++, (again += n - 1));
    return { parts, again };
  }
}

/** A loader started on `link`, its first parts answered. */
export async function startLoader(link: Link, clocked = true): Promise<MapLoader> {
  let loader: MapLoader | null = null;
  void MapLoader.start(link.get, `map/${link.head.name}`, { wait: link.wait, pause: link.pause, ...(clocked ? { every: link.wait } : {}) }).then((l) => (loader = l));
  for (let k = 0; k < 1000 && !loader; k++) await link.drain(0, 1);
  if (!loader) throw new Error("the loader did not start");
  return loader;
}

/** What a test's page wants: tight reaches and budgets, so parts come and go within a few sectors. */
export interface Wants {
  view: number;
  statics: number;
  budget?: number;
  ground?: number;
  camera: { x: number; z: number } | null;
  focus: { x: number; z: number } | null;
  screen: { x: number; z: number; half: number } | null;
}

export const wantOf = (w: Wants): WantFrom => ({ view: w.view, statics: w.statics, ...(w.budget !== undefined ? { budget: w.budget } : {}), ...(w.ground !== undefined ? { ground: w.ground } : {}), camera: w.camera, focus: w.focus, screen: w.screen });

export type { Place };

/** The private parts of a loader a test reads. */
export interface LoaderInside {
  came: Set<MapPart>;
  going: Set<MapPart>;
  waiting: Set<MapPart>;
  broken: Set<MapPart>;
  want: { parts: Map<MapPart, number>; kept: Set<MapPart> };
  roads: Set<MapPart>;
  roadsHeld: Set<MapPart>;
  handing: boolean;
  handedAt: number;
}

export const inside = (loader: MapLoader): LoaderInside => loader as unknown as LoaderInside;

// A page on a server: the loader, and a session wired to it as client/shell/main.ts wires them.

import { NO_CLIPS } from "../../shared/anim/clip.ts";
import { defaultLook } from "../../shared/anim/look.ts";
import { ClientSession } from "../../client/core/session.ts";
import type { CityMaker } from "../../client/core/render/citymake.ts";
import type { LoopbackEnd } from "../../shared/net/loopback.ts";
import { nodeLayers } from "../../shared/world/mapfile.ts";
import { toldHealth, type StructureStore } from "../../shared/world/structures.ts";
import { Harness, testKey } from "./net.ts";

/** A server on `file`, with no clips or rigs to load. */
export const serverOn = (file: Uint8Array<ArrayBuffer>, seed = 3): Harness => new Harness({}, seed, 60, { dev: true, clips: NO_CLIPS, rigs: [], map: file });

/** The private parts of a session a test reads. */
export interface SessionInside {
  waitingRows: (Uint8Array | number)[];
  whole: Uint8Array;
  parked: Map<number, { version: number }>;
  unbased: Set<number>;
  staticKinds: Uint16Array | null;
  nodeHeld: number[];
}

export const sessionInside = (s: ClientSession): SessionInside => s as unknown as SessionInside;

/** A page in the game: its loader on a link the test answers, and its session on the harness's server. */
export class Page {
  readonly h: Harness;
  readonly link: Link;
  readonly loader: MapLoader;
  readonly session: ClientSession;
  readonly end: LoopbackEnd;
  readonly wants: Wants;
  /** Hand-overs of the statics taken to their end. */
  handed = 0;
  /** Frames on which the body was predicted over ground not the map's own, or by a wheel over streets listed and not held. */
  readonly unsound: string[] = [];
  frames = 0;
  /** Called after each frame of `run`, where set: a scene's build. */
  onFrame: (() => void) | null = null;

  private constructor(h: Harness, link: Link, loader: MapLoader, session: ClientSession, end: LoopbackEnd, wants: Wants) {
    [this.h, this.link, this.loader, this.session, this.end, this.wants] = [h, link, loader, session, end, wants];
  }

  /** Joins `h` as `name` with a page of `file` wanting `wants`, to its first frame; `intent` as a page that comes back gives. */
  static async open(h: Harness, file: Uint8Array, name: string, wants: Wants, intent?: "resume", cityMaker?: CityMaker, from?: Link): Promise<Page> {
    const link = from ?? new Link(file);
    const loader = await startLoader(link);
    const { head, hf, nodes } = loader.staged;
    const end = h.net.connect({ latencyMs: 30 });
    h.gate(end.peer);
    const session = new ClientSession(end, {
      name,
      key: testKey(name),
      ...(intent ? { intent } : {}),
      spectate: false,
      registry: h.reg,
      clipHash: h.world.anim.set.hash,
      look: defaultLook(),
      resolveMap: (id, hash) => (id === head.id && hash === head.hash ? hf : null),
      nodes: (ground, content) => nodeLayers(head.dims, ground, content, nodes),
      tops: loader.staged.tops,
      buildings: loader.staged.buildings,
      held: loader.held,
      chartPlaces: head.spawns,
      ...(cityMaker ? { cityMaker } : {}),
    });
    const inner = h as unknown as { servers: unknown[]; manual: Set<ClientSession> };
    h.sessions.push(session);
    h.ends.push(end);
    inner.servers.push(end.peer);
    h.pilots.push({ moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 });
    // No frame is drawn before the first frame's parts have come.
    inner.manual.add(session);
    const page = new Page(h, link, loader, session, end, wants);
    for (let k = 0; k < 400 && !session.world; k++) h.run(16);
    if (!session.world) throw new Error(`${name} was not welcomed: ${session.state}`);
    let drawn = false;
    void loader.follow(() => session.mapFocus, { arriving: () => page.arriving(), want: () => wantOf(wants), held: () => session.behind }).then(() => (drawn = true));
    for (let k = 0; k < 400 && !drawn; k++) {
      await link.drain(0, 1);
      h.run(16);
    }
    if (!drawn) throw new Error("the first frame never came");
    inner.manual.delete(session);
    return page;
  }

  private *arriving(): Generator<void, void> {
    yield* this.session.staticsSteps();
    this.handed++;
  }

  /** `ms` of the game and of the link, a frame at a time, the loader's promises run between frames. */
  async run(ms: number): Promise<void> {
    for (let left = ms; left > 0; left -= 1000 / 60) {
      this.h.run(1000 / 60);
      this.watch();
      this.onFrame?.();
      await this.link.advance(1000 / 60);
      await turn();
    }
  }

  /** Looks at the frame just run: a body predicted stands on the map's own ground, a wheel on held streets. */
  watch(): void {
    const s = this.session, hf = this.loader.staged.hf, r = 128;
    this.frames++;
    if (s.state !== "active" || !s.predicting || this.unsound.length > 20) return;
    const b = s.own;
    if (!hf.exactIn(b.x - r, b.z - r, b.x + r, b.z + r)) this.unsound.push(`frame ${this.frames}: predicted at ${b.x.toFixed(1)}, ${b.z.toFixed(1)} over ground that stands in`);
    else if (s.driving >= 0 && hf.streets && !hf.streets.heldIn(b.x - r, b.z - r, b.x + r, b.z + r)) this.unsound.push(`frame ${this.frames}: a wheel predicted at ${b.x.toFixed(1)}, ${b.z.toFixed(1)} over streets listed and not held`);
  }

  /** The server's client for this page. */
  get client() {
    return this.h.client(this.session)!;
  }

  /** Sets the body down at (x, z) on the server, as an admin's teleport does. */
  tp(x: number, z: number): void {
    this.client.admin = true;
    this.session.text(`tp ${x.toFixed(2)} ${z.toFixed(2)}`);
  }

  /** The chunks the server has sent this page whole, at the version it holds now. */
  whole(): number[] {
    const c = this.client, structs = this.h.world.structs;
    return c.subscribed.filter((k) => structs.chunks[k] && c.known[k] === structs.chunks[k]!.version);
  }
}

/** Slots of `chunks` that differ between the server's `structs` and a client's `held`, an owned piece's health the stage a client is told. */
export function differ(structs: StructureStore, held: StructureStore, chunks: readonly number[]): number {
  let n = 0;
  for (const c of chunks) {
    const [t, u] = [structs.chunks[c]!, held.chunks[c]];
    if (!u) {
      n += t.live;
      continue;
    }
    for (let s = 0; s < Math.max(t.high, u.high); s++) {
      const kind = t.kind[s] ?? 0;
      const hp = kind !== 0 && t.owner[s] !== 0 ? toldHealth(t.hp[s]!, structs.fullHp![kind]!) : t.hp[s];
      if (kind !== (u.kind[s] ?? 0) || (kind !== 0 && ([t.x, t.y, t.z, t.yaw, t.owner].some((col, i) => col[s] !== [u.x, u.y, u.z, u.yaw, u.owner][i]![s]) || hp !== u.hp[s]))) n++;
    }
  }
  return n;
}
