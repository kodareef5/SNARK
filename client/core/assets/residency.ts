// What is on the graphics card, and what is asked for, kept and let go to keep it so. There are three kinds of slot.
// A level is the indices and flat vertices of one level of a mesh. A surface is what that level needs besides to be
// drawn with materials, its surface and its skin, and is of use only with its level. A texture holds its pictures up
// to some step, and changes step by being made again from its first picture while the card still draws with the old.
//
// What the boot pack holds is resident as soon as it is wanted and is never let go, so there is always some level of
// every mesh to draw. Everything else is asked of the port, most urgent first, put on the card within a frame's
// allowance of bytes, and let go, least lately drawn first, when the card's budget is passed. Textures have a share of
// the budget and a ring of their own, and levels and surfaces have what textures leave of it.
//
// What the card holds that is not an asset (terrain pictures, shadow maps, the sky, far meshes) is reserved by name and
// comes off the budget, and what goes onto the card that is not an asset is spent from the same frame's allowance.

import type { Manifest, ManifestLevel } from "../../../shared/pack/manifest.ts";
import type { Pack } from "../../../shared/pack/pack.ts";
import { LAST_STEP, STEP0_SIZE, pictureBytes, stepBytes, stepOf, topIn, type TextureFormat } from "../../../shared/pack/texture.ts";
import { Rng } from "../../../shared/rng.ts";
import type { TextureUpload } from "../render/packet.ts";
import { FAIL_HASH, FAIL_RANGE, levelParts, textureParts, type AssetArrival, type AssetPart, type AssetPort } from "./port.ts";

/**
 * A level to put on the graphics card: its indices and then its vertices, as the pack holds them. With `of` it is a
 * surface instead, for the level in slot `of`: an entry for every vertex and then, from `skinAt`, on a body, a skin
 * entry for every vertex.
 */
export interface AssetUpload {
  slot: number;
  mesh: number;
  level: number;
  data: Uint8Array;
  /** How many indices the data starts with, and the bytes of each. The vertices follow, from the next multiple of 4. */
  indexCount: number;
  indexBytes: 2 | 4;
  of?: number;
  skinAt?: number;
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
/** The textures a material may name: its base colour, normal, packed map and two masks. It is not drawn without its base colour and its masks. */
const MAPS = 5;
const NEEDED: readonly number[] = [0, 3, 4];
/** Step 0 of what a material is not drawn without is more urgent than anything else, by this much and again by how near it is. */
export const FIRST = 1e6;
/** How urgent a material's textures are against one another. */
const WEIGHT: readonly number[] = [1, 0.5, 0.25, 1, 1];
/** A texture in view is remade smaller only if what is left would do for this many times the pixels it covers. */
const KEEP = 1.25;
/** How long to wait before asking again for what failed, and how long once those are used up. */
const RETRY_MS: readonly number[] = [1000, 2000, 4000, 8000];
const RETRY_SLOW_MS = 30000;

const ABSENT = 0;
const LOADING = 1;
const ARRIVED = 2;
const RESIDENT = 3;
const DEAD = 4;
/** A surface that is coming in its level's request. */
const RIDING = 5;

const STEPS = LAST_STEP + 1;
const NONE: readonly number[] = [];

/** The first step whose pictures are at least `px` pixels across, and `most` if none before it is. */
function stepFor(px: number, most: number): number {
  let step = 0;
  while (step < most && STEP0_SIZE << step < px) step++;
  return step;
}

export class Residency {
  /** Bytes levels and textures may hold on the card, which is the tier's less what is reserved, and bytes that may go onto it in a frame. */
  budget = Infinity;
  uploadBytes = Infinity;
  /** Bytes reserved on the card for what is not an asset. */
  reserved = 0;
  /** Bytes of the budget that textures may hold, and the last step any is taken to: -1 for no textures and no surfaces. */
  texBudget = 0;
  cap = -1;
  /** The variant of the textures the device takes. Changing it lets every texture go. */
  format: TextureFormat = "rgba";
  /** Above 1 while what one frame draws is more than the card may hold: every threshold is this much looser. */
  relax = 1;
  /** Bytes on the card, how many of them are textures, and bytes arrived and waiting to go on it. */
  ledger = 0;
  texLedger = 0;
  waiting = 0;
  /** Requests under way. */
  flying = 0;
  readonly stats = { requests: 0, cancelled: 0, failed: 0, dead: 0, evicted: 0, wasted: 0, fetched: 0, cached: 0, uploaded: 0, used: 0, skipped: 0, shrunk: 0 };

