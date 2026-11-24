// What an orb is heard by (shared/world/orb.ts). Nothing is sent for it: each client hears the map's orbs from their
// sites. The skin hums at the point of the sphere nearest the ear, so the hum is beside a listener at its foot and
// overhead for one under its curve, quiet, and gone a street away.

import { cueKey } from "../../../shared/sound/cues.ts";
import type { OrbSite } from "../../../shared/world/orb.ts";

const HUM = cueKey("orb/hum");

/** The first of the loops' numbers that are the orbs': one a site. */
export const ORB_LOOPS = 700000;
/** Metres from the skin the hum is heard to. */
export const HUM_RANGE = 150;
/** The hum's level beside the skin, under its sound's own: it is a quiet one. */
export const HUM_LEVEL = 0.5;
/** Over this last share of its range the hum falls to nothing, so it does not stop at a step. */
const EDGE = 0.25;

type Loop = (id: number, key: number, x: number, y: number, z: number, level: number, on: boolean) => void;

export class OrbSounds {
  /** One frame: the orbs of `sites`, heard from (ex, ey, ez). A map with none hears nothing. */
  update(sites: readonly OrbSite[] | undefined, ex: number, ey: number, ez: number, loop: Loop): void {
    if (!sites) return;
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i]!;
      const cy = site.y + site.centre;
      const dx = ex - site.x, dy = ey - cy, dz = ez - site.z;
      const d = Math.hypot(dx, dy, dz);
      // From the centre itself every point of the skin is as near: the top is taken.
      const out = d > 0 ? site.radius / d : 0;
      const x = site.x + dx * out, y = d > 0 ? cy + dy * out : cy + site.radius, z = site.z + dz * out;
      const off = Math.abs(d - site.radius);
      loop(ORB_LOOPS + i, HUM, x, y, z, HUM_LEVEL * Math.min(1, (HUM_RANGE - off) / (HUM_RANGE * EDGE)), off < HUM_RANGE);
    }
  }
}
