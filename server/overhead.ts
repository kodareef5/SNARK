// What a client draws over a creature that it cannot work out itself. A pair's mating goes in the cue word's mating bits
// (shared/anim/pose.ts), which another tribe's client and a spectator are sent as begun and never how far along. What a
// survivor looks at goes to that session alone (OWN_OVERHEAD), with what ARK shows that viewer: its own tribe's creature's
// health and food, an unconscious wild one's torpor and taming, another tribe's name.

import { CUE_DEAD, CUE_MATING_SHIFT, MATING_STEPS } from "../shared/anim/pose.ts";
import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz } from "../shared/coords.ts";
import type { BitWriter } from "../shared/net/codec.ts";
import { DRONE_LOOK, MAX_NAME_BYTES, OWN_OVERHEAD, SESSION_ALIVE, SESSION_SPECTATING } from "../shared/net/protocol.ts";
import { SentView } from "../shared/net/view.ts";
import { youngScale } from "../shared/sim/breeding.ts";
import { stanceEye } from "../shared/sim/character.ts";
import { F_ALIVE, F_PLAYER, F_PROP } from "../shared/sim/entities.ts";
import { effectiveness, tameNeeded } from "../shared/sim/taming.ts";
import { V_FOOD, V_HEALTH, V_TORPOR } from "../shared/sim/vitals.ts";
import { HIT_NONE, castWorld, lookDirection, rayBox, rayHit } from "../shared/world/ray.ts";
import type { Breeding } from "./breeding.ts";
import type { Client, GameServer } from "./game.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Survival } from "./survival.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";

/** Metres from the eye that a look reaches. ARK publishes none; chosen to match the client's. */
export const LOOK_RANGE = 30;
/** The look is found this often, in ticks, and what it shows is sent again at most this often when only its numbers move. */
const LOOK_TICKS = 3;
const RESEND_TICKS = 6;
const MATING_MASK = 7 << CUE_MATING_SHIFT;
/** The mating bits another tribe is sent: begun, whatever the progress. */
const BEGUN = 1 << CUE_MATING_SHIFT;

/** The step a pair at `share` (0 to 1) of its mating shows: 1 as it begins, MATING_STEPS in its last seventh. */
function matingStep(share: number): number {
  return Math.min(MATING_STEPS, 1 + Math.floor(share * MATING_STEPS));
}

/** Fields of an OWN_OVERHEAD, in the order they are written. Shares are 0 to 1, or -1 where the viewer is not told. */
interface Looked {
  id: number;
  health: number;
  food: number;
  torpor: number;
  taming: number;
  te: number;
  mating: number;
  tribe: string;
}

export interface OverheadContext {
  readonly world: ServerWorld;
  readonly records: Records;
  readonly breeding: Breeding;
  readonly game: GameServer;
  readonly survival: Survival;
  readonly tribes: Tribes;
}

export class Overhead {
  readonly ctx: OverheadContext;
  /** Pids whose bodies carry mating bits, and those that should. */
  private readonly marked = new Set<number>();
  private readonly want = new Map<number, number>();
  private readonly sent = new WeakMap<Client, { sum: number; id: number; at: number }>();
  private readonly dir = [0, 0, 0];
  private readonly looked: Looked = { id: -1, health: -1, food: -1, torpor: -1, taming: -1, te: -1, mating: -1, tribe: "" };
  /** The shared view with another tribe's mating hidden, for one client at a time. */
  private readonly masked = new SentView();

  constructor(ctx: OverheadContext) {
    this.ctx = ctx;
    ctx.game.replication.viewFor = (c, cur) => this.view(c, cur);
  }

  /** Each tick, after breeding's. */
  step(tick: number): void {
    this.mark(tick);
    if (tick % LOOK_TICKS === 0) this.looks(tick);
  }

  /** Sets the mating bits of each creature in a pair, a male's from the furthest along of his, and clears those of the rest. */
  private mark(tick: number): void {
    const { breeding, records, world } = this.ctx;
    if (breeding.pairs.size === 0 && this.marked.size === 0) return;
    const want = this.want;
    want.clear();
    for (const [pid, p] of breeding.pairs) {
      const s = matingStep(Math.max(0, Math.min(1, 1 - (p.due - tick) / p.span)));
      if ((want.get(pid) ?? 0) < s) want.set(pid, s);
      if ((want.get(p.male) ?? 0) < s) want.set(p.male, s);
    }
    const ents = world.ents;
    const set = (pid: number, step: number): void => {
      const e = records.entOf.get(pid);
      if (e === undefined || ents.pid[e] !== pid) return;
      const word = ((ents.cue[e]! & ~MATING_MASK) | (step << CUE_MATING_SHIFT)) >>> 0;
      if (word === ents.cue[e]) return;
      ents.cue[e] = word;
      world.history.cued(e);
    };
    for (const pid of this.marked) {
      if (want.has(pid)) continue;
      set(pid, 0);
      this.marked.delete(pid);
    }
    for (const [pid, step] of want) {
      set(pid, step);
      this.marked.add(pid);
    }
  }

