// The board's own state, owned by the rider's body through prediction and reconciliation. A parked board starts fresh.
import type { BitReader, BitWriter } from "../net/codec.ts";

/** What the rider is doing. `trick` says which trick of it (shared/sim/skate-tricks.ts). */
export const ROLL = 0, PUSH = 1, OLLIE = 2, FLIP = 3, SPECIAL = 4, GRIND = 5, BAIL = 6, MANUAL = 7, GRAB = 8, REVERT = 9, SLIDE = 10;
export const SKATE_MOVES = ["Rolling", "Pushing", "Ollie", "Flip", "Special", "Grind", "Bail", "Manual", "Grab", "Revert", "Slide"];

/** Entries of a line kept for the feed and for counting repeats. */
export const LINE_MOST = 16;
/** Ticks of holding the pop to reach a full-height ollie. */
export const CHARGE_TICKS = 12;
export const SPECIAL_FULL = 1000;
/** Metres from a board a survivor can step onto it with the use key, as after a fall. */
export const BOARD_REACH = 4;

export class SkateState {
  move = ROLL;
  trick = 0;
  ticks = 0;
  keys = 0;
  /** Ticks since leaving the ground in which a pop still works. */
  grace = 0;
  /** Ticks a pop let go of in the air waits for the ground. */
  buffer = 0;
  /** Ticks the pop has been held, up to CHARGE_TICKS. */
  charge = 0;
  /** Degrees the rider and deck have turned in this air, and are turning each tick. */
  spin = 0;
  spinRate = 0;
  /** Ticks a turn key has been held in this air. */
  spinHold = 0;
  /** The movement keys held last tick (up 1, down 2, left 4, right 8), those that pick no trick until pressed again,
   * and the ticks since one was last pressed. */
  held = 0;
  lock = 0;
  pressAge = 255;
  /** Ticks left in which a landing counts as Perfect, set by a pop pressed in the air. */
  perfect = 0;
  /** Ticks since the last landing, up to 255. */
  landed = 255;
  /** How the last landing went (skate-tricks.ts GRADE_*). */
  grade = 0;
  balance = 0;
  /** Millimetres on the current edge or manual not yet paid, and whether the edge or manual is in the line yet. */
  distance = 0;
  paid = false;
  /** The line: its points before the multiplier, the multiplier, and the points of this air not yet landed. */
  points = 0;
  chain = 0;
  airPoints = 0;
  /** Entries of this air not yet landed. */
  pending = 0;
  /** The last banked line, and how many lines have been banked, wrapping at 256. */
  bank = 0;
  banks = 0;
  /** Ticks left before rolling banks the line. */
  window = 0;
  switched = false;
  /** Released, braking to a stop, or stepping backwards. */
  brake = 0;
  special = 0;
  /** The ground's rise along travel, in thousandths, for a launch off a ramp. */
  rise = 0;
  /** Entries in the line, which may be more than are kept. */
  count = 0;
  readonly line = new Uint16Array(LINE_MOST);
}

export function copySkate(target: SkateState | null, s: SkateState | null): SkateState | null {
  if (!s) return null;
  const t = target ?? new SkateState();
  t.move = s.move; t.trick = s.trick; t.ticks = s.ticks; t.keys = s.keys; t.grace = s.grace; t.buffer = s.buffer;
  t.charge = s.charge; t.spin = s.spin; t.spinRate = s.spinRate; t.spinHold = s.spinHold; t.held = s.held; t.lock = s.lock; t.pressAge = s.pressAge;
  t.perfect = s.perfect; t.landed = s.landed; t.grade = s.grade; t.balance = s.balance; t.distance = s.distance; t.paid = s.paid;
  t.points = s.points; t.chain = s.chain; t.airPoints = s.airPoints; t.pending = s.pending; t.bank = s.bank; t.banks = s.banks;
  t.window = s.window; t.switched = s.switched; t.brake = s.brake; t.special = s.special; t.rise = s.rise; t.count = s.count;
  t.line.set(s.line);
  return t;
}

