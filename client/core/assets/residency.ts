// What is on the graphics card, and what is asked for, kept and let go to keep it so. There are five kinds of slot.
// A level is the indices and flat vertices of one level of a mesh. A surface is what that level needs besides to be
// drawn with materials, its surface and its skin, and is of use only with its level. A texture holds its pictures up
// to some step, and changes step by being made again from its first picture while the card still draws with the old.
// A skeleton's clips never go on the card: they are read as they come and kept. A page is the rows of some meshes and
// of what they are drawn with, and their smallest levels: a mesh whose page has not come is asked for by its page,
// before anything else, and is not drawn.
//
// What the boot pack and the pages that have come hold is resident as soon as it is wanted and is never let go, so
// there is always some level of every mesh known to draw. Everything else is asked of the port, most urgent first, put
// on the card within a frame's allowance of bytes, and let go, least lately drawn first, when the card's budget is
// passed. Textures have a share of the budget and a ring of their own, and levels and surfaces have what textures
// leave of it.
//
// What the card holds that is not an asset (terrain pictures, shadow maps, the sky, far meshes) is reserved by name and
// comes off the budget, and what goes onto the card that is not an asset is spent from the same frame's allowance.

import type { ClipSet } from "../../../shared/anim/clip.ts";
import { meshKnown, readPage, skeletonClips, storedBytes, type Manifest, type ManifestLevel } from "../../../shared/pack/manifest.ts";
import { VERTEX_BYTES, type Pack } from "../../../shared/pack/pack.ts";
import { LAST_STEP, STEP0_SIZE, blockOf, pictureBytes, stepBytes, stepOf, topIn, type TextureFormat } from "../../../shared/pack/texture.ts";
import { Rng } from "../../../shared/rng.ts";
import type { TextureUpload } from "../render/packet.ts";
import { FAIL_HASH, FAIL_RANGE, levelParts, textureParts, wholePart, type AssetArrival, type AssetPart, type AssetPort } from "./port.ts";

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
  /** Its indices are those every level of quads shares (packet.ts quadIndices), and `data` holds its vertices alone. */
  quads?: boolean;
  /** The bounds its vertices are stored within, where they are not its mesh's. */
  bounds?: { readonly center: readonly number[]; readonly half: readonly number[] };
  of?: number;
  skinAt?: number;
  /**
   * For one that goes up in pieces over several frames: where `data` begins in its `whole` bytes. The piece at 0 makes
   * room for the whole, and it is drawn once the last has gone.
   */
  at?: number;
  whole?: number;
}

/**
 * Requests under way at once, and how many of them are kept for small parts so a large one never holds them up. Over
 * HTTP/1.1 a browser opens six connections to a host. HTTP/2 and 3 carry many requests on one, and there a first view
 * of small parts is bound by round trips unless many are under way (D124).
 */
