// A view is the sorted list of entities a client holds after applying one snapshot. A snapshot is encoded against the newest
// view the client has acknowledged, so a lost snapshot costs nothing. Entities absent from a delta are unchanged.
//
// Wire form after the snapshot header:
//   count varint, then per op in ascending id order:
//     id gap varint: this id minus the previous id (first: id + 1), so always >= 1
//     op 2 bits: 0 update, 1 create, 2 remove
//     create: kind varint, generation 12 bits, x 22, y 20, z 22, yaw 10, flags 4, pose state 32, then its appearance:
//             revision 4, level varint, [colours? 1][6 x 8], [name? 1][string], [look? 1][28 x 8], [gear? 1][6 x 16],
//             [team? 1][varint], [seat? 1][varint], [young? 1][span 32, grown 32]
//     update: [pos? 1][small? 1][3 x s8 | 22+20+22] [yaw? 1][10] [flags? 1][4]
//             [motion? 1][12] [look? 1][6] [action? 1][14]
//
// Appearance is sent only on create. A change bumps the entity's revision, and the next delta then sends a create for it again.
// Only a remove is sent whatever it costs. Every other op waits its turn when a snapshot is full.
//
// The baseline is a round trip old, and the client has had newer snapshots since. A body whose op had to wait is in the new
// view as the baseline has it, which is where it stood a round trip ago, or not at all. So a client keeps a second list for
// each snapshot, of what it shows: each body as the newest snapshot to say anything of it left it. The views stay what the
// server holds them to be, and deltas are read against them alone. The server keeps for each client the bodies whose last
// word it has not acknowledged (`Told`), and has more to say of one until it has: an update that changes nothing where a
// body is back as the baseline has it, a remove where the baseline never had it.

import { ANIM_ACTION_BITS, ANIM_ACTION_SHIFT, ANIM_LOOK_BITS, ANIM_LOOK_SHIFT, ANIM_MOTION_BITS, ANIM_MOTION_MASK } from "../anim/pose.ts";
import { LOOK_BYTES } from "../anim/look.ts";
import { WORLD_MIN_Y } from "../coords.ts";
import { GEAR_COUNT } from "../sim/entities.ts";
import type { BitReader, BitWriter } from "./codec.ts";

export const VIEW_RING = 32;
/** The most entities a view can hold. A server shows a client fewer: its own cap, and what the client asks for. */
export const MAX_VIEW = 2048;
/** What a client is shown until it asks for another number. */
export const VIEW_DEFAULT = 512;
/** A view's columns start with room for this many and double as it fills. */
const VIEW_START = 256;
/** Position units per metre on the wire. */
export const POS_UNITS = 256;

const OP_UPDATE = 0;
const OP_CREATE = 1;
const OP_REMOVE = 2;

const ANIM_BITS = ANIM_MOTION_BITS + ANIM_LOOK_BITS + ANIM_ACTION_BITS;
const LOOK_MASK = (1 << ANIM_LOOK_BITS) - 1;
const CREATE_BITS = 24 + 2 + 24 + 12 + 64 + 10 + 4 + ANIM_BITS + 4 + 16 + 4 + 48 + 3;
/** In bytes. */
export const MAX_NAME_LENGTH = 72;

/** The appearance of every entity, by entity index. `EntityStore` has these columns. */
export interface Looks {
  readonly level: Uint16Array;
  /** Six bytes for each entity. */
  readonly colors: Uint8Array;
  readonly name: string[];
  readonly look: (Uint8Array | null)[];
  readonly gear: (Uint16Array | null)[];
  readonly team: Uint32Array;
  readonly seat: Uint32Array;
  readonly span: Uint32Array;
  readonly grown: Uint32Array;
}

/** An upper bound on the bits a create for entity `id` takes. */
function createBits(v: Looks, id: number): number {
  const name = v.name[id]!;
  // The optional fields: a look, gear, a team, a seat, an age.
  const look = (v.look[id] ? LOOK_BYTES * 8 : 0) + (v.gear[id] ? GEAR_COUNT * 16 : 0) + (v.team[id] !== 0 ? 40 : 0) + (v.seat[id] !== 0 ? 40 : 0) + (v.span[id] !== 0 || v.grown[id] !== 0 ? 64 : 0);
  if (name === "") return CREATE_BITS + look;
  let bytes = 1;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return CREATE_BITS + look + bytes * 8;
}

/** A longer copy of a column. */
function wider<T extends Uint8Array | Uint16Array | Uint32Array | Int32Array>(a: T, length: number): T {
  const out = new (a.constructor as unknown as new (length: number) => T)(length);
  out.set(a);
  return out;
}

export function quantX(x: number): number {
  return Math.round(x * POS_UNITS);
}

export function quantY(y: number): number {
  return Math.round((y - WORLD_MIN_Y) * POS_UNITS);
}

export function dequantX(q: number): number {
  return q / POS_UNITS;
}

export function dequantY(q: number): number {
  return q / POS_UNITS + WORLD_MIN_Y;
}

