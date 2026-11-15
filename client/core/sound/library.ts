// Which sounds are held, asked for and let go. A sound is wanted while something that makes it is within its range, and
// how urgently by how near. Its takes are fetched together through the asset port, checked there against their hashes,
// decoded here and handed to the audio device. Decoded takes are kept within a budget of bytes: when a sound wanted
// does not fit, the least lately used of those not wanted are let go first, and while it still does not fit the farther
// wanted sounds wait. A request that fails is asked again on the asset library's schedule.

import type { Manifest } from "../../../shared/pack/manifest.ts";
import { decodeTake, type ManifestSound } from "../../../shared/pack/sound.ts";
import { Rng } from "../../../shared/rng.ts";
import { FAIL_HASH, FAIL_RANGE, type AssetArrival, type AssetPart, type AssetPort } from "../assets/port.ts";
import type { SoundPacket } from "./packet.ts";
import { SOUND_SLOT } from "./split.ts";

/** Bytes of decoded sound kept on a computer, and on a touch-first device. */
export const SOUND_BUDGET = 48 * 1024 * 1024;
export const SOUND_BUDGET_TOUCH = 16 * 1024 * 1024;
/** Sounds asked for at once. They are small, and a mesh or a texture should not wait behind them. */
export const SOUND_FLIGHTS = 2;
/** A sound nobody has wanted or played for this long may be let go when room is needed, and is given up if still coming. */
export const SOUND_IDLE_MS = 3000;
const RETRY_MS: readonly number[] = [1000, 2000, 4000, 8000];
const RETRY_SLOW_MS = 30000;

const ABSENT = 0;
const LOADING = 1;
const RESIDENT = 2;
const DEAD = 3;

export class SoundLibrary {
  readonly sounds: readonly ManifestSound[];
  readonly index: ReadonlyMap<string, number>;
  /** Each sound's first buffer number. Take k of sound s is buffer `first[s] + k`. */
  readonly first: Int32Array;
  /** Seconds of each take, by buffer number. */
  readonly seconds: Float32Array;
  /** Bytes the decoded takes may hold, and bytes they hold. */
  budget = SOUND_BUDGET;
  used = 0;
  flying = 0;
  readonly stats = { requests: 0, loaded: 0, failed: 0, dead: 0, evicted: 0, cancelled: 0 };
  private readonly port: AssetPort | null;
  private readonly state: Uint8Array;
  /** The last time each sound was wanted or played, how urgently it was wanted then, and when it may be asked for again. */
  private readonly lastMs: Float64Array;
  private readonly urgency: Float32Array;
  private readonly retryAt: Float64Array;
  private readonly tries: Uint8Array;
  private readonly rehashed: Uint8Array;
  private readonly bytes: Float64Array;
  private readonly wants: number[] = [];
  private readonly arrivals: AssetArrival[] = [];
  private readonly rng = new Rng(7);
  private nowMs = 0;

  constructor(manifest: Pick<Manifest, "sounds">, port: AssetPort | null) {
    this.sounds = manifest.sounds ?? [];
    this.port = port;
    this.index = new Map(this.sounds.map((s, i) => [s.id, i]));
    const n = this.sounds.length;
    this.first = new Int32Array(n);
    let takes = 0;
    this.sounds.forEach((s, i) => {
      this.first[i] = takes;
      takes += s.takes.length;
    });
    this.seconds = new Float32Array(takes);
    this.sounds.forEach((s, i) => s.takes.forEach((t, k) => (this.seconds[this.first[i]! + k] = t.samples / s.rate)));
    this.state = new Uint8Array(n);
    this.lastMs = new Float64Array(n).fill(-Infinity);
    this.urgency = new Float32Array(n);
    this.retryAt = new Float64Array(n);
    this.tries = new Uint8Array(n);
    this.rehashed = new Uint8Array(n);
    this.bytes = Float64Array.from(this.sounds, (s) => s.takes.reduce((sum, t) => sum + t.samples * 4, 0));
  }

  /** Whether the sound's takes are on the audio device. */
  ready(sound: number): boolean {
    return this.state[sound] === RESIDENT;
  }

  /** Says the sound is wanted now, as urgently as `urgency`: higher is sooner. */
  want(sound: number, urgency: number): void {
    if (this.lastMs[sound] !== this.nowMs) {
      this.lastMs[sound] = this.nowMs;
      this.urgency[sound] = urgency;
      if (this.state[sound] === ABSENT) this.wants.push(sound);
    } else if (urgency > this.urgency[sound]!) this.urgency[sound] = urgency;
  }

  /** Starts a frame: what has arrived is decoded and goes to the device in `p`. */
  begin(nowMs: number, p: SoundPacket): void {
    this.nowMs = nowMs;
    this.wants.length = 0;
    if (!this.port) return;
    const n = this.port.take(this.arrivals);
    for (let i = 0; i < n; i++) {
      const a = this.arrivals[i]!;
      const s = a.slot - SOUND_SLOT;
      this.arrivals[i] = null!;
      if (this.state[s] !== LOADING) continue;
      this.flying--;
      const sound = this.sounds[s]!;
      if (a.data && this.load(s, sound, a.data, p)) continue;
      this.state[s] = ABSENT;
      if (a.fail === FAIL_RANGE || (a.fail === FAIL_HASH && this.rehashed[s] === 1) || (a.data !== null && a.fail === 0)) {
        // The manifest is wrong about it, or its bytes are wrong twice or do not decode. Asking again would change nothing.
        this.state[s] = DEAD;
        this.stats.dead++;
      } else if (a.fail === FAIL_HASH) {
        this.rehashed[s] = 1;
        this.stats.failed++;
      } else {
        this.stats.failed++;
        const wait = RETRY_MS[this.tries[s]!] ?? RETRY_SLOW_MS;
        this.retryAt[s] = nowMs + wait * (0.75 + 0.5 * this.rng.float());
        if (this.tries[s]! < RETRY_MS.length) this.tries[s]!++;
      }
    }
  }

