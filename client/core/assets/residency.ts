// Which levels of which meshes are on the graphics card, and what is asked for, kept and let go to keep it so.
// A slot is one level of one mesh. What the boot pack holds is resident as soon as it is wanted and is never let go,
// so there is always some level of every mesh to draw. Everything else is asked of the port, most urgent first, put
// on the card within a frame's allowance of bytes, and let go, least lately drawn first, when the card's budget is passed.

import type { Manifest } from "../../../shared/pack/manifest.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import { Rng } from "../../../shared/rng.ts";
import { FAIL_HASH, FAIL_RANGE, type AssetArrival, type AssetPort } from "./port.ts";

/** A level to put on the graphics card: its indices and then its vertices, as the pack holds them. */
export interface AssetUpload {
  slot: number;
  mesh: number;
  level: number;
  data: Uint8Array;
  /** How many indices the data starts with, and the bytes of each. The vertices follow, from the next multiple of 4. */
  indexCount: number;
  indexBytes: 2 | 4;
}

/** Requests under way at once, and how many of them are kept for small parts so a large one never holds them up. */
export const IN_FLIGHT = 6;
export const SMALL_LANES = 2;
export const SMALL_PART = 256 * 1024;
/** Nothing more is asked for while this many bytes have arrived and wait to go on the card. */
export const WAITING_LIMIT = 16 * 1024 * 1024;
/** A slot nobody has wanted for this many frames is given up, whether it is on its way or has arrived. */
export const IDLE_FRAMES = 30;
/** When one frame draws more than the budget, the card may hold this many times the budget and no more. */
export const OVERFLOW = 1.25;
/** How long to wait before asking again for what failed, and how long once those are used up. */
const RETRY_MS: readonly number[] = [1000, 2000, 4000, 8000];
const RETRY_SLOW_MS = 30000;

const ABSENT = 0;
const LOADING = 1;
const ARRIVED = 2;
const RESIDENT = 3;
const DEAD = 4;

export class Residency {
  /** Bytes the card may hold, and bytes that may go onto it in a frame. The tier sets both. */
  budget = Infinity;
  uploadBytes = Infinity;
  /** Above 1 while what one frame draws is more than the card may hold: every threshold is this much looser. */
  relax = 1;
  /** Bytes on the card, and bytes arrived and waiting to go on it. */
  ledger = 0;
  waiting = 0;
  /** Requests under way. */
  flying = 0;
  readonly stats = { requests: 0, cancelled: 0, failed: 0, dead: 0, evicted: 0, wasted: 0, fetched: 0, cached: 0, uploaded: 0, used: 0, skipped: 0 };

  private readonly manifest: Manifest;
  private readonly boot: Pack;
  private readonly port: AssetPort | null;
  private readonly rng: Rng;
  /** The first slot of each mesh, and one past the last. */
  private readonly first: Uint32Array;
  private readonly meshOf: Uint32Array;
  private readonly levelOf: Uint8Array;
  private readonly size: Uint32Array;
  private readonly inBoot: Uint8Array;
  private readonly state: Uint8Array;
  /** The frame each slot was last wanted in, and how urgently in that frame. */
  private readonly seen: Uint32Array;
  private readonly urgency: Float32Array;
  private readonly tries: Uint8Array;
  private readonly retryAt: Float64Array;
  private readonly rehashed: Uint8Array;
  private readonly drawn: Uint8Array;
  private readonly data: (Uint8Array | null)[];
  /** Resident slots that may be let go, least lately drawn first, as a ring through `root`. What follows `mark` was drawn this frame. */
  private readonly prev: Int32Array;
  private readonly next: Int32Array;
  private readonly root: number;
  private readonly mark: number;
  private frame = 0;
  private flyingLarge = 0;
  /** Slots wanted this frame that are neither resident nor on their way. */
  private readonly wants: number[] = [];
  /** Slots on their way or arrived. */
  private under: number[] = [];
  private readonly fromBoot: number[] = [];
  private readonly arrivals: AssetArrival[] = [];

