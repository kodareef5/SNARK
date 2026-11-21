// A rectangle cut from a city's work folder, as a work folder of its own:
//
//   bun tools/mapworld/cut.ts <city> <folder> <column> <row> <wide> <deep>
//   bun tools/mapworld/build.ts <folder> --out <another folder>
//
// The city's work folder is var/mapdata/<city>/current (tools/maps/city.ts), whose stages before the build are done. The
// rectangle is given on the lattice (shared/coords.ts): the column and row of its south-east corner and its chunks west
// and north, all within the map's frame. The folder gets the frame (map.json) of the rectangle in the map's own
// projection, the base layers' samples within it, the footprints wholly inside it, the spawn points, obelisks and landmarks
// standing in it, the city's street overlay as it is in assets/source/maps/<city>/streets (so an entry written there is
// tried on the cut at once), and the rest of the folder as it is: roads, ways, labels and places are cut by the build
// where it meets the map's edge. The fine layers are left out: the build does not read them. Nothing of the city's own
// folders is written; build the cut with --out, so its map and layers stay out of var/maps.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { readGrey, writeGrey } from "../map/png.ts";
import { Base, type MapInfo } from "./base.ts";
import type { World } from "./ground.ts";

const ROOT = resolve(import.meta.dir, "../..");

export function cutSource(city: string, from: string, folder: string, column: number, row: number, wide: number, deep: number): string {
  const base = new Base(from);
  const { grid, info } = base;
  const [frameX, frameZ] = info.frame;
  if (column < frameX || row < frameZ || column + wide > frameX + info.chunks[0] || row + deep > frameZ + info.chunks[1]) throw new Error(`${wide} by ${deep} chunks at ${column}, ${row} is not within ${from}'s frame`);
  // Columns count west and rows north, as engine x and z do.
  const east = grid.east - (column - frameX) * CHUNK_SIZE;
  const south = grid.south + (row - frameZ) * CHUNK_SIZE;
  const bounds = [east - wide * CHUNK_SIZE, south, east, south + deep * CHUNK_SIZE] as const;
  const [west, , , north] = bounds;
  const nx = (wide * CHUNK_SIZE) / grid.cell + 1;
  const nz = (deep * CHUNK_SIZE) / grid.cell + 1;
  const c0 = (west - grid.west) / grid.cell;
  const r0 = (grid.north - north) / grid.cell;
  const corner = (e: number, n: number): [number, number] => base.tm.inverse(e, n);
  const frame: MapInfo & Record<string, unknown> = {
    ...info,
    size_m: [wide * CHUNK_SIZE, deep * CHUNK_SIZE],
    chunks: [wide, deep],
    grid_samples: [nx, nz],
    frame: [column, row],
    bounds,
    corners_lon_lat: { NW: corner(west, north), NE: corner(east, north), SE: corner(east, south), SW: corner(west, south) },
  };
  mkdirSync(join(folder, "base"), { recursive: true });
  writeFileSync(join(folder, "map.json"), `${JSON.stringify(frame, null, 2)}\n`);

  for (const file of readdirSync(join(from, "base"))) {
    const path = join(from, "base", file);
    if (file.endsWith("_fine.png")) continue;
    if (file.endsWith(".png")) {
      const picture = readGrey(new Uint8Array(readFileSync(path)), file);
      if (picture.width !== grid.nx || picture.height !== grid.nz) throw new Error(`${file} is ${picture.width} by ${picture.height}, not the frame's samples`);
      const out = new (picture.data.constructor as Uint8ArrayConstructor | Uint16ArrayConstructor)(nx * nz);
      for (let r = 0; r < nz; r++) out.set(picture.data.subarray((r0 + r) * grid.nx + c0, (r0 + r) * grid.nx + c0 + nx), r * nx);
      writeFileSync(join(folder, "base", file), writeGrey(nx, nz, out));
    } else if (file === "buildings.geojson") {
      const doc = JSON.parse(readFileSync(path, "utf8")) as { features: { geometry: { type: string; coordinates: unknown } }[] };
      const inside = (p: number[]): boolean => p[0]! >= west && p[0]! <= east && p[1]! >= south && p[1]! <= north;
      const points = (c: unknown): number[][] => (typeof (c as unknown[])[0] === "number" ? [c as number[]] : (c as unknown[]).flatMap(points));
      writeFileSync(join(folder, "base", file), JSON.stringify({ ...doc, features: doc.features.filter((f) => points(f.geometry.coordinates).every(inside)) }));
    } else cpSync(path, join(folder, "base", file), { recursive: true });
  }
  for (const part of ["blocks", "ruins"]) if (existsSync(join(from, part))) cpSync(join(from, part), join(folder, part), { recursive: true });
  // The named places whose footprints the cut holds: one outside it would stop the build.
  const places = join(folder, "ruins/places.json");
  if (existsSync(places)) {
    const kept = new Set((JSON.parse(readFileSync(join(folder, "base/buildings.geojson"), "utf8")) as { features: { properties: { id: number } }[] }).features.map((f) => f.properties.id));
    const named = JSON.parse(readFileSync(places, "utf8")) as { footprint?: number }[];
    writeFileSync(places, `${JSON.stringify(named.filter((p) => p.footprint !== undefined && kept.has(p.footprint)), null, 2)}\n`);
  }

  // What the world names in the rectangle; the build looks for each one's ground within it.
  const world = JSON.parse(readFileSync(join(from, "world/world.json"), "utf8")) as World;
  const within = ([lon, lat]: readonly [number, number]): boolean => {
    const [e, n] = base.tm.forward(lon, lat);
    return e >= west && e <= east && n >= south && n <= north;
  };
  // A map has at least one spawn point: a cut with none of the city's gets one on open ground at its middle.
  const spawns = world.spawns.filter((s) => within(s.at));
  const middle = corner((west + east) / 2, (south + north) / 2), facing = corner((west + east) / 2, (south + north) / 2 + 50);
  if (spawns.length === 0) spawns.push({ name: "Cut", at: middle, face: facing, ground: "open" });
  const cut: World = { ...world, spawns, obelisks: (world.obelisks ?? []).filter((o) => within(o.at)), landmarks: (world.landmarks ?? []).filter((l) => within(l.at)) };
  mkdirSync(join(folder, "world"), { recursive: true });
  writeFileSync(join(folder, "world/world.json"), `${JSON.stringify(cut, null, 2)}\n`);
  mkdirSync(join(folder, "reports", world.ruins?.report ?? "ruins"), { recursive: true });
  // The city's street overlay as written, so an entry is tried on the cut as soon as it is written.
  const overlay = join(ROOT, "assets/source/maps", city, "streets");
  if (existsSync(overlay)) cpSync(overlay, join(folder, "streets"), { recursive: true });
  return `${wide} by ${deep} chunks at ${column}, ${row} in ${folder}: ${cut.spawns.length} of ${world.spawns.length} spawn points, ${cut.obelisks?.length ?? 0} of ${world.obelisks?.length ?? 0} obelisks, ${cut.landmarks?.length ?? 0} of ${world.landmarks?.length ?? 0} landmarks`;
}

if (import.meta.main) {
  const [name, folder, ...numbers] = process.argv.slice(2);
  const [column, row, wide, deep] = numbers.map(Number);
  if (!name || !folder || [column, row, wide, deep].some((v) => !Number.isInteger(v))) throw new Error("bun tools/mapworld/cut.ts <city> <folder> <column> <row> <wide> <deep>");
  if (existsSync(folder)) throw new Error(`${folder} is there already: a cut is made into a folder of its own`);
  console.log(cutSource(name, join(ROOT, "var/mapdata", name, "current"), resolve(folder), column!, row!, wide!, deep!));
}
