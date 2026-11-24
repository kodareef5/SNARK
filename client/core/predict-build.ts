// Pieces the builder has set down and the server has not yet sent as rows. Each is drawn at once where it was asked
// for, and its item is taken from the count the hotbar shows. They are never in the chunk tables (world.structs), so
// nothing collides with one and no chunk's version, row or removal can be changed by one.
//
// The server answers each CMD_PLACE with S_PLACED, then its result, then the survivor's slots, then the chunk's row,
// in that order on one stream. So an entry is drawn until its row lands or its chunk is whole again without it, and
// its item is held back until the slots change after its answer.

import type { BitWriter } from "../../shared/net/codec.ts";
import type { Placed } from "../../shared/net/placed.ts";
import { CMD_STRUCT, RESULT_OK, RESULT_WAIT } from "../../shared/net/protocol.ts";
import type { Inventory } from "../../shared/sim/items.ts";
import { STRUCT_PICKUP } from "../../shared/world/upkeep.ts";
import { MAX_PREDICTED } from "./render/packet.ts";
import type { Ghost } from "./render/passes/ghost.ts";
import type { ClientSession } from "./session.ts";

/** Entries held. A click past them is sent and not drawn. */
export const PREDICT_MOST = MAX_PREDICTED;
/** An entry's state: asked for, placed and awaiting its row, or refused and going. */
export const ASKED = 0, PLACED = 1, REFUSED = 2;
/** An answer is given up on after this long, a row after this long past its answer, and a refused piece is gone in this. */
const ANSWER_MS = 5000, ROW_MS = 3000, FADE_MS = 400;
/** Pieces remembered for undo, newest last. */
const UNDO_MOST = 32;

export interface Predicted {
  seq: number;
  kind: number;
  item: number;
  /** Metres, and a facing in wire units. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: number;
  bornMs: number;
  /** The row it became, once placed, and when its state last changed. */
  ref: number;
  atMs: number;
  /** Still drawn; its item still held back from the count. An entry with neither is dropped. */
  drawn: boolean;
  spent: boolean;
  /** Undo was asked before its answer came: it is taken back as soon as its ref is known. */
  undo: boolean;
  /** The inventory and its version, and the chunk's version, when its answer came. */
  inv: Inventory | null;
  invVersion: number;
  chunkVersion: number;
}

export class PredictBuild {
  readonly entries: Predicted[] = [];
  /** Pieces this survivor placed, newest last, which undo takes back while the pickup window allows. */
  private readonly done: { ref: number; kind: number }[] = [];
  /** The pickup undo last sent. */
  private undoSeq = 0;

  /** A piece asked for with command `seq`, at a place in metres and a facing in wire units. False when there is no room to draw it. */
  add(seq: number, kind: number, item: number, x: number, y: number, z: number, yaw: number, nowMs: number): boolean {
    if (seq === 0 || this.entries.length >= PREDICT_MOST) return false;
    this.entries.push({ seq, kind, item, x, y, z, yaw, state: ASKED, bornMs: nowMs, ref: -1, atMs: nowMs, drawn: true, spent: true, undo: false, inv: null, invVersion: 0, chunkVersion: 0 });
    return true;
  }

  /** The server's answer to a placement. Returns the entry it answers, or null for a piece that was not drawn. */
  placed(p: Placed, session: ClientSession, nowMs: number): Predicted | null {
    const e = this.entries.find((q) => q.seq === p.seq && q.state === ASKED) ?? null;
    const ok = p.code === RESULT_OK && p.refs.length > 0;
    if (ok) {
      const ref = p.refs[0]!;
      if (e?.undo) this.take(session, ref);
      else if (this.done.push({ ref, kind: e ? e.kind : 0 }) > UNDO_MOST) this.done.shift();
    }
    if (!e) return null;
    e.atMs = nowMs;
    if (!ok) {
      e.state = REFUSED;
      e.spent = false;
      return e;
    }
    e.state = PLACED;
    e.ref = p.refs[0]!;
    e.inv = session.inventory;
    e.invVersion = session.inventory?.version ?? 0;
    e.chunkVersion = session.world?.structs.chunks[Math.floor(e.ref / 65536)]?.version ?? 0;
    if (e.undo) e.drawn = false;
    return e;
  }

