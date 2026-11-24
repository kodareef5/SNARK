// Pieces the builder has set down and the server has not yet sent as rows. Each is drawn at once where it was asked
// for, and its item is taken from the count the hotbar shows. They are never in the chunk tables (world.structs), so
// nothing collides with one and no chunk's version, row or removal can be changed by one.
//
// The server answers each CMD_PLACE with S_PLACED, then its result, then the survivor's slots, then the chunk's row,
// in that order on one stream. So an entry is drawn until its row lands or its chunk is whole again without it, and
// its item is held back until the slots change after its answer.
//
// The builder's preview sees these pieces (build-view.ts), so one may be set on another the server has not answered
// for: its `on` lists those. When one of them is refused it goes with it. A piece that joins a base whose first piece is
// not yet a row cannot name that base's frame, so its command is held back until the row lands.

import { STRUCT_UNITS } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { PLACE_JOIN, PLACE_NEW, writeJoin } from "../../shared/net/place.ts";
import type { Placed } from "../../shared/net/placed.ts";
import { CMD_PLACE, CMD_STRUCT, RESULT_OK, RESULT_WAIT } from "../../shared/net/protocol.ts";
import type { Inventory } from "../../shared/sim/items.ts";
import { STRUCT_PICKUP } from "../../shared/world/upkeep.ts";
import { PROVISIONAL, type Overlaid } from "./build-view.ts";
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

/** How a piece was asked for, for one the preview may build on: its slot, what it stands on, and its place in a row. */
export interface Asking {
  /** A PLACE_ mode. A piece that joins has its frame and key; a base's first piece gets a frame of this client's own. */
  mode: number;
  variant: number;
  fr: number;
  k0: number;
  k1: number;
  /** The ids of the pieces not yet answered for that it joins or stands on. */
  on: readonly number[];
  /** Its place in a row sent as one command, the row's length and the direction it steps. */
  index: number;
  count: number;
  step: number;
  /** Its turn class in its base, as its row's will be. */
  tw: number;
}

export interface Predicted {
  /** Its own number, which the preview's view of the rows knows it by. */
  id: number;
  /** The command that asked for it, or 0 while that is held back. A row's pieces share one. */
  seq: number;
  /** The id of the first piece of its command, its place in it, and for that first piece the row's length and step. */
  group: number;
  index: number;
  count: number;
  step: number;
  variant: number;
  /** What the preview is shown of it, and the unanswered pieces it stands on. */
  readonly over: Overlaid;
  on: readonly number[];
  kind: number;
  item: number;
  /** Metres, a facing in wire units, and its turn class in its base. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  tw: number;
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
  /** Bumped whenever what the preview should see of the entries changes. */
  stamp = 0;
  /** Commands whose pieces went with the piece they stood on: their own refusal then says nothing new. */
  private readonly went = new Set<number>();
  private nextId = 1;
  /** The time of the last step. */
  private clock = 0;
  private readonly seen: Overlaid[] = [];
  private seenAt = -1;
  /** Pieces this survivor placed, newest last, which undo takes back while the pickup window allows. */
  private readonly done: { ref: number; kind: number }[] = [];
  /** The pickups undo has sent and not heard of: each one's command, its piece and when. The preview takes those pieces as gone. */
  private readonly taking: { seq: number; ref: number; atMs: number }[] = [];
  /** The refs of `taking`, for the preview. */
  readonly taken: number[] = [];

  /**
   * A piece asked for with command `seq`, at a place in metres and a facing in wire units. With `at`, the preview sees it
   * and may build on it; a `seq` of 0 is then a command held back until its base's frame is known. Null when there is no
   * room to draw it.
   */
  add(seq: number, kind: number, item: number, x: number, y: number, z: number, yaw: number, nowMs: number, at: Asking | null = null): Predicted | null {
    if ((seq === 0 && !at) || this.entries.length >= PREDICT_MOST) return null;
    const id = this.nextId++;
    const mode = at ? at.mode : -1;
    // A base's first piece founds a frame only this client knows, until its row says the server's.
    const fr = mode === PLACE_JOIN ? at!.fr : mode === PLACE_NEW ? PROVISIONAL + (id & 0xffffff) : 0;
    const over: Overlaid = { id, kind, mode, fr, k0: at?.k0 ?? 0, k1: at?.k1 ?? 0, x: Math.round(x * STRUCT_UNITS), y: Math.round(y * STRUCT_UNITS), z: Math.round(z * STRUCT_UNITS), yaw };
    const first = at && at.index > 0 ? this.entries.findLast((q) => q.index === 0 && q.count > 1) : undefined;
    const e: Predicted = { id, seq, group: first ? first.id : id, index: at?.index ?? 0, count: at?.count ?? 1, step: at?.step ?? 0, variant: at?.variant ?? 0, over, on: at ? at.on.slice() : [], kind, item, x, y, z, yaw, tw: at?.tw ?? 0, state: ASKED, bornMs: nowMs, ref: -1, atMs: nowMs, drawn: true, spent: true, undo: false, inv: null, invVersion: 0, chunkVersion: 0 };
    this.entries.push(e);
    this.stamp++;
    return e;
  }

