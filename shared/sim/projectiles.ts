// The server flies each arrow and dart to find what it hits, and a client flies the same ones to draw them.
// Each tick a projectile covers one straight piece, within two millimetres of the true curve at thirty ticks a second.

import { TICK_DT } from "../coords.ts";

/** Metres. A shot with no flight speed (a rifle round) is one ray, tested the tick it is fired. */
export const HITSCAN_RANGE = 600;
/** An undrawn bow sends its arrow at this share of full speed. */
export const DRAW_SPEED_MIN = 38 / 70;
/** The share of its speed a projectile keeps on entering water, if its weapon is made for water. Any other stops at the surface. */
export const WATER_SPEED = 0.4;
/** Ten seconds. A projectile still flying after that is dropped. */
export const FLIGHT_TICKS = 300;

/** `draw` is 0 to 1. */
export function launchSpeed(full: number, draw: number): number {
  const d = draw <= 0 ? 0 : draw >= 1 ? 1 : draw;
  return full * (DRAW_SPEED_MIN + (1 - DRAW_SPEED_MIN) * d);
}

export interface Flight {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** The piece the last flyStep covered: its start, unit direction and length. */
export const piece = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, length: 0 };

/** Writes the piece `f` would cover in `dt` seconds to `piece` without moving `f`. `gravity` is in metres per second squared, downward. */
export function flyStep(f: Flight, gravity: number, dt = TICK_DT): void {
  const sx = f.vx * dt;
  const sy = f.vy * dt - 0.5 * gravity * dt * dt;
  const sz = f.vz * dt;
  const length = Math.sqrt(sx * sx + sy * sy + sz * sz);
  piece.x = f.x;
  piece.y = f.y;
  piece.z = f.z;
  piece.length = length;
  if (length > 0) {
    piece.dx = sx / length;
    piece.dy = sy / length;
    piece.dz = sz / length;
  }
}

/** Moves `f` to the end of that piece. Pass the same `dt` as the flyStep before it. */
export function flyEnd(f: Flight, gravity: number, dt = TICK_DT): void {
  f.x = piece.x + piece.dx * piece.length;
  f.y = piece.y + piece.dy * piece.length;
  f.z = piece.z + piece.dz * piece.length;
  f.vy -= gravity * dt;
}
