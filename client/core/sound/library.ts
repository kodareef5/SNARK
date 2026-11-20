// Which sounds are held, asked for and let go. A sound is wanted while something that makes it is within its range, and
// how urgently by how near. Its first few takes are fetched through the asset port, checked there against their hashes,
// decoded by a SoundDecoder (in the browser a worker of its own, since a long bed takes several milliseconds), and handed to
// the audio device a few at a time, so that no frame waits long; each start of a take asks for one more, up to all of
// them. Decoded takes are kept within a budget of bytes: when a sound wanted does not fit, the least lately used of those
// not wanted are let go first, then the takes past the first few of the others, and while it still does not fit the
// farther wanted sounds wait. A request that fails is asked again on the asset library's schedule.

import type { Manifest } from "../../../shared/pack/manifest.ts";
import { decodeTake, type ManifestSound } from "../../../shared/pack/sound.ts";
import { Rng } from "../../../shared/rng.ts";
import { FAIL_HASH, FAIL_RANGE, type AssetArrival, type AssetPart, type AssetPort } from "../assets/port.ts";
import type { SoundPacket } from "./packet.ts";
import { SOUND_SLOT } from "./split.ts";

/** Bytes of decoded sound kept, on a phone as on a computer. */
export const SOUND_BUDGET = 48 * 1024 * 1024;
/** Sounds asked for at once. They are small, and a mesh or a texture should not wait behind them. */
export const SOUND_FLIGHTS = 2;
/** A sound nobody has wanted or played for this long may be let go when room is needed, and is given up if still coming. */
export const SOUND_IDLE_MS = 3000;
/** Takes of a sound asked for at first. */
export const FIRST_TAKES = 2;
const RETRY_MS: readonly number[] = [1000, 2000, 4000, 8000];
const RETRY_SLOW_MS = 30000;

/** Nothing asked for. A sound in any state may hold some of its takes. */
const NONE = 0;
const LOADING = 1;
const DEAD = 2;
/** Arrived, and being decoded. */
const DECODING = 3;
/** Samples handed to the audio device in one frame at most: copying them into its buffers is the main thread's cost. */
export const LOAD_SAMPLES = 1 << 20;

/** Decodes a sound's takes away from the frame. Answers arrive by `take`, in any order. */
export interface SoundDecoder {
  decode(s: number, data: Uint8Array, takes: readonly { samples: number; bytes: number }[]): void;
  /** Sounds decoded since the last call: each take's samples, or null where any take did not decode. Returns how many. */
  take(out: Decoded[]): number;
}

export interface Decoded {
  s: number;
  takes: Float32Array[] | null;
}

/** Decodes on the calling thread, one take a call: for tests, and where there are no workers. */
export class InlineDecoder implements SoundDecoder {
  private readonly queue: { s: number; data: Uint8Array; takes: readonly { samples: number; bytes: number }[]; done: Float32Array[]; at: number }[] = [];

  decode(s: number, data: Uint8Array, takes: readonly { samples: number; bytes: number }[]): void {
    this.queue.push({ s, data, takes, done: [], at: 0 });
  }

  take(out: Decoded[]): number {
    const q = this.queue[0];
    if (!q) return 0;
    const t = q.takes[q.done.length]!;
    const samples = new Float32Array(t.samples);
    const ok = decodeTake(q.data.subarray(q.at, q.at + t.bytes), t.samples, samples);
    q.at += t.bytes;
    q.done.push(samples);
    if (ok && q.done.length < q.takes.length) return 0;
    this.queue.shift();
    out[0] = { s: q.s, takes: ok ? q.done : null };
    return 1;
  }
}

