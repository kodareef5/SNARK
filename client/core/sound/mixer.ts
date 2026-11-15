// The voices playing, and which sound gets one. There are VOICES of them. Each kind of sound has a share of them, and
// each sound a smaller share, so that forty dodos startled at once are a few squawks near and not forty. A sound that
// finds no voice free takes the one heard least (its weight times its loudness where the ear is), if that is heard less
// than it would be; otherwise it is dropped. Footsteps weigh least, so they go first, then calls, then pecks and thumps;
// cries of pain and alarm weigh most. A creature has one mouth: a new cry from it ends its last unless the last weighs more.

import type { Rng } from "../../../shared/rng.ts";
import type { SoundPacket } from "./packet.ts";
import { distanceGain, lowpassAt } from "./place.ts";

export const VOICES = 32;
/** A cry, call or squawk, from a creature's mouth. */
export const KIND_VOCAL = 0;
/** A footfall. */
export const KIND_STEP = 1;
/** A peck, a blow, a body landing. */
export const KIND_HIT = 2;
/** Voices each kind may have at once, and each sound of that kind. */
const KIND_VOICES: readonly number[] = [16, 10, 8];
const SOUND_VOICES: readonly number[] = [5, 10, 4];
/** Below this gain where the ear is, a sound is not started. */
const INAUDIBLE = 0.004;
/** Milliseconds a stopped voice takes to fade, as the device does it. */
const STOP_MS = 40;

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
    p.stops.push(this.serial[v]!);
    this.serial[v] = 0;
  }

  /** Frees the voices whose sound has ended by `nowMs`. */
  expire(nowMs: number): void {
    for (let v = 0; v < VOICES; v++) if (this.serial[v] !== 0 && this.endMs[v]! <= nowMs) this.serial[v] = 0;
  }

  /**
   * Starts take `buffer` of `sound`, `seconds` long, at (x, y, z) with `lift` metres above it, following `entity` if it
   * is not -1. `level` is its gain before distance, `rate` its playback rate, `delay` seconds from now. Returns false
   * where it is dropped.
   */
  play(p: SoundPacket, ear: Ear, nowMs: number, sound: number, buffer: number, seconds: number, range: number, kind: number, weight: number, entity: number, x: number, y: number, z: number, lift: number, level: number, rate: number, delay: number): boolean {
    const d = Math.hypot(x - ear.x, y + lift - ear.y, z - ear.z);
    const heard = distanceGain(d, range) * level;
    if (heard < INAUDIBLE) {
      this.stats.quiet++;
      return false;
    }
    const score = weight * heard;
    let free = -1;
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
          return false;
        }
        this.stop(v, p);
        if (free < 0) free = v;
        continue;
      }
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
    else if (free < 0) take = least;
    if (take !== free) {
      if (take < 0 || this.weight[take]! * this.heard[take]! >= score) {
        this.stats.dropped++;
        return false;
      }
      this.stop(take, p);
      this.stats.stolen++;
    }
    const v = take;
    const serial = this.next++;
    this.serial[v] = serial;
    this.sound[v] = sound;
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
    this.endMs[v] = nowMs + (delay + seconds / rate) * 1000 + STOP_MS;
    p.starts.push(serial, buffer, delay, rate, heard, x - ear.x, y + lift - ear.y, z - ear.z, lowpassAt(d, range));
    this.stats.started++;
    return true;
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
      const dx = this.x[v]! - ear.x;
      const dy = this.y[v]! + this.lift[v]! - ear.y;
      const dz = this.z[v]! - ear.z;
      const d = Math.hypot(dx, dy, dz);
      this.heard[v] = distanceGain(d, this.range[v]!) * this.level[v]!;
      if (this.heard[v] === 0) {
        this.stop(v, p);
        continue;
      }
      p.moves.push(this.serial[v]!, this.heard[v]!, dx, dy, dz, lowpassAt(d, this.range[v]!));
    }
  }

  /** Stops every voice. */
  silence(p: SoundPacket): void {
    for (let v = 0; v < VOICES; v++) if (this.serial[v] !== 0) this.stop(v, p);
  }
}

/** A short random wait before a sound starts, so that many of one sound started together do not sound as one. Seconds. */
export function spread(rng: Rng, crowd: number): number {
  return crowd > 1 ? rng.range(0, Math.min(0.12, 0.02 * crowd)) : 0;
}

