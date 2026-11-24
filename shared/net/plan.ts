// The messages a plan is set down by: CMD_PLAN_PART and CMD_PLAN_COMMIT from the builder, and S_PLAN_REPORT back. The
// client writes the commands and the server reads them here; the report goes the other way. A plan's own record is in
// shared/world/plan.ts.

import type { BitReader, BitWriter } from "./codec.ts";

/** Why a paste was taken or refused, in S_PLAN_REPORT. */
export const PLAN_OK = 0;
/** Only the limits were asked for. */
export const PLAN_ASKED = 1;
/** The blueprint's bytes are not a blueprint, or it has too many bytes or pieces. */
export const PLAN_MALFORMED = 2;
export const PLAN_TOO_BIG = 3;
/** It names a form, or a form of a material, this server does not build. */
export const PLAN_UNKNOWN_FORM = 4;
/** A piece would stand too near another tribe's foundation. */
export const PLAN_ENEMY = 5;
/** Another plan of the tribe has a piece where one of its pieces would go. */
export const PLAN_OVERLAP = 6;
/** The tribe has as many plans as it may, or the chunk has. */
export const PLAN_TOO_MANY = 7;
export const PLAN_CHUNK_FULL = 8;
/** The tribe set one down too lately. */
export const PLAN_COOLDOWN = 9;
/** As many structures stand here as may. */
export const PLAN_LIMIT = 10;
export const PLAN_NO_HAMMER = 11;
export const PLAN_FAR = 12;
/** No whole blueprint was uploaded by this session. */
export const PLAN_NO_UPLOAD = 13;
/** The session's last paste is still being judged. */
export const PLAN_BUSY = 14;
/** The base it would join is not the tribe's, or is gone. */
export const PLAN_NOT_YOURS = 15;
/** Its place is off the map, or puts a piece off the lattice. */
export const PLAN_NOWHERE = 16;
/** Every piece of it is built already. */
export const PLAN_NOTHING = 17;

export const PLAN_REASONS: Readonly<Record<number, string>> = {
  [PLAN_MALFORMED]: "The template cannot be read",
  [PLAN_TOO_BIG]: "The template has too many pieces for this server",
  [PLAN_UNKNOWN_FORM]: "The template has a piece this server does not build",
  [PLAN_ENEMY]: "Too near another tribe's foundation",
  [PLAN_OVERLAP]: "Another plan of your tribe is in the way",
  [PLAN_TOO_MANY]: "Your tribe has as many plans as it may",
  [PLAN_CHUNK_FULL]: "This area holds no more plans",
  [PLAN_COOLDOWN]: "Wait before setting down another plan",
  [PLAN_LIMIT]: "No more structures may stand here",
  [PLAN_NO_HAMMER]: "Hold the template hammer",
  [PLAN_FAR]: "Too far away",
  [PLAN_NO_UPLOAD]: "The template did not arrive whole",
  [PLAN_BUSY]: "Your last plan is still being checked",
  [PLAN_NOT_YOURS]: "That base is not your tribe's",
  [PLAN_NOWHERE]: "It does not fit on the lattice there",
  [PLAN_NOTHING]: "Every piece of it is built already",
};

/** Pieces one report may name. */
export const REPORT_PIECES_MOST = 16;

/** CMD_PLAN_COMMIT: where the uploaded blueprint is to stand. */
export interface PlanCommit {
  /** Only the limits are asked for: nothing is uploaded or made. */
  ask: boolean;
  /** The frame to join, or 0 for a new one at the pose. */
  fr: number;
  /** A new frame's origin in lattice units and its turn. */
  ox: number;
  oy: number;
  oz: number;
  yaw: number;
  /** In a frame joined: where the blueprint's anchor goes, a tuple and a level. */
  m0: number;
  m1: number;
  m2: number;
  m3: number;
  lvl: number;
  turn: number;
  mirror: boolean;
}

export function makePlanCommit(): PlanCommit {
  return { ask: false, fr: 0, ox: 0, oy: 0, oz: 0, yaw: 0, m0: 0, m1: 0, m2: 0, m3: 0, lvl: 0, turn: 0, mirror: false };
}