  /** The pieces the preview is to see over the rows: asked for or placed, and not yet rows. Those with no slot told are left out. */
  get live(): readonly Overlaid[] {
    if (this.seenAt === this.stamp) return this.seen;
    this.seenAt = this.stamp;
    this.seen.length = 0;
    for (const e of this.entries) if (e.over.mode >= 0 && e.drawn && e.state !== REFUSED) this.seen.push(e.over);
    return this.seen;
  }

  /** The entry with this id, or undefined. */
  byId(id: number): Predicted | undefined {
    for (const e of this.entries) if (e.id === id) return e;
    return undefined;
  }

  /** How many pieces not yet answered for stand one on another down from the piece `id`, itself counted: 0 for one answered. */
  unsure(id: number): number {
    const e = this.byId(id);
    if (!e || e.state !== ASKED) return 0;
    let under = 0;
    for (const p of e.on) under = Math.max(under, this.unsure(p));
    return 1 + under;
  }

  /** Whether command `seq`'s pieces went with a piece they stood on, asked once: its own answer has then been shown already. */
  quiet(seq: number): boolean {
    return this.went.delete(seq);
  }

  /** A piece is refused, and each piece set on it goes with it: one not yet sent is never sent. */
  private refuse(e: Predicted, nowMs: number): void {
    [e.state, e.atMs, e.spent] = [REFUSED, nowMs, false];
    this.stamp++;
    for (const c of this.entries) {
      if (c.state !== ASKED || !(c.on.includes(e.id) || (c.over.mode === PLACE_JOIN && c.over.fr === e.over.fr && e.over.fr >= PROVISIONAL && e.over.mode === PLACE_NEW))) continue;
      if (c.seq !== 0) this.went.add(c.seq);
      this.refuse(c, nowMs);
    }
  }

  /** The server's answer to a placement. Returns the first entry it answers, or null for a piece that was not drawn. */
  placed(p: Placed, session: ClientSession, nowMs: number): Predicted | null {
    let first: Predicted | null = null;
    let answered = 0;
    // A row's pieces were added in order, so they are met in order here.
    for (const e of this.entries) {
      if (e.seq !== p.seq || e.state !== ASKED) continue;
      first ??= e;
      answered++;
      e.atMs = nowMs;
      if (e.index >= p.refs.length) {
        this.refuse(e, nowMs);
        continue;
      }
      e.state = PLACED;
      e.ref = p.refs[e.index]!;
      e.inv = session.inventory;
      e.invVersion = session.inventory?.version ?? 0;
      e.chunkVersion = session.world?.structs.chunks[Math.floor(e.ref / 65536)]?.version ?? 0;
      this.stamp++;
    }
    for (let i = 0; i < p.refs.length; i++) {
      const ref = p.refs[i]!;
      const e = this.entries.find((q) => q.seq === p.seq && q.state === PLACED && q.ref === ref);
      if (e?.undo) {
        this.take(session, ref);
        e.drawn = false;
        this.stamp++;
      } else if (this.done.push({ ref, kind: e ? e.kind : 0 }) > UNDO_MOST) this.done.shift();
    }
    return answered > 0 ? first : null;
  }

  /** A command's result. One that answers a piece still asked for had no S_PLACED: the server never judged it. */
  result(seq: number, code: number, nowMs: number): number {
    const undo = seq !== 0 ? this.taking.findIndex((q) => q.seq === seq) : -1;
    if (undo >= 0) {
      // Refused, the piece stands, and the preview sees it again. Taken, it is gone from the preview until its row goes.
      if (code !== RESULT_OK) this.untake(undo);
      // Too late for this one is too late for every piece before it.
      if (code === RESULT_WAIT) this.done.length = 0;
      return code;
    }
    if (seq === 0) return -1;
    for (const e of this.entries) {
      if (e.seq !== seq || e.state !== ASKED) continue;
      this.refuse(e, nowMs);
      if (code === RESULT_OK) e.drawn = false;
    }
    return -1;
  }

  /** The chunk's row for `ref` has landed (ClientSession.onRow). */
  row(ref: number): void {
    for (const e of this.entries) if (e.state === PLACED && e.ref === ref) this.landed(e);
  }

  /** A placed piece's row is here, or will not come: the preview has the row to go by now. */
  private landed(e: Predicted): void {
    if (!e.drawn) return;
    e.drawn = false;
    this.stamp++;
  }

