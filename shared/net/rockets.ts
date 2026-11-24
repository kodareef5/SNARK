// A round that goes off where it ends (a rocket) and the blast it ends in, as they are told to those who may see them
// (EVENT_ROCKET, EVENT_BLAST). The round has a number, and its blast says it, so a client ends the round it drew where
// the server ended it. A client draws from these and decides nothing.

import { packBolt, readStart, writeStart } from "./bolts.ts";
import type { BitReader, BitWriter } from "./codec.ts";

/** A round's number is from 1 to one less than this. 0 is a blast with no round: a grenade's. */
export const ROCKET_IDS = 1024;
const ID_BITS = 10;
/** Most ticks since a round left that a message says: one told later than this is not told. */
export const ROCKET_AGE_MOST = 255;

/** What a blast went off on. */
export const SURFACE_AIR = 0;
export const SURFACE_GROUND = 1;
export const SURFACE_BUILT = 2;
export const SURFACE_WATER = 3;
export const SURFACE_BODY = 4;
export const SURFACE_VEHICLE = 5;
/** What the built thing it went off on is made of, where the server knows. */
export const MADE_UNKNOWN = 0;
export const MADE_THATCH = 1;
export const MADE_WOOD = 2;
export const MADE_STONE = 3;
export const MADE_METAL = 4;
/** A blast's reach is told in these to a metre, to at most 63.75 m. */
const REACH_STEPS = 4;

/** A round as read: where it left, its unit way, its ammunition, its number, the ticks since it left, and whether it is the reader's own. */
export const rocket = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1, ammo: 0, id: 0, age: 0, own: false };

/** A blast as read: where, the unit way out of what it went off on, its reach, the item that blew (0 for none), its round's number, and what it met. */
export const blast = { x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0, radius: 0, item: 0, id: 0, surface: 0, made: 0 };

const packed = new Uint32Array(5);

/** Writes a round whose start and way are packed at `at` of `from` (packBolt): 16 bytes. */
export function writeRocket(w: BitWriter, from: Uint32Array, at: number, ammo: number, id: number, age: number, own: boolean): void {
  writeStart(w, from, at);
  w.u16(ammo);
  w.bits(id, ID_BITS);
  w.bits(age < 0 ? 0 : age > ROCKET_AGE_MOST ? ROCKET_AGE_MOST : Math.round(age), 8);
  w.bool(own);
}

export function readRocket(r: BitReader): void {
  readStart(r, rocket);
  rocket.ammo = r.u16();
  rocket.id = r.bits(ID_BITS);
  rocket.age = r.bits(8);
  rocket.own = r.bool();
}

/** Writes a blast at (x, y, z) on a surface whose unit way out is (nx, ny, nz): 17 bytes. */
export function writeBlast(w: BitWriter, x: number, y: number, z: number, nx: number, ny: number, nz: number, radius: number, item: number, id: number, surface: number, made: number): void {
  packBolt(x, y, z, nx, ny, nz, packed, 0);
  writeStart(w, packed, 0);
  w.bits(Math.max(1, Math.min(255, Math.round(radius * REACH_STEPS))), 8);
  w.u16(item);
  w.bits(id, ID_BITS);
  w.bits(surface, 3);
  w.bits(made, 3);
}

export function readBlast(r: BitReader): void {
  readStart(r, blast);
  blast.radius = r.bits(8) / REACH_STEPS;
  blast.item = r.u16();
  blast.id = r.bits(ID_BITS);
  blast.surface = r.bits(3);
  blast.made = r.bits(3);
}

/** The seed every client draws a blast from: its round's number and its place, to a quarter of a metre. */
export function blastSeed(id: number, x: number, y: number, z: number): number {
  let h = (id * 0x9e3779b1) ^ (Math.round(x * 4) * 0x85ebca6b) ^ (Math.round(y * 4) * 0xc2b2ae35) ^ (Math.round(z * 4) * 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}
