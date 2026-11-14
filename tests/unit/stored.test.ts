// Parts stored deflated where a build serves them: the filters come undone, a stored set lists where each part is and
// holds what the raw set held, and the asset library puts on the card exactly what it would from the raw set, for
// fewer bytes over the network.
import { expect, test } from "bun:test";
import { inflateRawSync } from "node:zlib";
import { Assets } from "../../client/core/assets/assets.ts";
import { levelParts, textureParts } from "../../client/core/assets/port.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { FramePacket } from "../../client/core/render/packet.ts";
import { hashBytes } from "../../shared/hash.ts";
import { MANIFEST_VERSION, parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { FILTER_LEVEL, FILTER_NONE, FILTER_PIXELS, FILTER_PLANES, FILTER_SURFACE, PARTS_MAGIC, STORED_TEXTURE_VERSION, filterPart, unfilterPart } from "../../shared/pack/stored.ts";
import { Rng } from "../../shared/rng.ts";
import { deflate } from "../../tools/pack/deflate.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import type { SplitFile } from "../../tools/pack/split.ts";
import { storeParts } from "../../tools/pack/store.ts";
import { FakeNet } from "../fixtures/assetnet.ts";
import { sceneRegistry, sceneSet } from "../fixtures/sceneworld.ts";

type Set = { files: SplitFile[]; manifest: Manifest };

const roundTrip = (data: Uint8Array, filter: number, numbers: number[] = []): Uint8Array | null => unfilterPart(new Uint8Array(inflateRawSync(deflate(filterPart(data, filter, numbers), { passes: 1 }))), data.length);

test("every filter comes undone: indices of both widths and their padding, vertices, surfaces, records and pixels", () => {
  const rng = new Rng(9);
  const noise = (n: number, below = 256): Uint8Array => Uint8Array.from({ length: n }, () => rng.int(below));
  for (const [count, bytes, verts] of [[3, 2, 3], [300, 2, 120], [90, 4, 70_000]] as const) {
    const ix = bytes === 2 ? Uint16Array.from({ length: count }, () => rng.int(verts)) : Uint32Array.from({ length: count }, () => rng.int(verts));
    const at = (count * bytes + 3) & ~3;
    const level = new Uint8Array(at + verts * 8);
    level.set(new Uint8Array(ix.buffer));
    level.set(noise(verts * 8), at);
    expect(roundTrip(level, FILTER_LEVEL, [count, bytes])).toEqual(level);
  }
  for (const [data, filter, numbers] of [[noise(12 * 40), FILTER_SURFACE, []], [noise(8 * 40, 4), FILTER_PLANES, [8]], [noise(16 * 9), FILTER_PLANES, [16]], [noise(77), FILTER_NONE, []], [new Uint8Array(0), FILTER_NONE, []]] as const) {
    expect(roundTrip(data, filter, [...numbers])).toEqual(data);
  }
  // A step 0 of pictures 1 to 64 across, and a later step of one picture, four channels and two, as they are and in planes.
  for (const channels of [4, 2]) {
    for (const planar of [0, 1]) {
      const first = noise(5461 * channels, 9);
      expect(roundTrip(first, FILTER_PIXELS, [channels, 7, 0, planar])).toEqual(first);
      const step = noise(128 * 128 * channels, 9);
      expect(roundTrip(step, FILTER_PIXELS, [channels, 1, 7, planar])).toEqual(step);
    }
  }
  // A stream that comes to the wrong size, or names no filter, is refused.
  expect(roundTrip(noise(100), FILTER_PLANES, [3])).toBeNull();
  expect(unfilterPart(Uint8Array.of(9, 1, 2, 3), 3)).toBeNull();
});

let stored: Promise<Set> | null = null;
/** The scene's set as a build serves it. Made once per test process. */
function storedSet(): Promise<Set> {
  const raw = sceneSet();
  const manifest = structuredClone(raw.manifest);
  return (stored ??= storeParts(raw.files, manifest, { cache: null, workers: 2 }).then(({ files }) => ({ files, manifest })));
}

test("a stored set lists where each part is now, and each comes back to the bytes it was", async () => {
  const raw = sceneSet();
  const set = await storedSet();
  expect(parseManifest(JSON.stringify(set.manifest))).toEqual(set.manifest);
  expect([set.manifest.version, set.files.map((f) => f.name)]).toEqual([MANIFEST_VERSION, ["scene.boot.snpk", "scene.mesh.snpt", "scene.tex.rgba.sntx"]]);
  // The boot file is fetched whole and is as it was. The others are smaller, each behind a header of its own.
  expect(set.files[0]!.bytes).toEqual(raw.files[0]!.bytes);
  expect(new DataView(set.files[1]!.bytes.buffer).getUint32(0, true)).toBe(PARTS_MAGIC);
  expect(new DataView(set.files[2]!.bytes.buffer).getUint16(4, true)).toBe(STORED_TEXTURE_VERSION);
  for (const k of [1, 2]) expect(set.files[k]!.bytes.length).toBeLessThan(raw.files[k]!.bytes.length * 0.75);
  const open = (file: number, offset: number, length: number, inflated?: number): Uint8Array => {
    const got = set.files[file]!.bytes.subarray(offset, offset + length);
    return inflated === undefined ? got : unfilterPart(new Uint8Array(inflateRawSync(got)), inflated)!;
  };
  let deflated = 0;
  set.manifest.meshes.forEach((m) =>
    m.levels.forEach((level) => {
      levelParts(level, 0, level.parts.length).forEach((p, k) => {
        const file = k === 0 ? level.file : (level.surface ?? level).file;
        if (p.inflated !== undefined) deflated++;
        expect(partHash(open(file, p.offset, p.length, p.inflated))).toBe(level.parts[k]!.hash);
      });
    }),
  );
  for (const tex of set.manifest.textures!) {
    textureParts(tex, "rgba", tex.in.rgba!.hash.length - 1).forEach((p, k) => {
      if (p.inflated !== undefined) deflated++;
      expect(partHash(open(tex.in.rgba!.file, p.offset, p.length, p.inflated))).toBe(tex.in.rgba!.hash[k]!);
    });
  }
  expect(deflated).toBeGreaterThan(10);
});

/**
 * Every mesh wanted at its finest, a couple of metres off, with its materials, over a network that brings all at once.
 * Returns a hash of what went onto the card in each frame, and the bytes fetched.
 */
function fetchAll(set: Set, tier: string): { frames: number[]; fetched: number; download: number; surfaces: number; rows: number } {
  const port = new FakeNet(set.files.map((f) => f.bytes));
  const assets = new Assets(sceneRegistry(), parsePack(set.files[0]!.bytes), set.manifest, port);
  assets.tier = tierOf(tier);
  const packet = new FramePacket();
  const frames: number[] = [];
  let [surfaces, rows] = [0, 0];
  for (let f = 0; f < 40; f++) {
    port.advance(f * 16);
    packet.beginFrame();
    assets.begin(f * 16, 720, 1.2217);
    for (let m = 0; m < set.manifest.meshes.length; m++) {
      assets.wantTextured(m, 0, 2);
      const got = assets.level(m, 0);
      if (got >= 0) assets.textured(m, got);
    }
    assets.end(packet, f * 16);
    let h = 0;
    const words = (...n: number[]): Uint8Array => new Uint8Array(Uint32Array.from(n).buffer);
    for (const u of packet.assetUploads) h = hashBytes(u.data, hashBytes(words(u.slot, u.of ?? 0, u.skinAt ?? 0), h));
    for (const u of packet.texUploads) h = hashBytes(u.data, hashBytes(words(u.slot, u.size, u.row, u.rows, u.top), h));
    frames.push(h);
    surfaces += packet.assetUploads.filter((u) => u.of !== undefined).length;
    rows += packet.texUploads.length;
  }
  return { frames, fetched: assets.residency.stats.fetched, download: assets.residency.download(), surfaces, rows };
}

test("the asset library puts on the card from a stored set what it would from the raw one, frame by frame, for fewer bytes", async () => {
  const set = await storedSet();
  for (const tier of ["lowpoly", "medium"]) {
    const [was, now] = [fetchAll(sceneSet(), tier), fetchAll(set, tier)];
    expect(now.frames).toEqual(was.frames);
    expect(now.fetched).toBeGreaterThan(0);
    expect(now.fetched).toBeLessThan(was.fetched * 0.75);
    expect(now.download).toBeLessThan(was.download * 0.75);
    // Low poly takes levels alone. Medium takes their surfaces too, and textures a band at a time.
    expect([now.surfaces > 0, now.rows > 0]).toEqual([tier === "medium", tier === "medium"]);
  }
});