  /** Each frame: what has landed, gone or been given up on, commands held back that can now go, and the entries with nothing left to show or hold. */
  step(session: ClientSession, nowMs: number): void {
    this.clock = nowMs;
    const structs = session.world?.structs;
    const list = this.entries;
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      if (e.state === ASKED && nowMs - e.bornMs >= ANSWER_MS) this.refuse(e, nowMs);
      else if (e.state === PLACED) {
        const t = structs?.chunks[Math.floor(e.ref / 65536)];
        const row = !!t && t.kind[e.ref & 0xffff] === e.kind;
        // A base's first piece has its row: the pieces set on it can now name its frame.
        if (row && e.over.fr >= PROVISIONAL && e.over.mode === PLACE_NEW) this.found(e, structs!.frameAt(e.ref), nowMs);
        // The row is there; or its chunk is whole again past the answer, so the piece came and went; or it never came.
        if (e.drawn && (row || (t && t.version !== e.chunkVersion) || nowMs - e.atMs >= ROW_MS)) {
          this.landed(e);
          if (!row && e.over.fr >= PROVISIONAL && e.over.mode === PLACE_NEW) this.found(e, 0, nowMs);
        }
        if (e.spent && (session.inventory !== e.inv || session.inventory?.version !== e.invVersion || nowMs - e.atMs >= ROW_MS)) e.spent = false;
      } else if (e.state === REFUSED && nowMs - e.atMs >= FADE_MS) e.drawn = false;
    }
    for (let i = this.taking.length - 1; i >= 0; i--) {
      const q = this.taking[i]!;
      const t = structs?.chunks[Math.floor(q.ref / 65536)];
      if (!t || t.kind[q.ref & 0xffff] === 0 || nowMs - q.atMs >= ROW_MS) this.untake(i);
    }
    // A command held back goes once its frame is the server's, if the piece it names is still the one in hand.
    const inv = session.inventory;
    const hand = inv && inv.hotbar >= 0 && session.held >= 0 && !session.handChanging ? inv.item[inv.hotbar + session.held]! : 0;
    for (const e of list) {
      if (e.seq !== 0 || e.state !== ASKED || e.group !== e.id || e.over.fr >= PROVISIONAL) continue;
      const { variant, count, step, over } = e;
      const seq = hand === e.item ? session.command(CMD_PLACE, (w: BitWriter) => writeJoin(w, variant, over.fr, over.k0, over.k1, count, step)) : 0;
      for (const q of list) {
        if (q.group !== e.id || q.state !== ASKED) continue;
        if (seq === 0) this.refuse(q, nowMs);
        else q.seq = seq;
      }
    }
    let kept = 0;
    for (let i = 0; i < list.length; i++) if (list[i]!.drawn || list[i]!.spent) list[kept++] = list[i]!;
    list.length = kept;
  }

  /** The base `root` founded has the server's frame `gid`, or with 0 never will: the pieces on it take the frame, or go. */
  private found(root: Predicted, gid: number, nowMs: number): void {
    const was = root.over.fr;
    for (const e of this.entries) {
      if (e === root || e.over.fr !== was || e.over.mode !== PLACE_JOIN) continue;
      if (gid !== 0) e.over.fr = gid;
      else if (e.state === ASKED) this.refuse(e, nowMs);
    }
    root.over.fr = 0;
    root.over.mode = -1;
    this.stamp++;
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
      [q.kind, q.x, q.y, q.z, q.yaw, q.tw] = [e.kind, e.x, e.y, e.z, e.yaw, e.tw];
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
      // One whose command was held back is simply never sent, unless it is one of a row.
      if (waiting.seq === 0 && waiting.count === 1 && waiting.index === 0) {
        [waiting.state, waiting.drawn, waiting.spent] = [REFUSED, false, false];
        this.stamp++;
      }
      return -1;
    }
    const structs = session.world?.structs;
    while (this.done.length > 0) {
      const last = this.done.pop()!;
      const t = structs?.chunks[Math.floor(last.ref / 65536)];
      const there = t ? t.kind[last.ref & 0xffff]! : 0;
      // The slot holds another piece now: that one is not this survivor's last.
      if (there !== 0 && last.kind !== 0 && there !== last.kind) continue;
      for (const e of this.entries) if (e.state === PLACED && e.ref === last.ref) this.landed(e);
      return this.take(session, last.ref);
    }
    return 0;
  }

  private take(session: ClientSession, ref: number): number {
    const seq = session.command(CMD_STRUCT, (w: BitWriter) => (w.u32(ref), w.u8(STRUCT_PICKUP)));
    if (seq !== 0) {
      this.taking.push({ seq, ref, atMs: this.clock });
      this.taken.push(ref);
      this.stamp++;
    }
    return seq;
  }

  private untake(i: number): void {
    this.taking.splice(i, 1);
    this.taken.splice(i, 1);
    this.stamp++;
  }

  /** Whether undo has a piece to take back. */
  get undoable(): boolean {
    return this.done.length > 0 || this.entries.some((q) => q.state === ASKED && !q.undo);
  }
}
