// The team's pins as the server tells them (OWN_PINS), the commands that place and remove one (CMD_PIN), and how the
// maps and the compass show each kind.

import type { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { fitBytes } from "../../shared/net/codec.ts";
import { CMD_PIN, MAX_NAME_BYTES, PIN_ADD, PIN_LABEL_BYTES, PIN_LOOK, PIN_REMOVE } from "../../shared/net/protocol.ts";
import { TICK_RATE } from "../../shared/coords.ts";

export interface PinView {
  id: number;
  /** An index of WAYPOINT_KINDS (shared/world/course.ts). */
  kind: number;
  shared: boolean;
  /** The reader placed it. */
  mine: boolean;
  /** Its author's name, "" where the server knows none. */
  author: string;
  x: number;
  z: number;
  radius: number;
  priority: number;
  pull: number;
  /** The tick it was placed at, and the tick it goes at (0 for never). */
  at: number;
  expires: number;
  label: string;
}

/** By WAYPOINT_KINDS: the words a pin's kind goes by, and its colour on the maps and the compass. */
export const PIN_WORDS: readonly string[] = ["Go", "Danger", "Enemy", "Supply", "Meet"];
export const PIN_TINT: readonly number[] = [0x8ee86a, 0xffa23a, 0xff4d5e, 0xc9a0ff, 0x4fe3d0];

/** Reads OWN_PINS into `out`, which is left as it was if the message is short. */
export function readPins(r: BitReader, out: PinView[]): void {
  const n = r.u8();
  const names: string[] = [];
  for (let k = r.u8(); k > 0 && !r.overflow; k--) names.push(r.string(MAX_NAME_BYTES * 3));
  const list: PinView[] = [];
  for (let i = 0; i < n && !r.overflow; i++) {
    const id = r.varint(), kind = r.bits(3), shared = r.bool(), mine = r.bool(), author = names[r.u8()] ?? "";
    const x = r.f32(), z = r.f32(), radius = r.u16() / 10, priority = r.bits(3), pull = r.sbits(8) / 127, at = r.u32();
    const expires = r.bool() ? r.u32() : 0;
    const label = r.string(PIN_LABEL_BYTES);
    list.push({ id, kind, shared, mine, author, x, z, radius, priority, pull, at, expires, label });
  }
  if (r.overflow) return;
  out.length = 0;
  for (const p of list) out.push(p);
}

/** What sends a command: the session. */
export interface PinSender {
  command(op: number, args?: (w: BitWriter) => void): number;
}

/** Asks for a pin at (x, z) on the map. Returns the command's sequence number, 0 if nothing was sent. */
export function pinAt(s: PinSender, x: number, z: number, kind: number, shared: boolean, label: string): number {
  return s.command(CMD_PIN, (w) => {
    w.bits(PIN_ADD, 2);
    w.f32(x);
    w.f32(z);
    writeChoice(w, kind, shared, label);
  });
}

/** Asks for a pin where the survivor looks, which the server finds. */
export function pinLook(s: PinSender, kind: number, shared: boolean, label: string): number {
  return s.command(CMD_PIN, (w) => {
    w.bits(PIN_LOOK, 2);
    writeChoice(w, kind, shared, label);
  });
}

export function unpin(s: PinSender, id: number): number {
  return s.command(CMD_PIN, (w) => {
    w.bits(PIN_REMOVE, 2);
    w.varint(id);
  });
}

function writeChoice(w: BitWriter, kind: number, shared: boolean, label: string): void {
  w.bits(kind, 3);
  w.bool(shared);
  w.string(fitBytes(label.trim(), PIN_LABEL_BYTES));
}

/** Whether the reader may take the pin away: its own, or any as its tribe's owner or a rank above member (server/tribes.ts). */
export function mayUnpin(p: PinView, rank: number): boolean {
  return p.mine || rank > 0;
}

/** How long ago tick `at` was at tick `now`, in a word or two. */
export function pinAge(now: number, at: number): string {
  const s = Math.max(0, Math.floor((now - at) / TICK_RATE));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h`;
}
