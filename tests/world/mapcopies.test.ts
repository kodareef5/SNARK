import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from "node:zlib";
import { partsFolder, partsOf, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { COPIES_FILE, FIRST_FRAME_BUDGET, LEVELS, PART_BUDGETS, checkBudgets, copiesLevel, packMap, writeMapFile, type PackedPart } from "../../tools/map/pack.ts";
import { firstFrameParts } from "../../client/core/mapload.ts";
import { CHUNK_SIZE } from "../../shared/coords.ts";
import { koruMap } from "../fixtures/koru.ts";
import { busyMap, wideMap } from "../fixtures/map.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-copies-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("each part's copies give its bytes back, and a release's are the smaller", async () => {
  const file = writeMap(busyMap());
  const everyday = await packMap(file);
  const release = await packMap(file, true);
  for (const copies of [everyday, release]) {
    expect(copies.parts.map((p) => p.name)).toEqual(partsOf(file).map((p) => p.name));
    for (const p of copies.parts) expect([new Uint8Array(brotliDecompressSync(p.br)), new Uint8Array(gunzipSync(p.gz))]).toEqual([new Uint8Array(p.bytes), new Uint8Array(p.bytes)]);
  }
  expect([everyday.release, release.release]).toEqual([false, true]);
  // A release's gzip is the tightest there is, as every build's was before an everyday build took less.
  expect(release.parts.every((p) => Buffer.from(p.gz).equals(gzipSync(p.bytes, { level: 9 })))).toBe(true);
  const sum = (parts: readonly PackedPart[]): number => parts.reduce((n, p) => n + p.br.length, 0);
  expect(sum(release.parts)).toBeLessThan(sum(everyday.parts));
});

test("the heaviest first frame is the head and what the page's first frame waits for where it waits longest, by the loader's own rule: the landmarks' definitions, the overviews within reach and at most four sectors' ground", async () => {
  // The wide map's ten sectors, two rows of five, none of its nodes listed (a listed layer's map waits for all its ground).
  const m = wideMap();
  const file = writeMap({ ...m, nodes: m.nodes.filter((l) => !("first" in l)) });
  const head = readHead(file);
  const wide = await packMap(file);
  const br = (name: string): number => wide.parts.find((p) => p.name === name)!.br.length;
  const at = (x: number, z: number): number => firstFrameParts(head, x, z).reduce((n, p) => n + br(p.name), br(head.name));
  // Every place a body can stand, a chunk's corner at a time: none waits for more than the build says, and one waits for that.
  let most = 0;
  for (let z = 0; z <= head.dims.chunksZ * CHUNK_SIZE; z += CHUNK_SIZE) for (let x = 0; x <= head.dims.chunksX * CHUNK_SIZE; x += CHUNK_SIZE) most = Math.max(most, at(x, z));
  expect([wide.first.br, at(...wide.first.at), wide.first.sectors.length]).toEqual([most, most, 4]);
  // Of the overviews, those within reach of the heaviest place.
  const overviews = firstFrameParts(head, ...wide.first.at).filter((p) => p.kind === "overview").reduce((n, p) => n + br(p.name), 0);
  const grounds = wide.parts.filter((p) => p.kind === "ground" && wide.first.sectors.includes(`${p.col}-${p.row}`)).reduce((n, p) => n + p.br.length, 0);
  expect(wide.first.br).toBe(br(head.name) + overviews + grounds);
  // Until the statics are all in hand there: every part but the tops.
  expect(wide.first.city.br).toBe(wide.parts.filter((p) => p.kind !== "tops").reduce((n, p) => n + p.br.length, 0));
  // With landmarks, their definitions are waited for too.
  const koru = await packMap(writeMap(koruMap()));
  expect(koru.parts.filter((p) => p.kind === "land").length).toBe(1);
  expect(koru.first.br).toBe(koru.parts.filter((p) => p.kind === "head" || p.kind === "land" || p.kind === "overview" || p.kind === "ground").reduce((n, p) => n + p.br.length, 0));
});

