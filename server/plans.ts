// The plans: templates set down as holograms, and filled a piece at a time through the place command. A plan is a
// record of its own (shared/world/plan.ts) and never a row: it takes no chunk slot, holds no materials, claims no land,
// and is told only to the tribe it belongs to. A paste is judged whole from the server's own rows, a part of it a tick,
// and is made whole or not at all.

import { STRUCT_UNITS, TICK_RATE, chunkAt, chunkCx, chunkCz } from "../shared/coords.ts";
import { BitReader, BitWriter } from "../shared/net/codec.ts";
import { PLACE_PLAN, type PlaceRequest } from "../shared/net/place.ts";
import {
  PLAN_ASKED,
  PLAN_BUSY,
  PLAN_CHUNK_FULL,
  PLAN_COOLDOWN,
  PLAN_ENEMY,
  PLAN_FAR,
  PLAN_LIMIT,
  PLAN_MALFORMED,
  PLAN_NOTHING,
  PLAN_NOT_YOURS,
  PLAN_NOWHERE,
  PLAN_NO_HAMMER,
  PLAN_NO_UPLOAD,
  PLAN_OK,
  PLAN_OVERLAP,
  PLAN_TOO_BIG,
  PLAN_TOO_MANY,
  PLAN_UNKNOWN_FORM,
  REPORT_PIECES_MOST,
  makePlanCommit,
  makePlanReport,
  readPlanCommit,
  writePlanReport,
  type PlanCommit,
} from "../shared/net/plan.ts";
import { RESULT_DENIED, RESULT_INVALID, RESULT_NOT_YOURS, RESULT_OK, RESULT_SHORT, SESSION_ALIVE, S_PLAN, S_PLAN_GONE, S_PLAN_REPORT } from "../shared/net/protocol.ts";
import type { Inventory } from "../shared/sim/items.ts";
import type { Frame } from "../shared/world/lattice/frames.ts";
import { keyLayer } from "../shared/world/lattice/module.ts";
import {
  CellIndex,
  GID_UNMADE,
  PIECE_BUILT,
  PIECE_ENEMY,
  PIECE_FINE,
  PIECE_PLAN,
  PIECE_UNSUPPORTED,
  PLAN_BYTES_MOST,
  PLAN_PART_BYTES,
  PLAN_SET_REACH,
  PlanJudge,
  fillOrder,
  filledAt,
  pieceBook,
  placePlan,
  planAnchor,
  planFrame,
  planSound,
  planSpots,
  readPlan,
  setFilled,
  spotOf,
  writePlan,
  type PieceBook,
  type Placed,
  type PlanAsks,
  type PlanRecord,
} from "../shared/world/plan.ts";
import { Support } from "../shared/world/support.ts";
import { ENEMY_FOUNDATION, ENEMY_PILLAR } from "./build.ts";
import type { Client, GameServer } from "./game.ts";
import type { Items } from "./items.ts";
import type { EntityRecord, Records } from "./records.ts";
import type { Rules } from "./settings/rules.ts";
import type { Tribes } from "./tribes.ts";
import type { ServerWorld } from "./world.ts";

/** Pieces the judging of pastes may look at in one tick, over every paste waiting. Measured: tools/bench/plans.ts. */
export const PLAN_TICK_PIECES = 400;
/** Ticks an upload is kept with no part coming. */
const UPLOAD_TICKS = 30 * TICK_RATE;
/** Chunks from a session's own within which it is told a plan, and past which it is told the plan is gone. */
const TELL_NEAR = 3;
const TELL_FAR = 4;
/** Ticks between two tellings of a plan's filled pieces to one session. */
const FILLED_TICKS = TICK_RATE;
/** Times a paste is judged again because a piece was built or went while it was being judged. */
const RESTARTS_MOST = 2;
/** The version of a saved plan's bytes. */
const SAVED = 1;

export interface PlansContext {
  readonly world: ServerWorld;
  readonly game: GameServer;
  readonly records: Records;
  readonly items: Items;
  readonly tribes: Tribes;
  readonly rules: Rules;
}