/** After the command's kind. */
export function writePlanCommit(w: BitWriter, p: PlanCommit): void {
  w.bool(p.ask);
  w.bool(p.mirror);
  w.bits(p.turn, 4);
  w.varint(p.fr);
  if (p.fr === 0) {
    w.sbits(p.ox, 32);
    w.sbits(p.oy, 32);
    w.sbits(p.oz, 32);
    w.u16(p.yaw);
    return;
  }
  w.sbits(p.m0, 11);
  w.sbits(p.m1, 11);
  w.sbits(p.m2, 11);
  w.sbits(p.m3, 11);
  w.sbits(p.lvl, 10);
}

/** After the command's kind, into `out`. False for one that runs past its end or names no turn. */
export function readPlanCommit(r: BitReader, out: PlanCommit): boolean {
  out.ask = r.bool();
  out.mirror = r.bool();
  out.turn = r.bits(4);
  out.fr = r.varint();
  out.ox = out.oy = out.oz = out.yaw = out.m0 = out.m1 = out.m2 = out.m3 = out.lvl = 0;
  if (out.fr === 0) {
    out.ox = r.sbits(32);
    out.oy = r.sbits(32);
    out.oz = r.sbits(32);
    out.yaw = r.u16();
  } else {
    out.m0 = r.sbits(11);
    out.m1 = r.sbits(11);
    out.m2 = r.sbits(11);
    out.m3 = r.sbits(11);
    out.lvl = r.sbits(10);
  }
  return !r.overflow && out.turn < 12;
}

/** S_PLAN_REPORT: what the server made of a paste, after judging every piece from its own rows. */
export interface PlanReport {
  /** The commit's sequence number. */
  seq: number;
  /** A PLAN_ code. */
  code: number;
  /** The plan made, or 0. */
  id: number;
  pieces: number;
  fine: number;
  built: number;
  blocked: number;
  unsupported: number;
  /** Structures standing round the place, and the most that may: 0 for no cap. */
  have: number;
  cap: number;
  /** The tribe's plans, and the most it may have. */
  plans: number;
  plansCap: number;
  /** The most pieces a plan may have here. */
  piecesCap: number;
  /** Ticks until the tribe may set another down. */
  wait: number;
  /** Pieces that are not fine, by their place in the plan, and each one's state (shared/world/plan.ts PIECE_). */
  index: number[];
  state: number[];
}

export function makePlanReport(): PlanReport {
  return { seq: 0, code: PLAN_OK, id: 0, pieces: 0, fine: 0, built: 0, blocked: 0, unsupported: 0, have: 0, cap: 0, plans: 0, plansCap: 0, piecesCap: 0, wait: 0, index: [], state: [] };
}

/** After the message's kind. */
export function writePlanReport(w: BitWriter, p: PlanReport): void {
  w.u16(p.seq);
  w.u8(p.code);
  w.varint(p.id);
  w.varint(p.pieces);
  w.varint(p.fine);
  w.varint(p.built);
  w.varint(p.blocked);
  w.varint(p.unsupported);
  w.varint(p.have);
  w.varint(p.cap);
  w.varint(p.plans);
  w.varint(p.plansCap);
  w.varint(p.piecesCap);
  w.varint(p.wait);
  const n = Math.min(p.index.length, REPORT_PIECES_MOST);
  w.bits(n, 5);
  for (let i = 0; i < n; i++) {
    w.varint(p.index[i]!);
    w.bits(p.state[i]!, 4);
  }
}

/** After the message's kind, into `out`. False for one that runs past its end. */
export function readPlanReport(r: BitReader, out: PlanReport): boolean {
  out.seq = r.u16();
  out.code = r.u8();
  out.id = r.varint();
  out.pieces = r.varint();
  out.fine = r.varint();
  out.built = r.varint();
  out.blocked = r.varint();
  out.unsupported = r.varint();
  out.have = r.varint();
  out.cap = r.varint();
  out.plans = r.varint();
  out.plansCap = r.varint();
  out.piecesCap = r.varint();
  out.wait = r.varint();
  const n = r.bits(5);
  out.index.length = out.state.length = 0;
  for (let i = 0; i < n && !r.overflow; i++) {
    out.index.push(r.varint());
    out.state.push(r.bits(4));
  }
  return !r.overflow && n <= REPORT_PIECES_MOST;
}