  private readonly manifest: Manifest;
  private readonly boot: Pack;
  private readonly port: AssetPort | null;
  private readonly rng: Rng;
  /** The first slot of each mesh, and one past the last. */
  private readonly first: Uint32Array;
  /** How many levels there are. The surface of the level in slot s is slot `levels + s`, and texture t is slot `texBase + t`. */
  private readonly levels: number;
  private readonly texBase: number;
  private readonly meshOf: Uint32Array;
  private readonly levelOf: Uint8Array;
  /** Bytes of a level or a surface. For a texture, bytes of the copy on its way. */
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
  /**
   * Two rings, one of levels and surfaces through `root` and one of textures through `texRoot`: what is resident and
   * may be let go, least lately drawn first. What follows `mark` or `texMark` was drawn this frame.
   */
  private readonly prev: Int32Array;
  private readonly next: Int32Array;
  private readonly root: number;
  private readonly mark: number;
  private readonly texRoot: number;
  private readonly texMark: number;

  /** Per level: its sections, and whether it can ever be drawn with them in this variant. */
  private readonly runs: (readonly number[])[];
  private readonly can: Uint8Array;
  /** Per material: its textures, how many steps each was authored below the widest of them, that widest step, and the frame it was last on screen. */
  private readonly matTex: Int32Array;
  private readonly matUnder: Uint8Array;
  private readonly matTop: Int8Array;
  private readonly matSeen: Uint32Array;
  /** Per texture: the step the card draws with and the step of the copy on its way, -1 for none, and the last step that can be had. */
  private readonly has: Int8Array;
  private readonly goal: Int8Array;
  private readonly limit: Int8Array;
  /** Bytes of a texture with steps 0 to k, at `t * STEPS + k`. */
  private readonly through: Uint32Array;
  /** How many bytes of the copy on its way the card has been handed. From the first of them the card holds that copy whole. */
  private readonly gone: Uint32Array;
  /** The most pixels across that anything showed a texture at this frame, and the frame it joined `wants`. */
  private readonly px: Float32Array;
  private readonly queued: Uint32Array;
  /** Set while the copy on its way is smaller than the one drawn. */
  private readonly down: Uint8Array;
  private shrinking = 0;
  /** Bytes of the textures on screen this frame, and bytes of every copy on its way. Together they are spoken for. */
  private texMarked = 0;
  private texComing = 0;
  private made: TextureFormat = "rgba";
  /** Textures let go between frames, for the next frame's drops. */
  private readonly late: number[] = [];

