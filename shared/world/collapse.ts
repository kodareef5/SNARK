// A collapse, worked out as one thing.
//
// When a piece goes, what it was helping to hold up is in doubt. Deciding
// that piece by piece, each question starting again from nothing, costs most
// exactly when most is falling. So a collapse is worked out over a picture of
// the pieces that is made once and shared (shared/world/support.ts), a ring
// at a time:
//
//   1. Everything within reach of what has just gone is in doubt, nearest to
//      where support was first lost first, and the lower of two first. So is
//      everything within reach of whatever stood straight on it, however
//      high: those may stay up, held some other way, but nothing can lean on
//      them as it did.
//   2. Each call judges as many of those as its allowance of work lets it.
//   3. What it found with nothing to hold it falls at the end of the call, as
//      one removal, and what was within reach of that is in doubt in turn.
//
// A piece found to stand is looked at again whenever something near it goes,
// so falling early is never wrong: it only ever leaves less standing. The
// work is counted and each call does only so much: a question that runs out
// of allowance part way is put off and asked again, the pictures it made
// kept. So a great collapse takes more ticks and never a longer one. Seen
// from outside it spreads from where support was lost.
//
// A piece may go with a claim on it: a number the caller gives, which follows
// the collapse outward. What comes down under a claim is not let fall: the
// caller is told of each such piece first (`onClaim`), and it is then simply
// taken away. That is how what stood on a piece somebody picked up comes back
// to their hands instead of breaking.
//
// Authority only: this removes structures.

import type { PieceTables } from "./snap.ts";
import { GONE_FELL, GONE_TAKEN, type StructureStore } from "./structures.ts";
import { COST_NODE, Support, type SupportNode } from "./support.ts";

/** Lattice positions are told apart by x and z together: z is less than this. */
const KEY = 4194304;

/** The most pieces one call takes down as one removal; more go in the next. */
const WAVE_MAX = 1024;

export class Collapse {
  /** Pieces that have fallen, removals they went in, and collapses that have run their course. */
  fallen = 0;
  waves = 0;
  settled = 0;
  /** Pieces that came down under a claim, and were taken away rather than let fall. */
  claimed = 0;
  /**
   * Called with a piece about to come down under a claim, and the claim,
   * while its row can still be read. True if the claim takes it; false and it
   * falls like any other.
   */
  onClaim: ((ref: number, claim: number) => boolean) | null = null;
  /** The work the last call did, in the units its allowance is given in. */
  spent = 0;
  /** Called with a piece about to fall, while its row can still be read. */
  onFall: ((ref: number) => void) | null = null;
  private readonly structs: StructureStore;
  private readonly tables: PieceTables;
  private readonly graph: Support;
  /**
   * Pieces whose surroundings have yet to be put in doubt, as the pictures
   * made of them: those that have gone, and those left without what they
   * stood straight on.
   */
  private readonly lost: SupportNode[] = [];
  private readonly lostBy: number[] = [];
  private drawn = 0;
  /** Places whose surroundings have been put in doubt since anything was last judged; and the number those pieces are marked with. */
  private readonly drew = new Set<number>();
  private batch = 1;
  /** Where this collapse began: where support was first lost. Metres. */
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private running = false;
  /** The pieces in doubt, in the order they will be judged, and how far through them the judging is. */
  private doubt: number[] = [];
  private doubtBy: number[] = [];
  private at = 0;
  private readonly inDoubt = new Set<number>();
  /** Those judged, in this call, to have nothing under them. */
  private readonly falling = new Uint32Array(WAVE_MAX);
  private readonly fallingBy = new Uint16Array(WAVE_MAX);
  private readonly taking = new Uint32Array(WAVE_MAX);
  private fell = 0;
  private removing = false;
  private readonly scratch = new Uint32Array(1024);
  private readonly fresh: number[] = [];
  private readonly rank = new Map<number, number>();

  constructor(structs: StructureStore, tables: PieceTables, heightAt: (x: number, z: number) => number) {
    this.structs = structs;
    this.tables = tables;
    this.graph = new Support(structs, tables, heightAt);
  }

  /**
   * A piece is going, for any reason but falling: call before its row is
   * erased. What it may have been holding up will be looked at. With a
   * `claim` (1 to 65535), whatever comes down because of it is the claim's.
   */
  gone(ref: number, claim = 0): void {
    // What this is itself taking away is already accounted for.
    if (this.removing) return;
    const t = this.structs.chunks[Math.floor(ref / 65536)]!;
    const slot = ref & 0xffff;
    if (this.tables.role[t.kind[slot]!]! < 0) return;
    const node = this.graph.node(ref);
    if (!node) return;
    if (!this.running) {
      this.running = true;
      this.ox = t.x[slot]!;
      this.oy = t.y[slot]!;
      this.oz = t.z[slot]!;
    }
    this.lost.push(node);
    this.lostBy.push(claim);
    // What stood straight up on it does so no longer.
    this.graph.again();
  }

  /** Something was built: the picture of the pieces around it is out of date. */
  built(): void {
    if (this.running) this.graph.forget();
  }

  /** Whether anything is still being worked out. */
  get busy(): boolean {
    return this.running;
  }

