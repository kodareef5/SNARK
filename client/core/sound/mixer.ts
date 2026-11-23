// The voices playing, and which sound gets one. There are VOICES of them in three pools: the world's, the interface's
// and the beds' (with music), so that a fight never takes the click of a button or the bed under it. Each kind of sound
// has a share of its pool, and each sound a smaller share, so that forty dodos startled at once are a few squawks near
// and not forty. A sound that finds no voice free takes the one of its pool heard least (its weight times its loudness
// where the ear is), if that is heard less than it would be; otherwise it is dropped. Footsteps weigh least, so they go
// first, then calls, then pecks and thumps; cries of pain and alarm weigh most. A creature has one mouth: a new cry from
// it ends its last unless the last weighs more. A sound at the ear is not placed and does not fade with distance; a
// looping sound plays until it is stopped.

import type { Rng } from "../../../shared/rng.ts";
import { START_FIELDS, type SoundPacket } from "./packet.ts";
import { TOP_HZ, distanceGain, lowpassAt } from "./place.ts";

export const VOICES = 48;
/** A cry, call or squawk, from a creature's mouth. */
export const KIND_VOCAL = 0;
/** A footfall. */
export const KIND_STEP = 1;
/** A peck, a blow, a body landing. */
export const KIND_HIT = 2;
/** A swing, a shot, a blast. */
export const KIND_WEAPON = 3;
/** A piece placed, broken or opened. */
export const KIND_BUILD = 4;
/** Something used: eaten, equipped, picked. */
export const KIND_ITEM = 5;
/** The interface. */
export const KIND_UI = 6;
/** A bed of the world: wind, waves, a jungle. */
export const KIND_BED = 7;
export const KIND_MUSIC = 8;
/** A vehicle: its engine, its tyres, its horn and doors. */
export const KIND_VEHICLE = 9;
/** The cue kinds of shared/sound/cues.ts, by kind number. */
export const KIND_NAMES: readonly string[] = ["vocal", "step", "hit", "weapon", "build", "item", "ui", "bed", "music", "vehicle"];
/** Voices each kind may have at once, and each sound of that kind. */
const KIND_VOICES: readonly number[] = [16, 10, 8, 10, 6, 6, 4, 3, 1, 10];
const SOUND_VOICES: readonly number[] = [5, 10, 4, 4, 3, 3, 2, 1, 1, 4];
/** The pool each kind plays in, and the voices of each pool. */
const KIND_POOL: readonly number[] = [0, 0, 0, 0, 0, 0, 1, 2, 2, 0];
const POOL_VOICES: readonly number[] = [40, 4, 4];
/** The volume each kind answers to: 0 effects, 1 ambience, 2 music, 3 interface (packet.ts). */
export const KIND_BUS: readonly number[] = [0, 0, 0, 0, 0, 0, 3, 1, 2, 0];
/** Flags of a start: not placed, at the ear; and plays until stopped. */
export const FLAT = 1;
export const LOOP = 2;
/** Below this gain where the ear is, a sound is not started. */
const INAUDIBLE = 0.004;
/** Milliseconds a stopped voice takes to fade, as the device does it. */
const STOP_MS = 40;
/** A voice is moved on the device when its gain changes by more than 0.5 dB, its direction by 2 degrees or its low-pass by 5%. */
const MOVE_GAIN = 10 ** (0.5 / 20) - 1;
const MOVE_COS = Math.cos((2 * Math.PI) / 180);
const MOVE_LOW = 0.05;

export interface Ear {
  x: number;
  y: number;
  z: number;
}

/** What a voice is placed by: an entity's position, looked up each frame. */
export type Locate = (entity: number, out: number[]) => boolean;

export class Mixer {
  /** The voices, as parallel arrays. `serial` is 0 for a free voice, otherwise the number the device knows it by. */
  readonly serial = new Uint32Array(VOICES);
  readonly sound = new Int32Array(VOICES);
  /** The take (buffer) each voice plays, so a take is not started twice at once. */
  readonly buffer = new Int32Array(VOICES);
  readonly kind = new Uint8Array(VOICES);
  readonly entity = new Int32Array(VOICES);
  readonly x = new Float64Array(VOICES);
  readonly y = new Float64Array(VOICES);
  readonly z = new Float64Array(VOICES);
  /** Metres above the entity's feet the sound comes from. */
  readonly lift = new Float32Array(VOICES);
  readonly range = new Float32Array(VOICES);
  /** Its weight, its gain before distance, and its gain where the ear is now. */
  readonly weight = new Float32Array(VOICES);
  readonly level = new Float32Array(VOICES);
  readonly heard = new Float32Array(VOICES);
  readonly endMs = new Float64Array(VOICES);
  readonly flags = new Uint8Array(VOICES);
  /** What the device was last told of each voice: gain, place from the ear, and low-pass. */
  private readonly sent = new Float64Array(VOICES * 5);
  /** Counted since the start: voices started, sounds dropped for want of a voice or too quiet to hear, and voices taken over. */
  readonly stats = { started: 0, dropped: 0, quiet: 0, stolen: 0 };
  private next = 1;
  private readonly at = [0, 0, 0];