/** The fields a delta compares. The server keeps these for each view it sent, and reads appearance from the store when it writes a create. */
export class SentView {
  /** Server tick of this view. 0 marks an unused or invalid view. */
  tick = 0;
  count = 0;
  /** Entries the columns have room for. */
  protected cap = VIEW_START;
  /** Entity slot index. Unique among live entities, ascending. */
  id = new Uint32Array(VIEW_START);
  gen = new Uint16Array(VIEW_START);
  kind = new Uint16Array(VIEW_START);
  qx = new Int32Array(VIEW_START);
  qy = new Int32Array(VIEW_START);
  qz = new Int32Array(VIEW_START);
  /** 10-bit yaw. */
  yaw = new Uint16Array(VIEW_START);
  flags = new Uint8Array(VIEW_START);
  /** Packed as `AnimState.pack` does. */
  anim = new Uint32Array(VIEW_START);
  /** Appearance revision, 4 bits. A change makes the next delta send a create. */
  rev = new Uint8Array(VIEW_START);
  /** Not sent. 1 for an entity whose changes go before the others when a snapshot cannot carry them all: a player, or a mount one drives. */
  urgent = new Uint8Array(VIEW_START);

  push(id: number, gen: number, kind: number, qx: number, qy: number, qz: number, yaw: number, flags: number, anim: number, rev = 0): boolean {
    const n = this.count;
    if (n === this.cap && !this.grow()) return false;
    this.id[n] = id;
    this.gen[n] = gen;
    this.kind[n] = kind;
    this.qx[n] = qx;
    this.qy[n] = qy;
    this.qz[n] = qz;
    this.yaw[n] = yaw;
    this.flags[n] = flags;
    this.anim[n] = anim;
    this.rev[n] = rev;
    this.count = n + 1;
    return true;
  }

  copyFrom(o: SentView, i: number): boolean {
    return this.push(o.id[i]!, o.gen[i]!, o.kind[i]!, o.qx[i]!, o.qy[i]!, o.qz[i]!, o.yaw[i]!, o.flags[i]!, o.anim[i]!, o.rev[i]!);
  }

  /** Doubles the columns. False when they are at MAX_VIEW. */
  protected grow(): boolean {
    if (this.cap >= MAX_VIEW) return false;
    const cap = (this.cap *= 2);
    this.id = wider(this.id, cap);
    this.gen = wider(this.gen, cap);
    this.kind = wider(this.kind, cap);
    this.qx = wider(this.qx, cap);
    this.qy = wider(this.qy, cap);
    this.qz = wider(this.qz, cap);
    this.yaw = wider(this.yaw, cap);
    this.flags = wider(this.flags, cap);
    this.anim = wider(this.anim, cap);
    this.rev = wider(this.rev, cap);
    this.urgent = wider(this.urgent, cap);
    return true;
  }
}

/** A view as a client holds it: each entity with its appearance. */
export class EntityView extends SentView {
  level = new Uint16Array(VIEW_START);
  colors = new Uint8Array(VIEW_START * 6);
  readonly name: string[] = new Array<string>(VIEW_START).fill("");
  /** A survivor's look (LOOK_BYTES), shared by reference and never changed in place. */
  readonly look: (Uint8Array | null)[] = new Array<Uint8Array | null>(VIEW_START).fill(null);
  /** GEAR_COUNT content indices, shared by reference. */
  readonly gear: (Uint16Array | null)[] = new Array<Uint16Array | null>(VIEW_START).fill(null);
  /** As in `EntityStore`, each 0 for none. */
  team = new Uint32Array(VIEW_START);
  seat = new Uint32Array(VIEW_START);
  span = new Uint32Array(VIEW_START);
  grown = new Uint32Array(VIEW_START);

  protected override grow(): boolean {
    if (!super.grow()) return false;
    const cap = this.cap;
    this.level = wider(this.level, cap);
    this.colors = wider(this.colors, cap * 6);
    while (this.name.length < cap) {
      this.name.push("");
      this.look.push(null);
      this.gear.push(null);
    }
    this.team = wider(this.team, cap);
    this.seat = wider(this.seat, cap);
    this.span = wider(this.span, cap);
    this.grown = wider(this.grown, cap);
    return true;
  }

  /** For the entry just pushed. Call it after `appear`, which zeroes these fields. */
  belong(team: number, seat: number, span: number, grown: number): void {
    const n = this.count - 1;
    this.team[n] = team;
    this.seat[n] = seat;
    this.span[n] = span;
    this.grown[n] = grown;
  }

  /** For the entry just pushed. Reads six bytes of `colors` from `at`. */
  appear(rev: number, level: number, colors: Uint8Array, at: number, name: string, look: Uint8Array | null, gear: Uint16Array | null): void {
    const n = this.count - 1;
    this.rev[n] = rev;
    this.level[n] = level;
    for (let k = 0; k < 6; k++) this.colors[n * 6 + k] = colors[at + k]!;
    this.name[n] = name;
    this.look[n] = look;
    this.gear[n] = gear;
    this.team[n] = this.seat[n] = this.span[n] = this.grown[n] = 0;
  }

