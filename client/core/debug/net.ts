// The debug bar's count of the game's socket: every message by its kind and sub-kind, in and out, a second at a time for
// the last three minutes, each snapshot by its sections and its bodies' ops, and the category the network tab shows each
// under. It is the session's tap (net-tap.ts) while the bar is on. The protocol's names come from the server (setNames):
// this file is fetched late, and its importing the protocol whole would make the first frame's script export all of it.

import type { Registry } from "../../../shared/content/registry.ts";
import type { CodeNames } from "../../../shared/debug.ts";
import { SNAP_BODIES, type NetTap } from "../net-tap.ts";

/** Whole seconds kept. */
export const SECONDS = 180;
/** The ring's slots: the second under way and those kept. */
const RING = SECONDS + 1;

/** Which way a message went. */
export const NET_IN = 0;
export const NET_OUT = 1;

/** The network tab's categories, in the order it shows them. */
export const CATEGORIES = ["player", "bodies", "world", "combat", "cosmetic", "text", "session", "input", "commands", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
const PLAYER = 0;
const BODIES = 1;
const OTHER = CATEGORIES.length - 1;

/**
 * The codes in each category, by name. A sub-kind's row comes before its kind's, and a code in no row is "other". A
 * snapshot's message counts as "bodies"; its bytes go by its sections (SECTION_CATEGORY).
 */
const ROWS: Readonly<Record<Category, readonly string[]>> = {
  player: ["S_OWN"],
  bodies: ["S_SNAPSHOT"],
  world: ["S_CHUNK", "S_CHUNK_DROP", "S_NODES", "S_TACTICAL", "S_MARKS", "S_FAR", "S_MOTION", "S_SUPPLY", "EVENT_TAMED", "EVENT_BALL"],
  combat: ["EVENT_HIT", "EVENT_HURT", "EVENT_DEATH", "EVENT_KILL", "EVENT_SHOT", "EVENT_BLAST"],
  cosmetic: ["EVENT_IMPACT", "S_CORPSE"],
  text: ["S_TEXT"],
  session: ["S_WELCOME", "S_RESULT", "S_REJECT", "S_TRAVEL", "S_TUNING", "C_HELLO"],
  input: ["C_INPUT"],
  commands: ["C_COMMAND"],
  other: [],
};
const CATEGORY_OF = new Map(CATEGORIES.flatMap((c, i) => ROWS[c].map((name) => [name, i] as const)));
/** The family a kind's sub-kind is named from, by the kind's name. */
const SUB_FAMILY = new Map<string, keyof CodeNames>([["S_OWN", "OWN"], ["S_EVENT", "EVENT"], ["S_TEXT", "TEXT"], ["C_COMMAND", "CMD"]]);

/** A snapshot's sections by SNAP_ (net-tap.ts), and the category of each. */
export const SECTIONS = ["head", "own body", "contacts", "bodies", "rest"] as const;
const SECTION_CATEGORY: readonly number[] = [PLAYER, PLAYER, BODIES, BODIES, BODIES];
/** A delta's ops by view.ts's OP_. */
export const OPS = ["update", "create", "remove", "died"] as const;
/** What a body is, by its kind (bodyClass). */
export const BODY_CLASSES = ["survivor", "creature", "vehicle", "other"] as const;
const SURVIVOR = 0;
const CREATURE = 1;
const VEHICLE = 2;
const BODY_OTHER = 3;
/** A second's body ops: by op, then by class. */
const CELLS = OPS.length * BODY_CLASSES.length;

/** The category (an index into CATEGORIES) of a message by the names of its kind and its sub-kind ("" for none). */
export function categoryOf(kind: string, sub = ""): number {
  return CATEGORY_OF.get(sub) ?? CATEGORY_OF.get(kind) ?? OTHER;
}

/** The class of body (an index into BODY_CLASSES) of each entity kind of `reg`. A civilian is a creature; a prop or a target is other. */
export function bodyClass(reg: Pick<Registry, "defs" | "vehicle">): (kind: number) => number {
  const of = new Uint8Array(reg.defs.length).fill(BODY_OTHER);
  for (let k = 0; k < reg.defs.length; k++) {
    const d = reg.defs[k];
    if (d?.type !== "species") continue;
    of[k] = reg.vehicle[k] || d.class === "vehicle" ? VEHICLE : d.class === "survivor" ? SURVIVOR : d.class === "creature" || d.class === "civilian" ? CREATURE : BODY_OTHER;
  }
  return (kind) => of[kind] ?? BODY_OTHER;
}

/** A row of the network tab's table: a kind of message, one of its sub-kinds, or a section of the snapshots. */
export interface NetRow {
  /** NET_IN or NET_OUT. */
  dir: number;
  /** Its S_ or C_ code, and its sub-kind's code, its section's SNAP_, or -1. */
  kind: number;
  sub: number;
  section: boolean;
  /** "S_EVENT", or its family and number until names come ("S 9"); "EVENT_HIT", a section's name, a number, or "". */
  kindName: string;
  subName: string;
  /** An index into CATEGORIES. */
  category: number;
  /** A second, over the last whole second and as the mean of the last ten. The snapshots' messages are on their bodies section. */
  bytes: number;
  messages: number;
  bytes10: number;
  messages10: number;
  /** Since the log began. */
  bytesAll: number;
  messagesAll: number;
}

/** The snapshots' parts a second, which NetLog.snapshots fills. */
export class SnapshotParts {
  /** Snapshots a second, and the longest gap between two in ms. */
  count = 0;
  gap = 0;
  /** Ms since the newest came, or -1 before the first. */
  since = -1;
  /** Bits a second of each section, by SNAP_. */
  readonly sections = new Float64Array(SECTIONS.length);
  /** Bits a second of the ops on each class of body, by BODY_CLASSES. */
  readonly classes = new Float64Array(BODY_CLASSES.length);
  /** Bits a second, and ops a second, by op and class: [op * BODY_CLASSES.length + class]. */
  readonly opBits = new Float64Array(CELLS);
  readonly ops = new Float64Array(CELLS);
  /** Bits a second of the deltas' counts of ops. */
  countBits = 0;
}

/** One kind of message, or one sub-kind of one, one way. */
class Key {
  readonly dir: number;
  readonly kind: number;
  readonly sub: number;
  /** By slot. */
  readonly msgs = new Uint32Array(RING);
  readonly bytes = new Uint32Array(RING);
  msgsAll = 0;
  bytesAll = 0;
  kindName = "";
  subName = "";
  category = OTHER;

  constructor(dir: number, kind: number, sub: number) {
    this.dir = dir;
    this.kind = kind;
    this.sub = sub;
  }
}

const slotOf = (second: number): number => ((second % RING) + RING) % RING;

function rowAt(out: NetRow[], i: number): NetRow {
  return (out[i] ??= { dir: 0, kind: 0, sub: 0, section: false, kindName: "", subName: "", category: 0, bytes: 0, messages: 0, bytes10: 0, messages10: 0, bytesAll: 0, messagesAll: 0 });
}

function divide(a: Float64Array, n: number): void {
  for (let i = 0; i < a.length; i++) a[i]! /= n;
}

export class NetLog implements NetTap {
  /** The class of body (an index into BODY_CLASSES) of an entity kind. Set it again when the content changes. */
  classify: (kind: number) => number;
  /** Since the log began. */
  bytesIn = 0;
  bytesOut = 0;
  messagesIn = 0;
  messagesOut = 0;
  private readonly clock: { now(): number };
  private names: CodeNames | null = null;
  private readonly keys: Key[] = [];
  private readonly byCode = new Map<number, Key>();
  /** The second the log began in, the second under way, and its slot. */
  private readonly first: number;
  private second: number;
  private slot: number;
  /** By slot: the snapshots' bits by section; their body ops' bits and number by op and class; their counts' bits; the longest gap before one. */
  private readonly sectionBits = new Uint32Array(RING * SECTIONS.length);
  private readonly opBits = new Uint32Array(RING * CELLS);
  private readonly opCount = new Uint32Array(RING * CELLS);
  private readonly countBits = new Uint32Array(RING);
  private readonly gaps = new Float64Array(RING);
  private readonly sectionAll = new Float64Array(SECTIONS.length);
  /** Messages received, and the newest's key and time; then the message that was the newest snapshot, its key and time. */
  private seq = 0;
  private last: Key | null = null;
  private at = 0;
  private snapSeq = -1;
  private snap: Key | null = null;
  private snapAt = -1;

  /** `clock` is the page's, in ms. */
  constructor(clock: { now(): number }, classify: (kind: number) => number) {
    this.clock = clock;
    this.classify = classify;
    this.second = this.first = Math.floor(clock.now() / 1000);
    this.slot = slotOf(this.second);
  }

  received(kind: number, sub: number, bytes: number): void {
    this.note(NET_IN, kind, sub, bytes);
  }

  sent(kind: number, sub: number, bytes: number): void {
    this.note(NET_OUT, kind, sub, bytes);
  }

  snapshot(section: number, op: number, kind: number, bits: number): void {
    if (this.snapSeq !== this.seq) this.began();
    const slot = this.slot;
    this.sectionBits[slot * SECTIONS.length + section]! += bits;
    this.sectionAll[section]! += bits;
    if (section !== SNAP_BODIES) return;
    if (op < 0) {
      this.countBits[slot]! += bits;
      return;
    }
    const cell = slot * CELLS + op * BODY_CLASSES.length + this.classify(kind);
    this.opBits[cell]! += bits;
    this.opCount[cell]!++;
  }

  /** Names each kind and sub-kind by the server's codes, and puts each in its category. */
  setNames(names: CodeNames): void {
    this.names = names;
    for (const key of this.keys) this.name(key);
  }

  /**
   * Bytes and messages a second by category for each of the last `n` whole seconds, oldest first: category `c`'s for the
   * i-th at [c * n + i], so each array needs CATEGORIES.length * n numbers. A second not kept is 0. `dir` takes what came in
   * (NET_IN) or what went out (NET_OUT) alone, -1 both.
   */
  series(n: number, bytes: Float64Array, msgs: Float64Array, dir = -1): void {
    this.roll(this.clock.now());
    bytes.fill(0, 0, CATEGORIES.length * n);
    msgs.fill(0, 0, CATEGORIES.length * n);
    for (let i = 0; i < n; i++) {
      const second = this.second - n + i;
      if (second < this.first || second < this.second - SECONDS) continue;
      const slot = slotOf(second);
      for (const key of this.keys) {
        if (dir >= 0 && key.dir !== dir) continue;
        if (key !== this.snap) {
          bytes[key.category * n + i]! += key.bytes[slot]!;
          msgs[key.category * n + i]! += key.msgs[slot]!;
          continue;
        }
        msgs[BODIES * n + i]! += key.msgs[slot]!;
        for (let s = 0; s < SECTIONS.length; s++) bytes[SECTION_CATEGORY[s]! * n + i]! += this.sectionBits[slot * SECTIONS.length + s]! / 8;
      }
    }
  }

  /**
   * A row for each kind and sub-kind seen, the snapshots' sections each a row in place of their kind's, into `out` from
   * its start; rows it lacks are added. Returns how many it filled.
   */
  rows(out: NetRow[]): number {
    this.roll(this.clock.now());
    let n = 0;
    for (const key of this.keys) {
      if (key !== this.snap) this.fillRow(rowAt(out, n++), key, -1);
      else for (let s = 0; s < SECTIONS.length; s++) this.fillRow(rowAt(out, n++), key, s);
    }
    return n;
  }

  /** Fills `out` with the snapshots' parts a second over the last `seconds` whole seconds. */
  snapshots(out: SnapshotParts, seconds = 1): void {
    const now = this.clock.now();
    this.roll(now);
    const n = this.whole(seconds);
    out.count = out.gap = out.countBits = 0;
    out.since = this.snapAt < 0 ? -1 : now - this.snapAt;
    out.sections.fill(0);
    out.classes.fill(0);
    out.opBits.fill(0);
    out.ops.fill(0);
    for (let i = 1; i <= n; i++) {
      const slot = slotOf(this.second - i);
      out.count += this.snap ? this.snap.msgs[slot]! : 0;
      out.gap = Math.max(out.gap, this.gaps[slot]!);
      out.countBits += this.countBits[slot]!;
      for (let s = 0; s < SECTIONS.length; s++) out.sections[s]! += this.sectionBits[slot * SECTIONS.length + s]!;
      for (let c = 0; c < CELLS; c++) {
        out.opBits[c]! += this.opBits[slot * CELLS + c]!;
        out.ops[c]! += this.opCount[slot * CELLS + c]!;
        out.classes[c % BODY_CLASSES.length]! += this.opBits[slot * CELLS + c]!;
      }
    }
    if (n === 0) return;
    out.count /= n;
    out.countBits /= n;
    divide(out.sections, n);
    divide(out.classes, n);
    divide(out.opBits, n);
    divide(out.ops, n);
  }

  /** Bytes in, bytes out, messages in and messages out a second over the last `seconds` whole seconds, into `out`. */
  rates(out: Float64Array, seconds = 1): void {
    this.roll(this.clock.now());
    const n = this.whole(seconds);
    out.fill(0, 0, 4);
    for (let i = 1; i <= n; i++) {
      const slot = slotOf(this.second - i);
      for (const key of this.keys) {
        out[key.dir]! += key.bytes[slot]!;
        out[2 + key.dir]! += key.msgs[slot]!;
      }
    }
    if (n > 0) for (let j = 0; j < 4; j++) out[j]! /= n;
  }

  private note(dir: number, kind: number, sub: number, bytes: number): void {
    const at = this.clock.now();
    this.roll(at);
    const code = (dir << 17) | ((kind & 0xff) << 9) | ((sub + 1) & 0x1ff);
    const key = this.byCode.get(code) ?? this.add(dir, kind, sub, code);
    key.msgs[this.slot]!++;
    key.bytes[this.slot]! += bytes;
    key.msgsAll++;
    key.bytesAll += bytes;
    if (dir === NET_OUT) {
      this.bytesOut += bytes;
      this.messagesOut++;
      return;
    }
    this.bytesIn += bytes;
    this.messagesIn++;
    // Sections told from now are this message's, though the session may send an input while it reads a snapshot.
    this.seq++;
    this.last = key;
    this.at = at;
  }

  /** A key first seen. */
  private add(dir: number, kind: number, sub: number, code: number): Key {
    const key = new Key(dir, kind, sub);
    this.name(key);
    this.keys.push(key);
    this.byCode.set(code, key);
    return key;
  }

  private name(key: Key): void {
    const names = this.names;
    const kind = names?.[key.dir === NET_IN ? "S" : "C"][key.kind];
    const family = kind === undefined ? undefined : SUB_FAMILY.get(kind);
    const sub = key.sub < 0 ? "" : family === undefined ? undefined : names![family][key.sub];
    key.kindName = kind ?? `${key.dir === NET_IN ? "S" : "C"} ${key.kind}`;
    key.subName = sub ?? String(key.sub);
    key.category = kind === undefined ? OTHER : categoryOf(kind, sub);
  }

  /** The newest message is a snapshot, and this its first section. */
  private began(): void {
    this.snapSeq = this.seq;
    this.snap = this.last;
    const slot = this.slot;
    if (this.snapAt >= 0 && this.at - this.snapAt > this.gaps[slot]!) this.gaps[slot] = this.at - this.snapAt;
    this.snapAt = this.at;
  }

  /** Moves the second under way to the one `at` is in, emptying the slots of the seconds it passes into. */
  private roll(at: number): void {
    const second = Math.floor(at / 1000);
    if (second <= this.second) return;
    for (let s = Math.max(this.second + 1, second - SECONDS); s <= second; s++) this.empty(slotOf(s));
    this.second = second;
    this.slot = slotOf(second);
  }

  private empty(slot: number): void {
    for (const key of this.keys) {
      key.msgs[slot] = 0;
      key.bytes[slot] = 0;
    }
    this.sectionBits.fill(0, slot * SECTIONS.length, (slot + 1) * SECTIONS.length);
    this.opBits.fill(0, slot * CELLS, (slot + 1) * CELLS);
    this.opCount.fill(0, slot * CELLS, (slot + 1) * CELLS);
    this.countBits[slot] = 0;
    this.gaps[slot] = 0;
  }

  /** How many of the last `seconds` whole seconds the log has. */
  private whole(seconds: number): number {
    return Math.max(0, Math.min(seconds, SECONDS, this.second - this.first));
  }

  /** The sum over the last `n` whole seconds of a column whose slot `slot` is at [slot * stride + at]. */
  private sum(column: Uint32Array, n: number, stride = 1, at = 0): number {
    let total = 0;
    for (let i = 1; i <= n; i++) total += column[slotOf(this.second - i) * stride + at]!;
    return total;
  }

  /** Fills `row` as `key`, or as section `section` of the snapshots, which `key` is the kind of (-1 for none). */
  private fillRow(row: NetRow, key: Key, section: number): void {
    const one = this.whole(1);
    const ten = this.whole(10);
    const mean = 1 / Math.max(1, ten);
    const whole = section < 0;
    // A section's bits are at [slot * SECTIONS.length + section]; the snapshots' messages count on their bodies.
    const bytes = whole ? key.bytes : this.sectionBits;
    const stride = whole ? 1 : SECTIONS.length;
    const at = whole ? 0 : section;
    const scale = whole ? 1 : 1 / 8;
    const msgs = whole || section === SNAP_BODIES;
    row.dir = key.dir;
    row.kind = key.kind;
    row.sub = whole ? key.sub : section;
    row.section = !whole;
    row.kindName = key.kindName;
    row.subName = whole ? key.subName : SECTIONS[section]!;
    row.category = whole ? key.category : SECTION_CATEGORY[section]!;
    row.bytes = this.sum(bytes, one, stride, at) * scale;
    row.bytes10 = this.sum(bytes, ten, stride, at) * scale * mean;
    row.bytesAll = whole ? key.bytesAll : this.sectionAll[section]! * scale;
    row.messages = msgs ? this.sum(key.msgs, one) : 0;
    row.messages10 = msgs ? this.sum(key.msgs, ten) * mean : 0;
    row.messagesAll = msgs ? key.msgsAll : 0;
  }
}
