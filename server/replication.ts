// Replication: what each session is sent each tick. Its own session's state, the systems' feeds, a snapshot of the
// entities in its interest as a delta against one it acknowledged, and the rows of the chunks round it. A sight's cone
// (server/gaze.ts) widens both. The order within a session's turn is the order of `send`.

import { OWN_STRIDE_BITS, ownStrideWord } from "../shared/anim/pose.ts";
import { MODE_WALK } from "../shared/sim/character.ts";
import { CHUNK_SIZE, TICK_RATE, chunkAt, chunkCount, chunkCx, chunkCz } from "../shared/coords.ts";
import type { BitReader, BitWriter } from "../shared/net/codec.ts";
import { BUTTON_BITS, HAVE_MOST, MARGIN_UNKNOWN, OWN_SESSION, REMOVAL_NEWS_TICKS, RESULT_INVALID, RESULT_OK, SESSION_ALIVE, S_CHUNK, S_CHUNK_DROP, S_OWN, S_SNAPSHOT, writeBody } from "../shared/net/protocol.ts";
import { CH_RELIABLE, CH_UNRELIABLE } from "../shared/net/transport.ts";
import { MAX_VIEW, SentView, type ViewSelection, VIEW_DEFAULT, VIEW_RING, quantX, quantY, writeViewDelta } from "../shared/net/view.ts";
import { ContactSnapshot, writeContacts } from "../shared/net/contact.ts";
import { packVehicleDrive, packVehiclePose, quantVehicleWheel, packVehicleRide } from "../shared/sim/vehicle-body.ts";
import { packSkateWord } from "../shared/sim/skate-state.ts";
import { packVehicleRotor, packVehicleSystems, packVehicleQuaternionPair, packBoatWater } from "../shared/sim/vehicle-presentation.ts";
import { drivetrainShifting } from "../shared/sim/vehicle-drivetrain.ts";
import { isWheelVehicle } from "../shared/sim/vehicle.ts";
import { jetNozzleAt, packJetNozzle } from "../shared/sim/jet.ts";
import { F_ALIVE, F_PLAYER, F_PROP, F_GROUNDED } from "../shared/sim/entities.ts";
import { tekWallKinds } from "../shared/world/lattice/tek-walls.ts";
import { NET_ROW_BITS_MOST, RowCoder } from "../shared/world/rows.ts";
import { GONE_BLAST, GONE_TAKEN, RECENT, TOUCH_KIND, TOUCH_LEFT, TOUCH_MOVED } from "../shared/world/structures.ts";
import { sortU32 } from "../shared/sort.ts";
import type { ChunkTable } from "../shared/world/structures.ts";
import type { Client, GameOptions, GameStats } from "./game.ts";
import type { ServerWorld } from "./world.ts";
import { PART, type TickParts } from "./admin/parts.ts";

/** The least snapshot budget a client may ask for, in bytes. The quarter of it that a crowd of players leaves the rest holds a dressed survivor's create. */
// A plain-lettered survivor in five styled garments is about 175 bytes. The largest create is about 270 (three-byte letters,
// editions near 2^32, seated and emoting): no quarter holds it, and none need, as a window always sends the op at its head.
export const SNAPSHOT_BYTES_MIN = 720;
/**
 * Chunk bytes a client may have on the way. On one stream everything sent before a snapshot it has read has reached it,
 * so what was sent since its newest acknowledged snapshot is still coming, ahead of the snapshots after it.
 */
const CHUNK_WINDOW = 16 * 1024;
/** Dropped chunks whose version a session is remembered to have held, for when it says it kept them (CMD_HAVE). */
const PARK_KEPT = 16;
/** Ticks a chunk a sight's cone had sent is held after the cone leaves it: turning about or lowering it makes no churn (D1087). */
export const CONE_KEEP = 150;
/** The most entities a session's sight's cone adds to its view (D1079). */
export const CONE_ENTITIES = 192;
/** The most far entities a tick (Replication.far): four jets and their missiles. */
export const FAR_MOST = 16;
/** A far row's fuel is sent in this many steps of its tank, and its engine's speed in steps of this many rpm. */
const FAR_STEPS = 32;
const FAR_RPM = 500;