  override copyFrom(o: EntityView, i: number): boolean {
    if (!super.copyFrom(o, i)) return false;
    this.appear(o.rev[i]!, o.level[i]!, o.colors, i * 6, o.name[i]!, o.look[i]!, o.gear[i]!);
    this.belong(o.team[i]!, o.seat[i]!, o.span[i]!, o.grown[i]!);
    return true;
  }
}

/**
 * Server side, for one client: the bodies it may show otherwise than its baselines say, each as it was last told of. A body
 * is listed from the snapshot that says something of it until the client acknowledges one that settles what it shows.
 */
export class Told {
  /** The tick of the snapshot the list was last brought up to, and of the last of those that was sent. */
  tick = 0;
  sent = 0;
  /** A bit for each of the 32 ticks up to `tick`, the lowest for `tick`: set where a snapshot was written. */
  wrote = 0;
  count = 0;
  /** The slots of the bodies listed, by ascending id. A body keeps its slot while it is listed, so most ticks change a slot in place. */
  order = new Uint16Array(VIEW_START);
  private making = new Uint16Array(VIEW_START);
  private made = 0;
  private cap = VIEW_START;
  private used = 0;
  private free = new Uint16Array(VIEW_START);
  private freed = 0;
  // By slot.
  id = new Uint32Array(VIEW_START);
  /**
   * The tick the body was last told of, or left as it was by a baseline that was sure. That tick's view has it as it was
   * told, at index `ix`, for as long as the ring keeps the view. For a body taken away, the first tick the client was told so.
   */
  at = new Uint32Array(VIEW_START);
  ix = new Uint16Array(VIEW_START);
  /** A bit for each of the 32 ticks up to `at`, the lowest for `at`: set where a client that has that tick's snapshot is sure to show the body like this. */
  sure = new Uint32Array(VIEW_START);
  /** 1 for a body the client was told to take away. */
  gone = new Uint8Array(VIEW_START);

  /** A slot for a body not listed, or -1 when the list is full: twice a view. */
  take(): number {
    if (this.freed > 0) return this.free[--this.freed]!;
    if (this.used === this.cap) {
      if (this.cap >= MAX_VIEW * 2) return -1;
      const cap = (this.cap *= 2);
      this.order = wider(this.order, cap);
      this.making = wider(this.making, cap);
      this.free = wider(this.free, cap);
      this.id = wider(this.id, cap);
      this.at = wider(this.at, cap);
      this.ix = wider(this.ix, cap);
      this.sure = wider(this.sure, cap);
      this.gone = wider(this.gone, cap);
    }
    return this.used++;
  }

  /** Slot `s` is no longer listed. */
  drop(s: number): void {
    this.free[this.freed++] = s;
  }

  /** Slot `s` is on the list being made. Slots are put on it by ascending id. */
  list(s: number): void {
    this.making[this.made++] = s;
  }

  /** The list being made becomes the list, as of `tick`. */
  turn(tick: number): void {
    const order = this.making;
    this.making = this.order;
    this.order = order;
    this.count = this.made;
    this.made = 0;
    const step = tick - this.tick;
    this.wrote = (step < 32 ? (this.wrote << step) | 1 : 1) >>> 0;
    this.tick = tick;
  }

  /** `sure` of slot `s` as it counts from `tick`. */
  private sureFrom(s: number, tick: number): number {
    const past = tick - this.at[s]!;
    return past < 32 ? (this.sure[s]! << past) >>> 0 : 0;
  }

  /** Whether a client with the snapshot of tick `acked` is sure to show the body in slot `s` as it was last told of. */
  sureAt(s: number, acked: number): boolean {
    const past = this.at[s]! - acked;
    return this.gone[s] === 0 && past >= 0 && past < 32 && ((this.sure[s]! >>> past) & 1) === 1;
  }

  /**
   * The body in slot `s` is left as its baseline of tick `acked` has it, which was sure, and is entry `ix` of this tick's
   * view. Sure at every snapshot from that baseline on, every baseline the client can still name has it so: it leaves the list.
   */
  hold(s: number, tick: number, acked: number, ix: number): void {
    const all = 0xffffffff >>> (31 - Math.min(31, this.tick - acked));
    if (((this.sureFrom(s, this.tick) | ~this.wrote) & all) >>> 0 === all) {
      this.drop(s);
      return;
    }
    this.sure[s] = this.sureFrom(s, tick) | 1;
    this.at[s] = tick;
    this.ix[s] = ix;
    this.list(s);
  }

  /**
   * The op of the body in slot `s` waits, and the client goes on showing what it was last told. A body it was told to take
   * away, back in view and not yet sent again, is still to be taken away from the next tick on.
   */
  wait(s: number, tick: number): void {
    if (this.gone[s] === 1) this.at[s] = tick + 1;
    this.list(s);
  }

