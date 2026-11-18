// A rectangle cut from a map's source, as a source of its own: bun tools/mapworld/cut.ts <name> <folder> <column> <row> <wide> <deep>
//
// The rectangle is given on the lattice (shared/coords.ts): the column and row of its south-east corner and its chunks
// west and north, all within the map's frame. The folder gets the frame (map.json) of the rectangle in the map's own
// projection, the base layers' samples within it, the footprints wholly inside it, the spawn points, obelisks and landmarks
// standing in it, and the rest of the source as it is: roads, ways, labels and places are cut by the build where it
// meets the map's edge. `bun tools/mapworld/build.ts <folder>` then builds it. The fine layers are left out: the build
// does not read them.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { readGrey, writeGrey } from "../map/png.ts";
import { Base, type MapInfo } from "./base.ts";
import type { World } from "./ground.ts";

const ROOT = resolve(import.meta.dir, "../..");

export function cutSource(name: string, folder: string, column: number, row: number, wide: number, deep: number): void {
  const from = join(ROOT, "assets/source/maps", name);
  const base = new Base(from);
  const { grid, info } = base;
  const [frameX, frameZ] = info.frame;
  if (column < frameX || row < frameZ || column + wide > frameX + info.chunks[0] || row + deep > frameZ + info.chunks[1]) throw new Error(`${wide} by ${deep} chunks at ${column}, ${row} is not within ${name}'s frame`);
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

  // What the world names in the rectangle, 300 m in from its edges, where the build looks for each one's ground.
  const world = JSON.parse(readFileSync(join(from, "world/world.json"), "utf8")) as World;
  const within = ([lon, lat]: readonly [number, number]): boolean => {
    const [e, n] = base.tm.forward(lon, lat);
    return e >= west + 300 && e <= east - 300 && n >= south + 300 && n <= north - 300;
  };
  const cut: World = { ...world, spawns: world.spawns.filter((s) => within(s.at)), obelisks: (world.obelisks ?? []).filter((o) => within(o.at)), landmarks: (world.landmarks ?? []).filter((l) => within(l.at)) };
  mkdirSync(join(folder, "world"), { recursive: true });
  writeFileSync(join(folder, "world/world.json"), `${JSON.stringify(cut, null, 2)}\n`);
  mkdirSync(join(folder, "reports", world.ruins?.report ?? "ruins"), { recursive: true });
  console.log(`${wide} by ${deep} chunks of ${name} at ${column}, ${row} in ${folder}: ${cut.spawns.length} of ${world.spawns.length} spawn points, ${cut.obelisks?.length ?? 0} of ${world.obelisks?.length ?? 0} obelisks, ${cut.landmarks?.length ?? 0} of ${world.landmarks?.length ?? 0} landmarks`);
}

if (import.meta.main) {
  const [name, folder, ...numbers] = process.argv.slice(2);
  const [column, row, wide, deep] = numbers.map(Number);
  if (!name || !folder || [column, row, wide, deep].some((v) => !Number.isInteger(v))) throw new Error("bun tools/mapworld/cut.ts <name> <folder> <column> <row> <wide> <deep>");
  cutSource(name, resolve(folder), column!, row!, wide!, deep!);
}