  /** Pieces in doubt and still to be judged, and places whose surroundings are still to be put in doubt. */
  get pending(): number {
    return this.doubt.length - this.at + this.lost.length - this.drawn;
  }

  /**
   * Do up to `budget` units of work (a search step is one, the picture of a
   * piece about two dozen), then let fall what was found to have nothing
   * under it. `stamp` is the clock the removal is marked with. Returns how
   * many pieces fell.
   */
  step(budget: number, stamp: number): number {
    if (!this.running) return 0;
    const graph = this.graph;
    graph.work = 0;
    graph.limit = budget;
    while (graph.work < budget && this.fell < WAVE_MAX) {
      if (this.drawn < this.lost.length) {
        this.draw();
        continue;
      }
      if (this.at === this.doubt.length) break;
      // Judging begins again: what is drawn after this is drawn afresh.
      if (this.drew.size > 0) {
        this.drew.clear();
        this.batch++;
      }
      const ref = this.doubt[this.at]!;
      const node = graph.node(ref);
      graph.work++;
      const stands = node === null || graph.standsNode(node);
      // Out of allowance in the middle of the question: it is asked again next time, and gets further.
      if (node !== null && graph.cut) break;
      this.inDoubt.delete(ref);
      if (!stands) {
        this.fallingBy[this.fell] = this.doubtBy[this.at]!;
        this.falling[this.fell++] = ref;
      }
      this.at++;
    }
    // Done with what has been judged: it is not kept.
    if (this.at > 4096) {
      this.doubt = this.doubt.slice(this.at);
      this.doubtBy = this.doubtBy.slice(this.at);
      this.at = 0;
    }
    this.spent = graph.work;
    if (this.fell > 0) return this.fall(stamp);
    if (this.drawn === this.lost.length && this.at === this.doubt.length) {
      // Nothing left in doubt: it has run its course.
      this.lost.length = this.lostBy.length = this.drawn = 0;
      this.doubt.length = this.doubtBy.length = this.at = 0;
      this.inDoubt.clear();
      this.drew.clear();
      graph.forget();
      this.running = false;
      this.settled++;
    }
    return 0;
  }

  /**
   * Put in doubt everything within reach of the next piece that went or lost
   * its footing, nearest the start of the collapse first; and note what stood
   * directly on it, which has lost its footing in turn.
   */
  private draw(): void {
    const graph = this.graph;
    const by = this.lostBy[this.drawn]!;
    const from = this.lost[this.drawn++]!;
    for (const ref of from.over) {
      const o = graph.node(ref);
      graph.work++;
      if (!o || o.mark === this.batch) continue;
      o.mark = this.batch;
      this.lost.push(o);
      this.lostBy.push(by);
    }
    if (this.drawn === this.lost.length) this.lost.length = this.lostBy.length = this.drawn = 0;
    // A column of pieces is one place.
    const key = from.x * KEY + from.z;
    if (this.drew.has(key)) return;
    this.drew.add(key);
    const n = graph.dependents(from.x, from.z, -1, this.scratch);
    const fresh = this.fresh;
    const rank = this.rank;
    fresh.length = 0;
    const ox = this.ox;
    const oz = this.oz;
    for (let i = 0; i < n; i++) {
      const ref = this.scratch[i]!;
      if (this.inDoubt.has(ref)) continue;
      this.inDoubt.add(ref);
      const t = this.structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const dx = t.x[slot]! - ox;
      const dz = t.z[slot]! - oz;
      // By how far off it is, to the nearest half metre; of those as far, the lower first.
      rank.set(ref, Math.round(Math.sqrt(dx * dx + dz * dz) * 2) * 4096 + t.y[slot]!);
      fresh.push(ref);
    }
    fresh.sort((a, b) => rank.get(a)! - rank.get(b)!);
    for (const ref of fresh) {
      this.doubt.push(ref);
      this.doubtBy.push(by);
    }
    rank.clear();
  }

  /**
   * Let fall, as one removal, what this call found with nothing under it;
   * what is under a claim is taken away instead. Where each was is somewhere
   * a piece has gone from.
   */
  private fall(stamp: number): number {
    let falls = 0;
    let takes = 0;
    for (let i = 0; i < this.fell; i++) {
      const ref = this.falling[i]!;
      const by = this.fallingBy[i]!;
      const taken = by !== 0 && this.onClaim !== null && this.onClaim(ref, by);
      if (!taken) this.onFall?.(ref);
      const node = this.graph.node(ref);
      if (node) {
        this.lost.push(node);
        this.lostBy.push(by);
      }
      if (taken) this.taking[takes++] = ref;
      else this.falling[falls++] = ref;
    }
    this.removing = true;
    const fell = this.structs.removeMany(this.falling, falls, GONE_FELL, this.ox, this.oy, this.oz, stamp);
    const taken = this.structs.removeMany(this.taking, takes, GONE_TAKEN, 0, 0, 0, stamp);
    this.removing = false;
    const removed = fell + taken;
    this.fell = 0;
    this.fallen += fell;
    this.claimed += taken;
    this.waves++;
    // What stood straight up on what fell does so no longer.
    this.graph.again();
    this.graph.work += COST_NODE;
    return removed;
  }
}
