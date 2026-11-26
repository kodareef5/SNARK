// The last LOG_ROWS requests the residency made, for the resource monitor (ui/monitor.ts): what each was for and why it
// was asked, its bytes and where they came from, and its times from asked, to arrived at the page, to on the card. The
// monitor makes it when it is first turned on and hands it to the residency (`Residency.log`), which tells it of each
// request as it asks, as the answer is taken in, and as its bytes go to the card. While the monitor is off the
// residency holds none, and its only cost is a test for it. Columns are typed arrays, written in place: nothing is made
// for a request. Like the inspectors it reads the residency's private fields by name, and is not in the script the
// first frame waits for.

import { slotName } from "./look.ts";
import type { AssetArrival } from "./port.ts";
import type { Residency } from "./residency.ts";

/** Requests kept, a power of two. */
export const LOG_ROWS = 512;

/** What a request is for. */
export const FOR_PAGE = 0, FOR_LEVEL = 1, FOR_SURFACE = 2, FOR_TEXTURE = 3, FOR_CLIPS = 4, FOR_FACES = 5;
/**
 * Why it was asked: rows of meshes (a page), a level, a level with its surface in the same request, a surface alone, a
 * texture's first step, a texture climbing to a larger step, a smaller copy to give room back, a skeleton's clips, a
 * mesh's face table.
 */
export const WHY_PAGE = 0, WHY_LEVEL = 1, WHY_PAIR = 2, WHY_SURFACE = 3, WHY_FIRST = 4, WHY_CLIMB = 5, WHY_SHRINK = 6, WHY_CLIPS = 7, WHY_FACES = 8;
/** Bits of `again`: it failed before and is asked again; its bytes came wrong, and it is asked past the port's cache. */
export const AGAIN_RETRY = 1, AGAIN_FRESH = 2;
/** Where its bytes came from, a bit each. */
export const FROM_NETWORK = 1, FROM_DISK = 2, FROM_MEMORY = 4;
/** How it stands: asked (under way, or given up, which the residency says), arrived and waiting for the card, done (on the card, or taken in for what never goes there), failed. */
export const IS_ASKED = 0, IS_ARRIVED = 1, IS_DONE = 2, IS_FAILED = 3;

export class RequestLog {
  /** Requests written, ever: the latest is at `(rows - 1) % LOG_ROWS`. */
  rows = 0;
  readonly slot = new Int32Array(LOG_ROWS);
  readonly generation = new Uint32Array(LOG_ROWS);
  readonly what = new Uint8Array(LOG_ROWS);
  /** The mesh, texture, skeleton or page it is for (a face table's mesh), and the level or the step asked to (-1 for neither). */
  readonly index = new Int32Array(LOG_ROWS);
  readonly step = new Int8Array(LOG_ROWS);
  readonly why = new Uint8Array(LOG_ROWS);
  readonly again = new Uint8Array(LOG_ROWS);
  /** Bytes asked for, as stored, and of the answer those that came over the network, from the port's disk and from its memory. */
  readonly bytes = new Float64Array(LOG_ROWS);
  readonly fetched = new Float64Array(LOG_ROWS);
  readonly disk = new Float64Array(LOG_ROWS);
  readonly memory = new Float64Array(LOG_ROWS);
  readonly from = new Uint8Array(LOG_ROWS);
  readonly state = new Uint8Array(LOG_ROWS);
  /** Slots still to go to the card: a level and its surface asked together are two. */
  private readonly pending = new Uint8Array(LOG_ROWS);
  /** In ms on the page's clock: asked, taken in by the residency, first bytes handed to the card, the last; NaN for not yet. */
  readonly askedAt = new Float64Array(LOG_ROWS);
  readonly arrivedAt = new Float64Array(LOG_ROWS).fill(NaN);
  readonly sendingAt = new Float64Array(LOG_ROWS).fill(NaN);
  readonly doneAt = new Float64Array(LOG_ROWS).fill(NaN);
  /** The ms the asset worker took over it, from the ask to its answer, where it says; NaN where not. */
  readonly workerMs = new Float32Array(LOG_ROWS).fill(NaN);
  /** By slot, the row of its latest request, -1 for none; a surface that rides in its level's request has the level's row. */
  private readonly rowOf: Int32Array;
  /** Where a level's surface is: a surface slot is `levels` past its level's. */
  private levels = 0;

  constructor(slots: number) {
    this.rowOf = new Int32Array(slots).fill(-1);
  }

  /** The row of the request `back` requests before the latest, or -1 where it is not kept. */
  row(back: number): number {
    return back >= 0 && back < this.rows && back < LOG_ROWS ? (this.rows - 1 - back) % LOG_ROWS : -1;
  }

  /** The row that holds `slot`'s latest request, -1 where it is no longer kept. */
  rowFor(slot: number): number {
    const k = this.rowOf[slot] ?? -1;
    return k >= 0 && (this.slot[k] === slot || (this.why[k] === WHY_PAIR && this.slot[k] === slot - this.levels)) ? k : -1;
  }