/** A plan as the server keeps it: its record, and its pieces as keys with the order they are filled in. */
export interface Plan extends PlanRecord {
  placed: Placed;
  cells: CellIndex;
  /** Each piece's cost from one that stands by itself, as the judge found it; the order that gives; and each piece's place in it. */
  rank: Uint8Array;
  order: Uint16Array;
  /** Pieces not filled. */
  left: number;
  /** Its anchor in metres, and the chunk that is in. */
  x: number;
  z: number;
  chunk: number;
  /** Bumped when the record changes other than by a fill, and when a piece is filled. */
  version: number;
  fills: number;
  /** Where its unfilled pieces are, for another plan's paste to be asked against: made when first asked, dropped at a fill. */
  spots: Set<number> | null;
}

/** What Build.set sets down for a PLACE_PLAN request. */
export interface PlanPiece {
  plan: Plan;
  index: number;
  kind: number;
  k0: number;
  k1: number;
  frame: Frame;
}

interface Upload {
  total: number;
  bytes: Uint8Array;
  got: Uint8Array;
  have: number;
  at: number;
}

interface Job {
  c: Client;
  seq: number;
  pid: number;
  team: number;
  commit: PlanCommit;
  bytes: Uint8Array;
  placed: Placed;
  frame: Frame;
  x: number;
  z: number;
  chunk: number;
  began: number;
  shapes: number;
  restarts: number;
}

interface Told {
  version: number;
  fills: number;
  at: number;
}

export class Plans {
  readonly byId = new Map<number, Plan>();
  /** Counters: pastes made and refused, pieces filled, and the pieces judged in the tick that judged most. */
  made = 0;
  refused = 0;
  filled = 0;
  judgedMost = 0;
  /** Bytes of S_PLAN sent. */
  sentBytes = 0;
  /** Plans changed since they were last saved (Persistence.plans). */
  readonly dirty = new Set<number>();
  /** The piece `pick` last chose, or null where the plan has none left to choose; and the place in the plan's order after it. */
  picked: PlanPiece | null = null;
  cursor = 0;
  private next = 1;
  private readonly ctx: PlansContext;
  private readonly book: PieceBook;
  private readonly hammer: number;
  private readonly byTeam = new Map<number, Plan[]>();
  private readonly byFrame = new Map<number, Plan[]>();
  private readonly lastPaste = new Map<number, number>();
  private readonly uploads = new WeakMap<Client, Upload>();
  private readonly told = new WeakMap<Client, Map<number, Told>>();
  private readonly jobs: Job[] = [];
  private readonly judge = new PlanJudge();
  private readonly asks: PlanAsks;
  /** The team and the plan the judge's questions are asked for. */
  private asking = 0;
  private budget = PLAN_TICK_PIECES;
  private judged = 0;
  private readonly commitRead = makePlanCommit();
  private readonly report = makePlanReport();
  private readonly piece: PlanPiece = { plan: null as unknown as Plan, index: 0, kind: 0, k0: 0, k1: 0, frame: null as unknown as Frame };
  private readonly anchor = { x: 0, y: 0, z: 0 };
  private readonly carried = new Map<number, number>();

  constructor(ctx: PlansContext) {
    this.ctx = ctx;
    const world = ctx.world;
    this.book = pieceBook(world.reg);
    this.hammer = world.reg.index.get("core:template_hammer") ?? 0;
    const heightAt = (x: number, z: number): number => world.hf.heightAt(x, z);
    this.asks = {
      site: { structs: world.structs, tables: world.reg, heightAt },
      support: new Support(world.structs, world.reg, heightAt),
      enemy: (x, z) => world.claims.enemyNear(this.asking, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR),
      other: (fr, k0, k1, x, y, z) => this.planned(this.asking, fr, k0, k1, x, y, z),
    };
  }

  /** How many plans a team has. */
  count(team: number): number {
    return this.byTeam.get(team)?.length ?? 0;
  }

