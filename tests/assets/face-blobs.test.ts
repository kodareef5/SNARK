// A mesh's face table through the pack, the split and the residency, and the CPU copy kept of a chosen level's bytes.
import { expect, test } from "bun:test";
import { Residency, type AssetUpload } from "../../client/core/assets/residency.ts";
import type { TextureUpload } from "../../client/core/render/packet.ts";
import { parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, meshFaces, parsePack, type Pack, type PackMaterial } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { bootManifest, splitPack } from "../../tools/pack/split.ts";
import { orderPack } from "../../tools/pack/order.ts";
import { storeParts } from "../../tools/pack/store.ts";
import { buildPack, unpackMeshes, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";
import { FakeNet } from "../fixtures/assetnet.ts";

const MATERIAL: PackMaterial = { id: "t:skin", base: -1, normal: -1, mro: -1, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 1 };

/** A grid of `n` by `n` vertices facing +z, each on two bones half and half. */
function grid(n: number): SourceLod {
  const positions: number[] = [], uvs: number[] = [], normals: number[] = [], indices: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    positions.push(x / (n - 1) - 0.5, y / (n - 1), Math.sin(x + y) * 0.01);
    uvs.push(x / (n - 1), y / (n - 1));
    normals.push(0, 0, 1);
  }
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) {
    const v = y * n + x;
    indices.push(v, v + 1, v + n + 1, v, v + n + 1, v + n);
  }
  const count = n * n;
  return {
    positions: Float32Array.from(positions), colors: new Uint8Array(count).fill(1), indices: Uint32Array.from(indices), uvs: Float32Array.from(uvs), normals: Float32Array.from(normals),
    bones: new Uint8Array(count), joints: Uint8Array.from({ length: count * 4 }, (_, k) => (k % 4 === 1 ? 1 : 0)), weights: Float32Array.from({ length: count * 4 }, (_, k) => (k % 4 < 2 ? 0.5 : 0)),
  };
}

const FACES = Uint8Array.from({ length: 3001 }, (_, k) => (k * 37 + (k >> 3)) & 255);
const HEAD: SourceMesh = { id: "t:head", skeleton: "t:skeleton", lods: [grid(30), grid(3)], flat: 2, materials: [MATERIAL], textures: [], faces: FACES };
const BODY: SourceMesh = { id: "t:body", lods: [grid(4)], flat: 1, materials: [MATERIAL], textures: [] };
const WHOLE = buildPack([HEAD, BODY], defaultPalette());
const PACK = parsePack(WHOLE);
const head = PACK.meshIndex.get("t:head")!;

/** A level's bytes in the whole pack: indices and vertices, and its surface and skin. */
function packLevel(pack: Pack, mesh: number, level: number): { level: Uint8Array; surface: Uint8Array } {
  const lod = pack.header.meshes[mesh]!.lods[level]!;
  const end = lod.vertexOffset + lod.vertexCount * VERTEX_BYTES;
  const surface = lod.surfaceOffset!;
  return { level: pack.blob.slice(lod.indexOffset, end), surface: pack.blob.slice(surface, surface + lod.vertexCount * (SURFACE_BYTES + (lod.skinOffset === undefined ? 0 : SKIN_BYTES))) };
}

/** A residency over the split files and frames run until `done`, or a hundred frames. */
function run(r: Residency, net: FakeNet, frame: (r: Residency) => void, done: () => boolean, from = 0): number {
  let now = from;
  const uploads: AssetUpload[] = [], drops: number[] = [], texUploads: TextureUpload[] = [], texDrops: number[] = [];
  for (let k = 0; k < 100 && !done(); k++) {
    now += 16;
    net.advance(now);
    uploads.length = drops.length = texUploads.length = texDrops.length = 0;
    r.begin(now);
    frame(r);
    r.end(uploads, drops, texUploads, texDrops, now);
  }
  return now;
}

/** A frame's draw of a level of the head with its materials: whether it was drawn so. */
function drawn(r: Residency, level: number): boolean {
  r.want(head, level, 1);
  r.wantSurface(head, level, 1);
  const shown = r.level(head, level);
  return shown === level && r.textured(head, shown);
}

function split(): { files: Uint8Array[]; manifest: Manifest; boot: Pack } {
  const { files, manifest } = splitPack(WHOLE, "t");
  return { files: files.map((f) => f.bytes), manifest: parseManifest(JSON.stringify(bootManifest(manifest))), boot: parsePack(files[0]!.bytes) };
}

test("a mesh's face table survives a pack unpacked and built again", () => {
  expect(meshFaces(PACK, PACK.header.meshes[head]!)).toEqual(FACES);
  expect(meshFaces(PACK, PACK.header.meshes[PACK.meshIndex.get("t:body")!]!)).toBeNull();
  const again = unpackMeshes(PACK);
  expect(again.find((m) => m.id === "t:head")!.faces).toEqual(FACES);
  const rebuilt = parsePack(buildPack(again, PACK.palette));
  expect(meshFaces(rebuilt, rebuilt.header.meshes[rebuilt.meshIndex.get("t:head")!]!)).toEqual(FACES);
});

test("ordering for the vertex cache keeps the face table and the finest level it is by", () => {
  const ordered = parsePack(orderPack(WHOLE));
  const at = ordered.meshIndex.get("t:head")!;
  expect(meshFaces(ordered, ordered.header.meshes[at]!)).toEqual(FACES);
  expect(packLevel(ordered, at, 0)).toEqual(packLevel(PACK, head, 0));
});