export class SoundLibrary {
  readonly sounds: readonly ManifestSound[];
  readonly index: ReadonlyMap<string, number>;
  /** Each sound's first buffer number. Take k of sound s is buffer `first[s] + k`. */
  readonly first: Int32Array;
  /** Seconds of each take, by buffer number. */
  readonly seconds: Float32Array;
  /** Decoded bytes of the takes before each buffer number. */
  private readonly before: Float64Array;
  /** Bytes the decoded takes may hold, and bytes they hold. */
  budget = SOUND_BUDGET;
  used = 0;
  flying = 0;
  /** `fetched` and `cached` are bytes that came over the network and from the port's cache, as stored, and `stale` those that came over the network for a sound no longer asked for. */
  readonly stats = { requests: 0, loaded: 0, failed: 0, dead: 0, evicted: 0, cancelled: 0, fetched: 0, cached: 0, stale: 0 };
  private readonly port: AssetPort | null;
  private readonly state: Uint8Array;
  /** The last time each sound was wanted or played, how urgently it was wanted then, and when it may be asked for again. */
  private readonly lastMs: Float64Array;
  private readonly urgency: Float32Array;
  private readonly retryAt: Float64Array;
  private readonly tries: Uint8Array;
  private readonly rehashed: Uint8Array;
  /** Takes 0 to held - 1 of each sound are decoded, and 0 to playable - 1 are on the device; goal is how many it should hold. */
  private readonly held: Uint16Array;
  private readonly playable: Uint16Array;
  private readonly goal: Uint16Array;
  /** Takes asked for after the held ones, and their decoded bytes. */
  private readonly asking: Uint16Array;
  private readonly askBytes: Float64Array;
  private readonly wants: number[] = [];
  private readonly arrivals: AssetArrival[] = [];
  private readonly decoder: SoundDecoder;
  private readonly decoded: Decoded[] = [];
  /** Takes decoded and not yet on the device, oldest first. */
  private readonly loading: { s: number; buffer: number; samples: Float32Array; rate: number }[] = [];
  /** Sounds held whatever else is wanted: the interface and the player's own (Sounds.pin). */
  private readonly pinned: Uint8Array;
  private readonly rng = new Rng(7);
  private nowMs = 0;

  constructor(manifest: Pick<Manifest, "sounds">, port: AssetPort | null, decoder: SoundDecoder = new InlineDecoder()) {
    this.sounds = manifest.sounds ?? [];
    this.port = port;
    this.decoder = decoder;
    this.index = new Map(this.sounds.map((s, i) => [s.id, i]));
    const n = this.sounds.length;
    this.first = new Int32Array(n);
    let takes = 0;
    this.sounds.forEach((s, i) => {
      this.first[i] = takes;
      takes += s.takes.length;
    });
    this.seconds = new Float32Array(takes);
    this.before = new Float64Array(takes + 1);
    this.sounds.forEach((s, i) =>
      s.takes.forEach((t, k) => {
        const b = this.first[i]! + k;
        this.seconds[b] = t.samples / s.rate;
        this.before[b + 1] = this.before[b]! + t.samples * 4;
      }),
    );
    this.state = new Uint8Array(n);
    this.lastMs = new Float64Array(n).fill(-Infinity);
    this.urgency = new Float32Array(n);
    this.retryAt = new Float64Array(n);
    this.tries = new Uint8Array(n);
    this.rehashed = new Uint8Array(n);
    this.held = new Uint16Array(n);
    this.playable = new Uint16Array(n);
    this.goal = Uint16Array.from(this.sounds, (s) => Math.min(FIRST_TAKES, s.takes.length));
    this.asking = new Uint16Array(n);
    this.askBytes = new Float64Array(n);
    this.pinned = new Uint8Array(n);
  }

  /** Decoded bytes of takes `from` to `to` - 1 of sound `s`. */
  private span(s: number, from: number, to: number): number {
    return this.before[this.first[s]! + to]! - this.before[this.first[s]! + from]!;
  }

  /** Keeps the sound once held and never lets it go, and asks for it whenever nothing more urgent is wanted. */
  pin(sound: number): void {
    this.pinned[sound] = 1;
  }

  /** Whether any of the sound's takes is on the audio device. */
  ready(sound: number): boolean {
    return this.playable[sound]! > 0;
  }

  /** How many of the sound's takes are on the audio device: takes 0 to this - 1 may play. */
  takes(sound: number): number {
    return this.playable[sound]!;
  }

  /** A take of the sound started, or would have with one more held: one more of its takes is asked for. */
  grow(sound: number): void {
    this.goal[sound] = Math.min(this.sounds[sound]!.takes.length, this.goal[sound]! + 1);
  }