  /** Whether a plan of `team` has an unfilled piece in this cell of frame `fr`, or at this place in metres. */
  private planned(team: number, fr: number, k0: number, k1: number, x: number, y: number, z: number): boolean {
    const plans = this.byTeam.get(team);
    if (!plans) return false;
    const spot = spotOf(x, y, z, keyLayer(k1));
    for (const p of plans) {
      if (p.fr !== 0 && p.fr === fr) {
        const i = p.cells.at(k0, k1);
        if (i >= 0 && !filledAt(p.filled, i)) return true;
      }
      p.spots ??= planSpots(this.ctx.world.reg.forms, planFrame(this.ctx.world.structs, p), p.placed, p.filled);
      if (p.spots.has(spot)) return true;
    }
    return false;
  }

  /** CMD_PLAN_PART. Returns a RESULT_ code. */
  part(c: Client, r: BitReader): number {
    const total = r.varint();
    const offset = r.varint();
    const data = r.blob(PLAN_PART_BYTES);
    if (r.overflow || !(total > 0 && total <= PLAN_BYTES_MOST) || offset % PLAN_PART_BYTES !== 0 || offset >= total || data.length !== Math.min(PLAN_PART_BYTES, total - offset)) return RESULT_INVALID;
    const tick = this.ctx.world.tick;
    let up = this.uploads.get(c);
    // Another size is another blueprint: what came of the last one is dropped.
    if (!up || up.total !== total || tick - up.at > UPLOAD_TICKS) this.uploads.set(c, (up = { total, bytes: new Uint8Array(total), got: new Uint8Array(Math.ceil(total / PLAN_PART_BYTES)), have: 0, at: tick }));
    const block = offset / PLAN_PART_BYTES;
    if (up.got[block] === 0) up.have++;
    up.got[block] = 1;
    up.bytes.set(data, offset);
    up.at = tick;
    return RESULT_OK;
  }

  /** The numbers every report carries: what stands round (x, z), the tribe's plans, and the limits. */
  private limits(team: number, x: number, z: number): void {
    const { world, rules } = this.ctx;
    const out = this.report;
    const cap = rules.num("TheMaxStructuresInRange");
    out.have = world.claims.near(x, z);
    out.cap = cap > 0 ? cap : 0;
    out.plans = this.count(team);
    out.plansCap = rules.num("MaxPlansPerTribe");
    out.piecesCap = rules.num("MaxPlanPieces");
    const wait = (this.lastPaste.get(team) ?? -Infinity) + Math.round(rules.num("PlanPasteCooldown") * TICK_RATE) - world.tick;
    out.wait = wait > 0 ? wait : 0;
  }

  private answer(c: Client, seq: number, code: number): void {
    const out = this.report;
    out.seq = seq;
    out.code = code;
    if (code !== PLAN_OK && code !== PLAN_ASKED) this.refused++;
    writePlanReport(this.ctx.game.begin(S_PLAN_REPORT), out);
    this.ctx.game.endOwn(c);
  }

  private blank(): void {
    const out = this.report;
    out.id = out.pieces = out.fine = out.built = out.blocked = out.unsupported = 0;
    out.index.length = out.state.length = 0;
  }

  /** Why a team may not set down one more plan with its anchor in `chunk`, a PLAN_ code, or PLAN_OK. */
  private room(team: number, chunk: number): number {
    const { rules, world } = this.ctx;
    if (this.count(team) >= rules.num("MaxPlansPerTribe")) return PLAN_TOO_MANY;
    let here = 0;
    for (const p of this.byId.values()) if (p.chunk === chunk) here++;
    if (here >= rules.num("MaxPlansPerChunk")) return PLAN_CHUNK_FULL;
    if ((this.lastPaste.get(team) ?? -Infinity) + Math.round(rules.num("PlanPasteCooldown") * TICK_RATE) > world.tick) return PLAN_COOLDOWN;
    return PLAN_OK;
  }