  private load(s: number, sound: ManifestSound, data: Uint8Array, p: SoundPacket): boolean {
    const total = sound.takes.reduce((sum, t) => sum + t.bytes, 0);
    if (data.length !== total) return false;
    let at = 0;
    const decoded: Float32Array[] = [];
    for (const t of sound.takes) {
      const out = new Float32Array(t.samples);
      if (!decodeTake(data.subarray(at, at + t.bytes), t.samples, out)) return false;
      decoded.push(out);
      at += t.bytes;
    }
    decoded.forEach((samples, k) => p.loads.push({ buffer: this.first[s]! + k, samples, rate: sound.rate }));
    this.state[s] = RESIDENT;
    this.used += this.bytes[s]!;
    this.tries[s] = 0;
    this.rehashed[s] = 0;
    this.stats.loaded++;
    return true;
  }

  /** A take of the sound is playing: it is not let go for a while. */
  played(sound: number): void {
    this.lastMs[sound] = this.nowMs;
  }

  /** Lets the sound go: its buffers leave the device in `p`. */
  private evict(s: number, p: SoundPacket): void {
    for (let k = 0; k < this.sounds[s]!.takes.length; k++) p.unloads.push(this.first[s]! + k);
    this.state[s] = ABSENT;
    this.used -= this.bytes[s]!;
    this.stats.evicted++;
  }

  /** Lets go of the least lately used sounds that are neither wanted nor playing until `bytes` more fit. False if they still do not. */
  private room(bytes: number, p: SoundPacket): boolean {
    if (this.used + bytes <= this.budget) return true;
    const idle: number[] = [];
    for (let s = 0; s < this.sounds.length; s++) if (this.state[s] === RESIDENT && this.nowMs - this.lastMs[s]! > SOUND_IDLE_MS) idle.push(s);
    idle.sort((a, b) => this.lastMs[a]! - this.lastMs[b]! || a - b);
    for (const s of idle) {
      if (this.used + bytes <= this.budget) break;
      this.evict(s, p);
    }
    return this.used + bytes <= this.budget;
  }

  /** Ends a frame: what is no longer wanted is given up, what is wanted is asked for, most urgent first, and the budget kept. */
  end(p: SoundPacket): void {
    const now = this.nowMs;
    for (let s = 0; s < this.sounds.length; s++) {
      if (this.state[s] === LOADING && now - this.lastMs[s]! > SOUND_IDLE_MS) {
        this.port!.cancel(SOUND_SLOT + s);
        this.state[s] = ABSENT;
        this.flying--;
        this.stats.cancelled++;
      }
    }
    // A budget made smaller lets go of what no longer fits.
    this.room(0, p);
    if (!this.port) return;
    this.wants.sort((a, b) => this.urgency[b]! - this.urgency[a]! || a - b);
    for (const s of this.wants) {
      if (this.flying >= SOUND_FLIGHTS) break;
      if (this.state[s] !== ABSENT || this.retryAt[s]! > now) continue;
      // Room for what is coming as well as what is here.
      if (!this.room(this.bytes[s]! + this.coming(), p)) break;
      this.ask(s);
    }
  }

  private coming(): number {
    let sum = 0;
    for (let s = 0; s < this.sounds.length; s++) if (this.state[s] === LOADING) sum += this.bytes[s]!;
    return sum;
  }

  private parts(s: number): AssetPart[] {
    const sound = this.sounds[s]!;
    let at = sound.at;
    return sound.takes.map((t) => {
      const part = { offset: at, length: t.bytes, hash: t.hash };
      at += t.bytes;
      return part;
    });
  }

  private ask(s: number): void {
    this.port!.request({ slot: SOUND_SLOT + s, file: this.sounds[s]!.file, parts: this.parts(s), priority: this.urgency[s]!, fresh: this.rehashed[s] === 1 });
    this.state[s] = LOADING;
    this.flying++;
    this.stats.requests++;
  }

  /** Asks the port to keep every sound between visits. Returns how many parts. */
  download(): number {
    if (!this.port) return 0;
    const parts = this.sounds.flatMap((s, i) => this.parts(i).map((part) => ({ file: s.file, part })));
    this.port.fill(parts);
    return parts.length;
  }

  /** The library in a line, for a developer's eye. */
  line(): string {
    let held = 0;
    for (let s = 0; s < this.sounds.length; s++) if (this.state[s] === RESIDENT) held++;
    return `sounds: ${held} of ${this.sounds.length} held, ${(this.used / 1048576).toFixed(1)} of ${(this.budget / 1048576).toFixed(0)} MB, ${this.flying} coming, ${this.stats.failed} failed, ${this.stats.dead} given up, ${this.stats.evicted} let go`;
  }
}
