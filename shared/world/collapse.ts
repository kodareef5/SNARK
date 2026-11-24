// Works a collapse out over shared support nodes (support.ts), within a work budget per call, so a large collapse takes more ticks
// and never a longer one. A piece found standing is judged again when a piece near it is removed. Authority only, because it removes structures.

import { CHUNK_SIZE, MAX_CHUNKS_PER_AXIS, STRUCT_UNITS } from "../coords.ts";
import type { PieceTables } from "./snap.ts";
import { Found, GONE_FELL, GONE_TAKEN, type StructureStore } from "./structures.ts";
import { COST_NODE, Support, type SupportNode } from "./support.ts";

/** Packs lattice x and z into one key. z is less than this on the largest map there can be. */
const KEY = MAX_CHUNKS_PER_AXIS * CHUNK_SIZE * STRUCT_UNITS;

/** The most pieces one call removes, whatever it is allowed. The rest go in the next call. */
export const WAVE_MAX = 1024;

export class Collapse {
  /** Pieces fallen, the removals they went in, and collapses finished. */
  fallen = 0;
  waves = 0;
  settled = 0;
  /** Pieces that came down under a claim and were taken instead of falling. */
  claimed = 0;
  /** Removals the collapse now running has made. The next collapse begins at 0. */
  made = 0;
  /** Chunks the collapse now running has lost a piece in, and a count of the changes to that list. */
  readonly chunks = new Set<number>();
  listed = 0;
  /** Called for a piece about to come down under a claim, while its row can still be read. True takes the piece, false lets it fall. */
  onClaim: ((ref: number, claim: number) => boolean) | null = null;
  /** Work the last step() did, in budget units. */
  spent = 0;
  /** Called for a piece about to fall, while its row can still be read. */
  onFall: ((ref: number) => void) | null = null;
  private readonly structs: StructureStore;
  private readonly tables: PieceTables;
  private readonly graph: Support;
  /** Nodes of pieces that were removed or lost their footing, and each one's claim. `drawn` is the next whose surroundings go in doubt. */
  private readonly lost: SupportNode[] = [];
  private readonly lostBy: number[] = [];
  private drawn = 0;
  /** Column keys put in doubt since a piece was last judged, and the mark value of that batch. */
  private readonly drew = new Set<number>();
  private batch = 1;
  /** Where support was first lost. Metres. */
  private ox = 0;
  private oy = 0;
  private oz = 0;
  private running = false;
  /** Refs in doubt in the order they are judged, each one's claim, and the index of the next to judge. */
  private doubt: number[] = [];
  private doubtBy: number[] = [];
  private at = 0;
  private readonly inDoubt = new Set<number>();
  /** Refs this call judged unsupported, and each one's claim. */
  private readonly falling = new Uint32Array(WAVE_MAX);
  private readonly fallingBy = new Uint16Array(WAVE_MAX);
  private readonly taking = new Uint32Array(WAVE_MAX);
  private fell = 0;
  private removing = false;
  private readonly scratch = new Found(1024);
  private readonly fresh: number[] = [];
  private readonly rank = new Map<number, number>();

  constructor(structs: StructureStore, tables: PieceTables, heightAt: (x: number, z: number) => number) {
    this.structs = structs;
    this.tables = tables;
    this.graph = new Support(structs, tables, heightAt);
  }

  /**
   * Call before erasing the row of a piece that is removed for any reason but falling. A `claim` (1 to 65535) follows the collapse
   * outward, and every piece that comes down because of it goes to onClaim.
   */
  gone(ref: number, claim = 0): void {
    // Removals that fall() makes are already accounted for.
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
    this.lose(Math.floor(ref / 65536));
    this.lost.push(node);
    this.lostBy.push(claim);
    // The graph's cached straight-up answers are now stale.
    this.graph.again();
  }

  /** Call when a structure is built. The cached nodes are then out of date. */
  built(): void {
    if (this.running) this.graph.forget();
  }

  get busy(): boolean {
    return this.running;
  }

  /** Refs still to judge plus lost pieces whose surroundings are still to be put in doubt. */
  get pending(): number {
    return this.doubt.length - this.at + this.lost.length - this.drawn;
  }