test("a part over its kind's budget, or a first frame over its own, is refused and named", async () => {
  const packed = await packMap(writeMap(busyMap()));
  expect(() => checkBudgets(packed)).not.toThrow();
  const ground = packed.parts.find((p) => p.kind === "ground")!;
  const big = { ...ground, br: Buffer.alloc(PART_BUDGETS.ground + 1) };
  expect(() => checkBudgets({ ...packed, parts: packed.parts.map((p) => (p === ground ? big : p)) })).toThrow(`map: its part ${ground.name} is 1.05 MB on the wire, over the 1.05 MB a part of its kind may be in tools/map/pack.ts (an everyday build's copies`);
  expect(() => checkBudgets({ ...packed, first: { ...packed.first, br: FIRST_FRAME_BUDGET + 1 } })).toThrow("waits for 6.29 MB of it before it draws, over the 6.29 MB of tools/map/pack.ts");
});

test("a map's build writes its parts' copies beside it, no raw part, and takes away the rest", async () => {
  const path = join(dir, "busy.snmap");
  const folder = partsFolder(path);
  expect(folder).toBe(join(dir, "busy.parts"));
  writeFileSync(join(dir, "busy.snmap.0123abcd.br"), "a copy of the version before parts");
  await writeMapFile(path, writeMap(wideMap()));
  writeFileSync(join(folder, "ground.1-1.0123456789abcdef.part"), "a part of no map");
  const file = writeMap(busyMap());
  await writeMapFile(path, file);
  const head = readHead(file);
  const names = [head.name, ...head.parts.map((p) => p.name)];
  expect(readdirSync(folder).sort()).toEqual([COPIES_FILE, ...names.flatMap((n) => [`${n}.br`, `${n}.gz`])].sort());
  expect([existsSync(path), existsSync(join(dir, "busy.snmap.0123abcd.br"))]).toEqual([true, false]);
});

test("a build that dies before its map is written takes no old copy away", async () => {
  const path = join(dir, "dies.snmap");
  const old = writeMap(wideMap());
  await writeMapFile(path, old);
  const before = readdirSync(partsFolder(path)).sort();
  mkdirSync(`${path}.tmp`);
  await expect(writeMapFile(path, writeMap(busyMap()))).rejects.toThrow();
  expect(before.every((name) => existsSync(join(partsFolder(path), name)))).toBe(true);
  rmSync(`${path}.tmp`, { recursive: true });
});

test("a copy is kept where its part's name and levels match, and a release makes its own", async () => {
  const path = join(dir, "kept.snmap");
  const folder = partsFolder(path);
  const file = writeMap(busyMap());
  await writeMapFile(path, file);
  expect(copiesLevel(folder)).toEqual(LEVELS.everyday);
  const statics = readHead(file).parts.find((p) => p.kind === "statics")!;
  const copy = join(folder, `${statics.name}.br`);
  const made = readFileSync(copy);
  // A copy put there by hand proves the next everyday build read it rather than compressed again.
  const marked = brotliCompressSync(file.subarray(statics.at, statics.at + statics.length), { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } });
  writeFileSync(copy, marked);
  const everyday = await writeMapFile(path, file);
  expect([Buffer.from(everyday.parts.find((p) => p.name === statics.name)!.br).equals(marked), readFileSync(copy).equals(marked)]).toEqual([true, true]);
  const release = await writeMapFile(path, file, true);
  expect([copiesLevel(folder), readFileSync(copy).equals(marked)]).toEqual([LEVELS.release, false]);
  expect(release.parts.every((p) => readFileSync(join(folder, `${p.name}.gz`)).equals(gzipSync(p.bytes, { level: 9 })))).toBe(true);
  // An everyday build after a release makes everyday copies again.
  await writeMapFile(path, file);
  expect([copiesLevel(folder), readFileSync(copy).equals(made)]).toEqual([LEVELS.everyday, true]);
});
