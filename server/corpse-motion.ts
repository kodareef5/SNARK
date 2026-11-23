// A corpse's full checkpoint is rare and reliable. Only bodies in the actual sent view may be requested or sent. A body
// a client has no checkpoint of goes first, nearest first. Corrections of bodies it has follow, two a snapshot, to the
// body whose drift would look largest: the longest since its last, for how near it is.
import { TICK_RATE } from "../shared/coords.ts";
import { handleGen, handleIndex, makeHandle } from "../shared/ids.ts";
import type { BitReader } from "../shared/net/codec.ts";
import { writeCorpseMotion } from "../shared/net/corpse.ts";
import { RESULT_BUSY, RESULT_INVALID, RESULT_OK, S_CORPSE } from "../shared/net/protocol.ts";
import type { Connection } from "../shared/net/transport.ts";
import type { SentView } from "../shared/net/view.ts";
import type { CorpseMotion } from "../shared/net/corpse.ts";
import type { Client, GameServer } from "./game.ts";

interface Told {
  readonly visible: Set<number>;
  readonly sent: Map<number, number>;
  /** The tick each body in `sent` was last sent at. */
  readonly sentAt: Map<number, number>;
  readonly retry: Set<number>;
  retryAt: number;
}
const BYTES_PER_SNAPSHOT = 16384;
/** Corrections sent a client in a snapshot: checkpoints of bodies it already lays, which a car or a creature disturbs. */
const CORRECTIONS_PER_SNAPSHOT = 2;
/** Sorts a body a client has no checkpoint of before every correction. */
const CORRECTION = 1e12;

/** What lies as a ragdoll and is sent so: corpses (server/corpses.ts) and survivors knocked down (server/falls.ts). */
export interface MotionSource {
  motionRevision(e: number): number;
  motion(e: number, delivery?: "first" | "correction"): CorpseMotion | null;
  /** The revision its lying began at, where one entity lies more than once; what a client has older is of before. */
  motionBegun?(e: number): number;
}

export class CorpseReplication {
  private readonly told = new WeakMap<Connection, Told>();
  readonly stats = { bytes: 0, checkpoints: 0, corrections: 0, deferred: 0 };
  private readonly game: GameServer;
  private readonly sources: readonly MotionSource[];
  /** The bodies a sync may send, by `order`: entity, handle, source, revision, and the key they are sent by. */
  private readonly ents: number[] = [];
  private readonly ids: number[] = [];
  private readonly from: MotionSource[] = [];
  private readonly revisions: number[] = [];
  private readonly keys: number[] = [];
  private readonly order: number[] = [];
  private readonly byKey = (a: number, b: number): number => this.keys[a]! - this.keys[b]! || a - b;
  constructor(game: GameServer, sources: readonly MotionSource[]) { this.game = game; this.sources = sources; }

  sync(c: Client, view: SentView): void {
    let state = this.told.get(c.conn);
    if (!state) { state = { visible: new Set(), sent: new Map(), sentAt: new Map(), retry: new Set(), retryAt: -TICK_RATE }; this.told.set(c.conn, state); }
    state.visible.clear();
    const ents = this.game.world.ents, tick = this.game.world.tick, { order, keys } = this;
    const ox = c.ent >= 0 ? ents.x[c.ent]! : 0, oz = c.ent >= 0 ? ents.z[c.ent]! : 0;
    order.length = 0;
    // Each body in the view, and the session's own, which its view leaves out: one knocked down lies as a ragdoll too.
    for (let i = 0; i <= view.count; i++) {
      const e = i < view.count ? view.id[i]! : c.ent, gen = i < view.count ? view.gen[i]! : ents.gen[c.ent]!;
      if (e < 0 || ents.gen[e] !== gen) continue;
      let source: MotionSource | null = null, revision = 0;
      for (const s of this.sources) if ((revision = s.motionRevision(e)) !== 0) { source = s; break; }
      if (!source) continue;
      const id = makeHandle(e, gen); state.visible.add(id);
      const had = state.sent.get(id);
      if (had === revision && !state.retry.has(id)) continue;
      const fresh = had === undefined || had < (source.motionBegun?.(e) ?? 0) || state.retry.has(id);
      const dx = ents.x[e]! - ox, dz = ents.z[e]! - oz, k = order.length, far = Math.sqrt(dx * dx + dz * dz);
      this.ents[k] = e; this.ids[k] = id; this.from[k] = source; this.revisions[k] = revision;
      keys[k] = fresh ? far : CORRECTION + far / Math.max(1, tick - (state.sentAt.get(id) ?? 0));
      order.push(k);
    }
    order.sort(this.byKey);
    let left = BYTES_PER_SNAPSHOT, corrections = CORRECTIONS_PER_SNAPSHOT;
    for (const k of order) {
      const correction = keys[k]! >= CORRECTION;
      if (correction && corrections === 0) { this.stats.deferred++; continue; }
      const id = this.ids[k]!, motion = this.from[k]!.motion(this.ents[k]!, correction ? "correction" : "first");
      if (!motion) continue;
      const bytes = motion.data.length + 16;
      if (bytes > left || !this.game.replication.spendChunkWindow(c, bytes)) { this.stats.deferred++; continue; }
      const writer = this.game.begin(S_CORPSE);
      writeCorpseMotion(writer, id, motion);
      const sent = writer.bytes().length;
      this.game.endOwn(c);
      left -= sent; this.stats.bytes += sent; this.stats.checkpoints++;
      if (correction) { corrections--; this.stats.corrections++; }
      state.sent.set(id, this.revisions[k]!); state.sentAt.set(id, tick); state.retry.delete(id);
    }
    this.from.length = 0;
    for (const id of state.sent.keys()) if (!state.visible.has(id)) { state.sent.delete(id); state.sentAt.delete(id); }
    for (const id of state.retry) if (!state.visible.has(id)) state.retry.delete(id);
  }

  request(c: Client, r: BitReader): number {
    const count = r.u8();
    if (count < 1 || count > 8) return RESULT_INVALID;
    const ids: number[] = [];
    for (let i = 0; i < count; i++) ids.push(r.u32());
    if (r.overflow) return RESULT_INVALID;
    const state = this.told.get(c.conn), tick = this.game.world.tick;
    if (!state || ids.some(id => !state.visible.has(id) || this.game.world.ents.gen[handleIndex(id)] !== handleGen(id))) return RESULT_INVALID;
    if (tick - state.retryAt < TICK_RATE) return RESULT_BUSY;
    state.retryAt = tick;
    for (const id of ids) state.retry.add(id);
    return RESULT_OK;
  }
}
