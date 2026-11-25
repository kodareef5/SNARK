// The grunt protocol's map channel for SNARK (grunt/protocol.md "map"): the ground for kilometres around, as a player's
// map screen shows it, from what the client holds of the whole map: the heightfield (water and its depth, slopes too
// steep to climb, roads by the ground's class), the map's own buildings (the city's statics, as the far city draws them)
// and the bases the server tells of far off (the far feed and the tactical map). A player sees all of this on the map
// screen and from a height; nothing behind walls or out of a client's knowledge is in it. Near ground comes finer from
// the terrain channel, which grunt's navigation lays over this.

import { CHUNK_SIZE, chunkAt, chunkCx, chunkCz } from "../shared/coords.ts";
import type { ClientSession } from "../client/core/session.ts";
import type { MapChannel, MapPlace } from "../grunt/protocol.ts";
import { swimDepth } from "../shared/sim/character.ts";
import { cityTops } from "../shared/world/city.ts";
import { TACTICAL_CELL } from "../shared/world/tactical.ts";
import { GROUND_CLASS } from "../shared/world/vehicle-surface.ts";

export const MAP_LEGEND: Record<string, string> = { ".": "walkable", "=": "road", "~": "deep_water", "-": "shallow_water", "^": "blocked", "#": "blocked", "?": "unknown" };
/** Metres around the survivor by default and at most; the coarsest a letter is kept to so a map stays some 200 a side. */
export const MAP_RADIUS = 600, MAP_MOST = 1500, MAP_LETTERS = 200;
const SIDE = CHUNK_SIZE / TACTICAL_CELL;

/** The map about the survivor, `radius` metres each way, `cell` metres a letter (at least 8, more for a wide one). */
export class MapRaster {
  private readonly tops = new Map<number, Uint8Array>();
  private readonly s: ClientSession;

  constructor(s: ClientSession) {
    this.s = s;
  }

  channel(cell = 8, radius = MAP_RADIUS): MapChannel | null {
    const s = this.s, world = s.world;
    if (!world) return null;
    const hf = world.hf, reg = s.registry;
    const move = reg.move[s.bodyKind]!;
    const r = Math.min(MAP_MOST, Math.max(64, radius));
    const c = Math.max(8, cell, Math.ceil((2 * r) / MAP_LETTERS / 4) * 4);
    const deep = swimDepth(move, 0.7);
    // SNARK's x grows west and z north: the protocol's corner (its least x and z) is SNARK's greatest.
    const [gx, gz] = [Math.floor((-s.own.x - r) / c) * c, Math.floor((-s.own.z - r) / c) * c];
    const n = Math.ceil((2 * r) / c) + 1;
    const statics = world.city?.statics ?? null;
    /** One 4 m cell of the ground at SNARK's (x, z): what the map screen shows there. */
    const at = (x: number, z: number): string => {
      if (x < 0 || z < 0 || x >= hf.sizeX || z >= hf.sizeZ) return "#";
      // What stands there: the map's own buildings, a base the far feed or the tactical map tells of.
      if (world.far.cells.cellAt(x, z) !== 0 || s.tactical.cellAt(x, z) !== 0) return "#";
      if (statics) {
        const chunk = chunkAt(hf.dims, x, z);
        let tops = this.tops.get(chunk);
        if (!tops) this.tops.set(chunk, (tops = cityTops(statics, chunk, hf, null)));
        const i = Math.floor((z - chunkCz(hf.dims, chunk) * CHUNK_SIZE) / TACTICAL_CELL) * SIDE + Math.floor((x - chunkCx(hf.dims, chunk) * CHUNK_SIZE) / TACTICAL_CELL);
        if (tops[i]! > 0) return "#";
      }
      const depth = hf.waterAt(x, z) - hf.heightAt(x, z);
      if (depth > deep) return "~";
      if (depth > 0.15) return "-";
      if (hf.slopeCosAt(x, z) < move.slopeCos) return "^";
      const k = hf.groundClassAt(x, z);
      return k === GROUND_CLASS.ASPHALT || k === GROUND_CLASS.PAVING ? "=" : ".";
    };
    // Each letter is what most of its 4 m cells are; a road in it keeps it a road (a street between buildings stays
    // open), and it is blocked only where most of it is.
    const per = Math.max(1, Math.round(c / TACTICAL_CELL));
    const rows: string[] = [];
    for (let row = 0; row < n; row++) {
      let line = "";
      for (let col = 0; col < n; col++) {
        const tally: Record<string, number> = {};
        for (let j = 0; j < per; j++) {
          for (let i = 0; i < per; i++) {
            const px = gx + col * c + (i + 0.5) * TACTICAL_CELL, pz = gz + row * c + (j + 0.5) * TACTICAL_CELL;
            const k = at(-px, -pz);
            tally[k] = (tally[k] ?? 0) + 1;
          }
        }
        const most = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]![0];
        line += tally["="] && most !== "~" ? "=" : most;
      }
      rows.push(line);
    }
    const places = mapPlaces(s);
    return { cell: c, origin: [gx, gz], size: [n, n], rows, legend: MAP_LEGEND, known: "full", ...(places.length ? { places } : {}) };
  }
}

const FORM = { sextant: "a sextant of arcs", lantern: "a lantern on masts" } as const;

/** The named places a player's map shows, in the protocol's frame: the obelisks (seen from anywhere, so all of them) and
 * the map's landmarks. */
export function mapPlaces(s: ClientSession): MapPlace[] {
  const out: MapPlace[] = [];
  for (const e of s.world?.tideEyes ?? []) {
    const form = e.form ? FORM[e.form] : "an eye on a spire";
    out.push({ name: `${e.color} obelisk`, kind: "obelisk", x: -Math.round(e.x), z: -Math.round(e.z), about: `the ${e.color} obelisk at ${e.name}: ${form} towering over the city, seen from anywhere; a travel terminal stands at its foot` });
  }
  for (const l of s.world?.landmarks ?? []) out.push({ name: l.name, kind: "landmark", x: -Math.round(l.x), z: -Math.round(l.z) });
  return out;
}
