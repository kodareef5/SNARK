import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { writeMap } from "../../shared/world/mapfile.ts";
import { encodePng } from "../../tools/pack/image.ts";
import { mapHeader, overviewRelief, spawnRelief } from "../../tools/title/map-card.ts";
import { buildMapGallery, spawnPhotoName } from "../../tools/title/maps.ts";
import { flatMap } from "../fixtures/map.ts";

const ROOT = resolve(import.meta.dir, "../..");
type Art = { label: string; cover: string; mapTile: string; overview?: string; regions: Record<string, string> };
const catalog = (dir: string) => JSON.parse(readFileSync(join(dir, "maps.json"), "utf8")) as Record<string, Art>;
const titleFile = (out: string, url: string) => join(out, url.slice("title/".length));

function proof<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "snark-map-gallery-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Miami's authored spawn places use the real checked-in photos", () => proof((dir) => {
  const maps = join(ROOT, "assets/source/maps"), media = join(ROOT, "client/entry/media"), out = join(dir, "title");
  buildMapGallery(maps, out, media, join(dir, "no-built-maps"));
  const art = catalog(out)["core:miami"]!;
  const { spawns } = JSON.parse(readFileSync(join(maps, "miami/world.json"), "utf8")) as { spawns: { name: string }[] };
  const photos = join(media, "atlas/miami");
  const authored = spawns.filter(({ name }) => existsSync(join(photos, spawnPhotoName(name) + ".webp")));
  expect(authored.length).toBeGreaterThan(0);
  expect(Object.keys(art.regions)).toEqual(authored.map(({ name }) => name));
  expect(readdirSync(photos).filter((file) => file.endsWith(".webp")).sort()).toEqual(authored.map(({ name }) => spawnPhotoName(name) + ".webp").sort());
  for (const { name } of authored) {
    const file = spawnPhotoName(name) + ".webp";
    expect(art.regions[name]).toBe(`title/atlas/miami/${file}`);
    expect(readFileSync(titleFile(out, art.regions[name]!))).toEqual(readFileSync(join(photos, file)));
  }
  expect(art.cover).toBe("title/miami-splash.webp");
  expect(existsSync(titleFile(out, art.cover))).toBe(true);
}));

test("a packed city supplies chart art and spawn crops without reports", () => proof((dir) => {
  const maps = join(dir, "built"), out = join(dir, "title");
  mkdirSync(maps);
  const dims = { chunksX: 4, chunksZ: 6 }, x = dims.chunksX * CHUNK_SIZE, z = dims.chunksZ * CHUNK_SIZE;
  const nx = x / TERRAIN_CELL + 1, nz = z / TERRAIN_CELL + 1;
  const spawns = [{ name: "Northwest", x: .75 * x, z: .75 * z, yaw: 0 }];
  const heights = Uint16Array.from({ length: nx * nz }, (_, k) => (k % nx > nx / 2 && Math.floor(k / nx) > nz / 2 ? 48 : 24) * 256);
  const file = join(maps, "tampa.snmap");
  writeFileSync(file, writeMap(flatMap(4, { id: "core:tampa", dims, heights, tint: new Uint8Array(nx * nz).fill(1), seaLevel: 0, spawns })));
  buildMapGallery(join(dir, "no-source-maps"), out, join(dir, "no-photos"), maps);
  const art = catalog(out)["core:tampa"]!;
  expect(art.label).toBe("Tampa");
  expect(art.overview).toBe("title/atlas/tampa/map.png");
  expect(art.mapTile).toBe("title/atlas/tampa/tile.png");
  expect(art.regions.Northwest).toBe("title/atlas/tampa/spawn-northwest.png");
  const picture = (url: string) => readFileSync(titleFile(out, url));
  const size = (file: Buffer) => [file.readUInt32BE(16), file.readUInt32BE(20)];
  expect(size(picture(art.overview!))).toEqual([512, 512]);
  expect(size(picture(art.mapTile))).toEqual([192, 192]);
  expect(size(picture(art.regions.Northwest!))).toEqual([240, 135]);
  const head = mapHeader(file);
  const relief = overviewRelief(head, 128);
  const warm = (pixel: number) => (pixel & 255) > ((pixel >> 16) & 255);
  expect(warm(relief.pixels[12 * 128 + 12]!)).toBe(true);
  expect(warm(relief.pixels[12 * 128 + 116]!)).toBe(false);
  expect(warm(relief.pixels[116 * 128 + 12]!)).toBe(false);
  const crop = spawnRelief(relief, head, head.spawns[0]!);
  expect(crop.pixels[68 * crop.width + 120]).toBe(0xff3549ae);
}));

test("legacy native reports and chart tiles keep their existing addresses", () => proof((dir) => {
  const maps = join(dir, "source"), source = join(maps, "tampa"), out = join(dir, "title");
  const views = join(source, "reports/world1"), world = join(source, "world"), tile = join(source, "tiles/z0");
  for (const folder of [views, world, tile]) mkdirSync(folder, { recursive: true });
  const png = encodePng({ width: 4, height: 3, channels: 3, depth: 8, data: new Uint8Array(36).fill(120) });
  for (const file of ["aerial-overhead.png", "skyline-river.png", "view-river.png"]) writeFileSync(join(views, file), png);
  writeFileSync(join(tile, "0_0.png"), png);
  writeFileSync(join(world, "world.json"), JSON.stringify({ spawns: [{ name: "River" }] }));
  writeFileSync(join(views, "views.json"), JSON.stringify([{ name: "skyline-river" }, { name: "view-river", spawn: "River" }]));
  buildMapGallery(maps, out, join(dir, "no-photos"), join(dir, "no-built-maps"));
  const art = catalog(out)["core:tampa"]!;
  expect(art.overview).toBe("title/map-tampa.png");
  expect(art.cover).toBe("title/atlas/tampa/cover.png");
  expect(art.mapTile).toBe("title/atlas/tampa/tile.png");
  expect(art.regions.River).toBe("title/atlas/tampa/view-river.png");
  for (const url of [art.cover, art.mapTile, art.overview!, art.regions.River!]) expect(existsSync(titleFile(out, url))).toBe(true);
}));