export function sameSkate(a: SkateState | null, b: SkateState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.move !== b.move || a.trick !== b.trick || a.ticks !== b.ticks || a.keys !== b.keys || a.grace !== b.grace ||
    a.buffer !== b.buffer || a.charge !== b.charge || a.spin !== b.spin || a.spinRate !== b.spinRate ||
    a.spinHold !== b.spinHold || a.held !== b.held || a.lock !== b.lock || a.pressAge !== b.pressAge || a.perfect !== b.perfect || a.landed !== b.landed ||
    a.grade !== b.grade || a.balance !== b.balance || a.distance !== b.distance || a.paid !== b.paid || a.points !== b.points ||
    a.chain !== b.chain || a.airPoints !== b.airPoints || a.pending !== b.pending || a.bank !== b.bank ||
    a.banks !== b.banks || a.window !== b.window || a.switched !== b.switched || a.brake !== b.brake ||
    a.special !== b.special || a.rise !== b.rise || a.count !== b.count) return false;
  for (let i = 0; i < LINE_MOST; i++) if (a.line[i] !== b.line[i]) return false;
  return true;
}

/** The owner's copy, sent with its body. */
export function writeSkate(w: BitWriter, s: SkateState): void {
  w.u8(s.move); w.u8(s.trick); w.u8(s.ticks); w.u16(s.keys);
  w.bits(s.grace, 3); w.bits(s.buffer, 3); w.bits(s.charge, 4);
  w.svarint(s.spin); w.sbits(s.spinRate, 7); w.bits(s.spinHold, 4); w.bits(s.held, 4); w.bits(s.lock, 4); w.u8(s.pressAge);
  w.bits(s.perfect, 2); w.u8(s.landed); w.bits(s.grade, 2);
  w.svarint(s.balance); w.varint(s.distance); w.bool(s.paid);
  w.varint(s.points); w.u8(s.chain); w.varint(s.airPoints); w.bits(s.pending, 3);
  w.varint(s.bank); w.u8(s.banks); w.u8(s.window); w.bool(s.switched); w.bits(s.brake, 2);
  w.bits(s.special, 10); w.svarint(s.rise); w.varint(s.count);
  const kept = Math.min(s.count, LINE_MOST);
  for (let i = 0; i < kept; i++) w.u16(s.line[i]!);
}

export function readSkate(r: BitReader, s: SkateState): void {
  s.move = r.u8(); s.trick = r.u8(); s.ticks = r.u8(); s.keys = r.u16();
  s.grace = r.bits(3); s.buffer = r.bits(3); s.charge = r.bits(4);
  s.spin = r.svarint(); s.spinRate = r.sbits(7); s.spinHold = r.bits(4); s.held = r.bits(4); s.lock = r.bits(4); s.pressAge = r.u8();
  s.perfect = r.bits(2); s.landed = r.u8(); s.grade = r.bits(2);
  s.balance = r.svarint(); s.distance = r.varint(); s.paid = r.bool();
  s.points = r.varint(); s.chain = r.u8(); s.airPoints = r.varint(); s.pending = r.bits(3);
  s.bank = r.varint(); s.banks = r.u8(); s.window = r.u8(); s.switched = r.bool(); s.brake = r.bits(2);
  s.special = r.bits(10); s.rise = r.svarint(); s.count = r.varint();
  const kept = Math.min(s.count, LINE_MOST);
  s.line.fill(0);
  for (let i = 0; i < kept; i++) s.line[i] = r.u16();
}

/** What others see of a rider besides the move and its phase: the trick, the crouch of a held pop, the last landing's
 * grade and a full special meter, in the word a car's thrusters use (server/replication.ts). */
export function packSkateWord(s: SkateState): number {
  return (s.trick & 127) | (Math.round(s.charge * 7 / CHARGE_TICKS) << 7) | ((s.grade & 3) << 10) | (s.special >= SPECIAL_FULL ? 1 << 12 : 0);
}
export const skateWordTrick = (n: number): number => n & 127;
export const skateWordCrouch = (n: number): number => ((n >>> 7) & 7) / 7;
export const skateWordGrade = (n: number): number => (n >>> 10) & 3;
export const skateWordSpecial = (n: number): boolean => (n & (1 << 12)) !== 0;
