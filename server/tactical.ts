// The server's part of the map. Each chunk's structures are baked to cells (shared/world/tactical.ts) and sent to the clients
// that may see them, so a base shows far beyond the view without a piece of it being sent. What each client holds is kept
// here by client id.

import { CHUNK_SIZE, TICK_RATE, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { CMD_MAP_ZOOM, RESULT_INVALID, RESULT_OK, S_TACTICAL } from "../shared/net/protocol.ts";
import type { Connection } from "../shared/net/transport.ts";
import { Summary, TACTICAL_LEVELS, bakeChunk, onlyTeam, writeCells, type PieceShapes } from "../shared/world/tactical.ts";
import type { Client, GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { ServerWorld } from "./world.ts";

export interface TacticalOptions {
  /**
   * Metres. Another tribe's structures show on a survivor's map once it has been this near them, and stay there after it
   * leaves. Its own tribe's show anywhere. 0 shows only its own tribe's.
   */
  tacticalRadius: number;
}

const DEFAULTS: TacticalOptions = { tacticalRadius: 512 };

/** Ticks between two bakes of one chunk, the most chunks baked in a tick, and the most waiting chunks looked at in one. */
const BAKE_EVERY = 5 * TICK_RATE;
const BAKES_PER_TICK = 4;
const LOOKS_PER_TICK = 16;
/** Bytes of cells sent to one client in a second. */
const CELL_BYTES = 1024;

/** Held.how: the level it was sent in the low two bits, whether it was sent every team's cells, and whether it has been within the radius. */
const HOW_LEVEL = 3;
const HOW_FULL = 4;
const HOW_NEAR = 8;

/** What one connection holds of the map. */
class Held {
  conn: Connection | null = null;
  /** Per chunk: the version of the summary it was sent, 0 for none, and the HOW_ bits. */
  readonly sent: Uint32Array;
  readonly how: Uint8Array;
  /** The finest map zoom it says it is showing. */
  zoom = 0;
  /** Where among its tribe's chunks the next second starts. */
  cursor = 0;

  constructor(chunks: number) {
    this.sent = new Uint32Array(chunks);
    this.how = new Uint8Array(chunks);
  }
}

export class Tactical {
  readonly opts: TacticalOptions;
  /** Chunks baked, and S_TACTICAL messages and bytes sent. */
  readonly stats = { bakes: 0, cells: 0, cellBytes: 0 };
  /** Per chunk, or null for one that has never held a structure. */
  readonly summaries: (Summary | null)[];

  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly records: Records;
  private readonly shapes: PieceShapes;
  private readonly held: (Held | null)[];
  /** Per chunk: the table version last looked at, the tick of its last bake, and whether it waits in `queue`. */
  private readonly seen: Uint32Array;
  private readonly bakedAt: Uint32Array;
  private readonly queued: Uint8Array;
  private readonly queue: number[] = [];
  /** The chunks that hold each team's cells. */
  private readonly ofTeam = new Map<number, number[]>();
  private readonly fresh = new Summary();
  private readonly part = new Summary();
  private steppedAt = -1;
  /** Chunk offsets within `ringFor` metres and a chunk more, nearest first. */
  private ring: Int16Array = new Int16Array(0);
  private ringFor = -1;

  constructor(world: ServerWorld, game: GameServer, records: Records, opts: Partial<TacticalOptions> = {}) {
    this.world = world;
    this.game = game;
    this.records = records;
    this.opts = { ...DEFAULTS, ...opts };
    const reg = world.reg;
    this.shapes = { halfX: reg.halfX, halfY: reg.halfY, halfZ: reg.halfZ, tint: Uint8Array.from(reg.defs, (d) => (d?.type === "structure" ? d.color : 0)) };
    const chunks = chunkCount(world.dims);
    this.summaries = new Array<Summary | null>(chunks).fill(null);
    this.held = new Array<Held | null>(game.clients.length).fill(null);
    this.seen = new Uint32Array(chunks);
    this.bakedAt = new Uint32Array(chunks);
    this.queued = new Uint8Array(chunks);
    // What stands at the start is baked at once, so every tribe's chunks are known before anyone joins.
    this.sweep();
    while (this.queue.length > 0) this.bake(this.queue.pop()!, 0);
    game.handle(CMD_MAP_ZOOM, (c, r) => {
      const zoom = r.bits(2);
      if (r.overflow) return RESULT_INVALID;
      this.of(c).zoom = zoom;
      return RESULT_OK;
    });
  }

  /** Call for each connected session once a tick, beside its other replication. */
  sync(c: Client): void {
    const T = this.world.tick;
    if (T !== this.steppedAt) this.step(T);
    // Each session's second starts on a tick of its own.
    if ((T + c.id * 7) % TICK_RATE === 0) this.sendCells(c, this.of(c));
  }

  private of(c: Client): Held {
    let h = this.held[c.id];
    if (!h) h = this.held[c.id] = new Held(this.summaries.length);
    if (h.conn !== c.conn) {
      // Another connection holds nothing yet.
      h.conn = c.conn;
      h.sent.fill(0);
      h.how.fill(0);
      h.zoom = 0;
      h.cursor = 0;
    }
    return h;
  }

  /** Once a tick: notice changed chunks every second, and bake a few of those waiting. */
  private step(T: number): void {
    this.steppedAt = T;
    if (T % TICK_RATE === 0) this.sweep();
    let baked = 0;
    for (let n = Math.min(this.queue.length, LOOKS_PER_TICK); n > 0 && baked < BAKES_PER_TICK; n--) {
      const chunk = this.queue.shift()!;
      if (this.bakedAt[chunk] !== 0 && T - this.bakedAt[chunk]! < BAKE_EVERY) {
        this.queue.push(chunk);
        continue;
      }
      this.bake(chunk, T);
      baked++;
    }
  }

  /** Queues every chunk whose table changed since it was last looked at. */
  private sweep(): void {
    const tables = this.world.structs.chunks;
    for (let k = 0; k < tables.length; k++) {
      const t = tables[k];
      if (!t || t.version === this.seen[k]) continue;
      this.seen[k] = t.version;
      if (this.queued[k] === 0) {
        this.queued[k] = 1;
        this.queue.push(k);
      }
    }
  }

  private bake(chunk: number, T: number): void {
    const dims = this.world.dims;
    const fresh = this.fresh;
    bakeChunk(this.world.structs.chunks[chunk] ?? null, chunkCx(dims, chunk) * CHUNK_SIZE, chunkCz(dims, chunk) * CHUNK_SIZE, this.shapes, this.world.hf, fresh);
    this.queued[chunk] = 0;
    this.bakedAt[chunk] = T;
    this.stats.bakes++;
    let s = this.summaries[chunk];
    // A bake that changes nothing a map shows (health, a piece under another) gives no new version, so nothing is sent for it.
    if (s ? s.same(fresh) : fresh.filled === 0) return;
    s ??= this.summaries[chunk] = new Summary();
    for (let i = 0; i < s.teamCount; i++) {
      const list = fresh.teamIndex(s.teams[i]!) < 0 ? this.ofTeam.get(s.teams[i]!) : undefined;
      const at = list ? list.indexOf(chunk) : -1;
      if (at >= 0) list!.splice(at, 1);
    }
    for (let i = 0; i < fresh.teamCount; i++) {
      const team = fresh.teams[i]!;
      if (team === 0 || s.teamIndex(team) >= 0) continue;
      const list = this.ofTeam.get(team);
      if (list) list.push(chunk);
      else this.ofTeam.set(team, [chunk]);
    }
    s.copy(fresh);
    s.version++;
  }

  /** Once a second for each session: the chunks near it, nearest first, then its own tribe's wherever they are. */
  private sendCells(c: Client, h: Held): void {
    const dims = this.world.dims;
    const team = this.records.byPid.get(c.pid)?.team ?? 0;
    const level = TACTICAL_LEVELS - 1 - h.zoom;
    let budget = CELL_BYTES;
    const R = this.opts.tacticalRadius;
    if (R > 0) {
      if (this.ringFor !== R) {
        this.ring = nearestFirst(Math.ceil(R / CHUNK_SIZE) + 1);
        this.ringFor = R;
      }
      const ring = this.ring;
      const ccx = chunkCx(dims, c.chunk);
      const ccz = chunkCz(dims, c.chunk);
      for (let o = 0; o < ring.length; o += 2) {
        const cx = ccx + ring[o]!;
        const cz = ccz + ring[o + 1]!;
        if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
        const chunk = cz * dims.chunksX + cx;
        const s = this.summaries[chunk];
        if (!s) continue;
        const dx = (cx + 0.5) * CHUNK_SIZE - c.body.x;
        const dz = (cz + 0.5) * CHUNK_SIZE - c.body.z;
        if (dx * dx + dz * dz > R * R) continue;
        // Having been this near is what keeps another tribe's base on its map.
        h.how[chunk]! |= HOW_NEAR;
        if (budget > 0) budget = this.send(c, h, chunk, s, level, team, budget);
      }
    }
    const mine = this.ofTeam.get(team);
    if (!mine) return;
    for (let n = mine.length; n > 0 && budget > 0; n--) {
      const chunk = mine[h.cursor++ % mine.length]!;
      budget = this.send(c, h, chunk, this.summaries[chunk]!, level, team, budget);
    }
  }

  /** Sends the chunk if what the session holds of it is out of date or too coarse. Returns the budget left, or 0 if the message must wait. */
  private send(c: Client, h: Held, chunk: number, s: Summary, level: number, team: number, budget: number): number {
    const how = h.how[chunk]!;
    const near = (how & HOW_NEAR) !== 0;
    const had = h.sent[chunk]!;
    if (had === s.version && (how & HOW_LEVEL) <= level && ((how & HOW_FULL) !== 0) === near) return budget;
    let from = s;
    if (!near) {
      // It has never been near, so it is shown its own tribe's cells and no others.
      const owner = s.teamIndex(team);
      if (owner < 0 && had === 0) return budget;
      onlyTeam(s, owner, this.part);
      from = this.part;
    } else if (had === 0 && s.filled === 0) return budget;
    const w = this.game.begin(S_TACTICAL);
    writeCells(w, chunk, from, level);
    // Only the first message of a second may pass the budget.
    if (w.byteLength > budget && budget < CELL_BYTES) return 0;
    this.game.endOwn(c);
    h.sent[chunk] = s.version;
    h.how[chunk] = (how & HOW_NEAR) | (near ? HOW_FULL : 0) | level;
    this.stats.cells++;
    this.stats.cellBytes += w.byteLength;
    return budget - w.byteLength;
  }
}

/** Chunk offsets within a square radius, as (dx, dz) pairs sorted by distance. */
function nearestFirst(radius: number): Int16Array {
  const list: [number, number][] = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) list.push([dx, dz]);
  list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  return Int16Array.from(list.flat());
}
