// The snapshot writer as it was before an update kept its vehicle comparison from sizing to writing, copied unchanged
// but for its name. tests/net/vehicle-bytes.test.ts holds the writer's bytes to these. When the wire changes, delete both.

import { ANIM_ACTION_BITS, ANIM_ACTION_SHIFT, ANIM_LOOK_BITS, ANIM_LOOK_SHIFT, ANIM_MOTION_BITS, ANIM_MOTION_MASK, CUE_BITS, EMOTE_BITS, REACT_BITS } from "../../shared/anim/pose.ts";
import { LOOK_BYTES } from "../../shared/anim/look.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { MAX_VIEW, Told, VIEW_RING, type Looks, type SentView, type ViewRing } from "../../shared/net/view.ts";
import { GEAR_COUNT } from "../../shared/sim/entities.ts";

const OP_UPDATE = 0;
const OP_CREATE = 1;
const OP_REMOVE = 2;
const OP_DIED = 3;

const ANIM_BITS = ANIM_MOTION_BITS + ANIM_LOOK_BITS + ANIM_ACTION_BITS;
/** A vehicle's parts in a view entry, in their order on the wire: pose, wheel, ride, doors, drive, rotor, systems two quaternion words, and hull/flooding. */
const VEHICLE_PART_BITS = [32, 16, 32, 32, 32, 32, 32, 32, 32, 16] as const;
/** A create's vehicle: every part, each with its bit. */
const VEHICLE_BITS = VEHICLE_PART_BITS.reduce((a, b) => a + b + 1, 0);
const partsA = new Uint32Array(VEHICLE_PART_BITS.length);
const partsB = new Uint32Array(VEHICLE_PART_BITS.length);

function vehicleParts(v: SentView, i: number, out: Uint32Array | number[]): void {
  out[0] = v.vehiclePose[i]!;
  out[1] = v.vehicleWheel[i]!;
  out[2] = v.vehicleRide[i]!;
  out[3] = v.vehicleDoors[i]!;
  out[4] = v.vehicleDrive[i]!;
  out[5] = v.vehicleRotor[i]!;
  out[6] = v.vehicleSystems[i]!;
  out[7] = v.vehicleAttitudeA[i]!;
  out[8] = v.vehicleAttitudeB[i]!;
  out[9] = v.vehicleWater[i]!;
}

/** The bits an update's vehicle takes after its own bit: 0 when no part changed. */
function vehicleChange(base: SentView, i: number, cur: SentView, j: number): number {
  vehicleParts(base, i, partsA);
  vehicleParts(cur, j, partsB);
  let bits = 0;
  let any = false;
  for (let p = 0; p < VEHICLE_PART_BITS.length; p++) {
    bits += 1;
    if (partsA[p] !== partsB[p]) { bits += VEHICLE_PART_BITS[p]!; any = true; }
  }
  return any ? bits : 0;
}

/** Each part with its bit, the part only where it differs from the base's (always, without a base). */
function writeVehicleParts(w: BitWriter, base: SentView | null, i: number, cur: SentView, j: number): void {
  if (base) vehicleParts(base, i, partsA);
  vehicleParts(cur, j, partsB);
  for (let p = 0; p < VEHICLE_PART_BITS.length; p++) {
    const sent = !base || partsA[p] !== partsB[p];
    w.bool(sent);
    if (sent) w.bits(partsB[p]!, VEHICLE_PART_BITS[p]!);
  }
}

const LOOK_MASK = (1 << ANIM_LOOK_BITS) - 1;
const CREATE_BITS = 1 + 24 + 2 + 24 + 12 + 64 + 10 + 4 + ANIM_BITS + 1 + 4 + 16 + 4 + 48 + 3;

function createBits(v: Looks, id: number): number {
  const name = v.names.get(id) ?? "";
  // The optional fields: a look, gear, a team, a seat, an age.
  const look = (v.looks.has(id) ? LOOK_BYTES * 8 : 0) + (v.gears.has(id) ? GEAR_COUNT * 16 + 1 : 0) + (v.team[id] !== 0 ? 40 : 0) + (v.seat[id] !== 0 ? 60 : 0) + (v.span[id] !== 0 || v.grown[id] !== 0 ? 64 : 0);
  if (name === "") return CREATE_BITS + look;
  let bytes = 1;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return CREATE_BITS + look + bytes * 8;
}