  /** Voices in use now. */
  get playing(): number {
    let n = 0;
    for (let v = 0; v < VOICES; v++) if (this.serial[v] !== 0) n++;
    return n;
  }

  private stop(v: number, p: SoundPacket): void {
    const serial = this.serial[v]!;
    this.serial[v] = 0;
    // The device stops before it starts, so a voice started in this packet is taken out of it instead.
    for (let i = p.starts.length - START_FIELDS; i >= 0; i -= START_FIELDS) {
      if (p.starts[i] !== serial) continue;
      p.starts.splice(i, START_FIELDS);
      return;
    }
    p.stops.push(serial);
  }

  /** Frees the voices whose sound has ended by `nowMs`. */
  expire(nowMs: number): void {
    for (let v = 0; v < VOICES; v++) if (this.serial[v] !== 0 && this.endMs[v]! <= nowMs) this.serial[v] = 0;
  }

  /**
   * Starts take `buffer` of `sound`, `seconds` long, at (x, y, z) with `lift` metres above it, following `entity` if it
   * is not -1. `level` is its gain before distance, `rate` its playback rate, `delay` seconds from now, `flags` FLAT and
   * LOOP. Returns the voice's serial, or 0 where it is dropped.
   */
  play(p: SoundPacket, ear: Ear, nowMs: number, sound: number, buffer: number, seconds: number, range: number, kind: number, weight: number, entity: number, x: number, y: number, z: number, lift: number, level: number, rate: number, delay: number, flags = 0): number {
    const flat = (flags & FLAT) !== 0;
    const d = flat ? 0 : Math.hypot(x - ear.x, y + lift - ear.y, z - ear.z);
    const heard = (flat ? 1 : distanceGain(d, range)) * level;
    if (heard < INAUDIBLE) {
      this.stats.quiet++;
      return 0;
    }
    const pool = KIND_POOL[kind]!;
    const score = weight * heard;
    let free = -1;
    let ofPool = 0;
    let ofKind = 0;
    let ofSound = 0;
    let least = -1;
    let leastSound = -1;
    let leastKind = -1;
    for (let v = 0; v < VOICES; v++) {
      if (this.serial[v] === 0) {
        if (free < 0) free = v;
        continue;
      }
      const s = this.weight[v]! * this.heard[v]!;
      // One mouth: a cry ends the creature's last, unless that weighs more.
      if (kind === KIND_VOCAL && entity >= 0 && this.kind[v] === KIND_VOCAL && this.entity[v] === entity) {
        if (this.weight[v]! > weight) {
          this.stats.dropped++;
          return 0;
        }
        this.stop(v, p);
        if (free < 0) free = v;
        continue;
      }
      if (KIND_POOL[this.kind[v]!] !== pool) continue;
      ofPool++;
      if (least < 0 || s < this.weight[least]! * this.heard[least]!) least = v;
      if (this.kind[v] !== kind) continue;
      ofKind++;
      if (leastKind < 0 || s < this.weight[leastKind]! * this.heard[leastKind]!) leastKind = v;
      if (this.sound[v] !== sound) continue;
      ofSound++;
      if (leastSound < 0 || s < this.weight[leastSound]! * this.heard[leastSound]!) leastSound = v;
    }
    // The tightest limit reached says which voice may be taken.
    let take = free;
    if (ofSound >= SOUND_VOICES[kind]!) take = leastSound;
    else if (ofKind >= KIND_VOICES[kind]!) take = leastKind;
    else if (free < 0 || ofPool >= POOL_VOICES[pool]!) take = least;
    if (take !== free) {
      if (take < 0 || this.weight[take]! * this.heard[take]! >= score) {
        this.stats.dropped++;
        return 0;
      }
      this.stop(take, p);
      this.stats.stolen++;
    }
    const v = take;
    const serial = this.next++;
    this.serial[v] = serial;
    this.sound[v] = sound;
    this.buffer[v] = buffer;
    this.kind[v] = kind;
    this.entity[v] = entity;
    this.x[v] = x;
    this.y[v] = y;
    this.z[v] = z;
    this.lift[v] = lift;
    this.range[v] = range;
    this.weight[v] = weight;
    this.level[v] = level;
    this.heard[v] = heard;
    this.flags[v] = flags;
    this.endMs[v] = (flags & LOOP) !== 0 ? Infinity : nowMs + (delay + seconds / rate) * 1000 + STOP_MS;
    if (flat) this.send(v, this.heard[v]!, 0, 0, 0, TOP_HZ);
    else this.send(v, this.heard[v]!, x - ear.x, y + lift - ear.y, z - ear.z, lowpassAt(d, range));
    const s = this.sent;
    p.starts.push(serial, buffer, delay, rate, heard, s[v * 5 + 1]!, s[v * 5 + 2]!, s[v * 5 + 3]!, s[v * 5 + 4]!, KIND_BUS[kind]!, flags);
    this.stats.started++;
    return serial;
  }

