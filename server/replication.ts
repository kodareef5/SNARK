// Replication: what each session is sent each tick. Its own session's state, the systems' feeds, a snapshot of the
// entities in its interest as a delta against one it acknowledged, and the rows of the chunks round it. A sight's cone
// (server/gaze.ts) widens both. The order within a session's turn is the order of `send`.

import { CHUNK_SIZE, STRUCT_UNITS, TICK_RATE, chunkAt, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import { type BitReader, type BitWriter, Named } from "../shared/net/codec.ts";
import { BUTTON_BITS, MARGIN_UNKNOWN, OWN_SESSION, REMOVAL_NEWS_TICKS, RESULT_INVALID, RESULT_OK, S_CHUNK, S_CHUNK_DROP, S_OWN, S_SNAPSHOT, writeBody } from "../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../shared/net/transport.ts";
import { MAX_VIEW, SentView, VIEW_DEFAULT, VIEW_RING, quantX, quantY, writeViewDelta } from "../shared/net/view.ts";
import { ContactSnapshot, writeContacts } from "../shared/net/contact.ts";
import { packVehicleDrive, packVehiclePose, quantVehicleWheel, packVehicleRide } from "../shared/sim/vehicle-body.ts";
import { packVehicleRotor, packVehicleSystems, packVehicleQuaternionPair, packBoatWater } from "../shared/sim/vehicle-presentation.ts";
import { drivetrainShifting } from "../shared/sim/vehicle-drivetrain.ts";
import { F_PLAYER, F_PROP, F_GROUNDED } from "../shared/sim/entities.ts";
import { GONE_TAKEN, RECENT } from "../shared/world/structures.ts";
import { sortU32 } from "../shared/sort.ts";
import type { ChunkTable } from "../shared/world/structures.ts";
import { staticKinds, type MapStatics } from "../shared/world/mapfile.ts";
import type { Client, GameOptions, GameStats } from "./game.ts";
import type { ServerWorld } from "./world.ts";
import { PART, type TickParts } from "./admin/parts.ts";

/** The least snapshot budget a client may ask for, in bytes. The quarter of it that a crowd of players leaves the rest holds any one create. */
const SNAPSHOT_BYTES_MIN = 600;
/** The most bits one row of a chunk message takes: slot 25, in place 1, kind 17, x and z 30, height 41, yaw 17, owner 41, health 33. */
const ROW_BITS = 205;
/**
 * Chunk bytes a client may have on the way, or two ticks of the slot budget if that is more. On one stream everything
 * sent before a snapshot it has read has reached it, so what was sent since its newest acknowledged snapshot is still
 * coming, ahead of the snapshots after it.
 */
const CHUNK_WINDOW = 16 * 1024;
/** Ticks a chunk a sight's cone had sent is held after the cone leaves it: turning about or lowering it makes no churn (D1087). */
export const CONE_KEEP = 150;
/** The most entities a session's sight's cone adds to its view (D1079). */
export const CONE_ENTITIES = 192;

/** What replication needs of the game. It needs nothing of the sessions or the player step. */
export interface ReplicationContext {
  readonly world: ServerWorld;
  readonly opts: GameOptions;
  /** The sessions, by slot (GameServer.clients). */
  readonly clients: readonly (Client | null)[];
  readonly stats: GameStats;
  /** The game's one writer: a message is built in it and sent before the next is begun. */
  readonly w: BitWriter;
  readonly parts: TickParts;
}

export class Replication {
  private readonly world: ServerWorld;
  private readonly opts: GameOptions;
  private readonly clients: readonly (Client | null)[];
  private readonly stats: GameStats;
  private readonly w: BitWriter;
  private readonly parts: TickParts;
  /** Called for each connected session just before its snapshot. */
  onReplicate: ((c: Client) => void) | null = null;
  /** The complete view actually sent, after budget selection and a successful snapshot write. */
  onSnapshot: ((c: Client, view: SentView) => void) | null = null;
  /** Authority-provided contact neighbourhood for driver prediction, independent of the render view. */
  contactProxies: ((c: Client, out: ContactSnapshot) => void) | null = null;
  /** The shared view around a session as that session may be sent it, or the same view. */
  viewFor: ((c: Client, cur: SentView) => SentView) | null = null;
  /**
   * The chunks past its own a session looks into through a sight (server/gaze.ts), best first, or null: their entities
   * are added to its view after those round it, which come first under its cap (D1079).
   */
  cone: ((c: Client) => { readonly chunks: Int32Array; readonly count: number; readonly players?: readonly number[] } | null) | null = null;
  private readonly contactSnapshot = new ContactSnapshot();
  /** The entities around each chunk that is some client's centre this tick, gathered once and shared by every client centred there. */
  private readonly around: SentView[] = [];
  /** For each of those lists, each entry's place in the order it was chosen in. A client is sent the entries below its cap. */
  private readonly ranks: Uint16Array[] = [];
  private gathered = 0;
  /**
   * Ticks the loop (server/main.ts) was behind its clock as the tick about to run began. The loop sets it before each
   * tick, so that a wrapper of `tick` cannot lose it. A margin is told against the tick due, so a page's clock keeps to
   * the loop's clock while the loop catches up.
   */
  behind = 0;
  /** Ticks the loop gave up since the start. */
  given = 0;
  /** The tick due when snapshots last went out. While the loop catches up they go out at the clock's pace, not each tick's. */
  private dueSent = 0;
  /** `opts.viewCap`, held to what a view can hold. */
  private cap: number;
  /** Per chunk: the tick `around[aroundAt]` was gathered for it. */
  private readonly aroundTick: Uint32Array;
  private readonly aroundAt: Uint16Array;
  /** A slot changed, times 2, plus 1 where it was moved, made or emptied. */
  private readonly changed = new Uint32Array(RECENT);
  /** The map's statics' kinds as content indices. */
  private readonly staticKinds: Uint16Array | null;
  /** Kept through the rows of one chunk message: the last row's slot and height, and the values it has named. */
  private rowSlot = -1;
  private rowY = 0;
  private readonly kinds = new Named();
  private readonly yaws = new Named();
  private readonly owners = new Named();
  private readonly ids = new Uint32Array(MAX_VIEW);
  private readonly movers = new Uint32Array(MAX_VIEW);
  private readonly idle = new Uint32Array(MAX_VIEW);
  private readonly entityOffsets: Int16Array;
  private readonly structOffsets: Int16Array;

  constructor(ctx: ReplicationContext) {
    const world = (this.world = ctx.world);
    this.opts = ctx.opts;
    this.clients = ctx.clients;
    this.stats = ctx.stats;
    this.w = ctx.w;
    this.parts = ctx.parts;
    this.cap = Math.max(1, Math.min(MAX_VIEW, Math.floor(this.opts.viewCap)));
    this.aroundTick = new Uint32Array(chunkCount(world.dims));
    this.aroundAt = new Uint16Array(chunkCount(world.dims));
    this.entityOffsets = nearestFirst(this.opts.entityRadius);
    this.structOffsets = nearestFirst(this.opts.structRadius);
    this.staticKinds = world.statics ? staticKinds(world.statics, world.reg) : null;
  }

  /** Ticks the loop gave up: every page is told, and moves its clock back as many. */
  giveUp(ticks: number): void {
    this.given += ticks;
    this.dueSent -= ticks;
  }

  /** Once a tick, after history: each connected session's turn, in slot order. */
  send(T: number): void {
    const world = this.world;
    const ents = world.ents;
    const parts = this.parts;
    const behind = this.behind;
    const every = this.opts.snapshotEvery;
    const snap = behind > 0 ? T + behind >= this.dueSent + every : T % every === 0;
    if (snap) this.dueSent = T + behind;
    this.gathered = 0;
    for (const c of this.clients) {
      if (!c?.active || c.closed) continue;
      // Commands and systems may have moved or replaced the body since it stepped.
      const at = c.drive >= 0 ? c.drive : c.ent;
      if (at >= 0) {
        ents.loadBody(at, c.body);
        c.chunk = chunkAt(world.dims, c.body.x, c.body.z);
      }
      if (c.ownDirty) this.sendOwn(c);
      this.onReplicate?.(c);
      parts.mark(PART.own);
      if (snap) this.snapshot(c, T);
      parts.mark(PART.snapshot);
      this.syncChunks(c, T);
      parts.mark(PART.chunks);
    }
  }

  /** Every session is told its state again (OWN_SESSION), at its next turn. */
  /** Takes the most bodies a session may be shown from the options again (ViewCap). A session has it at its next ask. */
  recap(): void {
    this.cap = Math.max(1, Math.min(MAX_VIEW, Math.floor(this.opts.viewCap)));
  }

  markAllOwn(): void {
    for (const c of this.clients) if (c?.active) c.ownDirty = true;
  }

  /** OWN_SESSION: the session's state, its role, its body and the day's offset. */
  private sendOwn(c: Client): void {
    const w = this.w;
    w.reset();
    w.u8(S_OWN);
    w.u8(OWN_SESSION);
    w.bits(c.state, 2);
    w.bool(c.admin);
    w.u32(c.ent >= 0 ? this.world.ents.handleOf(c.ent) : 0);
    w.u32(this.world.dayOffset);
    // The clock's pace with its offset, so a pace changed while the server runs never shows another hour.
    w.f64(this.world.clock.cycle);
    w.f64(this.world.clock.day);
    w.f64(this.world.clock.night);
    c.conn.send(CH_RELIABLE, w.bytes());
    c.ownDirty = false;
  }

  /** CMD_STATICS. Every chunk message sent after the answer takes from the map what is as the map has it. */
  takeStatics(c: Client): number {
    if (!this.world.statics) return RESULT_INVALID;
    c.statics = true;
    return RESULT_OK;
  }

  /** CMD_VIEW. The snapshot takes up what was asked. */
  askView(c: Client, r: BitReader): number {
    const view = r.u16();
    const bytes = r.u16();
    if (r.overflow) return RESULT_INVALID;
    c.wantView = Math.max(1, Math.min(view, this.cap));
    c.wantBytes = Math.max(SNAPSHOT_BYTES_MIN, Math.min(bytes, this.opts.snapshotBytesMax));
    return RESULT_OK;
  }

  /**
   * Where in `around` and `ranks` the entities are that a client centred on `chunk` may see at tick `T`, sorted by index. Every
   * client centred there shares the list, so it includes each one's own body, and the delta writer leaves that out. Players and
   * what they ride are chosen first, then anything moving or acting, then idle entities and props, so with more entities than the server's cap or
   * a client's own, a crowd of idle creatures never hides a player.
   */
  private viewAround(chunk: number, T: number): number {
    if (this.aroundTick[chunk] === T) return this.aroundAt[chunk]!;
    const world = this.world;
    const ents = world.ents;
    const dims = world.dims;
    const ccx = chunkCx(dims, chunk);
    const ccz = chunkCz(dims, chunk);
    const ids = this.ids;
    const movers = this.movers;
    const idle = this.idle;
    const offsets = this.entityOffsets;
    const cap = this.cap;
    let n = 0;
    let nm = 0;
    let ni = 0;
    for (let o = 0; o < offsets.length; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
        const f = ents.flags[i]!;
        if ((f & F_PLAYER) !== 0 || ents.driven[i] !== 0) {
          if (n < cap) ids[n++] = i;
        } else if ((f & F_PROP) === 0 && (ents.vx[i] !== 0 || ents.vz[i] !== 0 || ents.vy[i] !== 0 || ents.act[i] !== 0)) {
          if (nm < cap) movers[nm++] = i;
        } else if (ni < cap) idle[ni++] = i;
      }
    }
    for (let k = 0; k < nm && n < cap; k++) ids[n++] = movers[k]!;
    for (let k = 0; k < ni && n < cap; k++) ids[n++] = idle[k]!;
    // Each is sorted with the rank it was chosen at. An index is under 2^20 (shared/ids.ts), so the two fit one number.
    for (let k = 0; k < n; k++) ids[k] = ids[k]! * MAX_VIEW + k;
    sortU32(ids, n);
    const at = this.gathered++;
    const cur = (this.around[at] ??= new SentView());
    const rank = (this.ranks[at] ??= new Uint16Array(MAX_VIEW));
    cur.count = 0;
    for (let k = 0; k < n; k++) {
      const i = Math.floor(ids[k]! / MAX_VIEW);
      rank[k] = ids[k]! % MAX_VIEW;
      this.pushEntity(cur, i);
    }
    this.aroundTick[chunk] = T;
    this.aroundAt[chunk] = at;
    return at;
  }

  /** Adds entity `i` as it stands to `view`, and whether its changes go first. */
  private pushEntity(view: SentView, i: number): void {
    const ents = this.world.ents;
    const vehicle = this.world.reg.vehicle[ents.kind[i]!], rotor = vehicle?.movement === "rotor", v = ents.vrow[i]!;
    const skate = vehicle ? ents.skate.get(v) : undefined;
    view.push(i, ents.gen[i]!, ents.kind[i]!, quantX(ents.x[i]!), quantY(ents.y[i]!), quantX(ents.z[i]!), ents.yaw[i]! >>> 6,
      (ents.flags[i]! >>> 1) & 0xf, ents.anim[i]!, ents.rev[i]!, ents.cue[i]!,
      vehicle ? packVehiclePose(ents.vehiclePitch[v]!, ents.vehicleRoll[v]!, ents.steering[v]!) : 0,
      vehicle ? quantVehicleWheel(ents.wheelAngle[v]!) : 0,
      vehicle ? packVehicleRide(ents.vehicleGroundPitch[v]!, ents.vehicleGroundRoll[v]!, ents.vehicleRideOffset[v]!, (ents.flags[i]! & F_GROUNDED) !== 0) : 0,
      ents.vehicleDoors[v]!, vehicle && !rotor ? packVehicleDrive(skate?.move ?? ents.vehicleGear[v]!, skate ? Math.hypot(ents.vx[i]!, ents.vz[i]!) * 100 : ents.vehicleRpm[v]!, skate ? skate.switched : vehicle.movement === "boat" ? ents.vehicleShiftTime[v]! > 0 : drivetrainShifting(ents.vehicleShiftTime[v]!, vehicle.spec.drivetrain), (ents.flags[i]! & F_PROP) === 0 ? ents.vehicleLightMode[v]! : 0) : 0,
      // A car's rotor word is its thrusters' state, what fired on its last tick among it (shared/sim/vehicle-thrusters.ts).
      rotor ? packVehicleRotor(ents.vehicleRotorRpm[v]!, ents.vehicleRotorPhase[v]!) : vehicle?.movement !== "boat" && vehicle?.spec.thrusters ? ents.vehicleThrust[v]! : 0,
      vehicle ? packVehicleSystems(ents.fuel[v]!, vehicle.spec.fuelCapacity, ents.vehicleEngineCondition[v]!, ents.vehicleRotorCondition[v]!, ents.vehicleEngineOn[v] !== 0) : 0,
      vehicle ? packVehicleQuaternionPair(ents.vehicleQx[v]!, ents.vehicleQy[v]!) : 0,
      vehicle ? packVehicleQuaternionPair(ents.vehicleQz[v]!, ents.vehicleQw[v]!) : 0,
      vehicle ? packBoatWater(ents.vehicleHullCondition[v]!, ents.vehicleFlooding[v]!) : 0, ents.emote[i]!, ents.react[i]!);
    view.urgent[view.count - 1] = (ents.flags[i]! & F_PLAYER) !== 0 || ents.driven[i] !== 0 ? 1 : 0;
  }

  /**
   * `cur`, the view round `c`, and after it the entities of the chunks of its cone (`cone`) as far as CONE_ENTITIES: players
   * and what they ride first, then what moves, then the rest, each in the cone's order. Ascending by index as a view is,
   * ranked after all of `cur`'s, so a cap leaves them out first. Written to the session's own view and ranks.
   */
  private widen(c: Client, cur: SentView, ranks: Uint16Array, cone: { readonly chunks: Int32Array; readonly count: number; readonly players?: readonly number[] }): SentView {
    const ents = this.world.ents;
    const { ids, movers, idle } = this;
    const most = Math.min(CONE_ENTITIES, MAX_VIEW - cur.count);
    let n = 0, nm = 0, ni = 0;
    // The survivors its sight sees wherever they stand in it first (D1088); a chunk's own count them again, left out below.
    for (const e of cone.players ?? []) if (n < most) ids[n++] = e;
    for (let k = 0; k < cone.count; k++) {
      for (let i = ents.chunkHead[cone.chunks[k]!]!; i >= 0; i = ents.next[i]!) {
        const f = ents.flags[i]!;
        if ((f & F_PLAYER) !== 0 || ents.driven[i] !== 0) {
          if (n < most) ids[n++] = i;
        } else if ((f & F_PROP) === 0 && (ents.vx[i] !== 0 || ents.vz[i] !== 0 || ents.vy[i] !== 0 || ents.act[i] !== 0)) {
          if (nm < most) movers[nm++] = i;
        } else if (ni < most) idle[ni++] = i;
      }
    }
    for (let k = 0; k < nm && n < most; k++) ids[n++] = movers[k]!;
    for (let k = 0; k < ni && n < most; k++) ids[n++] = idle[k]!;
    for (let k = 0; k < n; k++) ids[k] = ids[k]! * MAX_VIEW + k;
    sortU32(ids, n);
    // One counted twice, as a survivor seen and in a chunk of the cone, once.
    let u = 0;
    for (let k = 0; k < n; k++) if (u === 0 || Math.floor(ids[k]! / MAX_VIEW) !== Math.floor(ids[u - 1]! / MAX_VIEW)) ids[u++] = ids[k]!;
    n = u;
    const wide = (c.wide ??= new SentView()), wideRanks = (c.wideRanks ??= new Uint16Array(MAX_VIEW));
    wide.count = 0;
    let a = 0, b = 0;
    while (a < cur.count || b < n) {
      const fromCone = b < n ? Math.floor(ids[b]! / MAX_VIEW) : -1;
      if (a < cur.count && (b >= n || cur.id[a]! <= fromCone)) {
        // An entity in both is the view's own: the cone's copy is left out.
        if (cur.id[a] === fromCone) b++;
        wide.copyFrom(cur, a);
        wide.urgent[wide.count - 1] = cur.urgent[a]!;
        wideRanks[wide.count - 1] = ranks[a]!;
        a++;
      } else {
        this.pushEntity(wide, fromCone);
        wideRanks[wide.count - 1] = cur.count + (ids[b]! % MAX_VIEW);
        b++;
      }
    }
    return wide;
  }

  private snapshot(c: Client, T: number): void {
    const ents = this.world.ents;
    // The client predicts its own body, so the view leaves it out. While it drives a mount, both bodies are in the view.
    const self = c.drive >= 0 ? -1 : c.ent;
    const at = this.viewAround(c.chunk, T);
    let cur = this.viewFor ? this.viewFor(c, this.around[at]!) : this.around[at]!;
    let ranks = this.ranks[at]!;
    const cone = this.cone ? this.cone(c) : null;
    if (cone && (cone.count > 0 || (cone.players?.length ?? 0) > 0)) {
      cur = this.widen(c, cur, ranks, cone);
      ranks = c.wideRanks!;
    }
    // What it asked for takes effect once a second at most, so that it cannot have its view sent over and over.
    if ((c.wantView !== c.viewCap || c.wantBytes !== c.snapshotBytes) && T >= c.viewReadyAt) {
      c.viewCap = c.wantView;
      c.snapshotBytes = c.wantBytes;
      c.viewReadyAt = T + TICK_RATE;
    }
    const limit = c.viewCap !== 0 ? c.viewCap : Math.min(VIEW_DEFAULT, this.cap);

    const age = T - c.ackTick;
    const base = c.ackTick > 0 && age < VIEW_RING ? c.views.find(c.ackTick) : null;
    const next = c.views.alloc(T);

    const w = this.w;
    w.reset();
    w.u8(S_SNAPSHOT);
    w.u32(T);
    w.u8(base ? age : 0);
    // Before the first input there is no margin. Sending 0 - T would tell a client joining a
    // long-running world that it is hopelessly late.
    let margin = c.newestInput - T - this.behind;
    if (c.newestInput === 0) margin = MARGIN_UNKNOWN;
    else if (margin < -127) margin = -127;
    else if (margin > 127) margin = 127;
    w.sbits(margin, 8);
    const given = (this.given - c.givenAt) & 0xffff;
    w.bool(given !== 0);
    if (given !== 0) w.u16(given);
    w.bool(c.carried !== 0);
    if (c.carried !== 0) w.bits(c.carried, BUTTON_BITS);
    w.bits(c.state, 2);
    // 0 for its own body, else the index of the entity it drives plus one.
    w.varint(c.drive + 1);
    writeBody(w, c.body);
    const bytes = c.snapshotBytes !== 0 ? c.snapshotBytes : this.opts.snapshotBytes;
    const contacts = this.contactSnapshot;
    contacts.tick = T;
    contacts.owner = contacts.epoch = contacts.count = 0;
    contacts.truncated = false;
    if (c.drive >= 0 && this.world.reg.vehicle[c.body.kind]) this.contactProxies?.(c, contacts);
    // Leave at least two thirds of the remaining packet for the ordinary view, and never exceed the selected snapshot budget.
    writeContacts(w, contacts, Math.min(320 * 8, Math.floor((bytes * 8 - w.pos) / 3)));
    c.rotate = writeViewDelta(w, base, cur, next, bytes * 8 - w.pos, c.rotate, ents, self, limit < cur.count ? ranks : null, limit, c.views);
    if (w.overflow) {
      // Part of a snapshot is of no use. Nothing is sent, and the view the client would have held is forgotten.
      this.stats.overflows++;
      next.tick = 0;
      return;
    }
    next.recordSeat(this.world, c.ent, c.drive >= 0);
    c.lastSnapshot = T;
    if (c.vehicleSeatSnapshot === -1) c.vehicleSeatSnapshot = T;
    c.conn.send(CH_UNRELIABLE, w.bytes());
    this.onSnapshot?.(c, next);
  }

  /** What is left of a client's chunk window (D230) on tick T. */
  private windowLeft(c: Client, T: number): number {
    const slot = T & 31;
    if (c.chunkSentAt[slot] !== T) {
      c.chunkSent[slot] = 0;
      c.chunkSentAt[slot] = T;
    }
    let owed = 0;
    for (let i = 0; i < 32; i++) if (c.chunkSentAt[i]! >= c.ackTick && c.chunkSentAt[i]! + 32 > T) owed += c.chunkSent[i]!;
    return Math.max(CHUNK_WINDOW, (this.opts.chunkSlotsPerTick * ROW_BITS) / 4) - owed;
  }

  /**
   * Counts `bytes` of another reliable feed in the client's chunk window, if the chunk rows of the tick before left room for
   * them, and says whether they did. Such a feed sends only what fits, so it never holds rows back.
   */
  spendChunkWindow(c: Client, bytes: number): boolean {
    const T = this.world.tick;
    if (c.rowsWaiting || bytes > this.windowLeft(c, T)) return false;
    c.chunkSent[T & 31] = c.chunkSent[T & 31]! + bytes;
    return true;
  }

  /** Nearest chunk first, within the per-tick slot budget. */
  private syncChunks(c: Client, T: number): void {
    const world = this.world;
    const dims = world.dims;
    const ccx = chunkCx(dims, c.chunk);
    const ccz = chunkCz(dims, c.chunk);
    const offsets = this.structOffsets;
    let budget = Math.min(this.opts.chunkSlotsPerTick, Math.floor(this.windowLeft(c, T) / (ROW_BITS / 8)));
    for (let o = 0; o < offsets.length && budget > 0; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      const chunk = cz * dims.chunksX + cx;
      const t = world.structs.chunks[chunk];
      if (t && t.version > c.known[chunk]!) budget = this.sendChunk(c, chunk, t, budget);
    }
    c.rowsWaiting = budget <= 0;
    // A sight's cone past the square round the body (server/gaze.ts): its chunks as well, nearest what it is on first, with
    // what the square leaves, so that what is far is drawn as near; kept CONE_KEEP after the cone leaves them (D1087). A
    // chunk as the map has it costs a client holding the statics its header alone.
    const cone = this.cone ? this.cone(c) : null;
    for (let k = 0; cone && k < cone.count; k++) {
      const chunk = cone.chunks[k]!;
      c.coneKept.set(chunk, T + CONE_KEEP);
      const t = world.structs.chunks[chunk];
      if (budget > 0 && t && t.version > c.known[chunk]!) budget = this.sendChunk(c, chunk, t, budget);
    }

    // Forget chunks the player has left behind.
    if ((T + c.id) % 16 === 0) {
      const limit = this.opts.structRadius + 1;
      const w = this.w;
      for (const [chunk, until] of c.coneKept) if (until <= T && c.known[chunk] === 0) c.coneKept.delete(chunk);
      for (let i = c.subscribed.length - 1; i >= 0; i--) {
        const chunk = c.subscribed[i]!;
        const dx = chunkCx(dims, chunk) - ccx;
        const dz = chunkCz(dims, chunk) - ccz;
        if (dx <= limit && dx >= -limit && dz <= limit && dz >= -limit) continue;
        if ((c.coneKept.get(chunk) ?? 0) > T) continue;
        c.coneKept.delete(chunk);
        c.subscribed[i] = c.subscribed[c.subscribed.length - 1]!;
        c.subscribed.pop();
        c.known[chunk] = 0;
        if (c.syncChunk === chunk) c.syncChunk = -1;
        w.reset();
        w.u8(S_CHUNK_DROP);
        w.u16(chunk);
        c.conn.send(CH_RELIABLE, w.bytes());
      }
    }
  }

  /**
   * Collects into `changed` the slots of `t` changed since version `from`, from its log, in ascending order, each times 2
   * plus 1 where one of those changes moved, made or emptied it. Returns how many, or -1 if the log does not reach back
   * that far or holds more than `most`.
   */
  private changedSince(t: ChunkTable, from: number, byRemoval: boolean, most: number): number {
    const slots = t.recentSlot;
    const vers = t.recentVer;
    const shaped = t.recentShaped;
    if (!slots || !vers || !shaped || from < t.recentFloor) return -1;
    const changed = this.changed;
    let n = 0;
    for (let k = 1, held = Math.min(t.recentCount, RECENT); k <= held; k++) {
      const at = (t.recentCount - k) % RECENT;
      if (vers[at]! <= from) break;
      const slot = slots[at]!;
      if (byRemoval && t.kind[slot] === 0) continue;
      changed[n++] = slot * 2 + shaped[at]!;
    }
    changed.subarray(0, n).sort();
    // A slot changed twice is sent once, and in place only if neither change moved it.
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (m > 0 && changed[m - 1]! >> 1 === changed[i]! >> 1) changed[m - 1] = changed[m - 1]! | changed[i]!;
      else if (m === most) return -1;
      else changed[m++] = changed[i]!;
    }
    return m;
  }

  /** Whether slot `s` of `t` holds the map's static `m` as placeStatics set it down. */
  private asMap(t: ChunkTable, s: number, statics: MapStatics, m: number): boolean {
    const kind = this.staticKinds![statics.kind[m]!]!;
    return s < t.high && t.kind[s] === kind && t.x[s] === statics.x[m] && t.y[s] === statics.y[m] && t.z[s] === statics.z[m] && t.yaw[s] === statics.yaw[m] && t.owner[s] === 0 && t.hp[s] === this.world.reg.maxHp[kind];
  }

  /** A row of a chunk message (CHUNK in shared/net/protocol.ts). In place, only its owner and health. */
  private row(w: BitWriter, t: ChunkTable, s: number, x0: number, z0: number, inPlace: boolean): void {
    const gap = s - this.rowSlot - 1;
    this.rowSlot = s;
    w.bool(gap === 0);
    if (gap !== 0) w.varint(gap - 1);
    w.bool(inPlace);
    const kind = s < t.high ? t.kind[s]! : 0;
    if (!inPlace) {
      this.kinds.write(w, kind, 16);
      if (kind === 0) return;
      w.bits(Math.round((t.x[s]! - x0) * STRUCT_UNITS), 15);
      w.bits(Math.round((t.z[s]! - z0) * STRUCT_UNITS), 15);
      const y = Math.round(t.y[s]! * STRUCT_UNITS);
      w.bool(y === this.rowY);
      if (y !== this.rowY) w.svarint(y - this.rowY);
      this.rowY = y;
      this.yaws.write(w, t.yaw[s]!, 16);
    }
    this.owners.write(w, t.owner[s]!, 0);
    const full = t.hp[s] === this.world.reg.maxHp[kind];
    w.bool(full);
    if (!full) w.f32(t.hp[s]!);
  }

  /** Returns the budget left, or 0 if the chunk is unfinished. */
  private sendChunk(c: Client, chunk: number, t: ChunkTable, budget: number): number {
    // One unfinished chunk keeps its place across ticks. A chunk that finishes within the tick leaves that
    // place alone. Otherwise a near chunk that changes every tick restarts a large one forever.
    const resumed = c.syncChunk === chunk;
    const from = resumed ? c.syncFrom : c.known[chunk]!;
    const target = resumed ? c.syncTarget : t.version;
    let cursor = resumed ? c.syncCursor : 0;
    // A chunk that remembers every removal since this client's version sends those whole.
    let byRemoval = resumed ? c.syncByRemoval : from > 0;
    if (byRemoval && from < t.goneFloor) {
      // A removal has been forgotten. Start again, row by row.
      byRemoval = false;
      cursor = 0;
    }
    const dims = this.world.dims;
    const x0 = chunkCx(dims, chunk) * CHUNK_SIZE;
    const z0 = chunkCz(dims, chunk) * CHUNK_SIZE;
    const w = this.w;
    w.reset();
    w.u8(S_CHUNK);
    w.u16(chunk);
    w.u32(target);
    const header = w.pos;
    w.bits(0, 1 + 16);
    // A client with the map's statics that holds none of this chunk takes the slots still as the map has them from its own copy.
    const statics = c.statics ? this.world.statics : null;
    const first = statics ? statics.first[chunk]! : 0;
    const mapped = statics ? statics.first[chunk + 1]! - first : 0;
    const filling = mapped > 0 && from === 0;
    if (mapped > 0) w.bool(filling);
    const fill = w.pos;
    if (filling) w.bits(0, 32);
    this.rowSlot = -1;
    this.rowY = 0;
    this.kinds.reset();
    this.yaws.reset();
    this.owners.reset();
    // Only rows count against the budget. Slots taken from the map cost no bytes, and their setting down is the client's.
    let count = 0;
    let rows = 0;
    let s = cursor;
    let final = true;
    // A client a few changes behind is sent those from the chunk's log. Otherwise every slot is looked at.
    const logged = cursor === 0 && !filling ? this.changedSince(t, from, byRemoval, budget) : -1;
    if (logged >= 0) {
      for (; rows < logged; rows++) this.row(w, t, this.changed[rows]! >> 1, x0, z0, (this.changed[rows]! & 1) === 0);
      count = rows;
    } else {
      // Rows stop where another might not fit, with a byte left for the count of removals.
      const room = w.buf.length * 8 - ROW_BITS - 8;
      const end = filling ? Math.max(t.high, mapped) : t.high;
      // A chunk still as the map placed it is all the map's slots and nothing else.
      if (filling && t.high === mapped && this.world.structs.asPlaced(chunk)) s = end;
      for (; s < end && count < budget && w.pos <= room; s++) {
        if (filling && s < mapped) {
          if (this.asMap(t, s, statics!, first + s)) continue;
        } else if (t.mod[s]! <= from || (byRemoval && t.kind[s] === 0)) continue;
        count++;
        this.row(w, t, s, x0, z0, false);
        rows++;
      }
      final = s >= end;
      if (filling && cursor < mapped) {
        const pos = w.pos;
        w.pos = fill;
        w.u16(cursor);
        w.u16(Math.min(s, mapped) - cursor);
        w.pos = pos;
      }
    }
    // Removals go with the last rows, each as runs of slots.
    let removals = 0;
    const at = w.pos;
    w.u8(0);
    if (final && byRemoval) {
      const T = this.world.tick;
      for (const g of t.gone) {
        if (g.version <= from || g.version > target) continue;
        // The cause is news only briefly. After that the rows are just gone.
        const cause = T - g.stamp <= REMOVAL_NEWS_TICKS ? g.cause : GONE_TAKEN;
        w.varint(target - g.version);
        w.bits(cause, 2);
        if (cause !== GONE_TAKEN) {
          w.f32(g.x);
          w.f32(g.y);
          w.f32(g.z);
          w.u32(g.stamp);
        }
        // Each run is coded from where the one before ended.
        w.varint(g.runs.length / 2);
        let last = 0;
        for (let k = 0; k < g.runs.length; k += 2) {
          w.svarint(g.runs[k]! - last);
          w.varint(g.runs[k + 1]! - 1);
          last = g.runs[k]! + g.runs[k + 1]!;
        }
        removals++;
        count += g.runs.length / 2;
      }
    }
    if (w.overflow) {
      // The removals do not fit one message, and part of them is of no use. Nothing is sent, and from the next
      // tick the chunk goes row by row, where a row that is gone says only that.
      this.stats.overflows++;
      c.syncChunk = chunk;
      c.syncCursor = 0;
      c.syncFrom = from;
      c.syncTarget = target;
      c.syncByRemoval = false;
      return 0;
    }
    const end = w.pos;
    w.pos = at;
    w.u8(removals);
    w.pos = header;
    // The header bits were written as zeros, so OR-ing the real values in is safe.
    w.bits(final ? 1 : 0, 1);
    w.bits(rows, 16);
    w.pos = end;
    const bytes = w.bytes();
    this.stats.chunkBytes += bytes.length;
    const k = this.world.tick & 31;
    c.chunkSent[k] = c.chunkSent[k]! + bytes.length;
    c.conn.send(CH_RELIABLE, bytes);
    if (final) {
      if (c.known[chunk] === 0 && !c.subscribed.includes(chunk)) c.subscribed.push(chunk);
      c.known[chunk] = target;
      if (resumed) c.syncChunk = -1;
      return budget - count;
    }
    c.syncChunk = chunk;
    c.syncCursor = s;
    c.syncFrom = from;
    c.syncTarget = target;
    c.syncByRemoval = byRemoval;
    return 0;
  }
}

/** Chunk offsets within a square radius, as (dx, dz) pairs sorted by distance. */
function nearestFirst(radius: number): Int16Array {
  const list: [number, number][] = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) list.push([dx, dz]);
  list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  return Int16Array.from(list.flat());
}
