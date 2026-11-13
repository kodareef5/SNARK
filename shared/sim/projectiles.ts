// How a thing in flight moves. The server flies every arrow and dart to find
// what it hits; a client flies the same ones to draw them. Both use this.
//
// A shot that has no speed of its own (a rifle round) is not flown: it is one
// ray, tested the tick it is fired, as far as `HITSCAN_RANGE`.
//
// Each tick a flying thing covers a straight piece: from where it was to where
// its speed and half a tick of falling put it. What it hits is whatever that
// piece crosses. At thirty ticks a second the piece is within two millimetres
// of the curve it stands for.

import { TICK_DT } from "../coords.ts";

/** How far a shot that is not flown reaches, metres. */
export const HITSCAN_RANGE = 600;
/** A bow let go undrawn sends its arrow at this share of its full speed. */
export const DRAW_SPEED_MIN = 38 / 70;
/** What entering water leaves of a flying thing's speed, when it is fired from something made for water. Anything else stops at the surface. */
export const WATER_SPEED = 0.4;
/** Ticks a thing may fly before it is given up: ten seconds. */
export const FLIGHT_TICKS = 300;

/** Speed off the string for a draw of 0 to 1. */
export function launchSpeed(full: number, draw: number): number {
  const d = draw <= 0 ? 0 : draw >= 1 ? 1 : draw;
  return full * (DRAW_SPEED_MIN + (1 - DRAW_SPEED_MIN) * d);
}

/** One flying thing: where it is and how it moves. */
export interface Flight {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** The piece covered by the last `flyStep`: where it began, its unit direction, and its length. */
export const piece = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, length: 0 };

/**
 * Work out the piece `f` would cover in `dt` seconds (a tick, unless said)
 * under `gravity` (metres per second squared, downward) into `piece`, without
 * moving it. `flyEnd` moves it.
 */
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

/** Move `f` to the end of the piece `flyStep` worked out for the same `dt`, falling as it goes. */
export function flyEnd(f: Flight, gravity: number, dt = TICK_DT): void {
  f.x = piece.x + piece.dx * piece.length;
  f.y = piece.y + piece.dy * piece.length;
  f.z = piece.z + piece.dz * piece.length;
  f.vy -= gravity * dt;
}