  constructor(manifest: Manifest, boot: Pack, port: AssetPort | null, seed = 1) {
    this.manifest = manifest;
    this.boot = boot;
    this.port = port;
    this.rng = new Rng(seed);
    this.first = new Uint32Array(manifest.meshes.length + 1);
    manifest.meshes.forEach((m, i) => (this.first[i + 1] = this.first[i]! + m.levels.length));
    const slots = this.first[manifest.meshes.length]!;
    this.meshOf = new Uint32Array(slots);
    this.levelOf = new Uint8Array(slots);
    this.size = new Uint32Array(slots);
    this.inBoot = new Uint8Array(slots);
    manifest.meshes.forEach((m, i) =>
      m.levels.forEach((level, l) => {
        const slot = this.first[i]! + l;
        this.meshOf[slot] = i;
        this.levelOf[slot] = l;
        this.size[slot] = level.parts[0]!.bytes;
        this.inBoot[slot] = level.file === manifest.boot ? 1 : 0;
      }),
    );
    this.state = new Uint8Array(slots);
    this.seen = new Uint32Array(slots);
    this.urgency = new Float32Array(slots);
    this.tries = new Uint8Array(slots);
    this.retryAt = new Float64Array(slots);
    this.rehashed = new Uint8Array(slots);
    this.drawn = new Uint8Array(slots);
    this.data = new Array<Uint8Array | null>(slots).fill(null);
    this.prev = new Int32Array(slots + 2);
    this.next = new Int32Array(slots + 2);
    this.root = slots;
    this.mark = slots + 1;
    this.prev[this.root] = this.next[this.root] = this.mark;
    this.prev[this.mark] = this.next[this.mark] = this.root;
  }

  /** The slot of a level of a mesh. */
  slot(mesh: number, level: number): number {
    return this.first[mesh]! + level;
  }

  private unlink(node: number): void {
    this.next[this.prev[node]!] = this.next[node]!;
    this.prev[this.next[node]!] = this.prev[node]!;
  }

  private toTail(node: number): void {
    const last = this.prev[this.root]!;
    this.next[last] = node;
    this.prev[node] = last;
    this.next[node] = this.root;
    this.prev[this.root] = node;
  }

  /** Starts a frame: takes in what has arrived since the last. */
  begin(nowMs: number): void {
    this.frame++;
    this.wants.length = 0;
    this.unlink(this.mark);
    this.toTail(this.mark);
    if (!this.port) return;
    const n = this.port.take(this.arrivals);
    for (let i = 0; i < n; i++) {
      const a = this.arrivals[i]!;
      const slot = a.slot;
      // Given up while it was on its way.
      if (this.state[slot] !== LOADING) continue;
      this.flying--;
      if (this.size[slot]! > SMALL_PART) this.flyingLarge--;
      this.stats.fetched += a.fetched;
      this.stats.cached += a.cached;
      if (a.data) {
        this.data[slot] = a.data;
        this.state[slot] = ARRIVED;
        this.waiting += this.size[slot]!;
        this.tries[slot] = 0;
      } else if (a.fail === FAIL_RANGE || (a.fail === FAIL_HASH && this.rehashed[slot] === 1)) {
        // The manifest is wrong about it, or its bytes are wrong twice. Asking again would change nothing.
        this.state[slot] = DEAD;
        this.stats.dead++;
      } else {
        this.state[slot] = ABSENT;
        this.stats.failed++;
        // Bytes with the wrong hash are asked for once more at once, past any cache that might hold them.
        if (a.fail === FAIL_HASH) this.rehashed[slot] = 1;
        else {
          const wait = RETRY_MS[this.tries[slot]!] ?? RETRY_SLOW_MS;
          this.retryAt[slot] = nowMs + wait * (0.75 + 0.5 * this.rng.float());
          if (this.tries[slot]! < RETRY_MS.length) this.tries[slot]!++;
        }
      }
    }
  }

  /** Says a level is wanted this frame, and how urgently against the others. */
  want(mesh: number, level: number, urgency: number): void {
    const slot = this.first[mesh]! + level;
    if (this.seen[slot] === this.frame) {
      if (urgency > this.urgency[slot]!) this.urgency[slot] = urgency;
      return;
    }
    this.seen[slot] = this.frame;
    this.urgency[slot] = urgency;
    if (this.state[slot] === ABSENT && this.inBoot[slot] === 0) this.wants.push(slot);
  }