  /** The client is told to take body `id` away. `s` is its slot, or -1. It is told again each snapshot until it acknowledges one that said so. */
  remove(s: number, id: number, tick: number): void {
    if (s < 0) {
      s = this.take();
      if (s < 0) return;
      this.gone[s] = 0;
    }
    if (this.gone[s] === 0) this.at[s] = tick;
    this.id[s] = id;
    this.gone[s] = 1;
    this.list(s);
  }

  /**
   * The client is told of body `id`, which is entry `ix` of this tick's view. `s` is its slot, or -1. Told `again` what it
   * was last told, it is as sure as it was at the ticks before.
   */
  say(s: number, id: number, tick: number, ix: number, again: boolean): void {
    if (s < 0) {
      s = this.take();
      if (s < 0) return;
    }
    if (again) this.sure[s] = this.sureFrom(s, tick) | 1;
    else {
      this.id[s] = id;
      this.sure[s] = 1;
      this.gone[s] = 0;
    }
    this.at[s] = tick;
    this.ix[s] = ix;
    this.list(s);
  }

  clear(): void {
    this.tick = this.sent = this.wrote = this.count = this.made = this.used = this.freed = 0;
  }
}

export class ViewRing<V extends SentView> {
  private readonly views: V[] = [];
  /** Server side: what the client was last told. */
  told: Told | null = null;

  constructor(make: () => V) {
    for (let i = 0; i < VIEW_RING; i++) this.views.push(make());
  }

  find(tick: number): V | null {
    const v = this.views[tick % VIEW_RING]!;
    return tick !== 0 && v.tick === tick ? v : null;
  }

  /** Returns the slot for `tick`, emptied. */
  alloc(tick: number): V {
    const v = this.views[tick % VIEW_RING]!;
    v.tick = tick;
    v.count = 0;
    return v;
  }

  at(i: number): V {
    return this.views[i]!;
  }

  clear(): void {
    for (const v of this.views) {
      v.tick = 0;
      v.count = 0;
    }
    this.told?.clear();
  }
}

const scratchColors = new Uint8Array(6);

// Encoder scratch, one entry per merged entity: those of the baseline, of the true state and of what the client was told.
const MAX_OPS = MAX_VIEW * 4;
const opKind = new Uint8Array(MAX_OPS);
const opBase = new Int16Array(MAX_OPS);
const opCur = new Int16Array(MAX_OPS);
/** Where the entity is in what the client was told, or -1. Not set for K_KEEP. */
const opTold = new Int16Array(MAX_OPS);
const opId = new Uint32Array(MAX_OPS);
/** Positions in the op list of the ops that may be deferred: those of urgent entities, and the rest. */
const urgIndex = new Int16Array(MAX_VIEW * 2);
const optIndex = new Int16Array(MAX_VIEW * 2);
/** Bits each deferrable op takes. Exact for an update but for its id gap, an upper bound for a create, new or again. */
const opBits = new Uint16Array(MAX_OPS);
let admitted = 0;
const K_KEEP = 0;
const K_UPDATE = 1;
const K_CREATE = 2;
const K_REMOVE = 3;
const K_REPLACE = 4;
const K_STALE = 5;
const K_SKIP = 6;
/** Unchanged from the baseline, and listed in what the client was told. */
const K_HOLD = 7;
const NONE = 0xffffffff;

function varintBits(v: number): number {
  return v < 0x80 ? 8 : v < 0x4000 ? 16 : v < 0x200000 ? 24 : 32;
}

/**
 * Lets through a window of the `count` ops in `list` that fits `budgetBits`, starting at `rotate`, and defers the rest.
 * Sets `admitted` and returns where the next window starts, so no entity starves. The first op always goes, or one larger
 * than the budget would hold the window where it is for good.
 */
function admit(list: Int16Array, count: number, rotate: number, budgetBits: number): number {
  const start = rotate % count;
  let allowed = 0;
  let bits = 0;
  for (; allowed < count; allowed++) {
    const cost = opBits[list[(start + allowed) % count]!]!;
    if (bits + cost > budgetBits && allowed > 0) break;
    bits += cost;
  }
  for (let t = allowed; t < count; t++) {
    const k = list[(start + t) % count]!;
    opKind[k] = opKind[k] === K_CREATE ? K_SKIP : K_STALE;
  }
  admitted = allowed;
  return (start + allowed) % count;
}

/** Whether the client was last told of the body in slot `s` as entry `j` of `v` has it. False where the view that would say is gone. */
function same(ring: ViewRing<SentView>, told: Told, s: number, v: SentView, j: number): boolean {
  const was = ring.find(told.at[s]!);
  if (!was) return false;
  const i = told.ix[s]!;
  return was.qx[i] === v.qx[j] && was.qz[i] === v.qz[j] && was.qy[i] === v.qy[j] && was.yaw[i] === v.yaw[j] && was.anim[i] === v.anim[j] && was.flags[i] === v.flags[j] && was.gen[i] === v.gen[j] && was.rev[i] === v.rev[j];
}