  /**
   * The shared view as `c` may be sent it. A pair of its own tribe shows how far along it is; another tribe's, to it or to a
   * spectator, only that it has begun. Returns `cur` itself unless something in it must be hidden.
   */
  view(c: Client, cur: SentView): SentView {
    const team = c.state === SESSION_SPECTATING ? 0 : (this.ctx.records.byPid.get(c.pid)?.team ?? 0);
    const owner = this.ctx.world.ents.team;
    const hidden = (k: number): boolean => (cur.cue[k]! & MATING_MASK) > BEGUN && (team === 0 || owner[cur.id[k]!] !== team);
    let k = 0;
    while (k < cur.count && !hidden(k)) k++;
    if (k === cur.count) return cur;
    const out = this.masked;
    out.count = 0;
    out.tick = cur.tick;
    for (let i = 0; i < cur.count; i++) {
      out.copyFrom(cur, i);
      out.urgent[i] = cur.urgent[i]!;
      if (hidden(i)) out.cue[i] = ((cur.cue[i]! & ~MATING_MASK) | BEGUN) >>> 0;
    }
    return out;
  }

  /** Finds what each living survivor looks at and sends it what that viewer may see of it, when that changed. */
  private looks(tick: number): void {
    const { game, records } = this.ctx;
    for (const c of game.clients) {
      if (!c?.active || c.closed) continue;
      const viewer = records.byPid.get(c.pid);
      const e = c.ent >= 0 && c.state === SESSION_ALIVE && viewer && !viewer.out ? this.lookedAt(c) : -1;
      const what = this.details(e, viewer ?? null);
      const sum = what ? hash(what) : 0;
      const last = this.sent.get(c);
      if (last && last.sum === sum && last.id === (what?.id ?? -1)) continue;
      // A new subject goes at once. Its numbers moving go at most every RESEND_TICKS.
      if (last && last.id === (what?.id ?? -1) && tick - last.at < RESEND_TICKS) continue;
      const w = game.beginOwn(OWN_OVERHEAD);
      w.bool(what !== null);
      if (what) writeLooked(w, what);
      game.endOwn(c);
      this.sent.set(c, { sum, id: what?.id ?? -1, at: tick });
    }
  }

  /** How far beyond LOOK_RANGE a session's look reaches: through a sight, its gaze's (server/gaze.ts lookReach, D1082). */
  reach: (c: Client) => number = () => 0;

  /**
   * The creature under `c`'s aim within LOOK_RANGE, or through a sight as far as its gaze reaches among the chunks round it
   * and those of its cone, or under the middle of a flown drone's camera within DRONE_LOOK, unless the world or another body
   * is in the way, or -1.
   */
  lookedAt(c: Client): number {
    const { world, game } = this.ctx;
    const ents = world.ents;
    const reg = world.reg;
    const from = c.drive >= 0 ? c.drive : c.ent;
    const d = this.dir;
    // A drone flown looks from its camera along its middle, as far as DRONE_LOOK.
    const eye = game.players.remoteEye?.(c) ?? null;
    let ox: number, oy: number, oz: number;
    if (eye) {
      ox = eye.x; oy = eye.y; oz = eye.z;
      const cp = Math.cos(eye.pitch);
      d[0] = Math.sin(eye.yaw) * cp; d[1] = Math.sin(eye.pitch); d[2] = Math.cos(eye.yaw) * cp;
    } else {
      ox = ents.x[from]!;
      oy = ents.y[from]! + stanceEye(reg.move[ents.kind[from]!]!, ents.stance[from]!);
      oz = ents.z[from]!;
      lookDirection(c.heldYaw, c.heldPitch, d);
    }
    const range = eye ? DRONE_LOOK : Math.max(LOOK_RANGE, this.reach(c));
    let best = castWorld(world, ox, oy, oz, d[0]!, d[1]!, d[2]!, range) === HIT_NONE ? range : rayHit.t;
    let hit = -1;
    const dims = world.dims;
    const home = chunkAt(dims, ox, oz);
    const hx = chunkCx(dims, home);
    const hz = chunkCz(dims, home);
    const near = range + 4;
    const cone = !eye && range > LOOK_RANGE && game.replication.cone ? game.replication.cone(c) : null;
    // A drone's ring is as far as it looks, and no wider than the view its page is sent.
    const ring = eye ? Math.min(Math.ceil(near / CHUNK_SIZE), Math.max(1, game.opts.entityRadius)) : 1;
    const test = (chunk: number): void => {
      for (let i = ents.chunkHead[chunk]!; i >= 0; i = ents.next[i]!) {
        if (i === c.ent || i === from || (ents.flags[i]! & (F_ALIVE | F_PROP)) !== F_ALIVE) continue;
        const dx = ents.x[i]! - ox;
        const dz = ents.z[i]! - oz;
        if (dx * dx + dz * dz > near * near) continue;
        const kind = ents.kind[i]!;
        const size = ents.grown[i] !== 0 ? youngScale(reg.birthScale[kind]!, ents.span[i]!, ents.grown[i]!, world.tick) : 1;
        const r = reg.bodyRadius[kind]! * size;
        const t = rayBox(ox, oy, oz, d[0]!, d[1]!, d[2]!, ents.x[i]! - r, ents.y[i]!, ents.z[i]! - r, ents.x[i]! + r, ents.y[i]! + reg.bodyHeight[kind]! * size, ents.z[i]! + r);
        if (t < best) {
          best = t;
          hit = i;
        }
      }
    };
    for (let cz = hz - ring; cz <= hz + ring; cz++) {
      for (let cx = hx - ring; cx <= hx + ring; cx++) if (cx >= 0 && cz >= 0 && cx < dims.chunksX && cz < dims.chunksZ) test(cz * dims.chunksX + cx);
    }
    for (let k = 0; cone && k < cone.count; k++) test(cone.chunks[k]!);
    return hit >= 0 && (ents.flags[hit]! & F_PLAYER) === 0 && (ents.cue[hit]! & CUE_DEAD) === 0 ? hit : -1;
  }