// When a crowd fills the view, keep up to eight bodies within eight metres of the viewer.
const NEAR_BODIES = 8;
const NEAR_METRES = 8;

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
  /** A remote operator sees the chunks around its aircraft while its body stays at its physical chunk. */
  cameraChunk: ((c: Client) => number | undefined) | null = null;
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
  private readonly candidates: number[] = [];
  private readonly playersAndMounts: number[] = [];
  private readonly nearIds = new Uint32Array(NEAR_BODIES);
  private readonly nearDistance = new Float64Array(NEAR_BODIES);
  private readonly nearRanks = new Uint16Array(NEAR_BODIES);
  private readonly selection: ViewSelection = { order: new Int16Array(MAX_VIEW), count: 0, extra: new SentView() };
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
  /** The chunks and versions of the CMD_HAVE being read. */
  private readonly said = new Uint32Array(HAVE_MOST * 2);
  /** Writes the rows of one chunk message at a time (shared/world/rows.ts). */
  private readonly rows: RowCoder;
  /** Bytes of its chunk window left to the session whose chunks are being sent. A message's rows stop once they pass it. */
  private room = 0;
  private readonly ids = new Uint32Array(MAX_VIEW);
  /**
   * Entities sent to every view whose centre is within their reach, though past its ring: an airborne jet and its live
   * missiles (server/vehicle-weapons.ts). Set afresh each tick through `far`.
   */
  private readonly farIds = new Int32Array(FAR_MOST);
  private readonly farReach = new Float64Array(FAR_MOST);
  private farCount = 0;
  private farTick = -1;
  /** The tick each entity was last made far at, by index, so a view asks it of one entity at once. */
  private farAt = new Int32Array(0);
  /** The far entities put in the view being gathered, past its ring. */
  private readonly injected = new Int32Array(FAR_MOST);
  private injectedCount = 0;
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
    this.rows = new RowCoder(world.structs.forms, world.reg.maxHp, { phaseKinds: tekWallKinds(world.reg.index) });
    this.aroundTick = new Uint32Array(chunkCount(world.dims));
    this.aroundAt = new Uint16Array(chunkCount(world.dims));
    this.entityOffsets = nearestFirst(this.opts.entityRadius);
    this.structOffsets = nearestFirst(this.opts.structRadius);
  }

  /** Sends entity `e` this tick to every view centred within `reach` metres of it: a craft fast enough to cross a ring between two snapshots. */
  far(e: number, reach: number): void {
    const T = this.world.tick;
    if (this.farTick !== T) { this.farTick = T; this.farCount = 0; }
    if (this.farCount >= FAR_MOST || (e < this.farAt.length && this.farAt[e] === T)) return;
    if (e >= this.farAt.length) {
      const grown = new Int32Array(Math.max(e + 1, this.world.ents.flags.length)).fill(-1);
      grown.set(this.farAt);
      this.farAt = grown;
    }
    this.farAt[e] = T;
    this.farIds[this.farCount] = e;
    this.farReach[this.farCount++] = reach * reach;
  }

  /** Whether entity `i` is one of this tick's far entities. */
  private isFar(i: number): boolean {
    return this.farTick === this.world.tick && i < this.farAt.length && this.farAt[i] === this.farTick;
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

  /** Takes the most bodies a session may be shown from the options again (ViewCap). A session has it at its next ask. */
  recap(): void {
    this.cap = Math.max(1, Math.min(MAX_VIEW, Math.floor(this.opts.viewCap)));
  }

  /** Every session is told its state again (OWN_SESSION), at its next turn. */
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
    w.varint(this.world.hairRate);
    c.conn.send(CH_RELIABLE, w.bytes());
    c.ownDirty = false;
  }

  /** CMD_STATICS. Every chunk message sent after the answer takes from the map what is as the map has it. */
  takeStatics(c: Client): number {
    if (!this.world.statics) return RESULT_INVALID;
    c.statics = true;
    return RESULT_OK;
  }

  /**
   * CMD_HAVE. A chunk it names at the version it was dropped at is taken as held at that version, and its next turn
   * sends what changed since. One the server is sending or has sent since is passed over: its rows went first. Any
   * other is dropped again, so the client lets go of what it kept.
   */
  have(c: Client, r: BitReader): number {
    const n = r.u8();
    if (r.overflow || n > HAVE_MOST) return RESULT_INVALID;
    const said = this.said;
    const chunks = this.world.structs.chunks;
    for (let i = 0; i < n; i++) {
      said[i * 2] = r.u16();
      said[i * 2 + 1] = r.u32();
      if (said[i * 2]! >= chunks.length) return RESULT_INVALID;
    }
    if (r.overflow) return RESULT_INVALID;
    for (let i = 0; i < n; i++) {
      const chunk = said[i * 2]!, version = said[i * 2 + 1]!;
      if (c.known[chunk] !== 0 || c.syncChunk === chunk) continue;
      const t = chunks[chunk];
      const kept = c.parked.get(chunk) === version && !!t && t.version >= version;
      c.parked.delete(chunk);
      if (kept) {
        c.known[chunk] = version;
        if (!c.subscribed.includes(chunk)) c.subscribed.push(chunk);
        if (!c.claimed.includes(chunk)) c.claimed.push(chunk);
        continue;
      }
      const w = this.w;
      w.reset();
      w.u8(S_CHUNK_DROP);
      w.u16(chunk);
      c.conn.send(CH_RELIABLE, w.bytes());
    }
    return RESULT_OK;
  }

  /** CMD_CHUNK_AGAIN. Each chunk named that the session holds is sent to it again from nothing, as `refill` does for every session. */
  chunkAgain(c: Client, r: BitReader): number {
    const n = r.u8(), said = this.said;
    if (r.overflow || n > HAVE_MOST) return RESULT_INVALID;
    for (let i = 0; i < n; i++) if ((said[i] = r.u16()) >= this.world.structs.chunks.length) return RESULT_INVALID;
    if (r.overflow) return RESULT_INVALID;
    for (let i = 0; i < n; i++) {
      const chunk = said[i]!;
      c.parked.delete(chunk);
      if (c.known[chunk] === 0) continue;
      c.known[chunk] = 0;
      if (c.syncChunk === chunk) c.syncChunk = -1;
    }
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
    let total = 0;
    for (let o = 0; o < offsets.length; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      for (let i = ents.chunkHead[cz * dims.chunksX + cx]!; i >= 0; i = ents.next[i]!) {
        total++;
        const f = ents.flags[i]!;
        if ((f & F_PLAYER) !== 0 || ents.driven[i] !== 0) {
          if (n < cap) ids[n++] = i;
        } else if ((f & F_PROP) === 0 && (ents.vx[i] !== 0 || ents.vz[i] !== 0 || ents.vy[i] !== 0 || ents.act[i] !== 0)) {
          if (nm < cap) movers[nm++] = i;
        } else if (ni < cap) idle[ni++] = i;
      }
    }
    // The far ones, ranked with the players: any outside the ring whose reach takes in the ring's middle.
    this.injectedCount = 0;
    if (this.farTick === T) {
      const mx = (ccx + .5) * CHUNK_SIZE, mz = (ccz + .5) * CHUNK_SIZE, radius = this.opts.entityRadius;
      for (let k = 0; k < this.farCount && n < cap; k++) {
        const i = this.farIds[k]!;
        if ((ents.flags[i]! & F_ALIVE) === 0) continue;
        const fx = ents.x[i]!, fz = ents.z[i]!;
        const ex = Math.floor(fx / CHUNK_SIZE) - ccx, ez = Math.floor(fz / CHUNK_SIZE) - ccz;
        if (ex >= -radius && ex <= radius && ez >= -radius && ez <= radius) continue;
        if ((fx - mx) * (fx - mx) + (fz - mz) * (fz - mz) > this.farReach[k]!) continue;
        ids[n++] = i;
        this.injected[this.injectedCount++] = i;
      }
    }
    const at = this.gathered++;
    this.candidates[at] = total;
    this.playersAndMounts[at] = n;
    for (let k = 0; k < nm && n < cap; k++) ids[n++] = movers[k]!;
    for (let k = 0; k < ni && n < cap; k++) ids[n++] = idle[k]!;
    // Each is sorted with the rank it was chosen at. An index is under 2^20 (shared/ids.ts), so the two fit one number.
    for (let k = 0; k < n; k++) ids[k] = ids[k]! * MAX_VIEW + k;
    sortU32(ids, n);
    const cur = (this.around[at] ??= new SentView());
    const rank = (this.ranks[at] ??= new Uint16Array(MAX_VIEW));
    cur.count = 0;
    for (let k = 0; k < n; k++) {
      const i = Math.floor(ids[k]! / MAX_VIEW);
      rank[k] = ids[k]! % MAX_VIEW;
      this.pushEntity(cur, i, this.injectedCount > 0 && this.wasInjected(i));
    }
    this.aroundTick[chunk] = T;
    this.aroundAt[chunk] = at;
    return at;
  }

  /** The closest bodies in reach across chunk borders. Equal distances keep the lower entity id. */
  private nearest(c: Client, seats: number): number {
    const { ents, dims } = this.world;
    const { x, y, z } = c.body;
    const cx = chunkCx(dims, c.chunk), cz = chunkCz(dims, c.chunk), radius = this.opts.entityRadius;
    const west = Math.max(0, cx - radius, Math.floor((x - NEAR_METRES) / CHUNK_SIZE));
    const east = Math.min(dims.chunksX - 1, cx + radius, Math.floor((x + NEAR_METRES) / CHUNK_SIZE));
    const north = Math.max(0, cz - radius, Math.floor((z - NEAR_METRES) / CHUNK_SIZE));
    const south = Math.min(dims.chunksZ - 1, cz + radius, Math.floor((z + NEAR_METRES) / CHUNK_SIZE));
    let count = 0;
    for (let row = north; row <= south; row++) {
      for (let col = west; col <= east; col++) {
        for (let id = ents.chunkHead[row * dims.chunksX + col]!; id >= 0; id = ents.next[id]!) {
          if ((ents.flags[id]! & F_PLAYER) !== 0 || ents.driven[id] !== 0) continue;
          const dx = ents.x[id]! - x, dy = ents.y[id]! - y, dz = ents.z[id]! - z;
          const d = dx * dx + dy * dy + dz * dz;
          if (d > NEAR_METRES * NEAR_METRES) continue;
          let i = count;
          while (i > 0 && (d < this.nearDistance[i - 1]! || (d === this.nearDistance[i - 1]! && id < this.nearIds[i - 1]!))) {
            if (i < seats) {
              this.nearIds[i] = this.nearIds[i - 1]!;
              this.nearDistance[i] = this.nearDistance[i - 1]!;
            }
            i--;
          }
          if (i >= seats) continue;
          this.nearIds[i] = id;
          this.nearDistance[i] = d;
          if (count < seats) count++;
        }
      }
    }
    return count;
  }

  /** Use the shared view unchanged whenever its ordinary ranking already includes everyone in reach we would keep. */
  private keepNear(c: Client, cur: SentView, ranks: Uint16Array, limit: number, seats: number): ViewSelection | null {
    const n = this.nearest(c, seats);
    let missing = false;
    this.nearRanks.fill(MAX_VIEW);
    for (let k = 0; k < n; k++) {
      const i = viewIndex(cur, this.nearIds[k]!);
      const rank = i < 0 ? MAX_VIEW : ranks[i]!;
      this.nearRanks[k] = rank;
      if (rank >= limit) missing = true;
    }
    if (!missing) return null;
    // Keep the first ordinary ranks, counting a protected body just once if it already falls among them.
    let cutoff = limit - n;
    this.nearRanks.sort();
    for (let k = 0; k < n && this.nearRanks[k]! < cutoff; k++) cutoff++;
    sortU32(this.nearIds, n);
    const out = this.selection;
    out.count = out.extra.count = 0;
    let j = 0, i = 0;
    while (i < cur.count || j < n) {
      if (j < n && (i === cur.count || this.nearIds[j]! < cur.id[i]!)) {
        out.order[out.count++] = ~out.extra.count;
        this.pushEntity(out.extra, this.nearIds[j++]!);
      } else {
        const keep = j < n && this.nearIds[j] === cur.id[i];
        if (keep || ranks[i]! < cutoff) out.order[out.count++] = i;
        if (keep) j++;
        i++;
      }
    }
    // The mask may reuse its storage on the next call for the shared rows. Keep these few private rows here.
    if (this.viewFor && out.extra.count > 0) {
      const masked = this.viewFor(c, out.extra);
      if (masked !== out.extra) {
        out.extra.count = 0;
        for (let k = 0; k < masked.count; k++) {
          out.extra.copyFrom(masked, k);
          out.extra.urgent[k] = masked.urgent[k]!;
        }
      }
    }
    return out;
  }

  private wasInjected(i: number): boolean {
    for (let k = 0; k < this.injectedCount; k++) if (this.injected[k] === i) return true;
    return false;
  }

  /**
   * Adds entity `i` as it stands to `view`, and whether its changes go first. One sent from `far` past the view's ring has
   * its fuel and its engine's speed held to coarse steps, which a viewer that far off neither sees nor hears change, and
   * no pose word: its attitude is its quaternion's.
   */
  private pushEntity(view: SentView, i: number, far = false): void {
    const ents = this.world.ents;
    const vehicle = this.world.reg.vehicle[ents.kind[i]!], rotor = vehicle?.movement === "rotor", jet = vehicle?.movement === "jet", v = ents.vrow[i]!;
    const skate = vehicle ? ents.skate.get(v) : undefined;
    view.push(i, ents.gen[i]!, ents.kind[i]!, quantX(ents.x[i]!), quantY(ents.y[i]!), quantX(ents.z[i]!), ents.yaw[i]! >>> 6,
      (ents.flags[i]! >>> 1) & 0xf, ents.anim[i]!, ents.rev[i]!, ents.cue[i]!,
      vehicle && !far ? packVehiclePose(ents.vehiclePitch[v]!, ents.vehicleRoll[v]!, ents.steering[v]!) : 0,
      vehicle ? quantVehicleWheel(ents.wheelAngle[v]!) : 0,
      vehicle ? packVehicleRide(ents.vehicleGroundPitch[v]!, ents.vehicleGroundRoll[v]!, ents.vehicleRideOffset[v]!, (ents.flags[i]! & F_GROUNDED) !== 0) : 0,
      ents.vehicleDoors[v]!, vehicle && !rotor ? packVehicleDrive(skate?.move ?? ents.vehicleGear[v]!, skate ? Math.hypot(ents.vx[i]!, ents.vz[i]!) * 100 : far ? Math.round(ents.vehicleRpm[v]! / FAR_RPM) * FAR_RPM : ents.vehicleRpm[v]!, skate ? skate.switched : !isWheelVehicle(vehicle) ? ents.vehicleShiftTime[v]! > 0 : drivetrainShifting(ents.vehicleShiftTime[v]!, vehicle.spec.drivetrain), (ents.flags[i]! & F_PROP) === 0 ? ents.vehicleLightMode[v]! : 0, ents.vehicleMissingPanels[v]!) : 0,
      // A car's rotor word is its thrusters' state, what fired on its last tick among it (shared/sim/vehicle-thrusters.ts).
      // A jet's drive word is its wheels down, its engine speed and its afterburner, and its rotor word its nozzle alone.
      rotor ? packVehicleRotor(ents.vehicleRotorRpm[v]!, ents.vehicleRotorPhase[v]!) : jet ? packJetNozzle(jetNozzleAt(ents, v)) : skate ? packSkateWord(skate) : vehicle && isWheelVehicle(vehicle) && vehicle.spec.thrusters ? ents.vehicleThrust[v]! : 0,
      vehicle ? packVehicleSystems(far ? Math.ceil(ents.fuel[v]! / vehicle.spec.fuelCapacity * FAR_STEPS) / FAR_STEPS * vehicle.spec.fuelCapacity : ents.fuel[v]!, vehicle.spec.fuelCapacity, ents.vehicleEngineCondition[v]!, ents.vehicleRotorCondition[v]!, ents.vehicleEngineOn[v] !== 0) : 0,
      vehicle ? packVehicleQuaternionPair(ents.vehicleQx[v]!, ents.vehicleQy[v]!) : 0,
      vehicle ? packVehicleQuaternionPair(ents.vehicleQz[v]!, ents.vehicleQw[v]!) : 0,
      vehicle ? packBoatWater(ents.vehicleHullCondition[v]!, ents.vehicleFlooding[v]!) : 0, ents.emote[i]!, ents.react[i]!, this.world.history.strideOf(i, this.world.tick, this.world), ents.identityRev[i]!);
    view.urgent[view.count - 1] = (ents.flags[i]! & F_PLAYER) !== 0 || ents.driven[i] !== 0 || (this.farCount > 0 && this.isFar(i)) ? 1 : 0;
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

  /**
   * Whether body `e` of generation `gen`, left out of a view by a cap, may be kept as the client has it (writeViewDelta):
   * alive, not a player, still within the square round `spareAt`, and in `spareHeld`, the view the newest snapshot sent
   * left the client, so that one taken away is not kept again.
   */
  private readonly spare = (e: number, gen: number): boolean => {
    const ents = this.world.ents;
    const dims = this.world.dims;
    if (ents.gen[e] !== gen || (ents.flags[e]! & (F_ALIVE | F_PLAYER)) !== F_ALIVE || ents.driven[e] !== 0) return false;
    const chunk = ents.chunk[e]!;
    const r = this.opts.entityRadius;
    if (chunk < 0 || Math.abs(chunkCx(dims, chunk) - chunkCx(dims, this.spareAt)) > r || Math.abs(chunkCz(dims, chunk) - chunkCz(dims, this.spareAt)) > r) return false;
    const held = this.spareHeld!;
    const slot = viewIndex(held, e);
    return slot >= 0 && held.gen[slot] === gen;
  };
  private spareHeld: SentView | null = null;
  private spareAt = 0;

  private snapshot(c: Client, T: number): void {
    if (c.conn.admit?.(CH_UNRELIABLE) === false) return;
    const ents = this.world.ents;
    // The client predicts its own body, so the view leaves it out. While it drives a mount, both bodies are in the view.
    const self = c.drive >= 0 ? -1 : c.ent;
    // What it asked for takes effect once a second at most, so that it cannot have its view sent over and over.
    if ((c.wantView !== c.viewCap || c.wantBytes !== c.snapshotBytes) && T >= c.viewReadyAt) {
      c.viewCap = c.wantView;
      c.snapshotBytes = c.wantBytes;
      c.viewReadyAt = T + TICK_RATE;
    }
    // Held to the server's cap as it is now: one lowered since the client was granted its view counts at once.
    const limit = Math.min(this.cap, c.viewCap !== 0 ? c.viewCap : VIEW_DEFAULT);

    const camera = this.cameraChunk?.(c);
    const centre = camera ?? c.chunk;
    const at = this.viewAround(centre, T);
    let cur = this.around[at]!;
    let ranks = this.ranks[at]!;
    const crowded = this.candidates[at]! > limit;
    let selection: ViewSelection | null = null;
    if (crowded && camera === undefined && c.ent >= 0 && limit > this.playersAndMounts[at]!) {
      selection = this.keepNear(c, cur, ranks, limit, Math.min(NEAR_BODIES, limit - this.playersAndMounts[at]!));
    }
    // The sight adds bodies after the local ones in rank order.
    const cone = cur.count < limit ? this.cone?.(c) : null;
    if (cone && (cone.count > 0 || (cone.players?.length ?? 0) > 0)) {
      cur = this.widen(c, cur, ranks, cone);
      ranks = c.wideRanks!;
    }
    if (this.viewFor) cur = this.viewFor(c, cur);

    const age = T - c.ackTick;
    const base = c.ackTick > 0 && age < VIEW_RING ? c.views.find(c.ackTick) : null;
    // With a cap leaving bodies out, those the newest snapshot sent left the client may be kept (writeViewDelta).
    const held = base && (crowded || limit < cur.count || cur.count >= this.cap) && c.lastSnapshot > 0 && T - c.lastSnapshot < VIEW_RING ? c.views.find(c.lastSnapshot) : null;
    this.spareHeld = held;
    this.spareAt = centre;
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
    next.ownStride = 0;
    if (self >= 0 && c.state === SESSION_ALIVE && !ents.seat[self] && ents.mode[self] === MODE_WALK && (ents.flags[self]! & F_GROUNDED)) {
      const anim = ents.anim[self]!;
      next.ownStride = ownStrideWord(anim & 15, (anim >>> 8) & 3, this.world.history.strideOf(self, T, this.world));
    }
    const strideChanged = next.ownStride !== (base?.ownStride ?? 0);
    w.bool(strideChanged);
    if (strideChanged) w.bits(next.ownStride, OWN_STRIDE_BITS);
    writeBody(w, c.body);
    const bytes = c.snapshotBytes !== 0 ? c.snapshotBytes : this.opts.snapshotBytes;
    const contacts = this.contactSnapshot;
    contacts.tick = T;
    contacts.owner = contacts.epoch = contacts.count = 0;
    contacts.truncated = false;
    if (c.drive >= 0 && this.world.reg.vehicle[c.body.kind]) this.contactProxies?.(c, contacts);
    // Leave at least two thirds of the remaining packet for the ordinary view, and never exceed the selected snapshot budget.
    writeContacts(w, contacts, Math.min(320 * 8, Math.floor((bytes * 8 - w.pos) / 3)));
    c.rotate = writeViewDelta(w, base, cur, next, bytes * 8 - w.pos, c.rotate, ents, self, !selection && limit < cur.count ? ranks : null, limit, c.views, held ? this.spare : null, selection);
    this.spareHeld = null;
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
    return CHUNK_WINDOW - owed;
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

  /** Nearest chunk first, within the tick's slot budget and the bytes left of the session's window. */
  private syncChunks(c: Client, T: number): void {
    const world = this.world;
    const dims = world.dims;
    const focus = this.cameraChunk?.(c) ?? c.chunk;
    const ccx = chunkCx(dims, focus);
    const ccz = chunkCz(dims, focus);
    const offsets = this.structOffsets;
    let budget = this.opts.chunkSlotsPerTick;
    this.room = this.windowLeft(c, T);
    // What it kept and said so is brought up to date first, wherever it is, by a header alone where nothing changed: the
    // client holds it apart until then.
    while (c.claimed.length > 0 && budget > 0 && this.room > 0) {
      const chunk = c.claimed[c.claimed.length - 1]!;
      const t = world.structs.chunks[chunk];
      if (t && c.known[chunk] !== 0) budget = this.sendChunk(c, chunk, t, budget);
      if (c.syncChunk !== chunk) c.claimed.pop();
    }
    for (let o = 0; o < offsets.length && budget > 0 && this.room > 0; o += 2) {
      const cx = ccx + offsets[o]!;
      const cz = ccz + offsets[o + 1]!;
      if (cx < 0 || cz < 0 || cx >= dims.chunksX || cz >= dims.chunksZ) continue;
      const chunk = cz * dims.chunksX + cx;
      const t = world.structs.chunks[chunk];
      if (t && t.version > c.known[chunk]!) budget = this.sendChunk(c, chunk, t, budget);
    }
    c.rowsWaiting = budget <= 0 || this.room <= 0;
    // A sight's cone past the square round the body (server/gaze.ts): its chunks as well, nearest what it is on first, with
    // what the square leaves, so that what is far is drawn as near; kept CONE_KEEP after the cone leaves them (D1087). A
    // chunk as the map has it costs a client holding the statics its header alone.
    const cone = this.cone ? this.cone(c) : null;
    for (let k = 0; cone && k < cone.count; k++) {
      const chunk = cone.chunks[k]!;
      c.coneKept.set(chunk, T + CONE_KEEP);
      const t = world.structs.chunks[chunk];
      if (budget > 0 && this.room > 0 && t && t.version > c.known[chunk]!) budget = this.sendChunk(c, chunk, t, budget);
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
        if (c.known[chunk] !== 0) {
          // Set again, it is the newest.
          c.parked.delete(chunk);
          c.parked.set(chunk, c.known[chunk]!);
          if (c.parked.size > PARK_KEPT) c.parked.delete(c.parked.keys().next().value!);
        }
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
   * Collects into `changed` the slots of `t` changed since version `from`, from its log, in ascending order, each times 8
   * plus what those changes did: TOUCH_MOVED where one moved, made or emptied it, TOUCH_KIND where one gave it another
   * kind in place. With `byRemoval`, a slot is left out that is now empty, or whose every change was a batch leaving its
   * heap: the batches say those. Returns how many, or -1 if the log does not reach back that far or holds more than `most`.
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
      // The third bit is turned over, so that it stays clear only where every change was a batch's.
      changed[n++] = slot * 8 + (shaped[at]! ^ TOUCH_LEFT);
    }
    changed.subarray(0, n).sort();
    // A slot changed twice is sent once, and in place only if neither change moved it.
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (m > 0 && changed[m - 1]! >> 3 === changed[i]! >> 3) changed[m - 1] = changed[m - 1]! | changed[i]!;
      else {
        if (m > 0 && byRemoval && (changed[m - 1]! & TOUCH_LEFT) === 0) m--;
        if (m === most) return -1;
        changed[m++] = changed[i]!;
      }
    }
    if (m > 0 && byRemoval && (changed[m - 1]! & TOUCH_LEFT) === 0) m--;
    return m;
  }

  /** A row of a chunk message (S_CHUNK in shared/net/protocol.ts). In place, only its owner and health, and its kind if `swapped`. */
  private row(w: BitWriter, t: ChunkTable, s: number, stays: boolean, swapped = false): void {
    this.rows.write(w, t, s, stays, swapped, this.world.structs.frames);
  }

  /** Runs of slots, each coded from where the one before ended. */
  private runs(w: BitWriter, runs: readonly number[]): void {
    w.varint(runs.length / 2);
    let last = 0;
    for (let k = 0; k < runs.length; k += 2) {
      w.svarint(runs[k]! - last);
      w.varint(runs[k + 1]! - 1);
      last = runs[k]! + runs[k + 1]!;
    }
  }

  /**
   * Makes each session that holds `chunk` take it again from nothing: with the map's statics, the slots still as the map
   * has them from its own copy and the rest as rows. For a chunk set back wholesale (an admin's reset of the city).
   */
  refill(chunk: number): void {
    for (const c of this.clients) {
      // What it kept of the chunk from a drop is not what the chunk was set back from.
      c?.parked.delete(chunk);
      if (!c || c.known[chunk] === 0) continue;
      c.known[chunk] = 0;
      if (c.syncChunk === chunk) c.syncChunk = -1;
    }
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
    const mapped = statics ? statics.first[chunk + 1]! - statics.first[chunk]! : 0;
    // The table's map slots are the map's rows one for one, but in a chunk where the map holds a row that took no slot.
    const filling = mapped > 0 && from === 0 && t.mapped === mapped;
    if (mapped > 0) w.bool(filling);
    const fill = w.pos;
    if (filling) w.bits(0, 32);
    // A frame is defined with the first row that names it to this session.
    this.rows.maxHp = this.world.reg.maxHp;
    this.rows.begin(x0, z0, -1, c.framesTold);
    // Only rows count against the budget. Slots taken from the map cost no bytes, and their setting down is the client's.
    let count = 0;
    let rows = 0;
    let s = cursor;
    let final = true;
    // Rows stop where another might not fit, with a byte left for the count of removals, and once they pass what is left
    // of the window. The first row always goes, so a chunk begun moves on.
    const room = Math.min(w.buf.length * 8 - NET_ROW_BITS_MOST - 8, Math.max(w.pos, this.room * 8));
    // A client a few changes behind is sent those from the chunk's log. Otherwise every slot is looked at.
    const logged = cursor === 0 && !filling ? this.changedSince(t, from, byRemoval, budget) : -1;
    if (logged >= 0) {
      for (; rows < logged && w.pos <= room; rows++) this.row(w, t, this.changed[rows]! >> 3, (this.changed[rows]! & TOUCH_MOVED) === 0, (this.changed[rows]! & TOUCH_KIND) !== 0);
      count = rows;
      // Cut short, the rest go by the scan from the next of them, which ascend.
      if (rows < logged) {
        final = false;
        s = this.changed[rows]! >> 3;
      }
    } else {
      const end = t.high;
      if (filling && s < mapped) {
        // Of the map's slots only those that changed are rows, from the chunk's list of them. The client sets the rest down.
        const list = this.world.structs.changedSlots(chunk);
        let k = 0;
        while (k < list.length && list[k]! < s) k++;
        while (s < mapped && count < budget && w.pos <= room) {
          if (k === list.length) {
            s = mapped;
            break;
          }
          s = list[k++]!;
          count++;
          // The client has just set this slot down from its map, so a piece there is told in place: by owner and health,
          // and by its kind where that is no longer the map's (a broken form, a heap).
          this.row(w, t, s, t.kind[s] !== 0, t.kind[s] !== this.world.structs.mapKind(chunk, s));
          s++;
          rows++;
        }
      }
      // Where the map's slots were cut short, there is no room for these either.
      for (; s < end && count < budget && w.pos <= room; s++) {
        if (t.mod[s]! <= from || (byRemoval && t.kind[s] === 0)) continue;
        count++;
        this.row(w, t, s, false);
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
        if (cause === GONE_BLAST) w.u8(Math.min(255, Math.round(g.radius * 4)));
        // The slots that took their heaps come first where there are any, then those emptied if there are those too.
        const leaves = g.left.length > 0;
        w.bool(leaves);
        if (leaves) {
          this.runs(w, g.left);
          w.bool(g.runs.length > 0);
        }
        if (!leaves || g.runs.length > 0) this.runs(w, g.runs);
        removals++;
        count += (g.runs.length + g.left.length) / 2;
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
    this.room -= bytes.length;
    c.conn.send(CH_RELIABLE, bytes);
    this.rows.sent();
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

function viewIndex(view: SentView, id: number): number {
  let lo = 0, hi = view.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (view.id[mid] === id) return mid;
    if (view.id[mid]! < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Chunk offsets within a square radius, as (dx, dz) pairs sorted by distance. */
function nearestFirst(radius: number): Int16Array {
  const list: [number, number][] = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) list.push([dx, dz]);
  list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  return Int16Array.from(list.flat());
}