  /** The residency has asked for `slot`, with `rider` (its level's surface) or -1, and a texture for steps 0 to `goal`. */
  asked(r: Residency, slot: number, rider: number, goal: number, nowMs: number): void {
    const k = this.rows % LOG_ROWS;
    this.rows++;
    const levels = r["levels"], texBase = r["texBase"], clipBase = r["clipBase"], faceBase = r["faceBase"], pageBase = r["pageBase"];
    this.levels = levels;
    this.slot[k] = slot;
    this.generation[k] = r["generation"][slot]!;
    this.step[k] = -1;
    this.pending[k] = 1;
    if (slot >= pageBase) {
      this.what[k] = FOR_PAGE;
      this.index[k] = slot - pageBase;
      this.why[k] = WHY_PAGE;
    } else if (slot >= faceBase) {
      this.what[k] = FOR_FACES;
      this.index[k] = r["manifest"].faces![slot - faceBase]!.mesh;
      this.why[k] = WHY_FACES;
    } else if (slot >= clipBase) {
      this.what[k] = FOR_CLIPS;
      this.index[k] = slot - clipBase;
      this.why[k] = WHY_CLIPS;
    } else if (slot >= texBase) {
      const t = slot - texBase, had = r["has"][t]!;
      this.what[k] = FOR_TEXTURE;
      this.index[k] = t;
      this.step[k] = goal;
      this.why[k] = had < 0 ? WHY_FIRST : goal < had ? WHY_SHRINK : WHY_CLIMB;
    } else {
      const level = slot < levels ? slot : slot - levels;
      this.what[k] = slot < levels ? FOR_LEVEL : FOR_SURFACE;
      this.index[k] = r["meshOf"][level]!;
      this.step[k] = r["levelOf"][level]!;
      this.why[k] = slot >= levels ? WHY_SURFACE : rider >= 0 ? WHY_PAIR : WHY_LEVEL;
      if (rider >= 0) this.pending[k] = 2;
    }
    this.again[k] = (r["tries"][slot]! > 0 ? AGAIN_RETRY : 0) | (r["rehashed"][slot] === 1 ? AGAIN_FRESH : 0);
    this.bytes[k] = r["asked"](slot);
    this.fetched[k] = this.disk[k] = this.memory[k] = 0;
    this.from[k] = 0;
    this.state[k] = IS_ASKED;
    this.askedAt[k] = nowMs;
    this.arrivedAt[k] = this.sendingAt[k] = this.doneAt[k] = this.workerMs[k] = NaN;
    this.rowOf[slot] = k;
    if (rider >= 0) this.rowOf[rider] = k;
  }

  /** The residency has taken in the answer for `slot`; `done` where nothing of it goes to the card (rows of meshes, clips, face tables). */
  came(slot: number, a: AssetArrival, nowMs: number, done: boolean): void {
    const k = this.rowFor(slot);
    if (k < 0 || this.slot[k] !== slot || this.generation[k] !== a.generation || this.state[k] !== IS_ASKED) return;
    const disk = a.disk ?? 0, memory = a.memory ?? a.cached - disk;
    this.fetched[k] = a.fetched;
    this.disk[k] = disk;
    this.memory[k] = memory;
    this.from[k] = (a.fetched > 0 ? FROM_NETWORK : 0) | (disk > 0 ? FROM_DISK : 0) | (memory > 0 ? FROM_MEMORY : 0);
    this.arrivedAt[k] = nowMs;
    this.workerMs[k] = a.took ?? NaN;
    const failed = a.data === null || a.fail !== 0;
    this.state[k] = failed ? IS_FAILED : done ? IS_DONE : IS_ARRIVED;
    if (done && !failed) this.doneAt[k] = nowMs;
  }

  /** Bytes of `slot`'s answer went to the card this frame, and with `last` the last of them. */
  sent(slot: number, nowMs: number, last: boolean): void {
    const k = this.rowFor(slot);
    if (k < 0 || this.state[k] !== IS_ARRIVED) return;
    if (Number.isNaN(this.sendingAt[k]!)) this.sendingAt[k] = nowMs;
    if (!last || --this.pending[k]! > 0) return;
    this.doneAt[k] = nowMs;
    this.state[k] = IS_DONE;
  }
}

/** What request `k` of `log` was for, in words: "Tall palm, model level 0", "Bark colour 1024 px". */
export function requestName(r: Residency, log: RequestLog, k: number): string {
  return slotName(r, log.slot[k]!, log.step[k]!, log.why[k] === WHY_PAIR);
}

/** Where request `k`'s bytes came from and where they stand: "network → card", "disk, waiting", "downloading". */
export function requestFrom(log: RequestLog, k: number): string {
  const s = log.state[k]!, f = log.from[k]!;
  if (s === IS_ASKED) return "downloading";
  if (s === IS_FAILED) return "failed";
  const from = f & FROM_NETWORK ? "network" : f & FROM_DISK ? "disk" : "memory";
  const card = log.what[k] !== FOR_PAGE && log.what[k] !== FOR_CLIPS && log.what[k] !== FOR_FACES;
  return s === IS_ARRIVED ? `${from}, waiting` : card ? `${from} → card` : from;
}

/** How long request `k` took from asked to done, or to now while it is not: "0.8 s", "120 ms". */
export function requestTime(log: RequestLog, k: number, nowMs: number): string {
  const end = Number.isNaN(log.doneAt[k]!) ? (Number.isNaN(log.arrivedAt[k]!) ? nowMs : log.arrivedAt[k]!) : log.doneAt[k]!;
  const ms = Math.max(0, end - log.askedAt[k]!);
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
