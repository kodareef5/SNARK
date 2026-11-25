// The map events every session is told of (planning/workstreams/map-events.md): one message, S_MAPEVENT, carrying
// every event that is live or has just ended, whole, after a change and to a session that has just come. Nothing is
// sent per tick: a craft's pose is worked out from its path (shared/sim/craft.ts). Parts carry their looks as data, in
// a table at the head of the message, so a client draws a kind it has never heard of by its parts.
//
// What the server simulates is rounded to the steps the wire carries before the server uses it (`wireCraft`), so the
// server and every client work from the same numbers.

import type { BitReader, BitWriter } from "../net/codec.ts";
import { CRAFT_MOST_POINTS, type PathPoint } from "../sim/craft.ts";
import type { ColumnLook, CraftLook, CraftSpec } from "./parts.ts";

/** Called and coming; come; over, and told a little longer so its going is seen. */
export const MAPEVENT_NOTICE = 0;
export const MAPEVENT_LIVE = 1;
export const MAPEVENT_ENDED = 2;
export const MAPEVENT_STATES = ["notice", "live", "ended"] as const;

const ROWS_BITS = 4;
/** The most rows a message carries: live events, and those that have just ended. */
export const MAPEVENT_ROWS = (1 << ROWS_BITS) - 1;
const PARTS_BITS = 3;
/** The most parts of one event a message carries. */
export const ROW_PARTS = (1 << PARTS_BITS) - 1;
/** Looks are counted and named in 7 bits: room for a look to every part of every row (15 × 7). */
const LOOK_BITS = 7;
export const MAPEVENT_LOOKS = (1 << LOOK_BITS) - 1;
/**
 * Bytes the feed may take. The server encodes it once a change into a writer this big, leaving out what does not fit
 * (those that ended first), and sends each session that as one blob.
 */
export const MAPEVENT_BYTES = 12 * 1024;
/** Bytes of a kind's id, and of a sound's owner or a mesh's name. */
const ID_BYTES = 32;
const NAME_BYTES = 72;

export type Look = { readonly type: "craft"; readonly craft: CraftLook } | { readonly type: "column"; readonly column: ColumnLook };

/** A craft as told: its path, its hull and fall as the wire rounds them, and what has befallen it. Ticks are the world's. */
export interface CraftRow {
  type: "craft";
  id: number;
  look: number;
  /** Ticks after its event comes that it enters. */
  after: number;
  radius: number;
  half: number;
  gravity: number;
  bleed: number;
  points: PathPoint[];
  /** How hurt it is: 0 whole, then each quarter of its health gone, 3 at a quarter or less. */
  stage: number;
  /** The tick its shield is broken until, or 0. */
  shieldUntil: number;
  /** The tick it was brought down at, or 0; then the tick it came to rest at, and where. */
  down: number;
  impact: number;
  rx: number;
  ry: number;
  rz: number;
}

/** A site as told: where, and the ticks it shows from and to (0 for as long as its event). */
export interface SiteRow {
  type: "site";
  id: number;
  look: number;
  x: number;
  y: number;
  z: number;
  from: number;
  to: number;
}

export type PartRow = CraftRow | SiteRow;

export interface MapEventRow {
  id: number;
  /** The kind's id, and the owner its own sounds are found under ("" for the cues'). */
  kind: string;
  sound: string;
  state: number;
  /** The tick it was called at, the tick it comes into the world at, and the tick it ended at, or 0. */
  called: number;
  start: number;
  ended: number;
  parts: PartRow[];
}

export interface MapEventFeed {
  looks: Look[];
  rows: MapEventRow[];
}

const POS_BITS = 20;
const HEIGHT_BITS = 18;
const pos = (v: number): number => Math.max(0, Math.min((1 << POS_BITS) - 1, Math.round(v * 32)));
const height = (v: number): number => Math.max(-(1 << (HEIGHT_BITS - 1)), Math.min((1 << (HEIGHT_BITS - 1)) - 1, Math.round(v * 32)));
/** A quarter of a metre, as a hull's size and a fall's pull are told. */
const quarter = (v: number): number => Math.max(1, Math.min(255, Math.round(v * 4)));
/** A share as a 255th. */
const share = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * A craft's numbers as the wire carries them: its points in 32nds of a metre and whole metres a second, its hull and
 * fall in quarters and 255ths. The server makes a craft from this, so it judges shots and falls by what clients read.
 */
