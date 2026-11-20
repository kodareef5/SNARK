// Re-cut the title set from the cooked Miami map: bun tools/title/shore.ts path/to/miami.parts
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHUNK_SIZE, SECTOR_CHUNKS } from "../../shared/coords.ts";
import { OVERVIEW_CHUNKS, readHead, readPart, squareOf } from "../../shared/world/mapfile.ts";
import { TOP_CELLS } from "../../client/core/render/blocks.ts";

const dir = process.argv[2];
if (!dir) throw Error("Pass the cooked Miami parts folder");
const read = (name: string) => readFileSync(join(dir, name));
const head = readHead(read(readdirSync(dir).find((n) => /^head\..+\.part$/.test(n))!));
const eye = head.tideEyes?.find((s) => s.color === "red" && s.form === "sextant");
if (head.id !== "core:miami" || !eye) throw Error("Expected the Wynwood sextant");
const origin = [3840, 4864] as const;
const dims = { chunksX: 71, chunksZ: 65 };
const actor = [4244 - origin[0], 5362 - origin[1]];
const heights: number[] = [],
  tint: number[] = [];
const [cx, cz] = origin.map((n) => n / CHUNK_SIZE) as [number, number];
for (let z = 0; z <= dims.chunksZ; z++)
  for (let x = 0; x <= dims.chunksX; x++) {
    const i = cx + x + (cz + z) * (head.dims.chunksX + 1);
    heights.push(head.coarse.heights[i]!);
    tint.push(head.coarse.tint[i]!);
  }
const close = { x: Math.floor(actor[0]! / 64) - 1, z: Math.floor(actor[1]! / 64) - 1, heights: [] as number[], tint: [] as number[] };
const parts = new Map<string, ReturnType<typeof readPart>>();
for (let z = 0; z <= 96; z++)
  for (let x = 0; x <= 96; x++) {
    const wx = origin[0] + close.x * 64 + 2 * x,
      wz = origin[1] + close.z * 64 + 2 * z;
    const col = Math.floor((head.dims.frameX + wx / 64) / SECTOR_CHUNKS),
      row = Math.floor((head.dims.frameZ + wz / 64) / SECTOR_CHUNKS);
    const key = col + "/" + row;
    if (!parts.has(key)) {
      const p = head.parts.find((p) => p.kind === "ground" && p.col === col && p.row === row)!;
      parts.set(key, readPart(head, p, read(p.name)));
    }
    const g = parts.get(key)!;
    if (g.kind !== "ground") throw Error("Missing ground");
    const i = wx / 2 - g.sq.cx0 * 32 + (wz / 2 - g.sq.cz0 * 32) * ((g.sq.cx1 - g.sq.cx0) * 32 + 1);
    close.heights.push(g.heights[i]!);
    close.tint.push(g.tint[i]!);
  }
// Keep the highest occupied 4 m cell per 16 m skyline column. Store palette and height together.
const skyline: number[] = [];
for (const p of head.parts.filter((p) => p.kind === "tops")) {
  const s = squareOf(head.dims, OVERVIEW_CHUNKS, p.col, p.row)!;
  if (s.cx1 <= cx || s.cz1 <= cz || s.cx0 >= cx + dims.chunksX || s.cz0 >= cz + dims.chunksZ) continue;
  const t = readPart(head, p, read(p.name));
  if (t.kind !== "tops") continue;
  for (let n = 0; n < t.chunks.length; n++) {
    const c = t.chunks[n]!,
      x = (c % head.dims.chunksX) - cx,
      z = Math.floor(c / head.dims.chunksX) - cz;
    if (
      x < 0 ||
      z < 0 ||
      x >= dims.chunksX ||
      z >= dims.chunksZ ||
      Math.hypot((x + 0.5) * 64 - actor[0]!, (z + 0.5) * 64 - actor[1]!) < 350
    )
      continue;
    for (let b = 0; b < 16; b++) {
      const at = n * TOP_CELLS + (b >> 2) * 64 + (b % 4) * 4;
      let best = at;
      for (let j = 0; j < 16; j++) {
        const i = at + (j >> 2) * 16 + (j % 4);
        if (t.top[i]! > t.top[best]!) best = i;
      }
      if (t.top[best]! < 6) continue;
      skyline.push((z * dims.chunksX + x) * 16 + b, t.top[best]! * 256 + t.tint[best]!);
    }
  }
}
const data = {
  dims,
  origin,
  actor,
  minY: head.minY,
  stepY: head.stepY,
  seaLevel: head.seaLevel,
  eye: { ...eye, x: eye.x - origin[0], z: eye.z - origin[1] },
  heights,
  tint,
  close,
  skyline,
};
writeFileSync(join(import.meta.dir, "../../client/entry/media/wynwood-shore.json"), JSON.stringify(data) + "\n");