/**
 * With no baseline nothing is settled, so the list must name every body the client shows: those on it, and the rest of the
 * view the newest snapshot sent left the client. After a second with no snapshot sent that view is gone, and both sides
 * start from nothing.
 */
function everything(ring: ViewRing<SentView>, told: Told, tick: number): void {
  const view = told.sent !== 0 && tick - told.sent < VIEW_RING ? ring.find(told.sent) : null;
  if (!view) {
    told.clear();
    return;
  }
  const order = told.order;
  const nt = told.count;
  let h = 0;
  for (let i = 0; i < view.count; i++) {
    const id = view.id[i]!;
    for (; h < nt && told.id[order[h]!]! < id; h++) told.list(order[h]!);
    if (h < nt && told.id[order[h]!] === id) continue;
    const s = told.take();
    if (s < 0) continue;
    // Settled when that snapshot was sent, so a client with it or any before it shows the body so.
    told.id[s] = id;
    told.at[s] = told.sent;
    told.ix[s] = i;
    told.sure[s] = 0xffffffff;
    told.gone[s] = 0;
    told.list(s);
  }
  for (; h < nt; h++) told.list(order[h]!);
  told.turn(told.tick);
}

/**
 * Encodes `cur` (the true state, sorted by id) against `base` (the view the client has, or null) and fills `next` with the
 * view the client will hold after applying it. `budgetBits` bounds the deferrable ops, which are all but the removes. A
 * deferred op is left out, and `next` records the stale state the client is left with, so later deltas stay correct.
 * Urgent entities are deferred last. `rotate` holds where deferral started last time. Pass back what this returns, and 0
 * the first time. `looks` gives the appearance a create carries.
 *
 * Clients around one place share one `cur`, and each is sent its own part of it. The entry with id `skip` is left out, and
 * so is every entry whose `rank` is `limit` or more. `rank` is each entry's place in the order they were chosen in.
 *
 * `ring` is the client's ring, which `next` was allocated from. With it the client is taken to show each body as it was
 * last told of, and is told again of any it may show otherwise until it acknowledges a snapshot that settles it. The
 * snapshot counts as sent unless `w` has overflowed by the time this returns. One that is not sent is as one lost on the way.
 */
