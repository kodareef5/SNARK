// The server's part of the map. Each chunk's structures are baked to cells (shared/world/tactical.ts) and sent to the clients
// that may see them, so a base shows far beyond the view without a piece of it being sent. Once a second each tribe's members
// and creatures are sent to it as marks, wherever they are. The same bake keeps far cells, every tribe's alike and with no
// owner, which are sent within FarRadius for drawing on the horizon and never reach the map. What each client holds is kept
// here by client id.

import { SPOTS_MOST } from "../shared/net/protocol.ts";
import { CHUNK_SIZE, TICK_RATE, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { hashBytes } from "../shared/hash.ts";
import { BitWriter } from "../shared/net/codec.ts";
import { CMD_FAR, CMD_MAP_ZOOM, RESULT_INVALID, RESULT_OK, S_FAR, S_MARKS, S_TACTICAL } from "../shared/net/protocol.ts";
import { CH_UNRELIABLE, type Connection } from "../shared/net/transport.ts";
import { F_ALIVE, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import type { MapExtent } from "../shared/world/coords.ts";
import { MARK_MATE, MARK_OTHER, MARK_SPOT, MARK_TAME, MAX_MARKS, PLAYERS_ALL, PLAYERS_OFF, PLAYERS_VIEW, Summary, bakeChunk, levelFor, onlyTeam, pieceShapes, writeCells, writeFar, writeMark, writeMarksHead, type PieceShapes } from "../shared/world/tactical.ts";
import type { Client, GameServer } from "./game.ts";
import type { Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { ServerWorld } from "./world.ts";

/** The words of the MapPlayers rule. Any other word is off. */
const PLAYERS: Record<string, number> = { off: PLAYERS_OFF, view: PLAYERS_VIEW, all: PLAYERS_ALL };

/** Ticks between two bakes of one chunk, the most chunks baked in a tick, and the most waiting chunks looked at in one. */
const BAKE_EVERY = 5 * TICK_RATE;
const BAKES_PER_TICK = 4;
const LOOKS_PER_TICK = 16;
/** Bytes of cells sent to one client in a second. */
const CELL_BYTES = 1024;
/**
 * Bytes of far cells sent to one client in a second: 2 KB of chunks it holds older, and 8 KB in all while some in its reach
 * it holds not at all. A second's go out over its ticks, a kilobyte or one message a tick, so they never come as one burst.
 */
const FAR_BYTES = 2048;
const FAR_NEW_BYTES = 8192;
const FAR_TICK_BYTES = 1024;
/** Ticks between listing each tribe's creatures afresh, and the longest an unchanged list of marks goes unsent. */
const TAMES_EVERY = 10 * TICK_RATE;
const MARKS_REPEAT = 5 * TICK_RATE;
const MARK_BITS = 36;

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
  /** The marks it was last sent, as their hash and their head, and when. */
  marksKey = 0;
  marksHead = -1;
  marksAt = 0;
  /** Per chunk: the far version it was sent, 0 for none. What was sent is never taken back. */
  readonly farSent: Uint32Array;
  /** The metres of far cells it asked for. */
  farAsk = 0;
  /** The chunks due this second, nearest first, how many of them have been seen to, and the bytes sent of them, in all and of chunks it held older. */
  readonly farDue: number[] = [];
  farNext = 0;
  farAll = 0;
  farOlder = 0;

  constructor(chunks: number) {
    this.sent = new Uint32Array(chunks);
    this.how = new Uint8Array(chunks);
    this.farSent = new Uint32Array(chunks);
  }
}

/** One tribe's marks for a second: its members with bodies in the order of their sessions, then its creatures, then anyone else the rule shows. */
class TeamMarks {
  n = 0;
  kind = new Uint8Array(64);
  x = new Float32Array(64);
  z = new Float32Array(64);
  yaw = new Uint16Array(64);
  /** Every mark, written once for the whole tribe when they fit one message. `key` is their hash. */
  readonly w = new BitWriter(Math.ceil((MAX_MARKS * MARK_BITS) / 8));
  key = 0;

  add(kind: number, x: number, z: number, yaw: number): void {
    const n = this.n++;
    if (n === this.kind.length) {
      const grow = <T extends Uint8Array | Float32Array | Uint16Array>(a: T): T => {
        const b = new (a.constructor as new (n: number) => T)(n * 2);
        b.set(a);
        return b;
      };
      this.kind = grow(this.kind);
      this.x = grow(this.x);
      this.z = grow(this.z);
      this.yaw = grow(this.yaw);
    }
    this.kind[n] = kind;
    this.x[n] = x;
    this.z[n] = z;
    this.yaw[n] = yaw;
  }
}

export class Tactical {
  /**
   * Chunks baked, S_TACTICAL messages and bytes sent, S_MARKS messages and bytes sent, the marks left out of those
   * messages because a tribe had more than one holds, and S_FAR messages and bytes sent.
   */
  readonly stats = { bakes: 0, cells: 0, cellBytes: 0, marks: 0, markBytes: 0, marksLeftOut: 0, far: 0, farBytes: 0 };
  /** Per chunk, or null for one that has never held a structure. */
  readonly summaries: (Summary | null)[];

  private readonly world: ServerWorld;
  private readonly game: GameServer;
  private readonly records: Records;
  /** TacticalRadius, MapPlayers and FarRadius are read where they are used, so a change takes effect within a second. */
  private readonly rules: Rules;
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
  /** Entity indices of each tribe's creatures, as of `tamesAt`. */
  private readonly tames = new Map<number, number[]>();
  /** The creatures each tribe spotted (CMD_MARK, D1082), with their generations and the ticks their marks go. */
  private readonly spots = new Map<number, { e: number; gen: number; until: number }[]>();

  /** Marks creature `e` for `team` until tick `until`: again if it is marked, else in place of the oldest past SPOTS_MOST. */
  spot(team: number, e: number, until: number): void {
    const list = this.spots.get(team) ?? [];
    this.spots.set(team, list);
    const gen = this.world.ents.gen[e]!;
    const at = list.findIndex((s) => s.e === e && s.gen === gen);
    if (at >= 0) list.splice(at, 1);
    list.push({ e, gen, until });
    if (list.length > SPOTS_MOST) list.shift();
  }

  /** What `team` has spotted and holds marked now, for tests. */
  spotted(team: number): number[] {
    return (this.spots.get(team) ?? []).map((s) => s.e);
  }
  private tamesAt = -TAMES_EVERY;
  private readonly marksOf = new Map<number, TeamMarks>();
  private readonly spare: TeamMarks[] = [];
  /** Per client: its team this second, and its own place among that team's marks, or -1. */
  private teamOf: Uint32Array;
  private selfAt: Int32Array;
  /** Scratch for a tribe with more marks than a message holds: each mark's distance from the reader, and those sorted. */
  private far = new Float64Array(0);
  private sorted = new Float64Array(0);
  /** Chunks that have had far cells, which are all the far feed looks at. */
  private readonly farChunks: number[] = [];
  /** Scratch: the chunks a session is due, as distance squared times 65536 plus the chunk, so they sort nearest first. */
  private farOrder = new Float64Array(256);

  /** Makes room for more sessions, when MaxPlayers is raised while the server runs. */
  seats(n: number): void {
    if (n <= this.held.length) return;
    while (this.held.length < n) this.held.push(null);
    const teamOf = new Uint32Array(n), selfAt = new Int32Array(n);
    teamOf.set(this.teamOf);
    selfAt.set(this.selfAt);
    this.teamOf = teamOf;
    this.selfAt = selfAt;
  }

  constructor(world: ServerWorld, game: GameServer, records: Records, rules: Rules) {
    this.world = world;
    this.game = game;
    this.records = records;
    this.rules = rules;
    this.shapes = pieceShapes(world.reg);
    const chunks = chunkCount(world.dims);
    this.summaries = new Array<Summary | null>(chunks).fill(null);
    this.held = new Array<Held | null>(game.clients.length).fill(null);
    this.teamOf = new Uint32Array(game.clients.length);
    this.selfAt = new Int32Array(game.clients.length);
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
    game.handle(CMD_FAR, (c, r) => {
      const metres = r.u16();
      if (r.overflow) return RESULT_INVALID;
      this.ask(c, metres);
      return RESULT_OK;
    });
  }

  /** Call for each connected session once a tick, beside its other replication. */
  sync(c: Client): void {
    const T = this.world.tick;
    if (T !== this.steppedAt) this.step(T);
    // Each session's second for cells starts on a tick of its own. Marks are made for everyone on the same tick.
    const h = this.of(c);
    if ((T + c.id * 7) % TICK_RATE === 0) {
      this.sendCells(c, h);
      this.listFar(c, h);
    }
    if (h.farNext < h.farDue.length) this.sendFar(c, h);
    if (T % TICK_RATE === 0) this.sendMarks(c, h, T);
  }

  /** How far off a session wants far cells, in metres. It is sent them within the smaller of this and FarRadius. */
  ask(c: Client, metres: number): void {
    this.of(c).farAsk = metres;
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
      h.marksHead = -1;
      h.farSent.fill(0);
      h.farAsk = 0;
      h.farDue.length = 0;
    }
    return h;
  }

  /** Once a tick: every second notice changed chunks and make the marks, and bake a few of the chunks waiting. */
  private step(T: number): void {
    this.steppedAt = T;
    if (T % TICK_RATE === 0) {
      this.sweep();
      if (T - this.tamesAt >= TAMES_EVERY) this.listTames(T);
      this.mark();
    }
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
    // The far cells have a version of their own, so a change to one is never sent as the other.
    const mapSame = s ? s.same(fresh) : fresh.filled === 0;
    // A chunk already changed and empty at its first bake (razed before a restart) is news to a session that draws the statics.
    const farSame = s ? s.far.same(fresh.far) : fresh.far.filled === 0 && this.world.structs.asPlaced(chunk);
    if (mapSame && farSame) return;
    s ??= this.summaries[chunk] = new Summary();
    if (!farSame) {
      if (s.farVersion === 0) this.farChunks.push(chunk);
      s.far.copy(fresh.far);
      s.farVersion++;
    }
    if (mapSame) return;
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
    // Cells of the size that suits the window of the zoom it shows.
    const level = levelFor(Math.max(this.world.hf.sizeX, this.world.hf.sizeZ) / (1 << h.zoom));
    let budget = CELL_BYTES;
    const R = this.rules.num("TacticalRadius");
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

  /** Once a second for each session: the chunks within its reach whose far cells it holds older, nearest first. */
  private listFar(c: Client, h: Held): void {
    h.farDue.length = h.farNext = h.farAll = h.farOlder = 0;
    const reach = Math.min(this.rules.num("FarRadius"), h.farAsk);
    if (reach <= 0) return;
    const dims = this.world.dims;
    const list = this.farChunks;
    let order = this.farOrder;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const chunk = list[i]!;
      if (!this.farDue(c, h, chunk)) continue;
      const dx = (chunkCx(dims, chunk) + 0.5) * CHUNK_SIZE - c.body.x;
      const dz = (chunkCz(dims, chunk) + 0.5) * CHUNK_SIZE - c.body.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > reach * reach) continue;
      if (n === order.length) {
        order = new Float64Array(n * 2);
        order.set(this.farOrder);
        this.farOrder = order;
      }
      order[n++] = Math.floor(d2) * 65536 + chunk;
    }
    order.subarray(0, n).sort();
    for (let i = 0; i < n; i++) h.farDue.push(order[i]! % 65536);
  }

  /**
   * Whether the session is due the far cells of `chunk`. One that holds the map's statics draws a chunk as the map placed it
   * from them, and is due its cells once it has changed, even emptied, and again when a chunk it was sent stands as placed
   * once more. To any other an empty chunk is news only if it was sent it filled.
   */
  private farDue(c: Client, h: Held, chunk: number): boolean {
    const s = this.summaries[chunk]!;
    const had = h.farSent[chunk]!;
    if (had === s.farVersion) return false;
    const statics = c.statics ? this.world.statics : null;
    if (statics && had === 0 && this.world.structs.asPlaced(chunk)) return false;
    return had !== 0 || s.far.filled > 0 || (statics !== null && statics.first[chunk + 1]! > statics.first[chunk]!);
  }

  /**
   * Sends what is due of the far cells, each chunk whole in one message, within the second's bytes and this tick's. They go in
   * what the chunk rows leave of the window, so a join's near chunks come first.
   */
  private sendFar(c: Client, h: Held): void {
    let tick = 0;
    for (; h.farNext < h.farDue.length; h.farNext++) {
      const chunk = h.farDue[h.farNext]!;
      const s = this.summaries[chunk]!;
      const had = h.farSent[chunk]!;
      if (!this.farDue(c, h, chunk) || (had !== 0 && h.farOlder >= FAR_BYTES)) continue;
      // Open decision 2 (F5): a terrain check would test a chunk here, before its first send, since a send cannot be taken back.
      const w = this.game.begin(S_FAR);
      writeFar(w, chunk, s.far);
      const bytes = w.byteLength;
      if (h.farAll + bytes > FAR_NEW_BYTES) {
        h.farDue.length = 0;
        return;
      }
      if (had !== 0 && h.farOlder + bytes > FAR_BYTES) {
        h.farOlder = FAR_BYTES;
        continue;
      }
      if ((tick > 0 && tick + bytes > FAR_TICK_BYTES) || !this.game.replication.spendChunkWindow(c, bytes)) return;
      this.game.endOwn(c);
      h.farSent[chunk] = s.farVersion;
      tick += bytes;
      h.farAll += bytes;
      if (had !== 0) h.farOlder += bytes;
      this.stats.far++;
      this.stats.farBytes += bytes;
    }
  }

  /** A tribe's creatures are found by a pass over every entity, so the list is made seldom. One tamed since shows at the next. */
  private listTames(T: number): void {
    this.tamesAt = T;
    this.tames.clear();
    const { team, flags } = this.world.ents;
    for (let e = 0; e < team.length; e++) {
      const t = team[e]!;
      if (t === 0 || (flags[e]! & (F_ALIVE | F_PLAYER | F_PROP)) !== F_ALIVE) continue;
      const list = this.tames.get(t);
      if (list) list.push(e);
      else this.tames.set(t, [e]);
    }
  }

  /** The MapPlayers rule as a PLAYERS_ value. */
  private players(): number {
    return PLAYERS[this.rules.text("MapPlayers").toLowerCase()] ?? PLAYERS_OFF;
  }

  /** Makes this second's marks for every tribe with a session. */
  private mark(): void {
    const ents = this.world.ents;
    const clients = this.game.clients;
    for (const m of this.marksOf.values()) this.spare.push(m);
    this.marksOf.clear();
    for (const c of clients) {
      if (!c?.active) continue;
      const team = this.records.byPid.get(c.pid)?.team ?? 0;
      this.teamOf[c.id] = team;
      this.selfAt[c.id] = -1;
      if (team === 0) continue;
      let m = this.marksOf.get(team);
      if (!m) {
        m = this.spare.pop() ?? new TeamMarks();
        m.n = 0;
        this.marksOf.set(team, m);
      }
      if (c.ent < 0) continue;
      this.selfAt[c.id] = m.n;
      m.add(MARK_MATE, ents.x[c.ent]!, ents.z[c.ent]!, ents.yaw[c.ent]!);
    }
    const everyone = this.players() === PLAYERS_ALL;
    for (const [team, m] of this.marksOf) {
      const tames = this.tames.get(team);
      for (let i = 0; tames && i < tames.length; i++) {
        const e = tames[i]!;
        // It may have died or changed hands since the list was made.
        if (ents.team[e] === team && (ents.flags[e]! & (F_ALIVE | F_PLAYER | F_PROP)) === F_ALIVE) m.add(MARK_TAME, ents.x[e]!, ents.z[e]!, ents.yaw[e]!);
      }
      if (everyone) for (const c of clients) if (c?.active && c.ent >= 0 && this.teamOf[c.id] !== team) m.add(MARK_OTHER, ents.x[c.ent]!, ents.z[c.ent]!, ents.yaw[c.ent]!);
      // What it spotted, where it is now, while it lives and its mark lasts.
      const spots = this.spots.get(team);
      for (let k = spots ? spots.length - 1 : -1; k >= 0; k--) {
        const s = spots![k]!;
        if (this.world.tick >= s.until || ents.gen[s.e] !== s.gen || (ents.flags[s.e]! & (F_ALIVE | F_PROP)) !== F_ALIVE) spots!.splice(k, 1);
        else m.add(MARK_SPOT, ents.x[s.e]!, ents.z[s.e]!, ents.yaw[s.e]!);
      }
      if (m.n > MAX_MARKS) continue;
      const w = m.w;
      w.reset();
      for (let i = 0; i < m.n; i++) writeMark(w, m.kind[i]!, m.x[i]!, m.z[i]!, m.yaw[i]!, this.world.hf);
      m.key = hashBytes(w.bytes());
    }
  }

  /** Sends a session its tribe's marks if they changed, or if it has not been sent any for a while. They may be lost on the way. */
  private sendMarks(c: Client, h: Held, T: number): void {
    const m = this.marksOf.get(this.teamOf[c.id]!);
    let self = this.selfAt[c.id]!;
    let count = m ? m.n : 0;
    let leftOut = 0;
    if (m && count > MAX_MARKS) {
      // More than a message holds, so this reader gets the nearest to it, written for it alone. The rest are counted.
      this.nearest(m, self, c.body, this.world.hf);
      leftOut = count - MAX_MARKS - (self < 0 ? 0 : 1);
      count = MAX_MARKS;
      self = -1;
    }
    const players = this.players();
    const head = (self < 0 ? 255 : self) | (h.zoom << 8) | (players << 10) | (count << 12);
    const key = m ? m.key : 0;
    if (key === h.marksKey && head === h.marksHead && T - h.marksAt < MARKS_REPEAT) return;
    this.stats.marksLeftOut += leftOut;
    const w = this.game.begin(S_MARKS);
    writeMarksHead(w, head & 255, h.zoom, players, count);
    // The head ends on a byte, so the tribe's marks follow as they were written.
    if (m) for (const b of m.w.bytes()) w.u8(b);
    c.conn.send(CH_UNRELIABLE, w.bytes());
    h.marksKey = key;
    h.marksHead = head;
    h.marksAt = T;
    this.stats.marks++;
    this.stats.markBytes += w.byteLength;
  }

  /** Writes the MAX_MARKS of `m` nearest to `at`, leaving out the reader's own, in place of the whole tribe's. */
  private nearest(m: TeamMarks, self: number, at: { x: number; z: number }, map: MapExtent): void {
    if (this.far.length < m.n) {
      this.far = new Float64Array(m.kind.length);
      this.sorted = new Float64Array(m.kind.length);
    }
    const far = this.far;
    for (let i = 0; i < m.n; i++) {
      const dx = m.x[i]! - at.x;
      const dz = m.z[i]! - at.z;
      far[i] = i === self ? Infinity : dx * dx + dz * dz;
    }
    const sorted = this.sorted.subarray(0, m.n);
    sorted.set(far.subarray(0, m.n));
    sorted.sort();
    const reach = sorted[MAX_MARKS - 1]!;
    const w = m.w;
    w.reset();
    for (let i = 0, n = 0; i < m.n && n < MAX_MARKS; i++) {
      if (far[i]! > reach) continue;
      writeMark(w, m.kind[i]!, m.x[i]!, m.z[i]!, m.yaw[i]!, map);
      n++;
    }
    m.key = hashBytes(w.bytes());
  }
}

/** Chunk offsets within a square radius, as (dx, dz) pairs sorted by distance. */
function nearestFirst(radius: number): Int16Array {
  const list: [number, number][] = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) list.push([dx, dz]);
  list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  return Int16Array.from(list.flat());
}
