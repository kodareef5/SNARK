// An obelisk as a map sets it down (content/terminals.ts): the obelisk standing on the ground at its place, and its terminal
// on the ground a step in front of it along its facing, turned to face the way it does, so a survivor walks up to it there.

import { eyeCollision, type EyeColor, type TideEyeSite } from "./tide-eye.ts";
import type { Registry } from "../content/registry.ts";
import { TAU, detCos, detSin } from "../math/scalar.ts";
import type { MapStatic } from "./mapfile.ts";

export const OBELISK = "core:obelisk";
export const TRAVEL_TERMINAL = "core:travel_terminal";
/** Metres of ground between the obelisk's face and its terminal's back. */
const STEP = 1.5;
/** The obelisk is this many of its pieces, one on another: a piece is at most 32 m tall. */
export const OBELISK_PIECES = 3;

/** Where an obelisk stands: a name for it, its place, and the way its terminal faces in 1/65,536 turns. */
export interface ObeliskPlace {
  readonly name: string;
  readonly color?: EyeColor;
  readonly radius?: number;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** The obelisk's pieces, then its terminal's. `ground` is the height of the ground at a place. */
export function obeliskStatics(reg: Registry, at: ObeliskPlace, ground: (x: number, z: number) => number): MapStatic[] {
  const obelisk = reg.index.get(OBELISK);
  const terminal = reg.index.get(TRAVEL_TERMINAL);
  if (obelisk === undefined || terminal === undefined) throw new Error(`an obelisk needs content "${OBELISK}" and "${TRAVEL_TERMINAL}"`);
  if (at.color) {
    const site = { ...at, color: at.color, radius: at.radius ?? 70, y: ground(at.x, at.z) } satisfies TideEyeSite;
    return [...eyeCollision(site), { kind: TRAVEL_TERMINAL, x: site.x, y: site.y + reg.halfY[terminal]! + 0.085, z: site.z, yaw: site.yaw }];
  }
  const a = ((at.yaw & 0xffff) / 65536) * TAU;
  const away = reg.halfX[obelisk]! + STEP + 0.3;
  const tx = at.x + detSin(a) * away;
  const tz = at.z + detCos(a) * away;
  const foot = ground(at.x, at.z);
  const half = reg.halfY[obelisk]!;
  const pieces: MapStatic[] = [];
  for (let i = 0; i < OBELISK_PIECES; i++) pieces.push({ kind: OBELISK, x: at.x, y: foot + half * (2 * i + 1), z: at.z, yaw: at.yaw & 0xffff });
  pieces.push({ kind: TRAVEL_TERMINAL, x: tx, y: ground(tx, tz) + reg.halfY[terminal]!, z: tz, yaw: at.yaw & 0xffff });
  return pieces;
}