export function writeViewDelta(w: BitWriter, base: SentView | null, cur: SentView, next: SentView, budgetBits: number, rotate: number, looks: Looks, skip = -1, rank: Uint16Array | null = null, limit = MAX_VIEW, ring: ViewRing<SentView> | null = null): number {
  const nb = base ? base.count : 0;
  const nc = cur.count;
  const tick = next.tick;
  const acked = base ? base.tick : 0;
  const told = ring ? (ring.told ??= new Told()) : null;
  if (told && !base) everything(ring!, told, tick);
  const nt = told ? told.count : 0;
  const order = told ? told.order : null;
  let i = 0;
  let j = 0;
  let h = 0;
  let n = 0;
  let optional = 0;
  let optionalBits = 0;
  let urgent = 0;
  let urgentBits = 0;
  let written = 0;
  /** One more than the id of the last op, for the size of the next op's id gap. A deferred op between two makes the real gap larger. */
  let last = 0;
  let tid = nt > 0 ? told!.id[order![0]!]! : NONE;
  while (i < nb || j < nc || h < nt) {
    if (j < nc && (cur.id[j] === skip || (rank !== null && rank[j]! >= limit))) {
      j++;
      continue;
    }
    const bid = i < nb ? base!.id[i]! : NONE;
    const cid = j < nc ? cur.id[j]! : NONE;
    // The body's slot in what the client was told, or -1.
    let th = -1;
    if (tid <= bid && tid <= cid) {
      th = order![h++]!;
      const id = tid;
      tid = h < nt ? told!.id[order![h]!]! : NONE;
      // Told to take it away, and a snapshot that said so is acknowledged.
      const settled = told!.gone[th] === 1 && acked >= told!.at[th]!;
      if (settled) told!.drop(th);
      if (id < bid && id < cid) {
        // Out of view and not in the baseline, so no delta would mention it. The client may show it still. In a snapshot
        // with a thousand removes already it stays listed for the next, so that a reader never meets more ops than it allows.
        if (!settled) {
          if (written < MAX_VIEW / 2) {
            opKind[n] = K_REMOVE;
            opId[n] = id;
            written++;
            last = id + 1;
          } else opKind[n] = K_SKIP;
          opTold[n] = th;
          n++;
        }
        continue;
      }
      if (settled) th = -1;
    }
    let bits = 0;
    if (bid < cid) {
      opKind[n] = K_REMOVE;
      opBase[n] = i++;
      opId[n] = bid;
      written++;
      last = bid + 1;
    } else if (cid < bid) {
      opKind[n] = K_CREATE;
      opCur[n] = j;
      opId[n] = cid;
      bits = createBits(looks, cid);
      last = cid + 1;
    } else {
      opBase[n] = i;
      opCur[n] = j;
      if (base!.gen[i] !== cur.gen[j] || base!.rev[i] !== cur.rev[j]) {
        // Deferred, it leaves the client the entry it has.
        opKind[n] = K_REPLACE;
        bits = createBits(looks, cid);
        last = cid + 1;
      } else {
        const dx = cur.qx[j]! - base!.qx[i]!;
        const dy = cur.qy[j]! - base!.qy[i]!;
        const dz = cur.qz[j]! - base!.qz[i]!;
        const moved = dx !== 0 || dy !== 0 || dz !== 0;
        const changed = cur.anim[j]! ^ base!.anim[i]!;
        if (!moved && changed === 0 && base!.yaw[i] === cur.yaw[j] && base!.flags[i] === cur.flags[j]) {
          if (th < 0) {
            opKind[n] = K_KEEP;
            i++;
            j++;
            n++;
            continue;
          }
          // Sure at the baseline, and no different since. Last told of in the baseline itself, it is as the baseline has it.
          if (told!.sureAt(th, acked) && (told!.at[th] === acked || same(ring!, told!, th, cur, j))) {
            opKind[n] = K_HOLD;
            opTold[n] = th;
            i++;
            j++;
            n++;
            continue;
          }
          // As the baseline has it, but the client may show what it was told since. An update with no parts says so.
        }
        opKind[n] = K_UPDATE;
        // The id gap, the op, and one bit for each of the six parts that may follow.
        bits = varintBits(cid + 1 - last) + 2 + 6;
        if (moved) bits += dx >= -128 && dx <= 127 && dy >= -128 && dy <= 127 && dz >= -128 && dz <= 127 ? 25 : 65;
        if (base!.yaw[i] !== cur.yaw[j]) bits += 10;
        if (base!.flags[i] !== cur.flags[j]) bits += 4;
        if ((changed & ANIM_MOTION_MASK) !== 0) bits += ANIM_MOTION_BITS;
        if (((changed >>> ANIM_LOOK_SHIFT) & LOOK_MASK) !== 0) bits += ANIM_LOOK_BITS;
        if (changed >>> ANIM_ACTION_SHIFT !== 0) bits += ANIM_ACTION_BITS;
        last = cid + 1;
      }
      opId[n] = cid;
      i++;
    }
    opTold[n] = th;
    if (bits !== 0) {
      if (th >= 0 && bid === cid && told!.gone[th] === 1) {
        // Taken away and back, and in this baseline all along. It is told now, or it would show as the baseline has it.
        written++;
      } else {
        opBits[n] = bits;
        if (cur.urgent[j] === 1) {
          urgIndex[urgent++] = n;
          urgentBits += bits;
        } else {
          optIndex[optional++] = n;
          optionalBits += bits;
        }
      }
    }
    if (cid <= bid) j++;
    n++;
  }

  // Over budget. Urgent ops go first, and a rotating window of the others takes what is left. The others keep a quarter
  // of the budget, so a fight with more players than a snapshot carries does not freeze every creature in it.
  if (urgentBits + optionalBits <= budgetBits) {
    written += urgent + optional;
    rotate = 0;
  } else {
    // Each list has its own place in `rotate`: twelve bits for the others, the rest for the urgent.
    let urgentFrom = rotate >>> 12;
    let othersFrom = rotate & 0xfff;
    const kept = optional > 0 ? budgetBits >> 2 : 0;
    let left = budgetBits - urgentBits;
    if (left < kept) {
      urgentFrom = admit(urgIndex, urgent, urgentFrom, budgetBits - kept);
      written += admitted;
      left = kept;
    } else written += urgent;
    if (optional > 0) {
      othersFrom = admit(optIndex, optional, othersFrom, left);
      written += admitted;
    }
    rotate = urgentFrom * 4096 + othersFrom;
  }

  w.varint(written);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const kind = opKind[k]!;
    const bi = opBase[k]!;
    if (kind === K_KEEP) {
      next.copyFrom(base!, bi);
      continue;
    }
    const th = opTold[k]!;
    if (kind === K_HOLD) {
      next.copyFrom(base!, bi);
      told!.hold(th, tick, acked, next.count - 1);
      continue;
    }
    if (kind === K_STALE || kind === K_SKIP) {
      if (kind === K_STALE) next.copyFrom(base!, bi);
      if (th >= 0) told!.wait(th, tick);
      continue;
    }
    const ci = opCur[k]!;
    const id = opId[k]!;
    w.varint(id + 1 - prev);
    prev = id + 1;
    if (kind === K_REMOVE) {
      w.bits(OP_REMOVE, 2);
      if (told) told.remove(th, id, tick);
      continue;
    }
    // Both ops below add it to `next`, at the end. Last told of in the baseline, it is now told something else.
    if (told) told.say(th, id, tick, next.count, th >= 0 && told.gone[th] === 0 && told.at[th] !== acked && same(ring!, told, th, cur, ci));
    if (kind !== K_UPDATE) {
      w.bits(OP_CREATE, 2);
      w.varint(cur.kind[ci]!);
      w.bits(cur.gen[ci]!, 12);
      w.bits(cur.qx[ci]!, 22);
      w.bits(cur.qy[ci]!, 20);
      w.bits(cur.qz[ci]!, 22);
      w.bits(cur.yaw[ci]!, 10);
      w.bits(cur.flags[ci]!, 4);
      w.bits(cur.anim[ci]!, ANIM_BITS);
      w.bits(cur.rev[ci]!, 4);
      w.varint(looks.level[id]!);
      const c0 = id * 6;
      const colors = looks.colors;
      const coloured = (colors[c0]! | colors[c0 + 1]! | colors[c0 + 2]! | colors[c0 + 3]! | colors[c0 + 4]! | colors[c0 + 5]!) !== 0;
      w.bool(coloured);
      if (coloured) for (let q = 0; q < 6; q++) w.u8(colors[c0 + q]!);
      const name = looks.name[id]!;
      w.bool(name !== "");
      if (name !== "") w.string(name);
      const look = looks.look[id]!;
      w.bool(look !== null);
      if (look) for (let q = 0; q < LOOK_BYTES; q++) w.u8(look[q]!);
      const gear = looks.gear[id]!;
      w.bool(gear !== null);
      if (gear) for (let q = 0; q < GEAR_COUNT; q++) w.u16(gear[q]!);
      // Team, seat and growth are each sent only when set.
      w.bool(looks.team[id] !== 0);
      if (looks.team[id] !== 0) w.varint(looks.team[id]!);
      w.bool(looks.seat[id] !== 0);
      if (looks.seat[id] !== 0) w.varint(looks.seat[id]!);
      const young = looks.span[id] !== 0 || looks.grown[id] !== 0;
      w.bool(young);
      if (young) {
        w.u32(looks.span[id]!);
        w.u32(looks.grown[id]!);
      }
      next.copyFrom(cur, ci);
    } else {
      w.bits(OP_UPDATE, 2);
      const dx = cur.qx[ci]! - base!.qx[bi]!;
      const dy = cur.qy[ci]! - base!.qy[bi]!;
      const dz = cur.qz[ci]! - base!.qz[bi]!;
      const moved = dx !== 0 || dy !== 0 || dz !== 0;
      w.bool(moved);
      if (moved) {
        const small = dx >= -128 && dx <= 127 && dy >= -128 && dy <= 127 && dz >= -128 && dz <= 127;
        w.bool(small);
        if (small) {
          w.sbits(dx, 8);
          w.sbits(dy, 8);
          w.sbits(dz, 8);
        } else {
          w.bits(cur.qx[ci]!, 22);
          w.bits(cur.qy[ci]!, 20);
          w.bits(cur.qz[ci]!, 22);
        }
      }
      const turned = cur.yaw[ci] !== base!.yaw[bi];
      w.bool(turned);
      if (turned) w.bits(cur.yaw[ci]!, 10);
      const flagged = cur.flags[ci] !== base!.flags[bi];
      w.bool(flagged);
      if (flagged) w.bits(cur.flags[ci]!, 4);
      const changed = cur.anim[ci]! ^ base!.anim[bi]!;
      const motion = (changed & ANIM_MOTION_MASK) !== 0;
      w.bool(motion);
      if (motion) w.bits(cur.anim[ci]! & ANIM_MOTION_MASK, ANIM_MOTION_BITS);
      const look = ((changed >>> ANIM_LOOK_SHIFT) & LOOK_MASK) !== 0;
      w.bool(look);
      if (look) w.bits((cur.anim[ci]! >>> ANIM_LOOK_SHIFT) & LOOK_MASK, ANIM_LOOK_BITS);
      const action = changed >>> ANIM_ACTION_SHIFT !== 0;
      w.bool(action);
      if (action) w.bits(cur.anim[ci]! >>> ANIM_ACTION_SHIFT, ANIM_ACTION_BITS);
      next.copyFrom(cur, ci);
    }
  }
  if (told) {
    told.turn(tick);
    if (!w.overflow) told.sent = tick;
  }
  return rotate;
}

