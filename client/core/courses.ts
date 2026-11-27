// The tame orders that walk a course (server/courses.ts): to a pin or where one looks, and a patrol of pins in order.
// Both ride CMD_ORDER.

import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_ORDER, ORDER_MOVE, ORDER_PATROL } from "../../shared/net/protocol.ts";
import { WAYPOINT_KINDS } from "../../shared/world/course.ts";
import type { PinView } from "./pins.ts";

/** Pins a patrol walks at the most, as the server takes them. */
export const PATROL_MOST = 8;
const GO = WAYPOINT_KINDS.indexOf("go");

export interface OrderSender {
  command(op: number, args?: (w: BitWriter) => void): number;
}

/** Sends tame `which` (an entity index, or ORDER_ALL) to pin `pin`, or with 0 to where the survivor looks. */
export function orderMove(s: OrderSender, which: number, pin: number): number {
  return s.command(CMD_ORDER, (w) => {
    w.u32(which >>> 0);
    w.u8(ORDER_MOVE);
    w.varint(pin);
  });
}

/** Sends `which` round `pins` in order, or back and forth along them. 0, and nothing sent, for none; past PATROL_MOST are left out. */
export function orderPatrol(s: OrderSender, which: number, pins: readonly number[], back: boolean): number {
  const n = Math.min(PATROL_MOST, pins.length);
  if (n === 0) return 0;
  return s.command(CMD_ORDER, (w) => {
    w.u32(which >>> 0);
    w.u8(ORDER_PATROL);
    w.bool(back);
    w.bits(n - 1, 3);
    for (let i = 0; i < n; i++) w.varint(pins[i]!);
  });
}

/** The ids of the tribe's shared pins of kind "go", in the order they were placed, as many as a patrol takes. */
export function goPins(pins: readonly PinView[], out: number[] = []): number[] {
  out.length = 0;
  for (const p of pins) if (p.kind === GO && p.shared && out.length < PATROL_MOST) out.push(p.id);
  return out;
}