  /** A command's result. One that answers a piece still asked for had no S_PLACED: the server never judged it. */
  result(seq: number, code: number, nowMs: number): number {
    if (seq !== 0 && seq === this.undoSeq) {
      this.undoSeq = 0;
      // Too late for this one is too late for every piece before it.
      if (code === RESULT_WAIT) this.done.length = 0;
      return code;
    }
    const e = this.entries.find((q) => q.seq === seq && q.state === ASKED);
    if (!e) return -1;
    e.state = REFUSED;
    e.atMs = nowMs;
    e.spent = false;
    if (code === RESULT_OK) e.drawn = false;
    return -1;
  }

  /** The chunk's row for `ref` has landed (ClientSession.onRow). */
  row(ref: number): void {
    for (const e of this.entries) if (e.state === PLACED && e.ref === ref) e.drawn = false;
  }

  /** Each frame: what has landed, gone or been given up on, and the entries with nothing left to show or hold. */
  step(session: ClientSession, nowMs: number): void {
    const structs = session.world?.structs;
    const list = this.entries;
    let kept = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (e.state === ASKED && nowMs - e.bornMs >= ANSWER_MS) {
        [e.state, e.atMs, e.spent] = [REFUSED, nowMs, false];
      } else if (e.state === PLACED) {
        const t = structs?.chunks[Math.floor(e.ref / 65536)];
        // The row is there; or its chunk is whole again past the answer, so the piece came and went; or it never came.
        if (e.drawn && ((t && (t.kind[e.ref & 0xffff] === e.kind || t.version !== e.chunkVersion)) || nowMs - e.atMs >= ROW_MS)) e.drawn = false;
        if (e.spent && (session.inventory !== e.inv || session.inventory?.version !== e.invVersion || nowMs - e.atMs >= ROW_MS)) e.spent = false;
      } else if (e.state === REFUSED && nowMs - e.atMs >= FADE_MS) e.drawn = false;
      if (e.drawn || e.spent) list[kept++] = e;
    }
    list.length = kept;
  }

  /** Whether a piece asked for or placed, and still drawn, stands at this place in metres: the preview has nothing to add there. */
  covers(x: number, y: number, z: number): boolean {
    for (const e of this.entries) if (e.drawn && e.state !== REFUSED && Math.abs(e.x - x) < 1e-3 && Math.abs(e.y - y) < 1e-3 && Math.abs(e.z - z) < 1e-3) return true;
    return false;
  }

  /** How many of `item` have been set down and not yet taken from the inventory the session holds. */
  pending(item: number): number {
    let n = 0;
    for (const e of this.entries) if (e.spent && e.item === item) n++;
    return n;
  }

  /** Hands the pass the pieces to draw: as built, and a refused one going in `refused`, a palette colour. */
  fill(ghost: Ghost, refused: number, nowMs: number): void {
    let n = 0;
    for (const e of this.entries) {
      if (!e.drawn) continue;
      const q = ghost.pieces[n++]!;
      [q.kind, q.x, q.y, q.z, q.yaw] = [e.kind, e.x, e.y, e.z, e.yaw];
      q.fade = e.state === REFUSED ? Math.max(0.01, (nowMs - e.atMs) / FADE_MS) : 0;
    }
    ghost.predicted = n;
    ghost.refusedColor = refused;
  }

  /**
   * Takes back the last piece this survivor placed, through the pickup every piece has. A piece still unanswered is
   * taken back when its answer comes: -1 is returned for that. Else the command's sequence number, or 0 with nothing to take back.
   */
  undo(session: ClientSession): number {
    const waiting = this.entries.findLast((q) => q.state === ASKED && !q.undo);
    if (waiting) {
      waiting.undo = true;
      return -1;
    }
    const structs = session.world?.structs;
    while (this.done.length > 0) {
      const last = this.done.pop()!;
      const t = structs?.chunks[Math.floor(last.ref / 65536)];
      const there = t ? t.kind[last.ref & 0xffff]! : 0;
      // The slot holds another piece now: that one is not this survivor's last.
      if (there !== 0 && last.kind !== 0 && there !== last.kind) continue;
      for (const e of this.entries) if (e.state === PLACED && e.ref === last.ref) e.drawn = false;
      return this.take(session, last.ref);
    }
    return 0;
  }

  private take(session: ClientSession, ref: number): number {
    return (this.undoSeq = session.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(STRUCT_PICKUP))));
  }

  /** Whether undo has a piece to take back. */
  get undoable(): boolean {
    return this.done.length > 0 || this.entries.some((q) => q.state === ASKED && !q.undo);
  }
}
