// A round that flies, as it is told to those who see it (EVENT_BOLTS): 99 bits where EVENT_SHOT is 35 bytes, and a
// tick's rounds in one message. A client draws from it and decides nothing, so its start is to 2 cm and its way to a
// fiftieth of a degree.

import type { BitReader, BitWriter } from "./codec.ts";

/** Rounds one message holds. */
export const BOLTS_MOST = 255;
/** Most ticks since a round left that a message says: the server looks back no further (server/combat.ts REWIND_TICKS). */
export const BOLT_BACK_MOST = 15;

/** Steps to a metre, level and up, and how far below the map's zero a start may be. */
const LEVEL = 64;
const UP = 32;
const DEEP = 1024;
const LEVEL_BITS = 24;
const UP_BITS = 18;
const YAW_BITS = 14;
const PITCH_BITS = 13;
const YAW_STEPS = 1 << YAW_BITS;
const PITCH_STEPS = (1 << PITCH_BITS) - 1;
const clamp = (v: number, most: number): number => (v < 0 ? 0 : v > most ? most : v);

/** One round as read: where it left, the unit way it went, its ammunition, the ticks since it left and whether its gun is silenced. */
export const bolt = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, ammo: 0, back: 0, silenced: false };

/** A round's start and way as the message says them, worked out once for all who are told: x, y, z, yaw, pitch. */
export function packBolt(x: number, y: number, z: number, dx: number, dy: number, dz: number, out: Uint32Array, at: number): void {
  out[at] = clamp(Math.round(x * LEVEL), (1 << LEVEL_BITS) - 1);
  out[at + 1] = clamp(Math.round((y + DEEP) * UP), (1 << UP_BITS) - 1);
  out[at + 2] = clamp(Math.round(z * LEVEL), (1 << LEVEL_BITS) - 1);
  const yaw = Math.atan2(dx, dz);
  out[at + 3] = Math.round(((yaw < 0 ? yaw + 2 * Math.PI : yaw) / (2 * Math.PI)) * YAW_STEPS) % YAW_STEPS;
  out[at + 4] = Math.round((Math.asin(dy < -1 ? -1 : dy > 1 ? 1 : dy) / Math.PI + 0.5) * PITCH_STEPS);
}

/**
 * Writes the round packed at `at` of `packed`. `last` is the ammunition of the round written before it in this message, 0
 * for the first: a round of the same is said in one bit.
 */
export function writeBolt(w: BitWriter, packed: Uint32Array, at: number, ammo: number, back: number, silenced: boolean, last: number): void {
  w.bits(packed[at]!, LEVEL_BITS);
  w.bits(packed[at + 1]!, UP_BITS);
  w.bits(packed[at + 2]!, LEVEL_BITS);
  w.bits(packed[at + 3]!, YAW_BITS);
  w.bits(packed[at + 4]!, PITCH_BITS);
  w.bool(ammo === last);
  if (ammo !== last) w.u16(ammo);
  w.bits(clamp(Math.round(back), BOLT_BACK_MOST), 4);
  w.bool(silenced);
}

/** Reads one round into `bolt`. `last` as for writeBolt. */
export function readBolt(r: BitReader, last: number): void {
  bolt.x = r.bits(LEVEL_BITS) / LEVEL;
  bolt.y = r.bits(UP_BITS) / UP - DEEP;
  bolt.z = r.bits(LEVEL_BITS) / LEVEL;
  const yaw = (r.bits(YAW_BITS) / YAW_STEPS) * 2 * Math.PI;
  const pitch = (r.bits(PITCH_BITS) / PITCH_STEPS - 0.5) * Math.PI;
  const level = Math.cos(pitch);
  bolt.dx = Math.sin(yaw) * level;
  bolt.dy = Math.sin(pitch);
  bolt.dz = Math.cos(yaw) * level;
  bolt.ammo = r.bool() ? last : r.u16();
  bolt.back = r.bits(4);
  bolt.silenced = r.bool();
}