export const IN_FLIGHT = 6;
export const SMALL_LANES = 2;
export const IN_FLIGHT_SHARED = 24;
export const SMALL_LANES_SHARED = 20;
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
/** A page is more urgent than step 0 of any texture: nothing of its meshes is drawn without it. So is the first level of a mesh with none held. */
export const PAGE_FIRST = 4 * FIRST;
/** How urgent a material's textures are against one another. */
const WEIGHT: readonly number[] = [1, 0.5, 0.25, 1, 1];
/** A texture's climb is as urgent as the pixels it adds for each this many bytes of it, so the cheapest gain comes first. */
const CLIMB_BYTES = 65536;
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
  /**
   * Requests that failed are `failed` (to be asked again) or `dead` (given up), and by kind `failNet`, `failHash` and
   * `failRange`, with the HTTP status of the last on the network, 0 for no answer. `refused` counts uploads the card refused.
   */
  readonly stats = { requests: 0, cancelled: 0, failed: 0, dead: 0, failNet: 0, failHash: 0, failRange: 0, lastStatus: 0, refused: 0, evicted: 0, wasted: 0, fetched: 0, cached: 0, uploaded: 0, used: 0, skipped: 0, shrunk: 0 };

  private readonly manifest: Manifest;
  private readonly boot: Pack;
  private readonly port: AssetPort | null;
  private readonly rng: Rng;
  /** The first slot of each mesh, and one past the last. */
  private readonly first: Uint32Array;
  /**
   * How many levels there are. The surface of the level in slot s is slot `levels + s`, texture t is slot `texBase + t`,
   * the clips of the manifest's skeleton c are slot `clipBase + c`, and page p is slot `pageBase + p`.
   */
  private readonly levels: number;
  private readonly texBase: number;
  private readonly clipBase: number;
  private readonly pageBase: number;
  /** Each skeleton's clips once they have come. */
  private readonly clipSets: (ClipSet | null)[];
  private readonly meshOf: Uint32Array;
  private readonly levelOf: Uint8Array;
  /** Each mesh's page, -1 for one the boot pack holds, and whether its row is here. */
  private readonly pageOf: Int32Array;
  private readonly knownMesh: Uint8Array;
  /** By the first page of a request, how many pages that follow it in its file come in the same request. */
  private readonly run: Uint16Array;
  /** Meshes whose pages came in this frame's `begin`, for what keeps what it read of a mesh. */
  readonly learned: number[] = [];
  /** Set by `download`: each page that comes has its meshes' parts kept as well. */
  private keepAll = false;
  /** Bytes of a level or a surface. For a texture, bytes of the copy on its way. */
  private readonly size: Uint32Array;
  /** Set on a level the boot pack or a page that has come holds, and on a surface the boot pack holds, and the first part of such a level. */
  private readonly inBoot: Uint8Array;
  private readonly heldBytes: (Uint8Array | null)[];
  private readonly state: Uint8Array;
  /** The frame each slot was last wanted in, and how urgently in that frame. */
  private readonly seen: Uint32Array;
  private readonly urgency: Float32Array;
  private readonly generation: Uint32Array;
  private readonly tries: Uint8Array;
  private readonly retryAt: Float64Array;
  private readonly rehashed: Uint8Array;
  private readonly drawn: Uint8Array;
  /** Set on a level put on the card in a frame before its surface: it is kept, and drawn once the surface follows. */
  private readonly apart: Uint8Array;
  /** Bytes the card has been handed of a level or a surface going up in pieces. From the first of them it holds the whole. */
  private readonly given: Uint32Array;
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
  /** Per material: its hurt and decay layer, -1 for none. */
  private readonly matLayer: Int32Array;
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
  /** The time the frame began, in milliseconds. */
  private now = 0;
  private readonly reserves = new Map<string, number>();
  /** Bytes of this frame's allowance spent on what is not an asset. */
  private spent = 0;
  private flyingLarge = 0;
  /** How many requests may be under way, and how many of them are kept for small parts: more where the port's files come over HTTP/2 or 3. */
  private inFlight = IN_FLIGHT;
  private smallLanes = SMALL_LANES;
  /** Set in a frame in which something waited because the card was over-full, and in which a texture waited for room in the textures' share. */
  private full = false;
  private short = false;
  /** Slots wanted this frame that are neither resident nor on their way. */
  private readonly wants: number[] = [];
  /** Slots on their way or arrived. */
  private under: number[] = [];
  private readonly fromBoot: number[] = [];
  private readonly arrivals: AssetArrival[] = [];

  /** Bounded, on-demand inspection: authored texture identity and its resident/incoming step. */
  textureState(): { id: string; have: number; goal: number; state: number; wanted: boolean }[] {
    return (this.manifest.textures ?? []).map((texture, t) => ({ id: texture.id, have: this.has[t]!, goal: this.goal[t]!, state: this.state[this.texBase + t]!, wanted: this.seen[this.texBase + t] === this.frame }));
  }

  /** `pages` are the blobs of pages whose rows a tool has read into the manifest already (shared/pack/manifest.ts `readPages`), by page. */
  constructor(manifest: Manifest, boot: Pack, port: AssetPort | null, pages: readonly Uint8Array[] = [], seed = 1) {
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
    this.clipBase = this.texBase + textures.length;
    const clips = manifest.clips ?? [];
    this.clipSets = clips.map(() => null);
    this.pageBase = this.clipBase + clips.length;
    const slots = this.pageBase + (manifest.pages?.length ?? 0);
    this.meshOf = new Uint32Array(this.levels);
    this.levelOf = new Uint8Array(this.levels);
    this.pageOf = Int32Array.from(manifest.meshes, (m) => m.page ?? -1);
    this.knownMesh = new Uint8Array(manifest.meshes.length);
    this.run = new Uint16Array(manifest.pages?.length ?? 0);
    this.size = new Uint32Array(slots);
    this.inBoot = new Uint8Array(slots);
    this.heldBytes = new Array<Uint8Array | null>(this.levels).fill(null);
    this.runs = new Array<readonly number[]>(this.levels).fill(NONE);
    manifest.meshes.forEach((m, i) => {
      m.levels.forEach((_, l) => {
        this.meshOf[this.first[i]! + l] = i;
        this.levelOf[this.first[i]! + l] = l;
      });
      if (!meshKnown(m)) return;
      if (m.page !== undefined && !pages[m.page]) throw new Error(`residency: the blob of the page of ${m.id} is not given`);
      this.learnMesh(i, m.page === undefined ? null : pages[m.page]!);
    });
    clips.forEach((e, c) => (this.size[this.clipBase + c] = e.part.bytes));
    (manifest.pages ?? []).forEach((p, k) => (this.size[this.pageBase + k] = p.part.bytes));
    this.state = new Uint8Array(slots);
    pages.forEach((blob, p) => blob && (this.state[this.pageBase + p] = RESIDENT));
    this.seen = new Uint32Array(slots);
    this.urgency = new Float32Array(slots);
    this.generation = new Uint32Array(slots);
    this.tries = new Uint8Array(slots);
    this.retryAt = new Float64Array(slots);
    this.rehashed = new Uint8Array(slots);
    this.drawn = new Uint8Array(slots);
    this.apart = new Uint8Array(this.levels);
    this.given = new Uint32Array(this.texBase);
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
    this.matLayer = new Int32Array(materials.length);
    materials.forEach((_, i) => this.learnMaterial(i));
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
    for (let t = 0; t < this.limit.length; t++) this.learnTexture(t);
    for (let slot = 0; slot < this.levels; slot++) this.can[slot] = this.canDraw(slot);
  }

  private learnTexture(t: number): void {
    const tex = this.manifest.textures![t]!;
    this.limit[t] = this.port && tex.in[this.made] ? stepOf(topIn(this.made, tex.top)) : -1;
    const block = blockOf(this.made, tex.in[this.made] ?? {});
    for (let k = 0, bytes = 0; k <= this.limit[t]!; k++) this.through[t * STEPS + k] = bytes += stepBytes(this.made, tex.role, k, block);
  }

  private learnMaterial(i: number): void {
    const m = this.manifest.materials![i]!;
    const textures = this.manifest.textures!;
    const maps = [m.base, m.normal, m.mro, m.mask, m.mask2 ?? -1];
    const steps = maps.map((t) => (t < 0 ? 0 : stepOf(textures[t]!.top)));
    this.matTop[i] = Math.max(...steps);
    maps.forEach((t, r) => {
      this.matTex[i * MAPS + r] = t;
      this.matUnder[i * MAPS + r] = t < 0 ? 0 : this.matTop[i]! - steps[r]!;
    });
    const layer = m.layer ?? -1;
    this.matLayer[i] = layer;
  }

  /** What the manifest says of a mesh whose row is here, with the blob of its page where it has one. */
  private learnMesh(i: number, blob: Uint8Array | null): void {
    this.manifest.meshes[i]!.levels.forEach((level, l) => {
      const slot = this.first[i]! + l;
      const bytes = level.parts[0]!.bytes;
      this.size[slot] = bytes;
      this.size[this.levels + slot] = level.parts.reduce((sum, p, k) => (k > 0 ? sum + p.bytes : 0), 0);
      const role = this.manifest.files[level.file]!.role;
      const from = level.at - this.boot.blobAt;
      this.heldBytes[slot] = level.file === this.manifest.boot ? this.boot.blob.subarray(from, from + bytes) : role === "page" ? blob!.subarray(level.at, level.at + bytes) : null;
      this.inBoot[slot] = this.heldBytes[slot] ? 1 : 0;
      this.inBoot[this.levels + slot] = (level.surface ?? level).file === this.manifest.boot ? 1 : 0;
      this.runs[slot] = level.sections ?? NONE;
    });
    this.knownMesh[i] = 1;
  }

  /** A page has come: the rows it holds, and the levels it holds from its blob. False where it is not the page it should be. */
  private learnPage(p: number, data: Uint8Array): boolean {
    let page: ReturnType<typeof readPage>;
    try {
      page = readPage(this.manifest, p, data);
    } catch {
      return false;
    }
    for (const t of page.textures) this.learnTexture(t);
    for (const k of page.materials) this.learnMaterial(k);
    for (const i of page.meshes) {
      this.learnMesh(i, page.blob);
      for (let s = this.first[i]!; s < this.first[i + 1]!; s++) this.can[s] = this.canDraw(s);
      this.learned.push(i);
    }
    if (this.keepAll) this.keepParts(page.meshes, page.textures, false);
    return true;
  }

  /** Whether a level can be drawn with its materials at all: it has a surface, and its materials' base colours and masks can be had. */
  private canDraw(slot: number): number {
    const runs = this.runs[slot]!;
    let can = this.size[this.levels + slot]! > 0 && runs.length > 0;
    for (let k = 0; k < runs.length; k += 3) {
      for (const r of NEEDED) {
        const t = this.matTex[runs[k]! * MAPS + r]!;
        can &&= t < 0 || this.limit[t]! >= 0;
      }
    }
    return can ? 1 : 0;
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
    let bytes = this.size[slot]!;
    if (slot >= this.pageBase) for (let k = 1; k <= this.run[slot - this.pageBase]!; k++) bytes += this.size[slot + k]!;
    return bytes + (slot < this.levels && this.state[this.levels + slot] === RIDING ? this.size[this.levels + slot]! : 0);
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
    } else if (this.isTexture(slot)) {
      this.texComing -= this.size[slot]!;
      this.settle(slot - this.texBase);
    } else if (slot >= this.pageBase) {
      for (let k = 1; k <= this.run[slot - this.pageBase]!; k++) this.state[slot + k] = ABSENT;
      this.run[slot - this.pageBase] = 0;
    }
  }

  private isTexture(slot: number): boolean {
    return slot >= this.texBase && slot < this.clipBase;
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
    this.now = nowMs;
    this.spent = 0;
    this.wants.length = 0;
    this.unlink(this.mark);
    this.toTail(this.mark);
    this.unlink(this.texMark);
    this.toTail(this.texMark, this.texRoot);
    this.texMarked = 0;
    if (this.format !== this.made) this.remake();
    this.learned.length = 0;
    if (!this.port) return;
    const shared = this.port.protocol === "h2" || this.port.protocol.startsWith("h3");
    this.inFlight = shared ? IN_FLIGHT_SHARED : IN_FLIGHT;
    this.smallLanes = shared ? SMALL_LANES_SHARED : SMALL_LANES;
    const n = this.port.take(this.arrivals);
    for (let i = 0; i < n; i++) {
      const a = this.arrivals[i]!;
      const slot = a.slot;
      // A previous variant can already be in the worker's outgoing queue when the slot is reused.
      if (this.state[slot] !== LOADING || a.generation !== this.generation[slot]) continue;
      this.land(slot);
      this.stats.fetched += a.fetched;
      this.stats.cached += a.cached;
      const rider = slot < this.levels && this.state[this.levels + slot] === RIDING ? this.levels + slot : -1;
      // A port that brings fewer bytes than were asked for has failed, whatever it says.
      if (a.data && a.data.length === this.asked(slot)) {
        this.tries[slot] = 0;
        if (slot >= this.pageBase) {
          // The pages of a request come one after another, each as long as it is.
          for (let k = 0, at = 0; k <= this.run[slot - this.pageBase]!; k++) {
            const page = a.data.subarray(at, (at += this.size[slot + k]!));
            this.state[slot + k] = this.learnPage(slot + k - this.pageBase, page) ? RESIDENT : DEAD;
            if (this.state[slot + k] === DEAD) this.stats.dead++;
          }
          this.run[slot - this.pageBase] = 0;
          continue;
        }
        if (slot >= this.clipBase) {
          this.clipSets[slot - this.clipBase] = skeletonClips(this.manifest.clips![slot - this.clipBase]!, a.data);
          this.state[slot] = RESIDENT;
          continue;
        }
        this.data[slot] = rider < 0 ? a.data : a.data.subarray(0, this.size[slot]!);
        this.state[slot] = ARRIVED;
        this.waiting += this.size[slot]!;
        if (rider >= 0) {
          this.data[rider] = a.data.subarray(this.size[slot]!);
          this.state[rider] = ARRIVED;
          this.waiting += this.size[rider]!;
          this.under.push(rider);
        }
        continue;
      }
      this.undo(slot);
      if (a.fail === FAIL_HASH) this.stats.failHash++;
      else if (a.fail === FAIL_RANGE) this.stats.failRange++;
      else {
        this.stats.failNet++;
        this.stats.lastStatus = a.status ?? 0;
      }
      if (a.fail === FAIL_RANGE || (a.fail === FAIL_HASH && this.rehashed[slot] === 1)) {
        // The manifest is wrong about it, or its bytes are wrong twice. Asking again would change nothing.
        this.stats.dead++;
        if (rider >= 0) {
          // Which of the two is wrong is not known. The surface is given up, and the level is asked for alone.
          this.state[rider] = DEAD;
          this.state[slot] = ABSENT;
          this.rehashed[slot] = 0;
        } else if (this.isTexture(slot)) {
          // The texture stays at the step before.
          this.limit[slot - this.texBase] = this.goal[slot - this.texBase]! - 1;
          this.state[slot] = ABSENT;
          this.rehashed[slot] = 0;
          if (this.goal[slot - this.texBase] === 0) for (let s = 0; s < this.levels; s++) this.can[s] = this.canDraw(s);
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

  /** Says a level is wanted this frame, and how urgently against the others: its mesh's page, where that has not come. */
  want(mesh: number, level: number, urgency: number): void {
    if (this.knownMesh[mesh] === 1) this.wantSlot(this.first[mesh]! + level, urgency);
    else this.wantSlot(this.pageBase + this.pageOf[mesh]!, PAGE_FIRST + urgency);
  }

  /** Whether a mesh's row is here, to be drawn and to say what it is drawn with. Where not, its page is wanted. */
  known(mesh: number): boolean {
    if (this.knownMesh[mesh] === 1) return true;
    this.want(mesh, 0, 0);
    return false;
  }

  /** Says the surface of a level is wanted this frame too. False, with nothing wanted, where there are no textures or the level is never drawn with materials. */
  wantSurface(mesh: number, level: number, urgency: number): boolean {
    const slot = this.first[mesh]! + level;
    if (this.cap < 0 || this.can[slot] === 0) return false;
    this.wantSlot(this.levels + slot, urgency);
    return true;
  }

  /** Says the clips of the manifest's skeleton `c` are wanted. They are asked for at once, as a body without them stands at rest. */
  wantClips(c: number): void {
    const slot = this.clipBase + c;
    this.seen[slot] = this.frame;
    this.urgency[slot] = FIRST;
    if (this.state[slot] === ABSENT && this.port && this.retryAt[slot]! <= this.now) this.ask(slot, -1, 0);
  }

  /** The clips of the manifest's skeleton `c`, or null until they have come. */
  clips(c: number): ClipSet | null {
    return this.clipSets[c]!;
  }

  /**
   * Says a material is on screen this frame, a whole texture of it covering `pixels` pixels on something `distance`
   * metres off. Each of its textures is kept, and wanted at the first step that is as wide as it is shown: as far
   * under the material's widest as it was authored, and no wider than the tier allows. Only its first `roles` maps are
   * wanted where fewer are read. `needed` says each of them is one the material is not drawn without, as the world's
   * finishes' every map is, so each one's first step is as urgent as a base colour's.
   */
  material(m: number, pixels: number, distance: number, roles = MAPS, needed = false): void {
    if (this.cap < 0) return;
    this.matSeen[m] = this.frame;
    const most = STEP0_SIZE << (this.matTop[m]! < this.cap ? this.matTop[m]! : this.cap);
    const shown = pixels < most ? pixels : most;
    for (let r = 0; r < roles; r++) {
      const t = this.matTex[m * MAPS + r]!;
      if (t >= 0) this.texture(t, shown / (1 << this.matUnder[m * MAPS + r]!), WEIGHT[r]! / distance, needed || r === 0 || r >= 3);
    }
  }

  /**
   * Says a material's hurt and decay layer is on screen, as `material` says of its maps: a body drawn with it is hurt or
   * dead. It is wanted as wide as its base colour is, up to its own top, however much smaller it was stored: its marks
   * are thin lines, which a coarser step swells. Its first step is as urgent as what a material is not drawn without.
   * False for a material with no layer.
   */
  layer(m: number, pixels: number, distance: number): boolean {
    const t = this.matLayer[m]!;
    if (this.cap < 0 || t < 0) return false;
    const most = STEP0_SIZE << (this.matTop[m]! < this.cap ? this.matTop[m]! : this.cap);
    this.texture(t, pixels < most ? pixels : most, 1 / distance, true);
    return true;
  }

  /** Whether a material's layer can be drawn with this frame. */
  layered(m: number): boolean {
    const t = this.matLayer[m]!;
    return t >= 0 && this.has[t]! >= 0;
  }

  /** Whether texture `t` (its index in the manifest) can be had at all: false with no network to bring it. */
  canHave(t: number): boolean {
    return this.limit[t]! >= 0;
  }

  /** How many textures that can be had were shown this frame with no step of them on the card. */
  bare(): number {
    let n = 0;
    for (let t = 0; t < this.has.length; t++) if (this.has[t]! < 0 && this.limit[t]! >= 0 && this.seen[this.texBase + t] === this.frame) n++;
    return n;
  }

  /** The last step of texture `t` (its index in the manifest) the card holds, or -1 for none. */
  holds(t: number): number {
    return this.has[t]!;
  }

  /** The card is to let go of texture `t` whole, as of this frame, and take it again from its first step. */
  again(t: number): void {
    if (this.has[t]! >= 0 || this.gone[t]! > 0) this.late.push(t);
    this.letGo(t);
  }

  /**
   * A texture shown `px` pixels across. Its first step is as urgent as FIRST where `first`, else its pixels times `weight`;
   * after it, the climb to the step it is shown at is as urgent as the pixels that adds, times `weight`, for each
   * CLIMB_BYTES of the climb.
   */
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
    let urgency: number;
    if (have < 0) urgency = first ? FIRST * (1 + weight) : STEP0_SIZE * weight;
    else {
      const want = stepFor(px, this.limit[t]!);
      if (want <= have) return;
      const top = STEP0_SIZE << want;
      urgency = (((px < top ? px : top) - (STEP0_SIZE << have)) * weight * CLIMB_BYTES) / (this.through[t * STEPS + want]! - this.through[t * STEPS + have]!);
    }
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
    if (slot < this.levels && this.apart[slot] === 1) return false;
    if (this.drawn[slot] === 0) {
      this.drawn[slot] = 1;
      if (this.inBoot[slot] === 0) this.stats.used += this.size[slot]!;
    }
    return true;
  }

  /**
   * The level of `mesh` to draw when `wanted` is asked for: that level if it is resident, else the next coarser that
   * is, else the nearest finer. -1 if there is none, which once its row is here can be only for a landmark's far mesh,
   * which holds no level in the boot file (shared/pack/far.ts).
   */
  level(mesh: number, wanted: number): number {
    if (!this.known(mesh)) {
      this.stats.skipped++;
      return -1;
    }
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

  /** Bit l for each level of `mesh` the card holds or can take from the boot pack or its page: what can be drawn without fetching. */
  held(mesh: number): number {
    let bits = 0;
    const base = this.first[mesh]!;
    for (let s = base; s < this.first[mesh + 1]!; s++) if ((this.state[s] === RESIDENT && this.apart[s] === 0) || this.inBoot[s] === 1) bits |= 1 << (s - base);
    return bits;
  }

  /** Whether a held level's cut-out sections can be drawn into a depth map without fetching: its surface is held and its materials' base colours are on the card. */
  heldCutouts(mesh: number, level: number): boolean {
    const slot = this.first[mesh]! + level;
    const s = this.levels + slot;
    if (this.cap < 0 || this.can[slot] === 0 || (this.state[s] !== RESIDENT && this.inBoot[s] === 0)) return false;
    const runs = this.runs[slot]!;
    for (let k = 0; k < runs.length; k += 3) {
      const t = this.matTex[runs[k]! * MAPS]!;
      if (t >= 0 && this.has[t]! < 0) return false;
    }
    return true;
  }

  /** Keeps a held level on the card through this frame, as a draw of it does, and with `cutouts` its surface and its materials' base colours. */
  keep(mesh: number, level: number, cutouts: boolean): void {
    const slot = this.first[mesh]! + level;
    this.usable(slot);
    if (!cutouts) return;
    this.usable(this.levels + slot);
    const runs = this.runs[slot]!;
    for (let k = 0; k < runs.length; k += 3) {
      const t = this.matTex[runs[k]! * MAPS]!;
      const at = this.texBase + t;
      if (t < 0 || this.seen[at] === this.frame) continue;
      this.seen[at] = this.frame;
      this.urgency[at] = 0;
      this.px[t] = 0;
      this.unlink(at);
      this.toTail(at, this.texRoot);
      this.texMarked += this.through[t * STEPS + this.has[t]!]!;
    }
  }

  /** The level of a level's slot or of its surface's. */
  private levelAt(slot: number): ManifestLevel {
    const of = slot < this.levels ? slot : slot - this.levels;
    return this.manifest.meshes[this.meshOf[of]!]!.levels[this.levelOf[of]!]!;
  }

  /**
   * A level of a mesh as the boot pack or its page holds it, or null where neither does: its vertices in metres from the
   * mesh's origin, as the flat programs place them, their palette colours, and its triangles' corners.
   */
  heldGeometry(mesh: number, level: number): { positions: Float32Array; colors: Uint8Array; indices: Uint32Array } | null {
    const slot = this.slot(mesh, level);
    const data = level < this.manifest.meshes[mesh]!.levels.length ? this.heldBytes[slot] : null;
    if (!data) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const { tris, index } = this.levelAt(slot);
    const indices = new Uint32Array(tris * 3);
    for (let i = 0; i < indices.length; i++) indices[i] = index === 4 ? view.getUint32(i * 4, true) : view.getUint16(i * 2, true);
    const from = (indices.length * index + 3) & ~3;
    const n = (data.length - from) / VERTEX_BYTES;
    const { center, half } = this.manifest.meshes[mesh]!;
    const positions = new Float32Array(n * 3);
    const colors = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      for (let a = 0; a < 3; a++) positions[v * 3 + a] = center[a]! + (Math.max(-32767, view.getInt16(from + v * VERTEX_BYTES + a * 2, true)) / 32767) * half[a]!;
      colors[v] = data[from + v * VERTEX_BYTES + 6]!;
    }
    return { positions, colors, indices };
  }

  private upload(slot: number, data: Uint8Array, out: AssetUpload[], at = 0, whole = data.length): void {
    const of = slot < this.levels ? slot : slot - this.levels;
    const level = this.levelAt(of);
    const piece = data.length < whole ? { at, whole } : {};
    if (of === slot) out.push({ slot, mesh: this.meshOf[of]!, level: this.levelOf[of]!, data, indexCount: level.tris * 3, indexBytes: level.index, ...piece });
    else out.push({ slot, mesh: this.meshOf[of]!, level: this.levelOf[of]!, data, indexCount: 0, indexBytes: level.index, of, skinAt: level.parts[1]!.bytes, ...piece });
    this.stats.uploaded += data.length;
  }

  /**
   * Asks the port to keep everything this tier may fetch, so nothing need be fetched while playing: every page, every
   * level that is not held and, where there are textures, its surface and every texture as far as the tier takes it,
   * and every skeleton's clips. A page asked for from now brings its meshes' parts the same way. Returns the bytes
   * asked for of what is known.
   */
  download(): number {
    this.keepAll = true;
    const meshes: number[] = [];
    for (let i = 0; i < this.knownMesh.length; i++) if (this.knownMesh[i] === 1) meshes.push(i);
    return this.keepParts(meshes, Array.from(this.limit, (_, t) => t), true);
  }

  private keepParts(meshes: readonly number[], textures: readonly number[], clips: boolean): number {
    const parts: { file: number; part: AssetPart }[] = [];
    let bytes = 0;
    const add = (file: number, part: AssetPart): void => {
      parts.push({ file, part });
      bytes += part.length;
    };
    for (const i of meshes) {
      for (let slot = this.first[i]!; slot < this.first[i + 1]!; slot++) {
        const level = this.levelAt(slot);
        if (this.inBoot[slot] === 0) for (const p of levelParts(level, 0, 1)) add(level.file, p);
        if (this.cap < 0 || this.inBoot[this.levels + slot] === 1) continue;
        for (const p of levelParts(level, 1, level.parts.length)) add((level.surface ?? level).file, p);
      }
    }
    if (clips) for (const e of this.manifest.clips ?? []) add(e.file, wholePart(e));
    if (this.cap >= 0) {
      // A texture is taken as far as the material that shows it widest would.
      const most = new Int8Array(this.has.length).fill(-1);
      for (let k = 0; k < this.matTex.length; k++) {
        const t = this.matTex[k]!;
        if (t >= 0) most[t] = Math.max(most[t]!, Math.min(this.limit[t]!, Math.max(0, Math.min(this.cap, this.matTop[Math.floor(k / MAPS)]!) - this.matUnder[k]!)));
      }
      for (const t of textures) {
        const tex = this.manifest.textures![t]!;
        const v = tex.in[this.made];
        if (v && most[t]! >= 0) for (const p of textureParts(tex, this.made, most[t]!)) add(v.file, p);
      }
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
    this.stats.refused++;
    this.restart(slot);
    if (this.state[slot] !== RESIDENT) return;
    if (this.inBoot[slot] === 0) this.unlink(slot);
    this.state[slot] = ABSENT;
    this.ledger -= this.size[slot]!;
  }

  /** The graphics card could not take a texture it was sent, and has dropped all it had of it. `texture` is as in `texUploads`. */
  failedTexture(texture: number): void {
    this.stats.refused++;
    this.letGo(texture);
  }

  /** Ends a frame: `uploads`, `drops` and the same for textures are what the graphics card must do before it draws this frame, the drops first. */
  end(uploads: AssetUpload[], drops: number[], texUploads: TextureUpload[], texDrops: number[], nowMs: number): void {
    for (const slot of this.fromBoot) this.upload(slot, this.heldBytes[slot]!, uploads);
    this.fromBoot.length = 0;
    for (const t of this.late) texDrops.push(t);
    this.late.length = 0;
    if (!this.port) return;
    if (this.keepAll) for (let slot = this.pageBase; slot < this.size.length; slot++) this.wantSlot(slot, 0);

    // What nobody wants any longer is given up, on its way or arrived, but for a page, which every mesh of it needs. What the card has begun is finished.
    let kept = 0;
    for (const slot of this.under) {
      const idle = slot < this.pageBase && this.frame - this.seen[slot]! > IDLE_FRAMES;
      if (this.state[slot] === LOADING && idle) {
        this.port.cancel(slot);
        this.land(slot);
        this.undo(slot);
        this.state[slot] = ABSENT;
        this.stats.cancelled++;
      } else if (this.state[slot] === ARRIVED && idle && (slot < this.texBase ? this.given[slot] : this.gone[slot - this.texBase]) === 0) {
        if (slot >= this.levels && slot < this.texBase) this.apart[slot - this.levels] = 0;
        this.data[slot] = null;
        this.waiting -= this.size[slot]!;
        this.undo(slot);
        this.state[slot] = ABSENT;
        this.stats.wasted += this.size[slot]!;
      }
      if (this.state[slot] === LOADING || this.state[slot] === ARRIVED) this.under[kept++] = slot;
    }
    this.under.length = kept;

    // What has arrived goes on the card, what it has begun of a level first and then the most urgent, within what the
    // frame's bytes have left. Something always goes.
    const urgent = (slot: number): number => (slot < this.texBase && this.given[slot]! > 0 ? Infinity : this.seen[slot] === this.frame ? this.urgency[slot]! : -1);
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
      // A level or a surface that would pass what the frame has left goes in pieces of what is left, over the frames
      // that follow, and with nothing left one small part goes. A surface goes up with its level where the two fit,
      // or after it.
      const left = this.uploadBytes - sent;
      const room = left > 0 ? left : sent > this.spent ? 0 : SMALL_PART;
      if ((slot >= this.levels && this.state[slot - this.levels] !== RESIDENT) || room === 0) {
        this.under[kept++] = slot;
        continue;
      }
      let pair = slot < this.levels && this.given[slot] === 0 && this.state[this.levels + slot] === ARRIVED ? this.levels + slot : -1;
      if (pair >= 0 && this.size[slot]! + this.size[pair]! > room) pair = -1;
      if (this.given[slot] === 0) {
        const bytes = this.size[slot]! + (pair < 0 ? 0 : this.size[pair]!);
        this.makeRoom(bytes, drops);
        // What this frame draws already fills the card past its overflow. It waits, and everything is asked for coarser.
        if (this.ledger + bytes > this.budget * OVERFLOW) this.full = true;
        if (this.ledger + bytes > this.budget * OVERFLOW || (slot >= this.levels && this.state[slot - this.levels] !== RESIDENT)) {
          this.under[kept++] = slot;
          continue;
        }
      }
      sent += this.take(slot, uploads, room);
      if (pair >= 0) sent += this.take(pair, uploads, room);
      if (this.state[slot] === ARRIVED) this.under[kept++] = slot;
      else if (pair < 0 && slot < this.levels && this.state[this.levels + slot] === ARRIVED) this.apart[slot] = 1;
    }
    this.under.length = kept;

    for (const slot of this.wants.sort(byUrgency)) {
      if (this.flying >= this.inFlight || this.waiting >= WAITING_LIMIT) break;
      if (this.state[slot] !== ABSENT || this.retryAt[slot]! > nowMs) continue;
      let bytes = this.size[slot]!;
      let rider = -1;
      let goal = 0;
      if (this.isTexture(slot)) {
        // A texture comes at its first step, then climbs in one request to the step it is shown at, and only into room
        // that is not spoken for.
        const t = slot - this.texBase, have = this.has[t]!;
        goal = have < 0 ? 0 : Math.max(have + 1, stepFor(this.px[t]!, this.limit[t]!));
        bytes = this.through[(slot - this.texBase) * STEPS + goal]!;
        if (this.texMarked + this.texComing + bytes > this.texBudget) {
          this.short = true;
          continue;
        }
      } else if (slot >= this.levels && slot < this.texBase) {
        // A surface is asked for by itself when its level is here or coming. Otherwise it comes in its level's request.
        const level = this.state[slot - this.levels]!;
        if (level !== LOADING && level !== ARRIVED && level !== RESIDENT) continue;
      } else if (slot < this.levels) {
        // A surface that follows its level in the file comes with it, so that the two arrive together.
        const s = this.levels + slot;
        if (this.seen[s] === this.frame && this.state[s] === ABSENT && this.retryAt[s]! <= nowMs && !this.levelAt(slot).surface) {
          rider = s;
          bytes += this.size[s]!;
        }
      }
      if (bytes > SMALL_PART && this.flyingLarge >= this.inFlight - this.smallLanes) continue;
      if (slot >= this.pageBase) this.askPages(slot, nowMs);
      else this.ask(slot, rider, goal);
    }
    if ((this.short || this.texLedger > this.texBudget) && this.shrinking === 0 && this.flying < this.inFlight && this.waiting < WAITING_LIMIT) this.shrink(nowMs);

    this.texRoom(0, this.texBudget, texDrops);
    this.makeRoom(0, drops);
    if (this.full || this.ledger > this.budget * OVERFLOW) this.relax *= 1.02;
    else if (this.relax > 1 && this.ledger < this.budget * 0.7) this.relax = Math.max(1, this.relax / 1.02);
  }

  /** Asks for a page with the pages wanted this frame that lie next to it in its file, as many as a small part's bytes allow. */
  private askPages(slot: number, nowMs: number): void {
    const pages = this.manifest.pages!;
    /** Whether page `q`, wanted and not yet asked for, joins page `p` that lies before or after it. */
    const joins = (q: number, p: number): boolean => {
      const s = this.pageBase + q;
      const [a, b] = q < p ? [pages[q]!, pages[p]!] : [pages[p]!, pages[q]!];
      return this.seen[s] === this.frame && this.state[s] === ABSENT && this.retryAt[s]! <= nowMs && bytes + this.size[s]! <= SMALL_PART && a.file === b.file && a.at + storedBytes(a.part) === b.at;
    };
    let first = slot - this.pageBase, last = first, bytes = this.size[slot]!;
    while (first > 0 && joins(first - 1, first)) bytes += this.size[this.pageBase + --first]!;
    while (last + 1 < pages.length && joins(last + 1, last)) bytes += this.size[this.pageBase + ++last]!;
    this.run[first] = last - first;
    for (let q = first + 1; q <= last; q++) this.state[this.pageBase + q] = RIDING;
    this.ask(this.pageBase + first, -1, 0);
  }

  /** Asks the port for a level, with its surface if `rider` is that, for a surface, for steps 0 to `goal` of a texture, or for clips or pages. */
  private ask(slot: number, rider: number, goal: number): void {
    const parts: AssetPart[] = [];
    let file: number;
    if (slot >= this.pageBase) {
      const first = slot - this.pageBase;
      file = this.manifest.pages![first]!.file;
      for (let q = first; q <= first + this.run[first]!; q++) parts.push(wholePart(this.manifest.pages![q]!));
    } else if (slot >= this.clipBase) {
      const e = this.manifest.clips![slot - this.clipBase]!;
      file = e.file;
      parts.push(wholePart(e));
    } else if (slot >= this.texBase) {
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
    this.generation[slot]++;
    this.port!.request({ slot, generation: this.generation[slot], file, parts, priority: this.urgency[slot]!, fresh: this.rehashed[slot] === 1 });
    this.state[slot] = LOADING;
    this.flying++;
    if (this.asked(slot) > SMALL_PART) this.flyingLarge++;
    this.under.push(slot);
    this.stats.requests++;
  }

  /**
   * A level or a surface that has arrived goes on the card, as much of it as `room` allows from where it was left: the
   * card holds the whole from its first piece, and draws it once the last has gone. Returns the bytes sent.
   */
  private take(slot: number, uploads: AssetUpload[], room: number): number {
    const at = this.given[slot]!;
    const size = this.size[slot]!;
    const bytes = Math.min(size - at, room);
    if (at === 0) this.ledger += size;
    this.upload(slot, this.data[slot]!.subarray(at, at + bytes), uploads, at, size);
    this.given[slot] = at + bytes < size ? at + bytes : 0;
    if (at + bytes < size) return bytes;
    this.apart[slot < this.levels ? slot : slot - this.levels] = 0;
    this.data[slot] = null;
    this.state[slot] = RESIDENT;
    this.waiting -= size;
    this.toTail(slot);
    return bytes;
  }

  /** The card lets go of what it had begun of a level or a surface, which is begun again. */
  private restart(slot: number): void {
    if (this.given[slot] === 0) return;
    this.given[slot] = 0;
    this.ledger -= this.size[slot]!;
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
    const block = blockOf(this.made, tex.in[this.made]!);
    let at = this.gone[t]!;
    if (at === 0) {
      // A copy is begun in a frame that has bytes left for its first row.
      if (sent > this.spent && sent + pictureBytes(this.made, tex.role, 1, block) > this.uploadBytes) return sent;
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
    for (let bytes = pictureBytes(this.made, tex.role, side, block); start + bytes <= at; bytes = pictureBytes(this.made, tex.role, (side <<= 1), block)) start += bytes;
    while (at < whole) {
      // Rows of blocks, which are rows of pixels in rgba.
      const rows = Math.ceil(side / block);
      const rowBytes = pictureBytes(this.made, tex.role, side, block) / rows;
      const row = (at - start) / rowBytes;
      let n = Math.floor((this.uploadBytes - sent) / rowBytes);
      if (n <= 0) {
        if (sent > this.spent) break;
        n = 1;
      }
      if (n > rows - row) n = rows - row;
      const bytes = n * rowBytes;
      out.push({ slot: t, role: tex.role, format: this.made, block, top: STEP0_SIZE << goal, size: side, row: row * block, rows: Math.min(n * block, side - row * block), data: data.subarray(at, at + bytes), last: at + bytes === whole });
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
    if (this.texMarked + this.texComing + bytes > this.texBudget * OVERFLOW || (bytes > SMALL_PART && this.flyingLarge >= this.inFlight - this.smallLanes)) return;
    this.down[best] = 1;
    this.shrinking++;
    this.ask(this.texBase + best, -1, to);
  }

  /** Lets go of the least lately drawn levels and surfaces until `bytes` more fit in the budget. What this frame drew stays. */
  private makeRoom(bytes: number, drops: number[]): void {
    while (this.ledger + bytes > this.budget) {
      const slot = this.next[this.root]!;
      if (slot === this.mark) break;
      // A surface is no use without its level, and goes first, or what the card had of it.
      if (slot < this.levels && this.state[this.levels + slot] === RESIDENT) this.evict(this.levels + slot, drops);
      if (slot < this.levels) this.restart(this.levels + slot);
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

  /** The graphics card has lost everything. What had arrived and what is on its way are kept, and clips, which were never on it. */
  reset(): void {
    for (let slot = 0; slot < this.clipBase; slot++) if (this.state[slot] === RESIDENT) this.state[slot] = ABSENT;
    for (let t = 0; t < this.has.length; t++) {
      this.has[t] = -1;
      // A copy the card had begun is begun again.
      this.waiting += this.gone[t]!;
      this.gone[t] = 0;
      this.settle(t);
    }
    this.given.fill(0);
    this.ledger = this.texLedger = 0;
    this.fromBoot.length = 0;
    this.empty();
  }
}