  /** What `viewer` is told of creature `e` beyond what every client in view has, or null for nothing to look at. */
  details(e: number, viewer: EntityRecord | null): Looked | null {
    const { world, records, survival, tribes, breeding } = this.ctx;
    if (e < 0) return null;
    const rec = records.byPid.get(world.ents.pid[e]!);
    if (!rec || world.reg.defs[rec.kind]?.type !== "species" || rec.keyHash !== null || !rec.vitals) return null;
    const share = (i: number): number => {
      const most = rec.vitals!.max[i]! / 1e6;
      return most > 0 ? Math.max(0, Math.min(1, survival.value(rec, i) / most)) : 0;
    };
    const o = this.looked;
    o.id = e;
    o.health = o.food = o.torpor = o.taming = o.te = o.mating = -1;
    o.tribe = "";
    if (rec.team !== 0 && tribes.may(viewer, rec.team)) {
      o.health = share(V_HEALTH);
      o.food = share(V_FOOD);
      if (rec.out) o.torpor = share(V_TORPOR);
      const mate = breeding.progress(rec);
      if (mate > 0) o.mating = mate;
    } else if (rec.team === 0) {
      // Anyone may feed an unconscious wild creature, so anyone looking sees how its taming goes.
      if (rec.out) o.torpor = share(V_TORPOR);
      const p = world.reg.taming[rec.kind];
      if (rec.tame && p) {
        o.taming = Math.min(1, rec.tame.affinity / tameNeeded(p, rec.genome ? rec.genome.level : 1));
        o.te = effectiveness(p, rec.tame.sum);
      }
    } else o.tribe = tribes.byId.get(rec.team)?.name ?? "";
    return o;
  }
}

/** Shares go as thousandths in 10 bits. */
const thousandths = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 1000);

function hash(o: Looked): number {
  let h = Math.imul(o.id + 1, 31);
  for (const v of [o.health, o.food, o.torpor, o.taming, o.te, o.mating]) h = (Math.imul(h, 31) + (v < 0 ? -1 : thousandths(v))) | 0;
  for (let i = 0; i < o.tribe.length; i++) h = (Math.imul(h, 31) + o.tribe.charCodeAt(i)) | 0;
  return h >>> 0 || 1;
}

/** Writes the fields OWN_OVERHEAD names after its first bit. */
function writeLooked(w: BitWriter, o: Looked): void {
  w.u32(o.id >>> 0);
  for (const v of [o.health, o.food, o.torpor]) {
    w.bool(v >= 0);
    if (v >= 0) w.bits(thousandths(v), 10);
  }
  w.bool(o.taming >= 0);
  if (o.taming >= 0) {
    w.bits(thousandths(o.taming), 10);
    w.bits(thousandths(o.te), 10);
  }
  w.bool(o.mating >= 0);
  if (o.mating >= 0) w.bits(thousandths(o.mating), 10);
  w.bool(o.tribe !== "");
  if (o.tribe !== "") w.string(o.tribe.slice(0, MAX_NAME_BYTES));
}