  /**
   * CMD_PLAN_COMMIT. Returns a RESULT_ code; what became of the paste is S_PLAN_REPORT's to say, at once where it is
   * refused before judging and else when every piece has been judged.
   */
  commit(c: Client, r: BitReader, seq: number): number {
    const commit = this.commitRead;
    if (!readPlanCommit(r, commit)) return RESULT_INVALID;
    const { world, records, items, rules } = this.ctx;
    const rec = records.byPid.get(c.pid);
    if (!rec || c.state !== SESSION_ALIVE || c.ent < 0 || rec.out || rec.team === 0) return RESULT_DENIED;
    const structs = world.structs;
    const ents = world.ents;
    this.blank();
    const record: PlanRecord = { id: 0, team: rec.team, by: rec.pid, fr: commit.fr, ox: commit.ox, oy: commit.oy, oz: commit.oz, yaw: commit.yaw, m0: commit.m0, m1: commit.m1, m2: commit.m2, m3: commit.m3, lvl: commit.lvl, turn: commit.turn, mirror: commit.mirror, expires: 0, bytes: new Uint8Array(0), filled: new Uint8Array(0) };
    const joined = commit.fr !== 0 ? structs.frames.get(commit.fr) : undefined;
    if (joined) [record.ox, record.oy, record.oz, record.yaw] = [joined.ox, joined.oy, joined.oz, joined.yaw];
    const sound = (commit.fr === 0 || joined !== undefined) && planSound(record, world.dims.chunksX, world.dims.chunksZ);
    if (sound) planAnchor(record, this.anchor);
    else [this.anchor.x, this.anchor.z] = [ents.x[c.ent]!, ents.z[c.ent]!];
    const { x, z } = this.anchor;
    this.limits(rec.team, x, z);
    const refuse = (code: number): number => (this.answer(c, seq, code), RESULT_OK);
    if (commit.ask) return refuse(PLAN_ASKED);
    const inv = items.inv(rec);
    if (this.hammer === 0 || rec.held < 0 || inv.count[inv.hotbar + rec.held]! <= 0 || inv.item[inv.hotbar + rec.held] !== this.hammer) return refuse(PLAN_NO_HAMMER);
    if (this.jobs.some((j) => j.c === c)) return refuse(PLAN_BUSY);
    const up = this.uploads.get(c);
    if (!up || up.have !== up.got.length || world.tick - up.at > UPLOAD_TICKS) return refuse(PLAN_NO_UPLOAD);
    // A commit uses its upload up, whatever comes of it.
    this.uploads.delete(c);
    if (commit.fr !== 0 && (!joined || joined.team !== rec.team)) return refuse(PLAN_NOT_YOURS);
    if (!sound) return refuse(PLAN_NOWHERE);
    if (Math.hypot(x - ents.x[c.ent]!, z - ents.z[c.ent]!) > PLAN_SET_REACH) return refuse(PLAN_FAR);
    const chunk = chunkAt(world.dims, x, z);
    const room = this.room(rec.team, chunk);
    if (room !== PLAN_OK) return refuse(room);
    if (this.report.cap > 0 && this.report.have >= this.report.cap) return refuse(PLAN_LIMIT);
    const read = placePlan(this.book, up.bytes, commit.mirror, commit.turn, [commit.m0, commit.m1, commit.m2, commit.m3], commit.lvl);
    if (!read.ok) {
      const why = read.fault.reason;
      return refuse(why === "unknown form" || why === "no such piece" ? PLAN_UNKNOWN_FORM : why === "too many pieces" || why === "too long" ? PLAN_TOO_BIG : why === "off the lattice" ? PLAN_NOWHERE : PLAN_MALFORMED);
    }
    const placed = read.placed;
    this.report.pieces = placed.n;
    if (placed.n === 0) return refuse(PLAN_MALFORMED);
    if (placed.n > rules.num("MaxPlanPieces")) return refuse(PLAN_TOO_BIG);
    record.bytes = up.bytes;
    this.jobs.push({ c, seq, pid: rec.pid, team: rec.team, commit: { ...commit }, bytes: up.bytes, placed, frame: planFrame(structs, record), x, z, chunk, began: -1, shapes: 0, restarts: 0 });
    this.work();
    return RESULT_OK;
  }