  /** Says the sound is wanted now, as urgently as `urgency`: higher is sooner. */
  want(sound: number, urgency: number): void {
    if (this.lastMs[sound] !== this.nowMs) {
      this.lastMs[sound] = this.nowMs;
      this.urgency[sound] = urgency;
      if (this.state[sound] === NONE && this.held[sound]! < this.goal[sound]!) this.wants.push(sound);
    } else if (urgency > this.urgency[sound]!) this.urgency[sound] = urgency;
  }

  /** Starts a frame: what has arrived is taken in, and a take of what has arrived is decoded and goes to the device in `p`. */
  begin(nowMs: number, p: SoundPacket): void {
    this.nowMs = nowMs;
    this.wants.length = 0;
    if (!this.port) return;
    this.takeDecoded(p);
    for (let s = 0; s < this.sounds.length; s++) if (this.pinned[s] === 1) this.want(s, 0);
    const n = this.port.take(this.arrivals);
    for (let i = 0; i < n; i++) {
      const a = this.arrivals[i]!;
      const s = a.slot - SOUND_SLOT;
      this.arrivals[i] = null!;
      if (this.state[s] !== LOADING) {
        this.stats.stale += a.fetched;
        continue;
      }
      this.stats.fetched += a.fetched;
      this.stats.cached += a.cached;
      this.flying--;
      const takes = this.sounds[s]!.takes.slice(this.held[s]!, this.held[s]! + this.asking[s]!);
      if (a.data && a.data.length === takes.reduce((sum, t) => sum + t.bytes, 0)) {
        this.state[s] = DECODING;
        this.decoder.decode(s, a.data, takes);
        continue;
      }
      this.state[s] = NONE;
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

  /** Takes in what the decoder finished, and hands the device at most LOAD_SAMPLES of it a frame. */
  private takeDecoded(p: SoundPacket): void {
    const n = this.decoder.take(this.decoded);
    for (let i = 0; i < n; i++) {
      const d = this.decoded[i]!;
      this.decoded[i] = null!;
      if (this.state[d.s] !== DECODING) continue;
      if (!d.takes) {
        // Bytes that pass their hash and do not decode: asking again would change nothing.
        this.state[d.s] = DEAD;
        this.stats.dead++;
        continue;
      }
      const sound = this.sounds[d.s]!;
      const from = this.held[d.s]!;
      d.takes.forEach((samples, k) => this.loading.push({ s: d.s, buffer: this.first[d.s]! + from + k, samples, rate: sound.rate }));
      this.state[d.s] = NONE;
      this.held[d.s] = from + d.takes.length;
      this.used += this.span(d.s, from, from + d.takes.length);
      this.tries[d.s] = 0;
      this.rehashed[d.s] = 0;
      this.stats.loaded++;
    }
    let budget = LOAD_SAMPLES;
    while (this.loading.length > 0 && (budget > 0 || budget === LOAD_SAMPLES)) {
      const l = this.loading.shift()!;
      budget -= l.samples.length;
      p.loads.push(l);
      this.playable[l.s]!++;
    }
  }

  /** Whether the sound's takes may be let go: all it holds are on the device, and none are coming. */
  private settled(s: number): boolean {
    return this.held[s]! > 0 && this.playable[s] === this.held[s] && this.state[s] !== LOADING && this.state[s] !== DECODING;
  }

  /** A take of the sound is playing: it is not let go for a while. */
  played(sound: number): void {
    this.lastMs[sound] = this.nowMs;
  }

  /** Lets go of the sound's takes from `keep` on: their buffers leave the device in `p`. */
  private evict(s: number, keep: number, p: SoundPacket): void {
    for (let k = keep; k < this.held[s]!; k++) p.unloads.push(this.first[s]! + k);
    this.used -= this.span(s, keep, this.held[s]!);
    this.held[s] = this.playable[s] = keep;
    if (keep > 0) return;
    this.goal[s] = Math.min(FIRST_TAKES, this.sounds[s]!.takes.length);
    this.stats.evicted++;
  }

  /**
   * Lets go of the least lately used sounds that are neither wanted nor playing until `bytes` more fit, and with `trim`
   * then of the takes past the first few of the others. False if it still does not fit.
   */
  private room(bytes: number, p: SoundPacket, trim: boolean): boolean {
    if (this.used + bytes <= this.budget) return true;
    const lru = (a: number, b: number): number => this.lastMs[a]! - this.lastMs[b]! || a - b;
    const idle: number[] = [];
    const grown: number[] = [];
    for (let s = 0; s < this.sounds.length; s++) {
      if (!this.settled(s)) continue;
      if (this.pinned[s] === 0 && this.nowMs - this.lastMs[s]! > SOUND_IDLE_MS) idle.push(s);
      else if (this.held[s]! > FIRST_TAKES) grown.push(s);
    }
    for (const s of idle.sort(lru)) {
      if (this.used + bytes <= this.budget) break;
      this.evict(s, 0, p);
    }
    for (const s of trim ? grown.sort(lru) : []) {
      if (this.used + bytes <= this.budget) break;
      this.evict(s, FIRST_TAKES, p);
    }
    return this.used + bytes <= this.budget;
  }

  /** Ends a frame: what is no longer wanted is given up, what is wanted is asked for, most urgent first, and the budget kept. */
  end(p: SoundPacket): void {
    const now = this.nowMs;
    for (let s = 0; s < this.sounds.length; s++) {
      if (this.state[s] === LOADING && this.pinned[s] === 0 && now - this.lastMs[s]! > SOUND_IDLE_MS) {
        this.port!.cancel(SOUND_SLOT + s);
        this.state[s] = NONE;
        this.flying--;
        this.stats.cancelled++;
      }
    }
    // A budget made smaller lets go of what no longer fits.
    this.room(0, p, true);
    if (!this.port) return;
    // A sound not yet held comes before more takes of one that is.
    this.wants.sort((a, b) => Number(this.held[a]! > 0) - Number(this.held[b]! > 0) || this.urgency[b]! - this.urgency[a]! || a - b);
    for (const s of this.wants) {
      if (this.flying >= SOUND_FLIGHTS) break;
      if (this.state[s] !== NONE || this.retryAt[s]! > now) continue;
      const from = this.held[s]!;
      // Room for what is coming as well as what is here.
      if (!this.room(this.span(s, from, this.goal[s]!) + this.coming(), p, from === 0)) break;
      this.ask(s, from, this.goal[s]!);
    }
  }

  private coming(): number {
    let sum = 0;
    for (let s = 0; s < this.sounds.length; s++) if (this.state[s] === LOADING || this.state[s] === DECODING) sum += this.askBytes[s]!;
    return sum;
  }

  private parts(s: number, from: number, to: number): AssetPart[] {
    const sound = this.sounds[s]!;
    let at = sound.at;
    for (let k = 0; k < from; k++) at += sound.takes[k]!.bytes;
    return sound.takes.slice(from, to).map((t) => {
      const part = { offset: at, length: t.bytes, hash: t.hash };
      at += t.bytes;
      return part;
    });
  }

  private ask(s: number, from: number, to: number): void {
    this.port!.request({ slot: SOUND_SLOT + s, file: this.sounds[s]!.file, parts: this.parts(s, from, to), priority: this.urgency[s]!, fresh: this.rehashed[s] === 1 });
    this.state[s] = LOADING;
    this.asking[s] = to - from;
    this.askBytes[s] = this.span(s, from, to);
    this.flying++;
    this.stats.requests++;
  }

  /** Asks the port to keep every sound between visits. Returns how many parts. */
  download(): number {
    if (!this.port) return 0;
    const parts = this.sounds.flatMap((s, i) => this.parts(i, 0, s.takes.length).map((part) => ({ file: s.file, part })));
    this.port.fill(parts);
    return parts.length;
  }

  /** The library in a line, for a developer's eye. */
  line(): string {
    let held = 0;
    for (let s = 0; s < this.sounds.length; s++) if (this.held[s]! > 0) held++;
    return `sounds: ${held} of ${this.sounds.length} held, ${(this.used / 1048576).toFixed(1)} of ${(this.budget / 1048576).toFixed(0)} MB, ${this.flying} coming, ${this.stats.failed} failed, ${this.stats.dead} given up, ${this.stats.evicted} let go`;
  }
}