/** Copies to `drawn` the entries of `before` below `id`: bodies the client shows that this snapshot says nothing of. Returns where it stopped. */
function carry(drawn: EntityView, before: EntityView | null, l: number, id: number): number {
  if (before) while (l < before.count && before.id[l]! < id) drawn.copyFrom(before, l++);
  return l;
}

/** The entry just added to `next` had no op: it is shown as it was last told of, and as the view has it if it was not shown. */
function untold(drawn: EntityView, before: EntityView | null, l: number, next: EntityView): number {
  const at = next.count - 1;
  const id = next.id[at]!;
  l = carry(drawn, before, l, id);
  if (before && l < before.count && before.id[l] === id) drawn.copyFrom(before, l++);
  else drawn.copyFrom(next, at);
  return l;
}

/**
 * Returns false if the data is inconsistent. `next` becomes the view the server holds the client to have, which later deltas
 * are read against. `drawn`, if given, becomes what the client shows: `before`, which is what it showed after the snapshot
 * before this one, with this snapshot's ops applied. A body the snapshot says nothing of stays as it was last told of.
 */
export function readViewDelta(r: BitReader, base: EntityView | null, next: EntityView, before: EntityView | null = null, drawn: EntityView | null = null): boolean {
  const nb = base ? base.count : 0;
  // With no baseline and no snapshot for a second, the server has started again from nothing.
  if (!base && before && next.tick - before.tick >= VIEW_RING) before = null;
  const count = r.varint();
  if (count > MAX_VIEW * 2) return false;
  let i = 0;
  let l = 0;
  let prev = 0;
  for (let k = 0; k < count; k++) {
    const gap = r.varint();
    if (gap === 0) return false;
    prev += gap;
    const id = prev - 1;
    const op = r.bits(2);
    while (i < nb && base!.id[i]! < id) {
      if (!next.copyFrom(base!, i++)) return false;
      if (drawn) l = untold(drawn, before, l, next);
    }
    const present = i < nb && base!.id[i] === id;
    if (drawn) {
      l = carry(drawn, before, l, id);
      if (before && l < before.count && before.id[l] === id) l++;
    }
    if (op === OP_REMOVE) {
      if (present) i++;
    } else if (op === OP_CREATE) {
      const kind = r.varint();
      const gen = r.bits(12);
      const qx = r.bits(22);
      const qy = r.bits(20);
      const qz = r.bits(22);
      const yaw = r.bits(10);
      const flags = r.bits(4);
      const anim = r.bits(ANIM_BITS);
      const rev = r.bits(4);
      const level = r.varint();
      if (r.bool()) for (let q = 0; q < 6; q++) scratchColors[q] = r.u8();
      else scratchColors.fill(0);
      const name = r.bool() ? r.string(MAX_NAME_LENGTH) : "";
      let look: Uint8Array | null = null;
      if (r.bool()) {
        look = new Uint8Array(LOOK_BYTES);
        for (let q = 0; q < LOOK_BYTES; q++) look[q] = r.u8();
      }
      let gear: Uint16Array | null = null;
      if (r.bool()) {
        gear = new Uint16Array(GEAR_COUNT);
        for (let q = 0; q < GEAR_COUNT; q++) gear[q] = r.u16();
      }
      const team = r.bool() ? r.varint() : 0;
      const seat = r.bool() ? r.varint() : 0;
      const young = r.bool();
      const span = young ? r.u32() : 0;
      const grown = young ? r.u32() : 0;
      if (present) i++;
      if (kind > 0xffff || level > 0xffff || !next.push(id, gen, kind, qx, qy, qz, yaw, flags, anim)) return false;
      next.appear(rev, level, scratchColors, 0, name, look, gear);
      next.belong(team, seat, span, grown);
      if (drawn) drawn.copyFrom(next, next.count - 1);
    } else if (op === OP_UPDATE) {
      if (!present) return false;
      let qx = base!.qx[i]!;
      let qy = base!.qy[i]!;
      let qz = base!.qz[i]!;
      let yaw = base!.yaw[i]!;
      let flags = base!.flags[i]!;
      if (r.bool()) {
        if (r.bool()) {
          qx += r.sbits(8);
          qy += r.sbits(8);
          qz += r.sbits(8);
        } else {
          qx = r.bits(22);
          qy = r.bits(20);
          qz = r.bits(22);
        }
      }
      if (r.bool()) yaw = r.bits(10);
      if (r.bool()) flags = r.bits(4);
      let anim = base!.anim[i]!;
      if (r.bool()) anim = (anim & ~ANIM_MOTION_MASK) | r.bits(ANIM_MOTION_BITS);
      if (r.bool()) anim = (anim & ~(LOOK_MASK << ANIM_LOOK_SHIFT)) | (r.bits(ANIM_LOOK_BITS) << ANIM_LOOK_SHIFT);
      if (r.bool()) anim = (anim & ((1 << ANIM_ACTION_SHIFT) - 1)) | (r.bits(ANIM_ACTION_BITS) << ANIM_ACTION_SHIFT);
      if (!next.push(id, base!.gen[i]!, base!.kind[i]!, qx, qy, qz, yaw, flags, anim >>> 0)) return false;
      next.appear(base!.rev[i]!, base!.level[i]!, base!.colors, i * 6, base!.name[i]!, base!.look[i]!, base!.gear[i]!);
      next.belong(base!.team[i]!, base!.seat[i]!, base!.span[i]!, base!.grown[i]!);
      if (drawn) drawn.copyFrom(next, next.count - 1);
      i++;
    } else return false;
    if (r.overflow) return false;
  }
  while (i < nb) {
    if (!next.copyFrom(base!, i++)) return false;
    if (drawn) l = untold(drawn, before, l, next);
  }
  if (drawn) carry(drawn, before, l, NONE);
  return true;
}