  /** Judges the pastes waiting, the oldest first, within what is left of the tick's allowance. */
  private work(): void {
    const structs = this.ctx.world.structs;
    const judge = this.judge;
    while (this.budget > 0 && this.jobs.length > 0) {
      const job = this.jobs[0]!;
      // A paste is judged against rows that stood still: a piece built or gone since it began starts it again.
      if (job.began < 0 || (structs.shapes !== job.shapes && job.restarts++ < RESTARTS_MOST)) {
        job.began = this.ctx.world.tick;
        job.shapes = structs.shapes;
        this.asking = job.team;
        judge.begin(this.book, job.placed, job.frame, job.team, this.asks);
      }
      this.asking = job.team;
      const before = judge.looked;
      judge.step(this.budget);
      const looked = judge.looked - before;
      this.budget -= Math.max(1, looked);
      this.judged += looked;
      if (!judge.done) return;
      this.jobs.shift();
      this.finish(job);
    }
  }

  /** A paste judged: everything that refuses it outright is asked again now, and the plan is made whole or not at all. */
  private finish(job: Job): void {
    const { world, records, game, rules } = this.ctx;
    const c = job.c;
    const judge = this.judge;
    const placed = job.placed;
    const n = placed.n;
    const rec = records.byPid.get(job.pid);
    const out = this.report;
    this.blank();
    out.pieces = n;
    if (!rec || game.clients[c.id] !== c || c.closed) return;
    this.limits(job.team, job.x, job.z);
    const structs = world.structs;
    const U = STRUCT_UNITS;
    this.asking = job.team;
    // Rows may have changed since a piece was looked at, so what refuses a paste is asked of every piece again.
    const stale = job.began !== world.tick;
    const offend = (code: number, state: number): void => {
      for (let i = 0; i < n && out.index.length < REPORT_PIECES_MOST; i++) {
        if (judge.state[i] !== state) continue;
        out.index.push(i);
        out.state.push(state);
      }
      this.answer(c, job.seq, code);
    };
    for (let i = 0; stale && i < n; i++) {
      const s = judge.state[i]!;
      if (s === PIECE_BUILT || s === PIECE_ENEMY || s === PIECE_PLAN) continue;
      const x = judge.x[i]! / U;
      const z = judge.z[i]! / U;
      if (this.asks.other(job.frame.gid, placed.k0[i]!, placed.k1[i]!, x, judge.y[i]! / U, z)) judge.state[i] = PIECE_PLAN;
      else if (this.asks.enemy(x, z)) judge.state[i] = PIECE_ENEMY;
      if (judge.state[i] !== s) {
        judge.counts[s]!--;
        judge.counts[judge.state[i]!]!++;
      }
    }
    out.fine = judge.counts[PIECE_FINE]!;
    out.built = judge.counts[PIECE_BUILT]!;
    out.unsupported = judge.counts[PIECE_UNSUPPORTED]!;
    out.blocked = judge.blocked;
    if (rec.team !== job.team || (job.commit.fr !== 0 && structs.frames.get(job.commit.fr)?.team !== job.team)) return this.answer(c, job.seq, PLAN_NOT_YOURS);
    if (judge.counts[PIECE_ENEMY]! > 0) return offend(PLAN_ENEMY, PIECE_ENEMY);
    if (judge.counts[PIECE_PLAN]! > 0) return offend(PLAN_OVERLAP, PIECE_PLAN);
    const room = this.room(job.team, job.chunk);
    if (room !== PLAN_OK) return this.answer(c, job.seq, room);
    if (out.cap > 0 && out.have >= out.cap) return this.answer(c, job.seq, PLAN_LIMIT);
    if (out.built === n) return this.answer(c, job.seq, PLAN_NOTHING);
    const f = job.frame;
    const filled = new Uint8Array(Math.ceil(n / 8));
    for (let i = 0; i < n; i++) if (judge.state[i] === PIECE_BUILT) setFilled(filled, i);
    const commit = job.commit;
    const hours = rules.num("PlanExpiryHours");
    const record: PlanRecord = { id: this.next++, team: job.team, by: job.pid, fr: f.gid === GID_UNMADE ? 0 : f.gid, ox: f.ox, oy: f.oy, oz: f.oz, yaw: f.yaw, m0: commit.m0, m1: commit.m1, m2: commit.m2, m3: commit.m3, lvl: commit.lvl, turn: commit.turn, mirror: commit.mirror, expires: hours > 0 ? world.tick + Math.round(hours * 3600 * TICK_RATE) : 0, bytes: job.bytes, filled };
    const plan = this.keep(record, placed, judge.rank.slice(0, n));
    this.lastPaste.set(job.team, world.tick);
    this.made++;
    out.id = plan.id;
    out.plans = this.count(job.team);
    // The pieces that are not fine, something in the way first.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n && out.index.length < REPORT_PIECES_MOST; i++) {
        const s = judge.state[i]!;
        if (s === PIECE_FINE || s === PIECE_BUILT || (s === PIECE_UNSUPPORTED) !== (pass === 1)) continue;
        out.index.push(i);
        out.state.push(s);
      }
    }
    this.answer(c, job.seq, PLAN_OK);
  }

  /** Takes a record in as a plan, with its pieces and their ranks. */
  private keep(record: PlanRecord, placed: Placed, rank: Uint8Array): Plan {
    const world = this.ctx.world;
    planAnchor(record, this.anchor);
    let left = 0;
    for (let i = 0; i < placed.n; i++) if (!filledAt(record.filled, i)) left++;
    const plan: Plan = { ...record, placed, cells: new CellIndex(placed), rank, order: fillOrder(placed, rank), left, x: this.anchor.x, z: this.anchor.z, chunk: chunkAt(world.dims, this.anchor.x, this.anchor.z), version: 1, fills: 0, spots: null };
    this.byId.set(plan.id, plan);
    this.list(this.byTeam, plan.team, plan);
    if (plan.fr !== 0) this.list(this.byFrame, plan.fr, plan);
    this.dirty.add(plan.id);
    if (plan.id >= this.next) this.next = plan.id + 1;
    return plan;
  }

  private list(by: Map<number, Plan[]>, key: number, plan: Plan): void {
    const of = by.get(key);
    if (of) of.push(plan);
    else by.set(key, [plan]);
  }

  private unlist(by: Map<number, Plan[]>, key: number, plan: Plan): void {
    const of = by.get(key);
    if (!of) return;
    of.splice(of.indexOf(plan), 1);
    if (of.length === 0) by.delete(key);
  }

  /** Takes a plan away. Sessions told of it are told it is gone at the next step. */
  remove(plan: Plan): void {
    if (!this.byId.delete(plan.id)) return;
    this.unlist(this.byTeam, plan.team, plan);
    if (plan.fr !== 0) this.unlist(this.byFrame, plan.fr, plan);
    this.dirty.add(plan.id);
  }

  /** CMD_PLAN_CANCEL. Returns a RESULT_ code. */
  cancel(c: Client, r: BitReader): number {
    const id = r.varint();
    if (r.overflow) return RESULT_INVALID;
    const rec = this.ctx.records.byPid.get(c.pid);
    const plan = this.byId.get(id);
    if (!rec || c.state !== SESSION_ALIVE || rec.out) return RESULT_DENIED;
    if (!plan) return RESULT_INVALID;
    if (!this.ctx.tribes.may(rec, plan.team)) return RESULT_NOT_YOURS;
    this.remove(plan);
    return RESULT_OK;
  }

  /** Every plan of `from` is `to`'s: a survivor's own team joined a tribe. */
  moved(from: number, to: number): void {
    const plans = this.byTeam.get(from);
    if (!plans || from === to) return;
    for (const p of [...plans]) {
      this.unlist(this.byTeam, from, p);
      p.team = to;
      p.version++;
      this.list(this.byTeam, to, p);
      this.dirty.add(p.id);
    }
  }

  /** A team that nobody can act for any more leaves no plans. */
  dropTeam(team: number): void {
    for (const p of [...(this.byTeam.get(team) ?? [])]) this.remove(p);
  }

  /**
   * Chooses the piece a PLACE_PLAN request is to set down for `rec`, into `picked`: the one at `index`, or with an index
   * of -1 the first from place `at` of the plan's order that is not filled and that `rec` carries the piece for.
   * `picked` is null where none is left, and `cursor` is the place after the one chosen. Returns a RESULT_ code.
   */
  pick(rec: EntityRecord, req: PlaceRequest, at: number, inv: Inventory): number {
    this.picked = null;
    const plan = req.mode === PLACE_PLAN ? this.byId.get(req.plan) : undefined;
    if (!plan) return RESULT_INVALID;
    if (rec.team === 0 || rec.team !== plan.team) return RESULT_NOT_YOURS;
    const reg = this.ctx.world.reg;
    const placed = plan.placed;
    let i = -1;
    if (req.index >= 0) {
      if (req.index >= placed.n || filledAt(plan.filled, req.index)) return RESULT_INVALID;
      i = req.index;
      this.cursor = at;
    } else {
      // What is carried of each item is counted once a command: the first piece asked for counts afresh.
      if (at === req.from) this.carried.clear();
      let short = false;
      for (; at < placed.n && i < 0; at++) {
        const k = plan.order[at]!;
        if (filledAt(plan.filled, k)) continue;
        const item = reg.pieceItem[placed.kind[k]!]!;
        let have = this.carried.get(item);
        if (have === undefined) this.carried.set(item, (have = inv.total(item)));
        if (have > 0) i = k;
        else short = true;
      }
      this.cursor = at;
      if (i < 0) return short ? RESULT_SHORT : RESULT_OK;
      this.carried.set(reg.pieceItem[placed.kind[i]!]!, this.carried.get(reg.pieceItem[placed.kind[i]!]!)! - 1);
    }
    const p = this.piece;
    p.plan = plan;
    p.index = i;
    p.kind = placed.kind[i]!;
    p.k0 = placed.k0[i]!;
    p.k1 = placed.k1[i]!;
    p.frame = planFrame(this.ctx.world.structs, plan);
    this.picked = p;
    return RESULT_OK;
  }

  /** Sets a plan's piece down as a row: in its frame, which its first piece makes at the plan's own pose. Returns the ref, or -1. */
  setDown(p: PlanPiece, hp: number): number {
    const structs = this.ctx.world.structs;
    const plan = p.plan;
    if (p.frame.gid !== GID_UNMADE) return structs.place(p.kind, p.frame.gid, p.k0, p.k1, plan.team, hp);
    const f = structs.frames.make(plan.ox, plan.oy, plan.oz, plan.yaw, plan.team);
    const ref = structs.place(p.kind, f.gid, p.k0, p.k1, plan.team, hp);
    if (ref < 0) {
      structs.frames.drop(f.gid);
      return -1;
    }
    if (plan.fr !== 0) this.unlist(this.byFrame, plan.fr, plan);
    plan.fr = f.gid;
    plan.version++;
    this.list(this.byFrame, f.gid, plan);
    this.dirty.add(plan.id);
    return ref;
  }

  /** A row was set down: the piece of each plan of its frame that has its cell is filled. A plan with every piece filled goes. */
  landed(ref: number): void {
    const { world, rules } = this.ctx;
    const structs = world.structs;
    const t = structs.chunks[Math.floor(ref / 65536)];
    const slot = ref & 0xffff;
    const fr = t?.fr ? t.fr[slot]! : 0;
    const plans = fr !== 0 ? this.byFrame.get(fr) : undefined;
    if (!plans) return;
    for (const p of [...plans]) {
      const i = p.cells.at(t!.k0![slot]!, t!.k1![slot]!);
      if (i < 0 || filledAt(p.filled, i)) continue;
      setFilled(p.filled, i);
      p.left--;
      p.fills++;
      p.spots = null;
      this.filled++;
      const hours = rules.num("PlanExpiryHours");
      p.expires = hours > 0 ? world.tick + Math.round(hours * 3600 * TICK_RATE) : 0;
      this.dirty.add(p.id);
      if (p.left === 0) this.remove(p);
    }
  }

  /** Call once a tick: judges pastes, lets old plans go, and tells each session the plans that are its tribe's to see. */
  step(): void {
    const { world, game, records } = this.ctx;
    if (this.judged > this.judgedMost) this.judgedMost = this.judged;
    this.judged = 0;
    this.budget = PLAN_TICK_PIECES;
    this.work();
    const tick = world.tick;
    if (tick % TICK_RATE === 0) for (const p of [...this.byId.values()]) if (p.expires !== 0 && tick >= p.expires) this.remove(p);
    const dims = world.dims;
    for (const c of game.clients) {
      if (!c?.active || c.closed) continue;
      const rec = records.byPid.get(c.pid);
      const plans = rec && rec.team !== 0 ? this.byTeam.get(rec.team) : undefined;
      let told = this.told.get(c);
      if (!plans && (!told || told.size === 0)) continue;
      if (!told) this.told.set(c, (told = new Map()));
      const cx = chunkCx(dims, c.chunk);
      const cz = chunkCz(dims, c.chunk);
      const far = (p: Plan): number => Math.max(Math.abs(chunkCx(dims, p.chunk) - cx), Math.abs(chunkCz(dims, p.chunk) - cz));
      for (const id of told.keys()) {
        const p = this.byId.get(id);
        if (p && p.team === rec?.team && far(p) <= TELL_FAR) continue;
        game.begin(S_PLAN_GONE).varint(id);
        game.endOwn(c);
        told.delete(id);
      }
      for (const p of plans ?? []) {
        const was = told.get(p.id);
        if (!was && far(p) > TELL_NEAR) continue;
        const whole = !was || was.version !== p.version;
        if (!whole && (was.fills === p.fills || tick - was.at < FILLED_TICKS)) continue;
        const w = game.begin(S_PLAN);
        w.varint(p.id);
        w.bool(whole);
        if (whole) writePlan(w, p);
        else w.blob(p.filled);
        const bytes = w.byteLength;
        // A plan waits its turn behind the chunk rows, as every other reliable feed does.
        if (!game.replication.spendChunkWindow(c, bytes)) continue;
        game.endOwn(c);
        this.sentBytes += bytes;
        told.set(p.id, { version: p.version, fills: p.fills, at: tick });
      }
    }
  }

  /** A plan's bytes for the save, or null for one that is gone. */
  encode(id: number): { chunk: number; data: Uint8Array } | null {
    const p = this.byId.get(id);
    if (!p) return null;
    const w = new BitWriter(p.bytes.length + p.filled.length + p.placed.n + 128);
    w.u8(SAVED);
    writePlan(w, p);
    w.blob(p.rank);
    return { chunk: p.chunk, data: w.bytes().slice() };
  }

  /** Marks every plan to be saved again. */
  all(): void {
    for (const id of this.byId.keys()) this.dirty.add(id);
  }

  /** Takes in the plans a save holds. One whose blueprint this build cannot read, or whose team is no more, is left out and goes from the save. */
  load(rows: readonly { id: number; data: Uint8Array }[]): number {
    const r = new BitReader();
    let kept = 0;
    for (const row of rows) {
      r.reset(row.data);
      const record = r.u8() === SAVED ? readPlan(r) : null;
      const rank = record ? r.blob(PLAN_BYTES_MOST) : null;
      const read = record && !r.overflow ? placePlan(this.book, record.bytes, record.mirror, record.turn, [record.m0, record.m1, record.m2, record.m3], record.lvl) : null;
      if (!record || !rank || !read || !read.ok || rank.length !== read.placed.n || record.id !== row.id) {
        this.dirty.add(row.id);
        continue;
      }
      // Its frame went with its last row while the server was down, or before: its first piece makes it again.
      if (record.fr !== 0 && !this.ctx.world.structs.frames.get(record.fr)) record.fr = 0;
      this.keep(record, read.placed, rank);
      this.dirty.delete(record.id);
      kept++;
    }
    return kept;
  }
}