  private send(v: number, gain: number, x: number, y: number, z: number, low: number): void {
    const s = this.sent;
    s[v * 5] = gain;
    s[v * 5 + 1] = x;
    s[v * 5 + 2] = y;
    s[v * 5 + 3] = z;
    s[v * 5 + 4] = low;
  }

  /** Whether the device should hear of voice `v`'s new gain, place or low-pass: a change past MOVE_*, or a gain come to rest. */
  private moved(v: number, was: number, gain: number, x: number, y: number, z: number, low: number): boolean {
    const s = this.sent;
    const g = s[v * 5]!;
    if (Math.abs(gain - g) > g * MOVE_GAIN || (gain === was && gain !== g)) return true;
    if (Math.abs(low - s[v * 5 + 4]!) > s[v * 5 + 4]! * MOVE_LOW) return true;
    const sx = s[v * 5 + 1]!, sy = s[v * 5 + 2]!, sz = s[v * 5 + 3]!;
    return x * sx + y * sy + z * sz < MOVE_COS * Math.sqrt((x * x + y * y + z * z) * (sx * sx + sy * sy + sz * sz));
  }

  /** Changes a playing voice's gain before distance, as a bed fades in or out. False if the voice is gone. */
  gain(serial: number, level: number, at?: Ear): boolean {
    for (let v = 0; v < VOICES; v++) {
      if (this.serial[v] !== serial) continue;
      this.level[v] = level;
      if (at) { this.x[v] = at.x; this.y[v] = at.y; this.z[v] = at.z; }
      return true;
    }
    return false;
  }

  /** Stops the voice with this serial, if it plays. */
  end(serial: number, p: SoundPacket): void {
    for (let v = 0; v < VOICES; v++) if (this.serial[v] === serial) this.stop(v, p);
  }

  /** Moves every voice to where its entity is now, as heard from `ear`, and stops those out of hearing. */
  follow(p: SoundPacket, ear: Ear, locate: Locate): void {
    const at = this.at;
    for (let v = 0; v < VOICES; v++) {
      if (this.serial[v] === 0) continue;
      if (this.entity[v]! >= 0 && locate(this.entity[v]!, at)) {
        this.x[v] = at[0]!;
        this.y[v] = at[1]!;
        this.z[v] = at[2]!;
      }
      const was = this.heard[v]!;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      let low = TOP_HZ;
      if ((this.flags[v]! & FLAT) !== 0) this.heard[v] = this.level[v]!;
      else {
        dx = this.x[v]! - ear.x;
        dy = this.y[v]! + this.lift[v]! - ear.y;
        dz = this.z[v]! - ear.z;
        const d = Math.hypot(dx, dy, dz);
        this.heard[v] = distanceGain(d, this.range[v]!) * this.level[v]!;
        if (this.heard[v] === 0) {
          this.stop(v, p);
          continue;
        }
        low = lowpassAt(d, this.range[v]!);
      }
      if (!this.moved(v, was, this.heard[v]!, dx, dy, dz, low)) continue;
      this.send(v, this.heard[v]!, dx, dy, dz, low);
      p.moves.push(this.serial[v]!, this.heard[v]!, dx, dy, dz, low);
    }
  }

  /** Whether take `buffer` is playing on any voice now. */
  playingTake(buffer: number): boolean {
    for (let v = 0; v < VOICES; v++) if (this.serial[v] !== 0 && this.buffer[v] === buffer) return true;
    return false;
  }

  /** Stops every voice. */
  silence(p: SoundPacket): void {
    for (let v = 0; v < VOICES; v++) if (this.serial[v] !== 0) this.stop(v, p);
  }
}

/** A short random wait before a sound starts, so that many of one sound started together do not sound as one. Seconds. */
export function spread(rng: Rng, crowd: number): number {
  return crowd > 1 ? rng.range(0, Math.min(0.25, 0.04 * crowd)) : 0;
}

