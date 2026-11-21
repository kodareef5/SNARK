// Where a map's supply drops land when nobody has said (planning/workstreams/supply.md): one place to a square of the
// map, wherever in the square a drop may land, and each place in a band by how far it is from where survivors rise, as
// ARK's harder places get its better crates. The tool that writes a city's starter sites and the admin page's
// "generate" both run this over the server's test of a place (server/supply/ground.ts).

import { hashString } from "../hash.ts";
import { Rng } from "../rng.ts";

export interface SiteProbe {
  readonly sizeX: number;
  readonly sizeZ: number;
  /** Where survivors rise. */
  readonly spawns: readonly { readonly x: number; readonly z: number }[];
  /** Why no drop may land at a place, or "". */
  fault(x: number, z: number): string;
}

export interface FoundSite {
  x: number;
  z: number;
  /** Metres to the nearest place a survivor rises. */
  far: number;
}

/** Metres a side of the square each site is found in: sites are never nearer each other than two fifths of it. */
export const SITE_SPACING = 420;
/** Places tried in a square before it is left without one. */
export const SITE_TRIES = 10;

/**
 * A site to each square of `spacing` metres that has a fit place among the `tries` drawn in its middle three fifths,
 * to the whole metre, and how many places were turned down for each reason. The same seed finds the same sites.
 */
export function findSites(probe: SiteProbe, seed: number, spacing = SITE_SPACING, tries = SITE_TRIES): { sites: FoundSite[]; faults: Record<string, number> } {
  const sites: FoundSite[] = [];
  const faults: Record<string, number> = {};
  const cols = Math.floor(probe.sizeX / spacing);
  const rows = Math.floor(probe.sizeZ / spacing);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const rng = new Rng(hashString(`${i},${j}`, seed >>> 0));
      for (let t = 0; t < tries; t++) {
        const x = Math.round((i + 0.2 + 0.6 * rng.float()) * spacing);
        const z = Math.round((j + 0.2 + 0.6 * rng.float()) * spacing);
        const why = probe.fault(x, z);
        if (why !== "") {
          faults[why] = (faults[why] ?? 0) + 1;
          continue;
        }
        let far = Infinity;
        for (const s of probe.spawns) far = Math.min(far, Math.hypot(s.x - x, s.z - z));
        sites.push({ x, z, far });
        break;
      }
    }
  }
  return { sites, faults };
}

/** The sites in bands, nearest the spawns first, each band the share of them given (the last takes what is left). */
export function bandsOf(sites: readonly FoundSite[], shares: readonly number[]): FoundSite[][] {
  const sorted = [...sites].sort((a, b) => a.far - b.far || a.x - b.x || a.z - b.z);
  const out: FoundSite[][] = [];
  let at = 0;
  shares.forEach((share, k) => {
    const end = k === shares.length - 1 ? sorted.length : Math.min(sorted.length, at + Math.round(sorted.length * share));
    out.push(sorted.slice(at, end));
    at = end;
  });
  return out;
}