  private frame = 0;
  private readonly reserves = new Map<string, number>();
  /** Bytes of this frame's allowance spent on what is not an asset. */
  private spent = 0;
  private flyingLarge = 0;
  /** Set in a frame in which something waited because the card was over-full, and in which a texture waited for room in the textures' share. */
  private full = false;
  private short = false;
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
    const textures = manifest.textures ?? [];
    const materials = manifest.materials ?? [];
    this.first = new Uint32Array(manifest.meshes.length + 1);
    manifest.meshes.forEach((m, i) => (this.first[i + 1] = this.first[i]! + m.levels.length));
    this.levels = this.first[manifest.meshes.length]!;
    this.texBase = this.levels * 2;
    const slots = this.texBase + textures.length;
    this.meshOf = new Uint32Array(this.levels);
    this.levelOf = new Uint8Array(this.levels);
    this.size = new Uint32Array(slots);
    this.inBoot = new Uint8Array(slots);
    this.runs = new Array<readonly number[]>(this.levels).fill(NONE);
    manifest.meshes.forEach((m, i) =>
      m.levels.forEach((level, l) => {
        const slot = this.first[i]! + l;
        this.meshOf[slot] = i;
        this.levelOf[slot] = l;
        this.size[slot] = level.parts[0]!.bytes;
        for (let k = 1; k < level.parts.length; k++) this.size[this.levels + slot]! += level.parts[k]!.bytes;
        this.inBoot[slot] = level.file === manifest.boot ? 1 : 0;
        this.inBoot[this.levels + slot] = (level.surface ?? level).file === manifest.boot ? 1 : 0;
        if (level.sections) this.runs[slot] = level.sections;
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
    this.prev = new Int32Array(slots + 4);
    this.next = new Int32Array(slots + 4);
    this.root = slots;
    this.mark = slots + 1;
    this.texRoot = slots + 2;
    this.texMark = slots + 3;
    this.empty();

    this.can = new Uint8Array(this.levels);
    this.matTex = new Int32Array(materials.length * MAPS);
    this.matUnder = new Uint8Array(materials.length * MAPS);
    this.matTop = new Int8Array(materials.length);
    this.matSeen = new Uint32Array(materials.length);
    materials.forEach((m, i) => {
      const maps = [m.base, m.normal, m.mro, m.mask, m.mask2 ?? -1];
      const steps = maps.map((t) => (t < 0 ? 0 : stepOf(textures[t]!.top)));
      this.matTop[i] = Math.max(...steps);
      maps.forEach((t, r) => {
        this.matTex[i * MAPS + r] = t;
        this.matUnder[i * MAPS + r] = t < 0 ? 0 : this.matTop[i]! - steps[r]!;
      });
    });
    this.has = new Int8Array(textures.length).fill(-1);
    this.goal = new Int8Array(textures.length).fill(-1);
    this.limit = new Int8Array(textures.length);
    this.through = new Uint32Array(textures.length * STEPS);
    this.gone = new Uint32Array(textures.length);
    this.px = new Float32Array(textures.length);
    this.queued = new Uint32Array(textures.length);
    this.down = new Uint8Array(textures.length);
    this.retable();
  }

  /** Works out, for the variant, how far each texture goes and what its steps weigh. */
  private retable(): void {
    this.made = this.format;
    (this.manifest.textures ?? []).forEach((tex, t) => {
      this.limit[t] = this.port && tex.in[this.made] ? stepOf(topIn(this.made, tex.top)) : -1;
      for (let k = 0, bytes = 0; k <= this.limit[t]!; k++) this.through[t * STEPS + k] = bytes += stepBytes(this.made, tex.role, k);
    });
    this.recan();
  }

  /** Works out which levels can be drawn with their materials at all: those with a surface whose materials' base colours and masks can be had. */
  private recan(): void {
    const had = (t: number): boolean => t < 0 || this.limit[t]! >= 0;
    for (let slot = 0; slot < this.levels; slot++) {
      const runs = this.runs[slot]!;
      let can = this.size[this.levels + slot]! > 0 && runs.length > 0;
      for (let k = 0; k < runs.length; k += 3) for (const r of NEEDED) can &&= had(this.matTex[runs[k]! * MAPS + r]!);
      this.can[slot] = can ? 1 : 0;
    }
  }

  /** The slot of a level of a mesh. */
  slot(mesh: number, level: number): number {
    return this.first[mesh]! + level;
  }

  /**
   * Holds `bytes` of the card for something that is not an asset, such as the terrain's pictures, in place of what was
   * held under its name before. 0 gives it back. It comes off the budget from the next frame, and outlasts a lost card.
   */
  reserve(name: string, bytes: number): void {
    this.reserved += bytes - (this.reserves.get(name) ?? 0);
    if (bytes > 0) this.reserves.set(name, bytes);
    else this.reserves.delete(name);
  }

  /** Bytes of this frame's allowance left for what is not an asset, which spends before the assets do. */
  get left(): number {
    return Math.max(0, this.uploadBytes - this.spent);
  }

  /** Spends `bytes` of this frame's allowance on something that is not an asset. Assets have what is left, and one still goes. */
  spend(bytes: number): void {
    this.spent += bytes;
  }

  private empty(): void {
    this.prev[this.root] = this.next[this.root] = this.mark;
    this.prev[this.mark] = this.next[this.mark] = this.root;
    this.prev[this.texRoot] = this.next[this.texRoot] = this.texMark;
    this.prev[this.texMark] = this.next[this.texMark] = this.texRoot;
  }

  private unlink(node: number): void {
    this.next[this.prev[node]!] = this.next[node]!;
    this.prev[this.next[node]!] = this.prev[node]!;
  }

  private toTail(node: number, root = this.root): void {
    const last = this.prev[root]!;
    this.next[last] = node;
    this.prev[node] = last;
    this.next[node] = root;
    this.prev[root] = node;
  }

  /** Bytes of the request a slot is waiting on. A level's may bring its surface. */
  private asked(slot: number): number {
    return this.size[slot]! + (slot < this.levels && this.state[this.levels + slot] === RIDING ? this.size[this.levels + slot]! : 0);
  }

  /** A request has ended, however it ended. */
  private land(slot: number): void {
    this.flying--;
    if (this.asked(slot) > SMALL_PART) this.flyingLarge--;
  }

  /** What a slot was waiting on will not come, or what came for it is thrown away. */
  private undo(slot: number): void {
    if (slot < this.levels) {
      if (this.state[this.levels + slot] === RIDING) this.state[this.levels + slot] = ABSENT;
    } else if (slot >= this.texBase) {
      this.texComing -= this.size[slot]!;
      this.settle(slot - this.texBase);
    }
  }

  /** A texture's copy on its way is no longer a smaller one. */
  private settle(t: number): void {
    if (this.down[t] === 0) return;
    this.down[t] = 0;
    this.shrinking--;
  }

  /** Starts a frame: takes in what has arrived since the last. */
  begin(nowMs: number): void {
    this.frame++;
    this.spent = 0;
    this.wants.length = 0;
    this.unlink(this.mark);
    this.toTail(this.mark);
    this.unlink(this.texMark);
    this.toTail(this.texMark, this.texRoot);
    this.texMarked = 0;
    if (this.format !== this.made) this.remake();
    if (!this.port) return;
    const n = this.port.take(this.arrivals);
    for (let i = 0; i < n; i++) {
      const a = this.arrivals[i]!;
      const slot = a.slot;
      // Given up while it was on its way.
      if (this.state[slot] !== LOADING) continue;
      this.land(slot);
      this.stats.fetched += a.fetched;
      this.stats.cached += a.cached;
      const rider = slot < this.levels && this.state[this.levels + slot] === RIDING ? this.levels + slot : -1;
      // A port that brings fewer bytes than were asked for has failed, whatever it says.
      if (a.data && a.data.length === this.asked(slot)) {
        this.data[slot] = rider < 0 ? a.data : a.data.subarray(0, this.size[slot]!);
        this.state[slot] = ARRIVED;
        this.waiting += this.size[slot]!;
        this.tries[slot] = 0;
        if (rider >= 0) {
          this.data[rider] = a.data.subarray(this.size[slot]!);
          this.state[rider] = ARRIVED;
          this.waiting += this.size[rider]!;
          this.under.push(rider);
        }
        continue;
      }
      this.undo(slot);
      if (a.fail === FAIL_RANGE || (a.fail === FAIL_HASH && this.rehashed[slot] === 1)) {
        // The manifest is wrong about it, or its bytes are wrong twice. Asking again would change nothing.
        this.stats.dead++;
        if (rider >= 0) {
          // Which of the two is wrong is not known. The surface is given up, and the level is asked for alone.
          this.state[rider] = DEAD;
          this.state[slot] = ABSENT;
          this.rehashed[slot] = 0;
        } else if (slot >= this.texBase) {
          // The texture stays at the step before.
          this.limit[slot - this.texBase] = this.goal[slot - this.texBase]! - 1;
          this.state[slot] = ABSENT;
          this.rehashed[slot] = 0;
          if (this.goal[slot - this.texBase] === 0) this.recan();
        } else this.state[slot] = DEAD;
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

  private wantSlot(slot: number, urgency: number): void {
    if (this.seen[slot] === this.frame) {
      if (urgency > this.urgency[slot]!) this.urgency[slot] = urgency;
      return;
    }
    this.seen[slot] = this.frame;
    this.urgency[slot] = urgency;
    if (this.state[slot] === ABSENT && this.inBoot[slot] === 0) this.wants.push(slot);
  }

  /** Says a level is wanted this frame, and how urgently against the others. */
  want(mesh: number, level: number, urgency: number): void {
    this.wantSlot(this.first[mesh]! + level, urgency);
  }

  /** Says the surface of a level is wanted this frame too. False, with nothing wanted, where there are no textures or the level is never drawn with materials. */
  wantSurface(mesh: number, level: number, urgency: number): boolean {
    const slot = this.first[mesh]! + level;
    if (this.cap < 0 || this.can[slot] === 0) return false;
    this.wantSlot(this.levels + slot, urgency);
    return true;
  }

  /**
   * Says a material is on screen this frame, a whole texture of it covering `pixels` pixels on something `distance`
   * metres off. Each of its textures is kept, and wanted at the first step that is as wide as it is shown: as far
   * under the material's widest as it was authored, and no wider than the tier allows.
   */
  material(m: number, pixels: number, distance: number): void {
    if (this.cap < 0) return;
    this.matSeen[m] = this.frame;
    const most = STEP0_SIZE << (this.matTop[m]! < this.cap ? this.matTop[m]! : this.cap);
    const shown = pixels < most ? pixels : most;
    for (let r = 0; r < MAPS; r++) {
      const t = this.matTex[m * MAPS + r]!;
      if (t >= 0) this.texture(t, shown / (1 << this.matUnder[m * MAPS + r]!), WEIGHT[r]! / distance, r === 0 || r >= 3);
    }
  }

  /** A texture shown `px` pixels across. Its next step is as urgent as the pixels it adds, times `weight`. */
  private texture(t: number, px: number, weight: number, first: boolean): void {
    const slot = this.texBase + t;
    const have = this.has[t]!;
    if (this.seen[slot] !== this.frame) {
      this.seen[slot] = this.frame;
      this.urgency[slot] = 0;
      this.px[t] = px;
      if (have >= 0) {
        this.unlink(slot);
        this.toTail(slot, this.texRoot);
        this.texMarked += this.through[t * STEPS + have]!;
      }
    } else if (px > this.px[t]!) this.px[t] = px;
    if (have >= this.limit[t]!) return;
    const next = STEP0_SIZE << (have + 1);
    let urgency: number;
    if (have < 0) urgency = first ? FIRST * (1 + weight) : next * weight;
    else if (px > next >> 1) urgency = ((px < next ? px : next) - (next >> 1)) * weight;
    else return;
    if (urgency > this.urgency[slot]!) this.urgency[slot] = urgency;
    if (this.state[slot] === ABSENT && this.queued[t] !== this.frame) {
      this.queued[t] = this.frame;
      this.wants.push(slot);
    }
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

  /**
   * Whether a level that `level` has just given is drawn with its materials this frame: its surface, and the base
   * colour and masks of every material of its sections, are on the card. Otherwise the whole of it is drawn flat, and
   * what is missing is asked for. Always false where there are no textures.
   */
  textured(mesh: number, level: number): boolean {
    const slot = this.first[mesh]! + level;
    if (this.cap < 0 || this.can[slot] === 0 || !this.usable(slot)) return false;
    const s = this.levels + slot;
    // Nobody asked for the surface of a level that stands in for another. It is fetched as the level was: first.
    if (this.state[s] !== RESIDENT && this.seen[s] !== this.frame) {
      let urgency = 0;
      for (let l = this.first[mesh]!; l < this.first[mesh + 1]!; l++) if (this.seen[l] === this.frame && this.urgency[l]! > urgency) urgency = this.urgency[l]!;
      this.wantSlot(s, urgency * 2 + 1);
    }
    let ready = this.usable(s);
    const runs = this.runs[slot]!;
    for (let k = 0; k < runs.length; k += 3) {
      const m = runs[k]!;
      // What is drawn must be kept, whoever did or did not say it is on screen.
      if (this.matSeen[m] !== this.frame) this.material(m, 0, 1);
      for (let n = 0; n < NEEDED.length; n++) {
        const t = this.matTex[m * MAPS + NEEDED[n]!]!;
        if (t >= 0 && this.has[t]! < 0) ready = false;
      }
    }
    return ready;
  }

  /** The level of a level's slot or of its surface's. */
  private levelAt(slot: number): ManifestLevel {
    const of = slot < this.levels ? slot : slot - this.levels;
    return this.manifest.meshes[this.meshOf[of]!]!.levels[this.levelOf[of]!]!;
  }

  /** Where in its file a level's first part starts, or its surface: after the first part, unless the manifest says where else. */
  private startOf(slot: number): number {
    const level = this.levelAt(slot);
    return slot < this.levels ? level.at : level.surface ? level.surface.at : level.at + level.parts[0]!.bytes;
  }

  private upload(slot: number, data: Uint8Array, out: AssetUpload[]): void {
    const of = slot < this.levels ? slot : slot - this.levels;
    const level = this.levelAt(of);
    if (of === slot) out.push({ slot, mesh: this.meshOf[of]!, level: this.levelOf[of]!, data, indexCount: level.tris * 3, indexBytes: level.index });
    else out.push({ slot, mesh: this.meshOf[of]!, level: this.levelOf[of]!, data, indexCount: 0, indexBytes: level.index, of, skinAt: level.parts[1]!.bytes });
    this.stats.uploaded += data.length;
  }

  /**
   * Asks the port to keep everything this tier may fetch, so nothing need be fetched while playing: every level that
   * is not in the boot pack and, where there are textures, its surface and every texture as far as the tier takes it.
   * Returns their bytes.
   */
  download(): number {
    const parts: { file: number; part: AssetPart }[] = [];
    let bytes = 0;
    const add = (file: number, part: AssetPart): void => {
      parts.push({ file, part });
      bytes += part.length;
    };
    for (let slot = 0; slot < this.levels; slot++) {
      const level = this.levelAt(slot);
      if (this.inBoot[slot] === 0) for (const p of levelParts(level, 0, 1)) add(level.file, p);
      if (this.cap < 0 || this.inBoot[this.levels + slot] === 1) continue;
      for (const p of levelParts(level, 1, level.parts.length)) add((level.surface ?? level).file, p);
    }
    if (this.cap >= 0) {
      // A texture is taken as far as the material that shows it widest would.
      const most = new Int8Array(this.has.length).fill(-1);
      for (let k = 0; k < this.matTex.length; k++) {
        const t = this.matTex[k]!;
        if (t >= 0) most[t] = Math.max(most[t]!, Math.min(this.limit[t]!, Math.max(0, Math.min(this.cap, this.matTop[Math.floor(k / MAPS)]!) - this.matUnder[k]!)));
      }
      (this.manifest.textures ?? []).forEach((tex, t) => {
        const v = tex.in[this.made];
        if (v && most[t]! >= 0) for (const p of textureParts(tex, this.made, most[t]!)) add(v.file, p);
      });
    }
    this.port?.fill(parts);
    return bytes;
  }

  /** What the port keeps between visits, or null with no port. */
  get cache(): AssetPort["cache"] | null {
    return this.port ? this.port.cache : null;
  }

  /** The graphics card could not take a level or a surface it was sent. */
  failed(slot: number): void {
    if (this.state[slot] !== RESIDENT) return;
    if (this.inBoot[slot] === 0) this.unlink(slot);
    this.state[slot] = ABSENT;
    this.ledger -= this.size[slot]!;
  }

  /** The graphics card could not take a texture it was sent, and has dropped all it had of it. `texture` is as in `texUploads`. */
  failedTexture(texture: number): void {
    this.letGo(texture);
  }

  /** Ends a frame: `uploads`, `drops` and the same for textures are what the graphics card must do before it draws this frame, the drops first. */
  end(uploads: AssetUpload[], drops: number[], texUploads: TextureUpload[], texDrops: number[], nowMs: number): void {
    for (const slot of this.fromBoot) {
      const at = this.startOf(slot) - this.boot.blobAt;
      this.upload(slot, this.boot.blob.subarray(at, at + this.size[slot]!), uploads);
    }
    this.fromBoot.length = 0;
    for (const t of this.late) texDrops.push(t);
    this.late.length = 0;
    if (!this.port) return;

    // What nobody wants any longer is given up, on its way or arrived. A copy of a texture that the card has begun is finished.
    let kept = 0;
    for (const slot of this.under) {
      const idle = this.frame - this.seen[slot]! > IDLE_FRAMES;
      if (this.state[slot] === LOADING && idle) {
        this.port.cancel(slot);
        this.land(slot);
        this.undo(slot);
        this.state[slot] = ABSENT;
        this.stats.cancelled++;
      } else if (this.state[slot] === ARRIVED && idle && (slot < this.texBase || this.gone[slot - this.texBase] === 0)) {
        this.data[slot] = null;
        this.waiting -= this.size[slot]!;
        this.undo(slot);
        this.state[slot] = ABSENT;
        this.stats.wasted += this.size[slot]!;
      }
      if (this.state[slot] === LOADING || this.state[slot] === ARRIVED) this.under[kept++] = slot;
    }
    this.under.length = kept;

    // What has arrived goes on the card, most urgent first, within what the frame's bytes have left. One always goes.
    const urgent = (slot: number): number => (this.seen[slot] === this.frame ? this.urgency[slot]! : -1);
    const byUrgency = (a: number, b: number): number => urgent(b) - urgent(a) || a - b;
    let sent = this.spent;
    this.full = this.short = false;
    kept = 0;
    for (const slot of this.under.sort(byUrgency)) {
      if (this.state[slot] !== ARRIVED) {
        this.under[kept++] = slot;
        continue;
      }
      if (slot >= this.texBase) {
        sent = this.fill(slot - this.texBase, sent, texUploads, drops, texDrops);
        if (this.state[slot] === ARRIVED) this.under[kept++] = slot;
        continue;
      }
      // A surface goes up with its level, or after it.
      const pair = slot < this.levels && this.state[this.levels + slot] === ARRIVED ? this.levels + slot : -1;
      const bytes = this.size[slot]! + (pair < 0 ? 0 : this.size[pair]!);
      if ((slot >= this.levels && this.state[slot - this.levels] !== RESIDENT) || (sent > this.spent && sent + bytes > this.uploadBytes)) {
        this.under[kept++] = slot;
        continue;
      }
      this.makeRoom(bytes, drops);
      // What this frame draws already fills the card past its overflow. It waits, and everything is asked for coarser.
      if (this.ledger + bytes > this.budget * OVERFLOW) this.full = true;
      if (this.ledger + bytes > this.budget * OVERFLOW || (slot >= this.levels && this.state[slot - this.levels] !== RESIDENT)) {
        this.under[kept++] = slot;
        continue;
      }
      this.take(slot, uploads);
      if (pair >= 0) this.take(pair, uploads);
      sent += bytes;
    }
    this.under.length = kept;

    for (const slot of this.wants.sort(byUrgency)) {
      if (this.flying >= IN_FLIGHT || this.waiting >= WAITING_LIMIT) break;
      if (this.state[slot] !== ABSENT || this.retryAt[slot]! > nowMs) continue;
      let bytes = this.size[slot]!;
      let rider = -1;
      let goal = 0;
      if (slot >= this.texBase) {
        // A texture climbs a step at a time, and only into room that is not spoken for.
        goal = this.has[slot - this.texBase]! + 1;
        bytes = this.through[(slot - this.texBase) * STEPS + goal]!;
        if (this.texMarked + this.texComing + bytes > this.texBudget) {
          this.short = true;
          continue;
        }
      } else if (slot >= this.levels) {
        // A surface is asked for by itself when its level is here or coming. Otherwise it comes in its level's request.
        const level = this.state[slot - this.levels]!;
        if (level !== LOADING && level !== ARRIVED && level !== RESIDENT) continue;
      } else {
        // A surface that follows its level in the file comes with it, so that the two arrive together.
        const s = this.levels + slot;
        if (this.seen[s] === this.frame && this.state[s] === ABSENT && this.retryAt[s]! <= nowMs && !this.levelAt(slot).surface) {
          rider = s;
          bytes += this.size[s]!;
        }
      }
      if (bytes > SMALL_PART && this.flyingLarge >= IN_FLIGHT - SMALL_LANES) continue;
      this.ask(slot, rider, goal);
    }
    if ((this.short || this.texLedger > this.texBudget) && this.shrinking === 0 && this.flying < IN_FLIGHT && this.waiting < WAITING_LIMIT) this.shrink(nowMs);

    this.texRoom(0, this.texBudget, texDrops);
    this.makeRoom(0, drops);
    if (this.full || this.ledger > this.budget * OVERFLOW) this.relax *= 1.02;
    else if (this.relax > 1 && this.ledger < this.budget * 0.7) this.relax = Math.max(1, this.relax / 1.02);
  }

  /** Asks the port for a level, with its surface if `rider` is that, for a surface, or for steps 0 to `goal` of a texture. */
  private ask(slot: number, rider: number, goal: number): void {
    const parts: AssetPart[] = [];
    let file: number;
    if (slot >= this.texBase) {
      const t = slot - this.texBase;
      const tex = this.manifest.textures![t]!;
      file = tex.in[this.made]!.file;
      parts.push(...textureParts(tex, this.made, goal));
      this.goal[t] = goal;
      this.size[slot] = this.through[t * STEPS + goal]!;
      this.texComing += this.size[slot]!;
    } else {
      const level = this.levelAt(slot);
      file = slot < this.levels ? level.file : (level.surface ?? level).file;
      parts.push(...levelParts(level, slot < this.levels ? 0 : 1, slot >= this.levels || rider >= 0 ? level.parts.length : 1));
      if (rider >= 0) this.state[rider] = RIDING;
    }
    this.port!.request({ slot, file, parts, priority: this.urgency[slot]!, fresh: this.rehashed[slot] === 1 });
    this.state[slot] = LOADING;
    this.flying++;
    if (this.asked(slot) > SMALL_PART) this.flyingLarge++;
    this.under.push(slot);
    this.stats.requests++;
  }

  /** A level or a surface that has arrived goes on the card. */
  private take(slot: number, uploads: AssetUpload[]): void {
    this.upload(slot, this.data[slot]!, uploads);
    this.data[slot] = null;
    this.state[slot] = RESIDENT;
    this.waiting -= this.size[slot]!;
    this.ledger += this.size[slot]!;
    this.toTail(slot);
  }

  /**
   * Hands the card as much of a texture's copy that has arrived as the frame has bytes left for: rows of its pictures,
   * smallest picture first. The card holds the whole copy from its first rows, and the copy it drew with until the last.
   * Returns the bytes sent this frame.
   */
  private fill(t: number, sent: number, out: TextureUpload[], drops: number[], texDrops: number[]): number {
    const slot = this.texBase + t;
    const goal = this.goal[t]!;
    const whole = this.through[t * STEPS + goal]!;
    const tex = this.manifest.textures![t]!;
    let at = this.gone[t]!;
    if (at === 0) {
      // A copy is begun in a frame that has bytes left for its first row.
      if (sent > this.spent && sent + pictureBytes(this.made, tex.role, 1) > this.uploadBytes) return sent;
      // Textures keep to their share, but for a smaller copy that will give room back. Levels make way for them.
      const share = this.texBudget * (this.down[t] === 1 ? OVERFLOW : 1);
      this.texRoom(whole, share, texDrops);
      if (this.texLedger + whole > share) {
        this.short = true;
        return sent;
      }
      this.makeRoom(whole, drops);
      if (this.ledger + whole > this.budget * OVERFLOW) {
        this.full = true;
        return sent;
      }
      this.ledger += whole;
      this.texLedger += whole;
    }
    const data = this.data[slot]!;
    let side = 1;
    let start = 0;
    for (let bytes = pictureBytes(this.made, tex.role, side); start + bytes <= at; bytes = pictureBytes(this.made, tex.role, (side <<= 1))) start += bytes;
    while (at < whole) {
      const rows = this.made === "rgba" ? side : (side + 3) >> 2;
      const rowBytes = pictureBytes(this.made, tex.role, side) / rows;
      const row = (at - start) / rowBytes;
      let n = Math.floor((this.uploadBytes - sent) / rowBytes);
      if (n <= 0) {
        if (sent > this.spent) break;
        n = 1;
      }
      if (n > rows - row) n = rows - row;
      const bytes = n * rowBytes;
      out.push({ slot: t, role: tex.role, format: this.made, top: STEP0_SIZE << goal, size: side, row, rows: n, data: data.subarray(at, at + bytes), last: at + bytes === whole });
      at += bytes;
      sent += bytes;
      if (row + n === rows) {
        start = at;
        side <<= 1;
      }
    }
    this.waiting -= at - this.gone[t]!;
    this.stats.uploaded += at - this.gone[t]!;
    this.gone[t] = at;
    const had = this.has[t]!;
    // The copy drawn with is not let go in a frame that has sent rows of the new one.
    if (had >= 0) this.unlink(slot);
    if (had >= 0 || at === whole) this.toTail(slot, this.texRoot);
    if (at < whole) return sent;

    const was = had < 0 ? 0 : this.through[t * STEPS + had]!;
    this.ledger -= was;
    this.texLedger -= was;
    this.texComing -= whole;
    if (this.seen[slot] === this.frame) this.texMarked += whole - was;
    if (this.down[t] === 1) this.stats.shrunk++;
    else this.stats.used += whole - was;
    this.settle(t);
    this.has[t] = goal;
    this.gone[t] = 0;
    this.data[slot] = null;
    this.state[slot] = ABSENT;
    return sent;
  }

  /**
   * The textures' share is short. The texture on screen that holds most beyond what is wanted of it is asked for
   * again at the step that is wanted, and gives the rest back when that copy is made.
   */
  private shrink(nowMs: number): void {
    let best = -1;
    let to = 0;
    let most = 0;
    for (let t = 0; t < this.has.length; t++) {
      const slot = this.texBase + t;
      const have = this.has[t]!;
      if (have <= 0 || this.seen[slot] !== this.frame || this.state[slot] !== ABSENT || this.retryAt[slot]! > nowMs) continue;
      if (stepFor(this.px[t]! * KEEP, have) === have) continue;
      const want = stepFor(this.px[t]!, have);
      const saved = this.through[t * STEPS + have]! - this.through[t * STEPS + want]!;
      if (saved > most) {
        best = t;
        to = want;
        most = saved;
      }
    }
    if (best < 0) return;
    const bytes = this.through[best * STEPS + to]!;
    if (this.texMarked + this.texComing + bytes > this.texBudget * OVERFLOW || (bytes > SMALL_PART && this.flyingLarge >= IN_FLIGHT - SMALL_LANES)) return;
    this.down[best] = 1;
    this.shrinking++;
    this.ask(this.texBase + best, -1, to);
  }

  /** Lets go of the least lately drawn levels and surfaces until `bytes` more fit in the budget. What this frame drew stays. */
  private makeRoom(bytes: number, drops: number[]): void {
    while (this.ledger + bytes > this.budget) {
      const slot = this.next[this.root]!;
      if (slot === this.mark) break;
      // A surface is no use without its level, and goes first.
      if (slot < this.levels && this.state[this.levels + slot] === RESIDENT) this.evict(this.levels + slot, drops);
      this.evict(slot, drops);
    }
  }

  private evict(slot: number, drops: number[]): void {
    this.unlink(slot);
    this.state[slot] = ABSENT;
    this.ledger -= this.size[slot]!;
    drops.push(slot);
    this.stats.evicted++;
  }

  /** Lets go of the least lately drawn textures, each whole, until `bytes` more fit in `share`. What is on screen this frame stays. */
  private texRoom(bytes: number, share: number, texDrops: number[]): void {
    while (this.texLedger + bytes > share) {
      const slot = this.next[this.texRoot]!;
      if (slot === this.texMark) break;
      this.letGo(slot - this.texBase);
      texDrops.push(slot - this.texBase);
      this.stats.evicted++;
    }
  }

  /** A texture leaves the card whole: the copy drawn with, and a copy being made. A request on its way still comes. */
  private letGo(t: number): void {
    const slot = this.texBase + t;
    const have = this.has[t]!;
    if (have >= 0) {
      this.unlink(slot);
      this.ledger -= this.through[t * STEPS + have]!;
      this.texLedger -= this.through[t * STEPS + have]!;
      this.has[t] = -1;
    }
    if (this.gone[t]! > 0) {
      this.ledger -= this.size[slot]!;
      this.texLedger -= this.size[slot]!;
      this.waiting -= this.size[slot]! - this.gone[t]!;
      this.undo(slot);
      this.gone[t] = 0;
      this.data[slot] = null;
      this.state[slot] = ABSENT;
    }
    // What was to have been a smaller copy is now the only one.
    this.settle(t);
  }

  /** The device takes another variant: every texture goes, and what was on its way is given up. */
  private remake(): void {
    for (let t = 0; t < this.has.length; t++) {
      const slot = this.texBase + t;
      if (this.has[t]! >= 0 || this.gone[t]! > 0) this.late.push(t);
      this.letGo(t);
      if (this.state[slot] === LOADING) {
        this.port!.cancel(slot);
        this.land(slot);
      } else if (this.state[slot] === ARRIVED) {
        this.waiting -= this.size[slot]!;
        this.data[slot] = null;
      }
      this.state[slot] = ABSENT;
      this.tries[slot] = this.rehashed[slot] = this.retryAt[slot] = 0;
    }
    this.texComing = 0;
    this.retable();
  }

  /** The graphics card has lost everything. What had arrived and what is on its way are kept. */
  reset(): void {
    for (let slot = 0; slot < this.state.length; slot++) if (this.state[slot] === RESIDENT) this.state[slot] = ABSENT;
    for (let t = 0; t < this.has.length; t++) {
      this.has[t] = -1;
      // A copy the card had begun is begun again.
      this.waiting += this.gone[t]!;
      this.gone[t] = 0;
      this.settle(t);
    }
    this.ledger = this.texLedger = 0;
    this.fromBoot.length = 0;
    this.empty();
  }
}