test("a pack whose face table points past its blob is refused", () => {
  const json = JSON.stringify({ ...PACK.header, meshes: PACK.header.meshes.map((m) => (m.faces ? { ...m, faces: { offset: PACK.blob.length - 4, length: 8 } } : m)) });
  const text = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
  const file = new Uint8Array(12 + text.length + PACK.blob.length);
  file.set(WHOLE.subarray(0, 8));
  new DataView(file.buffer).setUint32(8, text.length, true);
  file.set(text, 12);
  file.set(PACK.blob, 12 + text.length);
  expect(() => parsePack(file)).toThrow(/face table/);
});

test("split puts the face table in the clip file, and no pack header names it", () => {
  const { files, manifest } = splitPack(WHOLE, "t");
  expect(files.map((f) => f.role)).toEqual(["boot", "mesh", "clip"]);
  const [entry] = manifest.faces!;
  expect([manifest.faces!.length, manifest.meshes[entry!.mesh]!.id, manifest.files[entry!.file]!.role]).toEqual([1, "t:head", "clip"]);
  expect(files[entry!.file]!.bytes.subarray(entry!.at, entry!.at + entry!.part.bytes)).toEqual(FACES);
  for (const f of files.slice(0, 2)) expect(parsePack(f.bytes).header.meshes.some((m) => m.faces !== undefined)).toBe(false);
  expect(parseManifest(JSON.stringify(bootManifest(manifest))).faces).toEqual(manifest.faces);
});

test("a face table stored deflated comes back whole after wantFaces, and outlasts a lost card", async () => {
  const { files, manifest } = splitPack(WHOLE, "t");
  const stored = await storeParts(files, manifest, { workers: 1, cache: null });
  const read = parseManifest(JSON.stringify(bootManifest(manifest)));
  const net = new FakeNet(stored.files.map((f) => f.bytes), { latencyMs: 40, bytesPerSecond: 2e5 });
  const r = new Residency(read, parsePack(stored.files[0]!.bytes), net);
  const body = read.meshes.findIndex((m) => m.id === "t:body");
  expect([r.facesOf(head), r.facesOf(body), r.faces(head)]).toEqual([true, false, null]);
  // Asked once: it is fetched over the frames that follow, nobody asking again.
  r.wantFaces(head);
  const now = run(r, net, () => {}, () => r.faces(head) !== null);
  expect(r.faces(head)).toEqual(FACES);
  r.reset();
  run(r, net, () => {}, () => false, now);
  expect(r.faces(head)).toEqual(FACES);
});

test("a face table that fails on the network is asked for again until it comes", () => {
  const { files, manifest, boot } = split();
  const net = new FakeNet(files, { loss: 1 });
  const r = new Residency(manifest, boot, net);
  r.wantFaces(head);
  let now = run(r, net, () => {}, () => false);
  expect([r.faces(head), r.stats.failNet > 0]).toEqual([null, true]);
  net.loss = 0;
  // Retries back off to 8 s at most, so a few seconds of frames bring it.
  for (let k = 0; k < 10 && !r.faces(head); k++) now = run(r, net, () => {}, () => r.faces(head) !== null, now + 1000);
  expect(r.faces(head)).toEqual(FACES);
});

test("keepBytes keeps a level's and its surface's bytes as the pack has them", () => {
  const { files, manifest, boot } = split();
  const net = new FakeNet(files, { latencyMs: 20, bytesPerSecond: 1e6 });
  const r = new Residency(manifest, boot, net);
  r.cap = 0;
  // Level 0 streams from the mesh file; level 1 is held in the boot file, and its surface streams.
  expect(manifest.meshes[head]!.levels.map((l) => manifest.files[l.file]!.role)).toEqual(["mesh", "boot"]);
  r.keepBytes(head, 0);
  r.keepBytes(head, 1);
  expect([r.keptBytes(head, 0), r.keptBytes(head, 1)]).toEqual([null, null]);
  run(r, net, (x) => (drawn(x, 0), drawn(x, 1)), () => r.keptBytes(head, 0) !== null && r.keptBytes(head, 1) !== null);
  for (const level of [0, 1]) {
    const kept = r.keptBytes(head, level)!;
    const lod = PACK.header.meshes[head]!.lods[level]!;
    expect({ level: kept.level, surface: kept.surface }).toEqual(packLevel(PACK, head, level));
    expect([kept.indexCount, kept.indexBytes, kept.skinAt]).toEqual([lod.indexCount, lod.indexBytes, lod.vertexCount * SURFACE_BYTES]);
  }
  // The card's letting go leaves the copies.
  r.reset();
  expect(r.keptBytes(head, 0)!.level).toEqual(packLevel(PACK, head, 0).level);
});

test("keepBytes on a level the card holds lets it go, and keeps it when it comes again", () => {
  const { files, manifest, boot } = split();
  const net = new FakeNet(files, { latencyMs: 20, bytesPerSecond: 1e6 });
  const r = new Residency(manifest, boot, net);
  r.cap = 0;
  let textured = false;
  const draw = (x: Residency): void => void (textured = drawn(x, 0));
  const now = run(r, net, draw, () => textured);
  expect(textured).toBe(true);
  r.keepBytes(head, 0);
  const evicted = r.stats.evicted;
  run(r, net, draw, () => r.keptBytes(head, 0) !== null, now);
  expect([r.stats.evicted - evicted, r.keptBytes(head, 0)?.surface]).toEqual([2, packLevel(PACK, head, 0).surface]);
});