export function wireCraft(spec: CraftSpec): { points: PathPoint[]; radius: number; half: number; gravity: number; bleed: number } {
  const fall = spec.fall ?? { gravity: 7.5, bleed: 0.12 };
  return {
    points: spec.points.map((p) => ({ x: pos(p.x) / 32, y: height(p.y) / 32, z: pos(p.z) / 32, speed: Math.max(1, Math.min(255, Math.round(p.speed))), low: p.low })),
    radius: quarter(spec.hull.radius) / 4,
    half: quarter(spec.hull.half) / 4,
    gravity: quarter(fall.gravity) / 4,
    bleed: share(fall.bleed) / 255,
  };
}

/** A key that is the same for looks that are the same, for the table at a message's head. */
export const lookKey = (look: Look): string => JSON.stringify(look);

function writeLook(w: BitWriter, look: Look): void {
  w.bool(look.type === "column");
  if (look.type === "column") {
    const c = look.column;
    w.bool(c.kind === "light");
    w.bits(c.rgb & 0xffffff, 24);
    w.f32(c.height);
    w.f32(c.wide);
    w.string(c.sound);
    return;
  }
  const l = look.craft;
  w.bits(l.pieces.length - 1, 2);
  for (const p of l.pieces) {
    w.string(p.mesh);
    w.f32(p.spin);
  }
  w.string(l.fallback);
  w.string(l.wreck);
  w.bits(l.glow & 0xffffff, 24);
  w.bits(l.broken & 0xffffff, 24);
  w.bits(l.ember & 0xffffff, 24);
  w.bool(l.beam !== null);
  if (l.beam) {
    w.bits(l.beam.rgb & 0xffffff, 24);
    w.f32(l.beam.wide);
    w.f32(l.beam.drop);
  }
  w.bool(l.smoke !== null);
  if (l.smoke) {
    w.bits(l.smoke.rgb & 0xffffff, 24);
    w.f32(l.smoke.height);
    w.f32(l.smoke.wide);
  }
  w.f32(l.lean);
  w.string(l.sound);
}

function readLook(r: BitReader): Look {
  if (r.bool()) {
    const kind = r.bool() ? "light" : "smoke";
    return { type: "column", column: { kind, rgb: r.bits(24), height: r.f32(), wide: r.f32(), sound: r.string(NAME_BYTES) } };
  }
  const n = r.bits(2) + 1;
  const pieces: { mesh: string; spin: number }[] = [];
  for (let i = 0; i < n; i++) pieces.push({ mesh: r.string(NAME_BYTES), spin: r.f32() });
  const fallback = r.string(NAME_BYTES);
  const wreck = r.string(NAME_BYTES);
  const glow = r.bits(24);
  const broken = r.bits(24);
  const ember = r.bits(24);
  const beam = r.bool() ? { rgb: r.bits(24), wide: r.f32(), drop: r.f32() } : null;
  const smoke = r.bool() ? { rgb: r.bits(24), height: r.f32(), wide: r.f32() } : null;
  const lean = r.f32();
  const sound = r.string(NAME_BYTES);
  return { type: "craft", craft: { pieces, fallback, wreck, glow, broken, ember, beam, smoke, lean, sound } };
}

function writePart(w: BitWriter, p: PartRow, start: number): void {
  w.bool(p.type === "site");
  w.u8(p.id);
  w.bits(p.look, LOOK_BITS);
  if (p.type === "site") {
    w.bits(pos(p.x), POS_BITS);
    w.sbits(height(p.y), HEIGHT_BITS);
    w.bits(pos(p.z), POS_BITS);
    w.varint(Math.max(0, p.from - start));
    w.bool(p.to > 0);
    if (p.to > 0) w.varint(Math.max(0, p.to - start));
    return;
  }
  w.varint(p.after);
  w.u8(quarter(p.radius));
  w.u8(quarter(p.half));
  w.u8(quarter(p.gravity));
  w.u8(share(p.bleed));
  const n = Math.min(CRAFT_MOST_POINTS, p.points.length);
  w.u8(n);
  for (let i = 0; i < n; i++) {
    const q = p.points[i]!;
    w.bits(pos(q.x), POS_BITS);
    w.sbits(height(q.y), HEIGHT_BITS);
    w.bits(pos(q.z), POS_BITS);
    w.u8(Math.max(1, Math.min(255, Math.round(q.speed))));
    w.bool(q.low);
  }
  w.bits(p.stage, 2);
  w.bool(p.shieldUntil > start);
  if (p.shieldUntil > start) w.varint(p.shieldUntil - start);
  w.bool(p.down > 0);
  if (p.down > 0) {
    w.varint(Math.max(0, p.down - start));
    w.varint(Math.max(0, p.impact - p.down));
    w.bits(pos(p.rx), POS_BITS);
    w.sbits(height(p.ry), HEIGHT_BITS);
    w.bits(pos(p.rz), POS_BITS);
  }
}