  /** Whether the slot can be drawn this frame. What the boot pack holds is made resident by being asked. */
  private usable(slot: number): boolean {
    if (this.state[slot] === RESIDENT) {
      if (this.inBoot[slot] === 0) {
        this.unlink(slot);
        this.toTail(slot);
      }
    } else if (this.inBoot[slot] === 1) {
      this.state[slot] = RESIDENT;
      this.ledger += this.size[slot]!;
      this.fromBoot.push(slot);
    } else return false;
    if (this.drawn[slot] === 0) {
      this.drawn[slot] = 1;
      if (this.inBoot[slot] === 0) this.stats.used += this.size[slot]!;
    }
    return true;
  }

  /**
   * The level of `mesh` to draw when `wanted` is asked for: that level if it is resident, else the next coarser that
   * is, else the nearest finer. -1 if there is none, which cannot be once the boot pack is here.
   */
  level(mesh: number, wanted: number): number {
    const base = this.first[mesh]!;
    const count = this.first[mesh + 1]! - base;
    const want = wanted < count ? wanted : count - 1;
    this.want(mesh, want, 0);
    // A level that cannot be had, or that failed and waits to be tried again, has the next one down fetched to stand in.
    for (let l = want; l < count - 1 && (this.state[base + l] === DEAD || (this.state[base + l] === ABSENT && this.tries[base + l]! > 0)); l++) {
      this.want(mesh, l + 1, this.urgency[base + want]!);
    }
    // A large part is a long time coming. The finest small level below it is fetched as well, and first.
    if (this.state[base + want] !== RESIDENT && this.size[base + want]! > SMALL_PART) {
      for (let l = want + 1; l < count; l++) {
        if (this.size[base + l]! > SMALL_PART) continue;
        this.want(mesh, l, this.urgency[base + want]! * 2 + 1);
        break;
      }
    }
    for (let l = want; l < count; l++) if (this.usable(base + l)) return l;
    for (let l = want - 1; l >= 0; l--) if (this.usable(base + l)) return l;
    this.stats.skipped++;
    return -1;
  }

  private upload(slot: number, data: Uint8Array, out: AssetUpload[]): void {
    const level = this.manifest.meshes[this.meshOf[slot]!]!.levels[this.levelOf[slot]!]!;
    out.push({ slot, mesh: this.meshOf[slot]!, level: this.levelOf[slot]!, data, indexCount: level.tris * 3, indexBytes: level.index });
    this.stats.uploaded += data.length;
  }

  /** Asks the port to keep every level that is not in the boot pack, so nothing need be fetched while playing. Returns their bytes. */
  download(): number {
    const parts: { file: number; part: { offset: number; length: number; hash: string } }[] = [];
    let bytes = 0;
    for (const m of this.manifest.meshes) {
      for (const level of m.levels) {
        if (level.file === this.manifest.boot) continue;
        parts.push({ file: level.file, part: { offset: level.at, length: level.parts[0]!.bytes, hash: level.parts[0]!.hash } });
        bytes += level.parts[0]!.bytes;
      }
    }
    this.port?.fill(parts);
    return bytes;
  }

  /** What the port keeps between visits, or null with no port. */
  get cache(): AssetPort["cache"] | null {
    return this.port ? this.port.cache : null;
  }

  /** The graphics card could not take a level it was sent. */
  failed(slot: number): void {
    if (this.state[slot] !== RESIDENT) return;
    if (this.inBoot[slot] === 0) this.unlink(slot);
    this.state[slot] = ABSENT;
    this.ledger -= this.size[slot]!;
  }