  /**
   * Does up to `budget` units of work (a search step costs 1, building a node about 24), then removes the pieces found unsupported,
   * `most` of them at most. `stamp` is the clock value the removal is marked with. Returns how many pieces it removed.
   * What is left standing at the end is the same whatever the budget and whatever `most`.
   */
  step(budget: number, stamp: number, most = WAVE_MAX): number {
    if (!this.running) return 0;
    const graph = this.graph;
    graph.work = 0;
    graph.limit = budget;
    const room = most < 1 ? 1 : most > WAVE_MAX ? WAVE_MAX : most;
    while (graph.work < budget && this.fell < room) {
      if (this.drawn < this.lost.length) {
        this.draw();
        continue;
      }
      if (this.at === this.doubt.length) break;
      // Judging resumes, so later draws start a new batch.
      if (this.drew.size > 0) {
        this.drew.clear();
        this.batch++;
      }
      const ref = this.doubt[this.at]!;
      const node = graph.node(ref);
      graph.work++;
      const stands = node === null || graph.standsNode(node);
      // The budget ran out mid-question. The next call asks again and gets further.
      if (node !== null && graph.cut) break;
      this.inDoubt.delete(ref);
      if (!stands) {
        this.fallingBy[this.fell] = this.doubtBy[this.at]!;
        this.falling[this.fell++] = ref;
      }
      this.at++;
    }
    if (this.at > 4096) {
      this.doubt = this.doubt.slice(this.at);
      this.doubtBy = this.doubtBy.slice(this.at);
      this.at = 0;
    }
    this.spent = graph.work;
    if (this.fell > 0) return this.fall(stamp);
    if (this.drawn === this.lost.length && this.at === this.doubt.length) {
      // Nothing is left in doubt. The collapse is over.
      this.lost.length = this.lostBy.length = this.drawn = 0;
      this.doubt.length = this.doubtBy.length = this.at = 0;
      this.inDoubt.clear();
      this.drew.clear();
      graph.forget();
      this.running = false;
      this.settled++;
      this.made = 0;
      if (this.chunks.size > 0) this.listed++;
      this.chunks.clear();
    }
    return 0;
  }

  private lose(chunk: number): void {
    if (this.chunks.has(chunk)) return;
    this.chunks.add(chunk);
    this.listed++;
  }

  /**
   * Goes on with a collapse a save caught midway: `chunks` are those it had lost pieces in, and (x, y, z) where it began.
   * Every piece built in them and in the chunks round them is put in doubt, which is every piece it could still bring down.
   */
  resume(chunks: readonly number[], x: number, y: number, z: number): void {
    const { structs, tables } = this;
    const { chunksX, chunksZ } = structs.dims;
    const near = new Set<number>();
    for (const chunk of chunks) {
      const cx = chunk % chunksX;
      const cz = Math.floor(chunk / chunksX);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (cx + dx >= 0 && cz + dz >= 0 && cx + dx < chunksX && cz + dz < chunksZ) near.add((cz + dz) * chunksX + cx + dx);
    }
    for (const chunk of near) {
      const t = structs.chunks[chunk];
      // The map's own pieces are nobody's and are never judged.
      for (let slot = t ? t.mapped : 0; t && slot < t.high; slot++) {
        const ref = chunk * 65536 + slot;
        if (t.kind[slot] === 0 || tables.role[t.kind[slot]!]! < 0 || this.inDoubt.has(ref)) continue;
        this.inDoubt.add(ref);
        this.doubt.push(ref);
        this.doubtBy.push(0);
      }
    }
    if (this.doubt.length === this.at) return;
    if (!this.running) [this.ox, this.oy, this.oz] = [x, y, z];
    this.running = true;
    for (const chunk of chunks) this.lose(chunk);
  }

  /** Where the collapse now running began, in metres. */
  get origin(): readonly [number, number, number] {
    return [this.ox, this.oy, this.oz];
  }

  /**
   * Puts in doubt every piece within reach of the next lost piece, nearest the start of the collapse first. The pieces that stood
   * directly on it join `lost` in turn.
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
    // Pieces in one column share a key, so a column is drawn once per batch.
    const key = from.x * KEY + from.z;
    if (this.drew.has(key)) return;
    this.drew.add(key);
    const n = graph.dependents(from.x, from.z, -1, this.scratch, from.kind);
    const fresh = this.fresh;
    const rank = this.rank;
    fresh.length = 0;
    const ox = this.ox;
    const oz = this.oz;
    for (let i = 0; i < n; i++) {
      const ref = this.scratch.refs[i]!;
      if (this.inDoubt.has(ref)) continue;
      this.inDoubt.add(ref);
      const t = this.structs.chunks[Math.floor(ref / 65536)]!;
      const slot = ref & 0xffff;
      const dx = t.x[slot]! - ox;
      const dz = t.z[slot]! - oz;
      // Ranked by distance from the start to the nearest half metre, then lower first.
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

  /** Removes the pieces this call found unsupported, as one removal. Claimed pieces are taken instead. Each joins `lost`. */
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
      this.lose(Math.floor(ref / 65536));
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
    this.made++;
    this.graph.again();
    this.graph.work += COST_NODE;
    return removed;
  }
}
