// Pictures of a built map as the game's map screen draws it with no painted tiles: its relief tiles (client/core/tactical.ts)
// from the file alone. bun tools/mapworld/pictures.ts <file.snmap> <out folder> [zoom] [col,row,...]
//
// Writes the whole map at zoom 0, and at the given zoom each tile asked for, or every tile of it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paintRelief } from "../../client/core/tactical.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { mapHeightfield, parseMap } from "../../shared/world/mapfile.ts";
import { encodePng } from "../snap/png.ts";

const SIZE = 1024;

export function reliefTile(file: Uint8Array, zoom: number, col: number, row: number): Uint8Array {
  const map = parseMap(file);
  const hf = mapHeightfield(map);
  const out = new Uint32Array(SIZE * SIZE);
  paintRelief(hf, defaultPalette(), zoom, col, row, SIZE, out);
  return encodePng(SIZE, SIZE, new Uint8Array(out.buffer));
}

if (import.meta.main) {
  const [path, folder, zoomArg, ...tiles] = process.argv.slice(2);
  if (!path || !folder) {
    console.error("bun tools/mapworld/pictures.ts <file.snmap> <out folder> [zoom] [col,row ...]");
    process.exit(2);
  }
  const map = parseMap(new Uint8Array(readFileSync(path)));
  const hf = mapHeightfield(map);
  const palette = defaultPalette();
  mkdirSync(folder, { recursive: true });
  const draw = (zoom: number, col: number, row: number, name: string): void => {
    const out = new Uint32Array(SIZE * SIZE);
    paintRelief(hf, palette, zoom, col, row, SIZE, out);
    writeFileSync(join(folder, name), encodePng(SIZE, SIZE, new Uint8Array(out.buffer)));
    console.log(join(folder, name));
  };
  draw(0, 0, 0, "mapscreen-z0.png");
  if (zoomArg !== undefined) {
    const zoom = Number(zoomArg);
    const asked = tiles.length > 0 ? tiles.map((t) => t.split(",").map(Number) as [number, number]) : Array.from({ length: 1 << (2 * zoom) }, (_, k) => [k % (1 << zoom), Math.floor(k / (1 << zoom))] as [number, number]);
    for (const [c, r] of asked) draw(zoom, c, r, `mapscreen-z${zoom}-${c}_${r}.png`);
  }
}
