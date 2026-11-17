import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { partsFolder, partsOf, readHead, writeMap } from "../../shared/world/mapfile.ts";
import { FIRST_FRAME_BUDGET, PART_BUDGETS, checkBudgets, firstFrame, packMap, writeMapFile, type PackedPart } from "../../tools/map/pack.ts";
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

test("the heaviest first frame is the head, the landmarks' definitions, the heaviest overview and the heaviest four sectors at a corner", async () => {
  const packed = await packMap(writeMap(koruMap()));
  const of = (kind: string): PackedPart[] => packed.parts.filter((p) => p.kind === kind);
  expect(of("land").length).toBe(1);
  // The wide map's ten sectors, two rows of five: the heaviest corner is somewhere among four of them.
  const wide = await packMap(writeMap(wideMap()));
  const sector = (col: number, row: number): number => wide.parts.filter((p) => (p.kind === "ground" || p.kind === "statics") && p.col === col && p.row === row).reduce((n, p) => n + p.br.length, 0);
  const corners = [127, 128, 129, 130].map((c) => sector(c, 128) + sector(c + 1, 128) + sector(c, 129) + sector(c + 1, 129));
  const most = Math.max(...corners);
  const head = wide.parts.find((p) => p.kind === "head")!.br.length;
  const overview = Math.max(...wide.parts.filter((p) => p.kind === "overview").map((p) => p.br.length));
  expect(wide.first).toEqual({ br: head + overview + most, gz: wide.first.gz, overview: wide.first.overview, corner: [127 + corners.indexOf(most), 128] });
  expect(firstFrame(packed.parts).br).toBe(of("head")[0]!.br.length + of("land")[0]!.br.length + of("overview")[0]!.br.length + of("ground")[0]!.br.length + of("statics")[0]!.br.length);
});

test("a part over its kind's budget, or a first frame over its own, is refused and named", async () => {
  const packed = await packMap(writeMap(busyMap()));
  expect(() => checkBudgets(packed)).not.toThrow();
  const ground = packed.parts.find((p) => p.kind === "ground")!;
  const big = { ...ground, br: Buffer.alloc(PART_BUDGETS.ground + 1) };
  expect(() => checkBudgets({ ...packed, parts: packed.parts.map((p) => (p === ground ? big : p)) })).toThrow(`map: its part ${ground.name} is 1.05 MB on the wire, over the 1.05 MB a part of its kind may be in tools/map/pack.ts (an everyday build's copies`);
  expect(() => checkBudgets({ ...packed, first: { ...packed.first, br: FIRST_FRAME_BUDGET + 1 } })).toThrow("waits for 8.39 MB of it before it draws, over the 8.39 MB of tools/map/pack.ts");
});

test("a map's build writes its head and parts beside it, each with its copies, and takes away what is not one of them", async () => {
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
  expect(readdirSync(folder).sort()).toEqual(names.flatMap((n) => [n, `${n}.br`, `${n}.gz`]).sort());
  expect([existsSync(path), existsSync(join(dir, "busy.snmap.0123abcd.br"))]).toEqual([true, false]);
});
