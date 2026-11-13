// What is done to a piece after it is built: taken back, taken down, mended.
//
// The numbers and the arithmetic of it, shared so that a client can say what
// an action would cost or give before asking. The server judges
// (server/build.ts); nothing here changes anything.

import type { Registry } from "../content/registry.ts";
import { TICK_RATE } from "../coords.ts";

/** What a CMD_STRUCT asks for. */
export const STRUCT_PICKUP = 0;
export const STRUCT_DEMOLISH = 1;
export const STRUCT_REPAIR = 2;
export const STRUCT_LOCK = 3;
export const STRUCT_UNLOCK = 4;
/** Give it a PIN (which also locks it), or with no PIN take its PIN away. */
export const STRUCT_PIN = 5;
/** Use it: a door opens or shuts, a box is looked into. With a PIN, for one who is not of its tribe. */
export const STRUCT_USE = 6;
/** In a command, the PIN that means none. */
export const NO_PIN = 0xffff;
/** Wrong PINs in a row before a session must wait, and how long it waits: ticks. */
export const PIN_TRIES = 3;
export const PIN_WAIT_TICKS = 30 * TICK_RATE;

/** Something that has just been harmed cannot be mended for this long: three minutes, in ticks. */
export const REPAIR_WAIT_TICKS = 180 * TICK_RATE;
/** How far from the eye a piece may be for a survivor to act on it: metres to its nearest face, about. */
export const ACT_REACH = 4;
/** A foundation or a ground pillar with nothing joined to it lasts this long unvisited, whatever it is made of: half a day. */
export const LONE_DECAY_DAYS = 0.5;

/** Scratch that `refundOf` and `repairCostOf` fill: pairs of item and count, `n` of them. */
export const cost = { n: 0, item: new Uint16Array(16), count: new Uint16Array(16) };

/**
 * What demolishing a structure of `kind` gives back: half of each thing one
 * is made of, rounded down. Fills `cost`; false if it is made of nothing
 * known.
 */
export function refundOf(reg: Registry, kind: number): boolean {
  return fill(reg, kind, 0.5, false);
}

/**
 * What mending a structure of `kind` with `hp` left costs: of each thing it
 * is made of, the part that is missing, rounded up. Fills `cost`; false if it
 * is made of nothing known or is whole.
 */
export function repairCostOf(reg: Registry, kind: number, hp: number): boolean {
  const max = reg.maxHp[kind]!;
  if (!(hp < max) || !(max > 0)) return false;
  return fill(reg, kind, 1 - (hp > 0 ? hp : 0) / max, true);
}

function fill(reg: Registry, kind: number, part: number, up: boolean): boolean {
  cost.n = 0;
  const item = reg.pieceItem[kind]!;
  const needs = item !== 0 ? reg.recipeOf[item] : null;
  if (!needs) return false;
  const makes = reg.recipeMakes[item]! || 1;
  for (let k = 0; k + 1 < needs.length && cost.n < cost.item.length; k += 2) {
    const exact = (needs[k + 1]! / makes) * part;
    const count = up ? Math.ceil(exact - 1e-9) : Math.floor(exact + 1e-9);
    if (count <= 0) continue;
    cost.item[cost.n] = needs[k]!;
    cost.count[cost.n] = count;
    cost.n++;
  }
  return true;
}