function readPart(r: BitReader, start: number): PartRow | null {
  const site = r.bool();
  const id = r.u8();
  const look = r.bits(LOOK_BITS);
  if (site) {
    const x = r.bits(POS_BITS) / 32;
    const y = r.sbits(HEIGHT_BITS) / 32;
    const z = r.bits(POS_BITS) / 32;
    const from = start + r.varint();
    const to = r.bool() ? start + r.varint() : 0;
    return { type: "site", id, look, x, y, z, from, to };
  }
  const after = r.varint();
  const radius = r.u8() / 4;
  const half = r.u8() / 4;
  const gravity = r.u8() / 4;
  const bleed = r.u8() / 255;
  const n = r.u8();
  if (n < 2 || n > CRAFT_MOST_POINTS) return null;
  const points: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const x = r.bits(POS_BITS) / 32;
    const y = r.sbits(HEIGHT_BITS) / 32;
    const z = r.bits(POS_BITS) / 32;
    const speed = r.u8();
    const low = r.bool();
    points.push({ x, y, z, speed, low });
  }
  const stage = r.bits(2);
  const shieldUntil = r.bool() ? start + r.varint() : 0;
  let down = 0;
  let impact = 0;
  let rx = 0;
  let ry = 0;
  let rz = 0;
  if (r.bool()) {
    down = start + r.varint();
    impact = down + r.varint();
    rx = r.bits(POS_BITS) / 32;
    ry = r.sbits(HEIGHT_BITS) / 32;
    rz = r.bits(POS_BITS) / 32;
  }
  return { type: "craft", id, look, after, radius, half, gravity, bleed, points, stage, shieldUntil, down, impact, rx, ry, rz };
}

/** The feed, whole, after the message's type (S_MAPEVENT). The server keeps within MAPEVENT_ROWS, MAPEVENT_LOOKS and ROW_PARTS. */
export function writeMapEvents(w: BitWriter, feed: MapEventFeed): void {
  // Reserved for the day a change is sent as a difference: true says the list that follows replaces the one held.
  w.bool(true);
  // A feed the server made never has more: one that did would name looks it did not carry.
  if (feed.looks.length > MAPEVENT_LOOKS) throw new Error(`a feed has ${MAPEVENT_LOOKS} looks at the most`);
  const looks = feed.looks.length;
  w.bits(looks, LOOK_BITS);
  for (let i = 0; i < looks; i++) writeLook(w, feed.looks[i]!);
  const n = Math.min(MAPEVENT_ROWS, feed.rows.length);
  w.bits(n, ROWS_BITS);
  for (let i = 0; i < n; i++) {
    const row = feed.rows[i]!;
    w.u16(row.id);
    w.string(row.kind);
    w.string(row.sound);
    w.bits(row.state, 2);
    w.uint53(row.called);
    w.varint(Math.max(0, row.start - row.called));
    w.bool(row.ended > 0);
    if (row.ended > 0) w.varint(Math.max(0, row.ended - row.start));
    const parts = Math.min(ROW_PARTS, row.parts.length);
    w.bits(parts, PARTS_BITS);
    for (let k = 0; k < parts; k++) writePart(w, row.parts[k]!, row.start);
  }
}

/** Null for a message cut short or one that names a look it did not carry. */
export function readMapEvents(r: BitReader): MapEventFeed | null {
  if (!r.bool()) return null;
  const looks: Look[] = [];
  for (let n = r.bits(LOOK_BITS); n > 0; n--) looks.push(readLook(r));
  const rows: MapEventRow[] = [];
  for (let n = r.bits(ROWS_BITS); n > 0; n--) {
    const id = r.u16();
    const kind = r.string(ID_BYTES);
    const sound = r.string(NAME_BYTES);
    const state = r.bits(2);
    const called = r.uint53();
    const start = called + r.varint();
    const ended = r.bool() ? start + r.varint() : 0;
    const parts: PartRow[] = [];
    for (let k = r.bits(PARTS_BITS); k > 0; k--) {
      const part = readPart(r, start);
      if (!part || part.look >= looks.length || r.overflow) return null;
      if ((part.type === "craft") !== (looks[part.look]!.type === "craft")) return null;
      parts.push(part);
    }
    if (r.overflow || state > MAPEVENT_ENDED) return null;
    rows.push({ id, kind, sound, state, called, start, ended, parts });
  }
  return r.overflow ? null : { looks, rows };
}