// Encoder scratch, one entry per merged entity: those of the baseline, of the true state and of what the client was told.
const MAX_OPS = MAX_VIEW * 4;
const opKind = new Uint8Array(MAX_OPS);
const opBase = new Int16Array(MAX_OPS);
const opCur = new Int16Array(MAX_OPS);
/** Where the entity is in what the client was told, or -1. Not set for K_KEEP. */
const opTold = new Int16Array(MAX_OPS);
const opId = new Uint32Array(MAX_OPS);
/** 1 for a remove of a body that died. */
const opDied = new Uint8Array(MAX_OPS);
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
  return was.qx[i] === v.qx[j] && was.qz[i] === v.qz[j] && was.qy[i] === v.qy[j] && was.yaw[i] === v.yaw[j] && was.anim[i] === v.anim[j] && was.cue[i] === v.cue[j] && was.emote[i] === v.emote[j] && was.react[i] === v.react[j] && was.stride[i] === v.stride[j] && was.vehiclePose[i] === v.vehiclePose[j] && was.vehicleWheel[i] === v.vehicleWheel[j] && was.vehicleRide[i] === v.vehicleRide[j] && was.vehicleDrive[i] === v.vehicleDrive[j] && was.vehicleRotor[i] === v.vehicleRotor[j] && was.vehicleSystems[i] === v.vehicleSystems[j] && was.vehicleAttitudeA[i] === v.vehicleAttitudeA[j] && was.vehicleAttitudeB[i] === v.vehicleAttitudeB[j] && was.vehicleWater[i] === v.vehicleWater[j] && was.vehicleDoors[i] === v.vehicleDoors[j] && was.flags[i] === v.flags[j] && was.gen[i] === v.gen[j] && was.rev[i] === v.rev[j];
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
export function writeViewDeltaBefore(w: BitWriter, base: SentView | null, cur: SentView, next: SentView, budgetBits: number, rotate: number, looks: Looks, skip = -1, rank: Uint16Array | null = null, limit = MAX_VIEW, ring: ViewRing<SentView> | null = null): number {
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
            opDied[n] = told!.died[th]!;
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
      // It died if the body that died last at its index is the one the client has.
      opDied[n] = looks.died !== undefined && looks.died[bid] === base!.gen[i] ? 1 : 0;
      opBase[n] = i++;
      opId[n] = bid;
      written++;
      last = bid + 1;
    } else if (cid < bid) {
      opKind[n] = K_CREATE;
      opCur[n] = j;
      opId[n] = cid;
      bits = createBits(looks, cid) + 1 + (cur.stride[j] ? 8 : 0) + (cur.cue[j] !== 0 ? CUE_BITS : 0) + 1 + (cur.emote[j] !== 0 ? EMOTE_BITS : 0) + 1 + (cur.react[j] !== 0 ? REACT_BITS : 0) + (cur.vehiclePose[j] !== 0 ? VEHICLE_BITS : 0);
      last = cid + 1;
    } else {
      opBase[n] = i;
      opCur[n] = j;
      if (base!.gen[i] !== cur.gen[j] || base!.rev[i] !== cur.rev[j]) {
        // Deferred, it leaves the client the entry it has.
        opKind[n] = K_REPLACE;
        bits = createBits(looks, cid) + 1 + (cur.stride[j] ? 8 : 0) + (cur.cue[j] !== 0 ? CUE_BITS : 0) + 1 + (cur.emote[j] !== 0 ? EMOTE_BITS : 0) + 1 + (cur.react[j] !== 0 ? REACT_BITS : 0) + (cur.vehiclePose[j] !== 0 ? VEHICLE_BITS : 0);
        last = cid + 1;
      } else {
        const dx = cur.qx[j]! - base!.qx[i]!;
        const dy = cur.qy[j]! - base!.qy[i]!;
        const dz = cur.qz[j]! - base!.qz[i]!;
        const moved = dx !== 0 || dy !== 0 || dz !== 0;
        const changed = cur.anim[j]! ^ base!.anim[i]!;
        const emoted = cur.emote[j] !== base!.emote[i];
        const strideChanged = cur.stride[j] !== base!.stride[i];
        const reacted = cur.react[j] !== base!.react[i];
        const cued = cur.cue[j] !== base!.cue[i] || emoted || reacted;
        const vehicleBits = vehicleChange(base!, i, cur, j);
        if (!moved && changed === 0 && !strideChanged && !cued && vehicleBits === 0 && base!.yaw[i] === cur.yaw[j] && base!.flags[i] === cur.flags[j]) {
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
        // The id gap, the op, and one bit for each of the seven parts that may follow.
        bits = varintBits(cid + 1 - last) + 2 + 7 + vehicleBits;
        if (moved) bits += dx >= -128 && dx <= 127 && dy >= -128 && dy <= 127 && dz >= -128 && dz <= 127 ? 25 : 65;
        if (base!.yaw[i] !== cur.yaw[j]) bits += 10;
        if (base!.flags[i] !== cur.flags[j]) bits += 4;
        if ((changed & ANIM_MOTION_MASK) !== 0 || strideChanged) bits += ANIM_MOTION_BITS + 1 + (strideChanged ? 8 : 0);
        if (((changed >>> ANIM_LOOK_SHIFT) & LOOK_MASK) !== 0) bits += ANIM_LOOK_BITS;
        if (changed >>> ANIM_ACTION_SHIFT !== 0 || cued) bits += ANIM_ACTION_BITS + 3 + (cur.cue[j] !== base!.cue[i] ? CUE_BITS : 0) + (emoted ? EMOTE_BITS : 0) + (reacted ? REACT_BITS : 0);
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
      w.bits(opDied[k] === 1 ? OP_DIED : OP_REMOVE, 2);
      if (told) told.remove(th, id, tick, opDied[k] === 1);
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
      w.bool(cur.cue[ci] !== 0);
      if (cur.cue[ci] !== 0) w.bits(cur.cue[ci]!, CUE_BITS);
      w.bool(cur.emote[ci] !== 0);
      if (cur.emote[ci] !== 0) w.bits(cur.emote[ci]!, EMOTE_BITS);
      w.bool(cur.stride[ci] !== 0);
      if (cur.stride[ci]) w.u8(cur.stride[ci]!);
      w.bool(cur.react[ci] !== 0);
      if (cur.react[ci] !== 0) w.bits(cur.react[ci]!, REACT_BITS);
      w.bool(cur.vehiclePose[ci] !== 0);
      if (cur.vehiclePose[ci] !== 0) writeVehicleParts(w, null, 0, cur, ci);
      w.bits(cur.rev[ci]!, 4);
      w.varint(looks.level[id]!);
      const c0 = id * 6;
      const colors = looks.colors;
      const coloured = (colors[c0]! | colors[c0 + 1]! | colors[c0 + 2]! | colors[c0 + 3]! | colors[c0 + 4]! | colors[c0 + 5]!) !== 0;
      w.bool(coloured);
      if (coloured) for (let q = 0; q < 6; q++) w.u8(colors[c0 + q]!);
      const name = looks.names.get(id) ?? "";
      w.bool(name !== "");
      if (name !== "") w.string(name);
      const look = looks.looks.get(id);
      w.bool(look !== undefined);
      if (look) for (let q = 0; q < LOOK_BYTES; q++) w.u8(look[q]!);
      const gear = looks.gears.get(id);
      w.bool(gear !== undefined);
      if (gear) {
        for (let q = 0; q < GEAR_COUNT; q++) w.u16(gear[q]!);
        w.bool((looks.on?.[id] ?? 0) !== 0);
      }
      // Team, seat and growth are each sent only when set.
      w.bool(looks.team[id] !== 0);
      if (looks.team[id] !== 0) w.varint(looks.team[id]!);
      w.bool(looks.seat[id] !== 0);
      if (looks.seat[id] !== 0) { w.varint(looks.seat[id]!); w.u8(looks.seatSlot?.[id] ?? 0); w.bits(looks.seatGen?.[id] ?? 0, 12); }
      const young = looks.span[id] !== 0 || looks.grown[id] !== 0;
      w.bool(young);
      if (young) {
        w.u32(looks.span[id]!);
        w.u32(looks.grown[id]!);
      }
      next.copyFrom(cur, ci);
    } else {
      // The parts are gathered into three writes, lowest bits first as the reader takes them: the op with the move, then the
      // yaw, the flags and the motion, then the look and the action.
      const dx = cur.qx[ci]! - base!.qx[bi]!;
      const dy = cur.qy[ci]! - base!.qy[bi]!;
      const dz = cur.qz[ci]! - base!.qz[bi]!;
      if (dx === 0 && dy === 0 && dz === 0) w.bits(OP_UPDATE, 3);
      else if (dx >= -128 && dx <= 127 && dy >= -128 && dy <= 127 && dz >= -128 && dz <= 127) w.bits(OP_UPDATE | 12 | ((dx & 255) << 4) | ((dy & 255) << 12) | ((dz & 255) << 20), 28);
      else {
        w.bits(OP_UPDATE | 4, 4);
        w.bits(cur.qx[ci]!, 22);
        w.bits(cur.qy[ci]!, 20);
        w.bits(cur.qz[ci]!, 22);
      }
      const changed = cur.anim[ci]! ^ base!.anim[bi]!;
      const cued = cur.cue[ci] !== base!.cue[bi];
      const emoted = cur.emote[ci] !== base!.emote[bi];
      const reacted = cur.react[ci] !== base!.react[bi];
      let v = 0;
      let n = 1;
      if (cur.yaw[ci] !== base!.yaw[bi]) {
        v = 1 | ((cur.yaw[ci]! & 0x3ff) << 1);
        n = 11;
      }
      if (cur.flags[ci] !== base!.flags[bi]) {
        v |= (1 | ((cur.flags[ci]! & 15) << 1)) << n;
        n += 5;
      } else n++;
      const strideChanged = cur.stride[ci] !== base!.stride[bi];
      const moving = (changed & ANIM_MOTION_MASK) !== 0 || strideChanged;
      if (moving) {
        v |= (1 | ((cur.anim[ci]! & ANIM_MOTION_MASK) << 1)) << n;
        n += 1 + ANIM_MOTION_BITS;
      } else n++;
      w.bits(v, n);
      if (moving) {
        w.bool(strideChanged);
        if (strideChanged) w.u8(cur.stride[ci]!);
      }
      v = 0;
      n = 1;
      if (((changed >>> ANIM_LOOK_SHIFT) & LOOK_MASK) !== 0) {
        v = 1 | (((cur.anim[ci]! >>> ANIM_LOOK_SHIFT) & LOOK_MASK) << 1);
        n = 1 + ANIM_LOOK_BITS;
      }
      const acting = changed >>> ANIM_ACTION_SHIFT !== 0 || cued || emoted || reacted;
      if (acting) {
        v |= (1 | ((cur.anim[ci]! >>> ANIM_ACTION_SHIFT) << 1)) << n;
        n += 1 + ANIM_ACTION_BITS;
      } else n++;
      w.bits(v, n);
      if (acting) {
        w.bool(cued);
        if (cued) w.bits(cur.cue[ci]!, CUE_BITS);
        w.bool(emoted);
        if (emoted) w.bits(cur.emote[ci]!, EMOTE_BITS);
        w.bool(reacted);
        if (reacted) w.bits(cur.react[ci]!, REACT_BITS);
      }
      const vehicleChanged = vehicleChange(base!, bi, cur, ci) !== 0;
      w.bool(vehicleChanged);
      if (vehicleChanged) writeVehicleParts(w, base!, bi, cur, ci);
      next.copyFrom(cur, ci);
    }
  }
  if (told) {
    told.turn(tick);
    if (!w.overflow) told.sent = tick;
  }
  return rotate;
}