  /** Ends a frame: `uploads` and `drops` are what the graphics card must do before it draws this frame. */
  end(uploads: AssetUpload[], drops: number[], nowMs: number): void {
    for (const slot of this.fromBoot) {
      const level = this.manifest.meshes[this.meshOf[slot]!]!.levels[this.levelOf[slot]!]!;
      this.upload(slot, this.boot.blob.subarray(level.at - this.boot.blobAt, level.at - this.boot.blobAt + this.size[slot]!), uploads);
    }
    this.fromBoot.length = 0;
    if (!this.port) return;

    // What nobody wants any longer is given up, on its way or arrived.
    let kept = 0;
    for (const slot of this.under) {
      const idle = this.frame - this.seen[slot]! > IDLE_FRAMES;
      if (this.state[slot] === LOADING && idle) {
        this.port.cancel(slot);
        this.flying--;
        if (this.size[slot]! > SMALL_PART) this.flyingLarge--;
        this.state[slot] = ABSENT;
        this.stats.cancelled++;
      } else if (this.state[slot] === ARRIVED && idle) {
        this.data[slot] = null;
        this.waiting -= this.size[slot]!;
        this.state[slot] = ABSENT;
        this.stats.wasted += this.size[slot]!;
      }
      if (this.state[slot] === LOADING || this.state[slot] === ARRIVED) this.under[kept++] = slot;
    }
    this.under.length = kept;

    // What has arrived goes on the card, most urgent first, within the frame's bytes. One always goes.
    const urgent = (slot: number): number => (this.seen[slot] === this.frame ? this.urgency[slot]! : -1);
    const byUrgency = (a: number, b: number): number => urgent(b) - urgent(a) || a - b;
    let sent = 0;
    let held = false;
    kept = 0;
    for (const slot of this.under.sort(byUrgency)) {
      if (this.state[slot] !== ARRIVED || (sent > 0 && sent + this.size[slot]! > this.uploadBytes)) {
        this.under[kept++] = slot;
        continue;
      }
      this.makeRoom(this.size[slot]!, drops);
      // What this frame draws already fills the card past its overflow. It waits, and everything is asked for coarser.
      if (this.ledger + this.size[slot]! > this.budget * OVERFLOW) {
        held = true;
        this.under[kept++] = slot;
        continue;
      }
      this.upload(slot, this.data[slot]!, uploads);
      this.data[slot] = null;
      this.state[slot] = RESIDENT;
      this.waiting -= this.size[slot]!;
      this.ledger += this.size[slot]!;
      this.toTail(slot);
      sent += this.size[slot]!;
    }
    this.under.length = kept;

    for (const slot of this.wants.sort(byUrgency)) {
      if (this.flying >= IN_FLIGHT || this.waiting >= WAITING_LIMIT) break;
      if (this.state[slot] !== ABSENT || this.retryAt[slot]! > nowMs) continue;
      const large = this.size[slot]! > SMALL_PART;
      if (large && this.flyingLarge >= IN_FLIGHT - SMALL_LANES) continue;
      const level = this.manifest.meshes[this.meshOf[slot]!]!.levels[this.levelOf[slot]!]!;
      this.port.request({ slot, file: level.file, parts: [{ offset: level.at, length: this.size[slot]!, hash: level.parts[0]!.hash }], priority: this.urgency[slot]!, fresh: this.rehashed[slot] === 1 });
      this.state[slot] = LOADING;
      this.flying++;
      if (large) this.flyingLarge++;
      this.under.push(slot);
      this.stats.requests++;
    }

    this.makeRoom(0, drops);
    if (held || this.ledger > this.budget * OVERFLOW) this.relax *= 1.02;
    else if (this.relax > 1 && this.ledger < this.budget * 0.7) this.relax = Math.max(1, this.relax / 1.02);
  }

  /** Lets go of the least lately drawn until `bytes` more fit in the budget. What this frame drew stays. */
  private makeRoom(bytes: number, drops: number[]): void {
    while (this.ledger + bytes > this.budget) {
      const slot = this.next[this.root]!;
      if (slot === this.mark) break;
      this.unlink(slot);
      this.state[slot] = ABSENT;
      this.ledger -= this.size[slot]!;
      drops.push(slot);
      this.stats.evicted++;
    }
  }

  /** The graphics card has lost everything. What had arrived and what is on its way are kept. */
  reset(): void {
    for (let slot = 0; slot < this.state.length; slot++) if (this.state[slot] === RESIDENT) this.state[slot] = ABSENT;
    this.ledger = 0;
    this.fromBoot.length = 0;
    this.prev[this.root] = this.next[this.root] = this.mark;
    this.prev[this.mark] = this.next[this.mark] = this.root;
  }
}
