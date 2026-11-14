// The asset library streaming surfaces and textures: a body is drawn with its materials only when the card holds all
// that takes, textures climb a step at a time within their share of the card, and low poly asks for none of it.
import { expect, test } from "bun:test";
import { FIRST, OVERFLOW } from "../../client/core/assets/residency.ts";
import { tierOf, type Tier } from "../../client/core/assets/tiers.ts";
import { MANIFEST_VERSION, parseManifest, type Manifest, type ManifestLevel, type ManifestMesh } from "../../shared/pack/manifest.ts";
import { SKIN_BYTES, SURFACE_BYTES, VERTEX_BYTES, parsePack, type PackHeader, type PackMaterial } from "../../shared/pack/pack.ts";
import { TEXTURE_FORMATS, TEXTURE_HEADER_BYTES, TEXTURE_MAGIC, TEXTURE_VERSION, pictureBytes, stepBytes, stepOf, textureBytes, topIn, type TextureFormat, type TextureRole } from "../../shared/pack/texture.ts";
import { Rng } from "../../shared/rng.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import { splitPack, type SplitFile } from "../../tools/pack/split.ts";
import { writeTextureFile } from "../../tools/pack/texture.ts";
import { PackBlob } from "../../tools/pack/write.ts";
import type { NetOptions } from "../fixtures/assetnet.ts";
import { assetWorld, type Thing } from "../fixtures/assetworld.ts";
import { tubePack } from "../fixtures/textured.ts";

type Set = { files: SplitFile[]; manifest: Manifest };

/** Bytes that mean nothing, the same for the same seed. */
function noise(bytes: number, rng: Rng): Uint8Array {
  const words = new Uint32Array((bytes + 3) >> 2);
  for (let i = 0; i < words.length; i++) words[i] = rng.u32();
  return new Uint8Array(words.buffer, 0, bytes);
}

const LEVELS = 3;
/** The textures of a body: its hide's base colour, normal, packed map and two masks, and its horn's base colour. */
const MAPS = 6;
const [BASE, NORMAL, MRO, MASK, MASK2, HORN] = [0, 1, 2, 3, 4, 5];

/**
 * A set listed by hand, its bytes noise. Each body has three levels: two with a surface and a skin, in the mesh file,
 * and a flat one in the boot file. It is drawn in two sections. Its hide has every map, `top` pixels across, with the
 * packed map and the masks authored a step under. Its horn has a base colour and nothing else.
 */
function texturedSet(bodies: number, top: number, formats: readonly TextureFormat[] = ["bc"], verts = 7000): Set {
  const rng = new Rng(5);
  const boot = new PackBlob();
  const header: PackHeader = { paletteOffset: boot.append(new Uint8Array(1024)), meshes: [], rigs: [], clips: [] };
  const manifest: Manifest = { version: MANIFEST_VERSION, files: [], boot: 0, clipHash: 0, meshes: [], materials: [], textures: [] };
  const stream: Uint8Array[] = [];
  let streamed = 0;
  for (let i = 0; i < bodies; i++) {
    const mesh: ManifestMesh = { id: `t:body_${i}`, center: [0, 1, 0], half: [1, 1, 1], levels: [], flat: LEVELS - 1 };
    [verts, verts >> 2, 40].forEach((count, l) => {
      const tris = count * 2;
      const sizes = [tris * 6 + count * VERTEX_BYTES, count * SURFACE_BYTES, count * SKIN_BYTES].slice(0, l < mesh.flat! ? 3 : 1);
      const parts = sizes.map((bytes) => noise(bytes, rng));
      const level: ManifestLevel = { file: l < mesh.flat! ? 1 : 0, at: streamed, verts: count, tris, index: 2, error: [0, 0.06, 0.4][l]!, parts: parts.map((p) => ({ bytes: p.length, hash: partHash(p) })) };
      if (l < mesh.flat!) {
        level.sections = [2 * i, 0, tris * 2, 2 * i + 1, tris * 2, tris];
        stream.push(...parts);
        streamed += sizes.reduce((a, b) => a + b, 0);
      } else level.at = boot.append(parts[0]!);
      mesh.levels.push(level);
    });
    manifest.meshes.push(mesh);
    const material = (id: string, span: number, maps: number[]): PackMaterial => ({ id, base: maps[0]!, normal: maps[1]!, mro: maps[2]!, mask: maps[3]!, mask2: maps[4]!, tint: [1, 1, 1], grey: 0.5, emissive: 0, flags: 0, cutoff: 0, span });
    manifest.materials!.push(material(`t:hide_${i}`, 2, [BASE, NORMAL, MRO, MASK, MASK2].map((k) => MAPS * i + k)), material(`t:horn_${i}`, 1, [MAPS * i + HORN, -1, -1, -1, -1]));
    const maps: [TextureRole, number][] = [["base", top], ["normal", top], ["mro", top >> 1], ["mask", top >> 1], ["mask2", top >> 1], ["base", top >> 1]];
    for (const [role, size] of maps) manifest.textures!.push({ id: `t:${role}_${manifest.textures!.length}`, role, top: size, in: {} });
  }
  const files: SplitFile[] = [
    { name: "t.boot.snpk", role: "boot", bytes: boot.file(header) },
    { name: "t.mesh.snpk", role: "mesh", bytes: Buffer.concat(stream) },
  ];
  // The flat levels were placed in the boot file's blob, which starts after its header.
  const blobAt = parsePack(files[0]!.bytes).blobAt;
  for (const mesh of manifest.meshes) mesh.levels[LEVELS - 1]!.at += blobAt;
  for (const format of formats) {
    const head = new Uint8Array(TEXTURE_HEADER_BYTES);
    new DataView(head.buffer).setUint32(0, TEXTURE_MAGIC, true);
    new DataView(head.buffer).setUint16(4, TEXTURE_VERSION, true);
    new DataView(head.buffer).setUint16(6, TEXTURE_FORMATS.indexOf(format), true);
    new DataView(head.buffer).setUint32(8, manifest.textures!.length, true);
    const runs: Uint8Array[] = [head];
    let at = head.length;
    for (const tex of manifest.textures!) {
      const hash: string[] = [];
      for (let k = 0; k <= stepOf(topIn(format, tex.top)); k++) {
        runs.push(noise(stepBytes(format, tex.role, k), rng));
        hash.push(partHash(runs[runs.length - 1]!));
      }
      tex.in[format] = { file: files.length, at, hash };
      at += textureBytes(format, tex.role, topIn(format, tex.top));
    }
    files.push({ name: `t.tex.${format}.sntx`, role: "tex", bytes: Buffer.concat(runs) });
  }
  manifest.files = files.map((f, k) => ({ name: f.name, bytes: f.bytes.length, role: f.role, ...(k > 1 ? { format: formats[k - 2]! } : {}) }));
  parseManifest(JSON.stringify(manifest));
  return { files, manifest };
}

const SET = texturedSet(4, 512);
/** A body's textures at their widest, and at their narrowest. */
const WIDE = [512, 512, 256, 256, 256, 256];
const NARROW = [64, 64, 64, 64, 64, 64];
/** The slot the port knows a texture by: the levels and their surfaces come first. */
const texSlot = (set: Set, texture: number): number => 2 * LEVELS * set.manifest.meshes.length + texture;
const world = (things: readonly Thing[], net: NetOptions = {}, tier: Partial<Tier> = {}, set = SET, format: TextureFormat = "bc", sight = Infinity) =>
  assetWorld(set, things, { keep: true, bytesPerSecond: 20e6, ...net }, tier, format, sight);
type World = ReturnType<typeof world>;
/** How wide the card's copy of each of a body's textures is. 0 for none. */
const tops = (w: World, body: number): number[] => Array.from({ length: MAPS }, (_, k) => w.card.textures.get(MAPS * body + k)?.top ?? 0);
/** The requests for a slot, in order: the whole line, or only what follows the urgency. */
const asks = (w: World, slot: number): string[] => w.port.log.filter((line) => line.split(" ")[1] === "ask" && line.split(" ")[2] === String(slot));
const kinds = (w: World, slot: number): string[] => asks(w, slot).map((line) => line.split(" ").slice(4).join(" "));
const once = (w: World): boolean => [...w.port.over.values()].every((times) => times === 1);

test("on a slow, lossy link a body turns from flat to its materials when the card holds all that takes, and its textures then climb a step at a time", () => {
  const upload = 16 * 1024;
  const w = world([0, 1, 2].map((i) => ({ mesh: i, x: (i - 1) * 3, z: 300 })), { latencyMs: 80, bytesPerSecond: 1.2e6, loss: 0.1, seed: 4 }, { uploadBytes: upload });
  w.frame(0);
  // The first frame draws every body flat, from the boot pack.
  expect([...w.shown, ...w.drawn]).toEqual([0, 0, 0, 2, 2, 2]);
  const end = w.run(10, 0, 29.65);
  w.run(8, end);
  // The world throws if a frame draws a body with materials while the card lacks its surface, a base colour or a mask,
  // and if the library's count of the card is ever not the card's own. None did, and no body once shown fell back.
  expect([w.settled(), [...w.shown], [...w.lapsed], w.r.stats.skipped]).toEqual([true, [1, 1, 1], [0, 0, 0], 0]);
  // At 3.5 m a hide 2 m across covers 294 pixels and wants its 512, with the packed map and the masks a step under,
  // as they were authored. The bodies 4.6 m off to the sides want a step less of everything.
  expect([0, 1, 2].map((body) => tops(w, body))).toEqual([WIDE.map((top) => top >> 1), WIDE, WIDE.map((top) => top >> 1)]);
  // Each texture was made at 64 and then at each size up to the one it has, each time from a request of its own.
  for (let t = 0; t < 3 * MAPS; t++) {
    const made = w.card.made.filter(([texture]) => texture === t).map(([, top]) => top);
    expect(made).toEqual(made.map((_, k) => 64 << k));
    expect(kinds(w, texSlot(SET, t)).filter((kind) => !kind.endsWith("fresh")).filter((kind, k, all) => all.indexOf(kind) === k)).toEqual(made.map((_, k) => (k === 0 ? "" : `x${k + 1}`)));
  }
  // Requests were lost and asked again, and still no part crossed the link twice: a step up asks for the steps before
  // it too, and those the port had kept.
  expect(w.r.stats.failed).toBeGreaterThan(3);
  expect([once(w), w.r.stats.fetched, w.r.stats.cached > 0]).toEqual([true, w.r.stats.used, true]);
  // Rows went up a frame's allowance at a time.
  expect([w.card.mostBand, w.mostRows()]).toEqual([upload, upload]);
  // What a material is not drawn without is asked for before its normal and its packed map, and before everything else.
  const firstAsk = (t: number): number => w.port.log.indexOf(asks(w, texSlot(SET, t))[0]!);
  for (let body = 0; body < 3; body++) expect(Math.max(...[BASE, MASK, MASK2].map((k) => firstAsk(MAPS * body + k)))).toBeLessThan(Math.min(firstAsk(MAPS * body + NORMAL), firstAsk(MAPS * body + MRO)));
  expect(asks(w, texSlot(SET, BASE))[0]!.split(" ")[3]).toBe(Math.fround(FIRST * (1 + 1 / Math.hypot(3, 300))).toFixed(4));
  // Standing still, nothing more is asked for or let go.
  const { requests } = w.r.stats;
  w.run(3, end);
  expect([w.r.stats.requests - requests, w.r.flying, w.dropped]).toEqual([0, 0, { levels: 0, textures: 0 }]);
});

test("the same seed gives the same requests and the same rows in the same frames", () => {
  const runs = [0, 1].map(() => {
    const w = world([0, 1, 2].map((i) => ({ mesh: i, x: (i - 1) * 3, z: 60 })), { latencyMs: 60, bytesPerSecond: 2e6, loss: 0.2, seed: 9 }, { uploadBytes: 32 * 1024 });
    const rows: string[] = [];
    for (let f = 0, z = 0; f < 300; f++) {
      w.frame((z += 0.19));
      for (const u of w.packet.assetUploads) rows.push(`${f} ${u.slot} ${u.of ?? ""}`);
      for (const u of w.packet.texUploads) rows.push(`${f} ${u.slot} ${u.top} ${u.size} ${u.row} ${u.rows} ${u.last}`);
    }
    return [w.port.log, rows];
  });
  expect([runs[0]![0]!.length > 40, runs[0]![1]!.length > 200]).toEqual([true, true]);
  expect(runs[1]).toEqual(runs[0]!);
});

test("textures keep to their share: the least lately drawn goes whole and its body is drawn flat, and levels make way for textures", () => {
  // Four bodies 200 m apart, each seen only from near it. One body's textures at their widest are 1.05 MB, so the share holds two bodies' and not three.
  const share = 2.4e6;
  const stops = [0, 1, 2, 3].map((i) => 200 * i - 3.5);
  const w = world([0, 1, 2, 3].map((i) => ({ mesh: i, z: 200 * i })), {}, { gpuBytes: 6e6, textureShare: share / 6e6 }, SET, "bc", 120);
  for (const z of stops.slice(0, 2)) w.run(3, z);
  expect([tops(w, 0), tops(w, 1), w.dropped.textures]).toEqual([WIDE, WIDE, 0]);
  w.run(3, stops[2]!);
  // The third body's came in, and for them the first body's went, each all at once, in the order they were last drawn in, until there was room.
  expect([tops(w, 0), tops(w, 2), w.dropped]).toEqual([[0, 0, 0, 0, 256, 256], WIDE, { levels: 0, textures: 4 }]);
  w.run(3, stops[3]!);
  expect([tops(w, 0), tops(w, 1), tops(w, 3)]).toEqual([[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 256, 256], WIDE]);
  expect(w.card.mostTex).toBeLessThanOrEqual(share);
  expect(w.card.mostTex).toBeGreaterThan(share * 0.9);
  // Back at the first body: its finest level and its surface are still on the card, and it is drawn flat until its base colour is back.
  w.frame(stops[0]!);
  expect([w.drawn[0], w.shown[0], w.card.surfaces.has(w.r.slot(0, 0))]).toEqual([0, 0, true]);
  w.run(3, stops[0]!);
  expect([w.shown[0], tops(w, 0)]).toEqual([1, WIDE]);
  // It was made again from its 64, out of parts the port had kept: nothing crossed the link twice.
  expect(w.card.made.filter(([texture]) => texture === BASE).map(([, top]) => top)).toEqual([64, 128, 256, 512, 64, 128, 256, 512]);
  expect(once(w)).toBe(true);

  // A card with room for two bodies' textures and little more: the levels of the bodies left behind go, and the textures never give them room.
  const budget = 2.8e6;
  const tight = world([0, 1, 2, 3].map((i) => ({ mesh: i, z: 200 * i })), {}, { gpuBytes: budget, textureShare: 0.85 }, SET, "bc", 120);
  for (const z of [...stops, stops[0]!]) tight.run(3, z);
  expect(tight.dropped.levels).toBeGreaterThan(4);
  expect(tight.dropped.textures).toBeGreaterThan(9);
  expect(tight.card.most).toBeLessThanOrEqual(budget * OVERFLOW);
  expect(tight.card.mostTex).toBeLessThanOrEqual(budget * 0.85);
  expect([tight.shown[0], tops(tight, 0), tight.r.stats.skipped]).toEqual([1, WIDE, 0]);
});

test("a texture in view that holds more than is wanted of it is remade smaller when another needs the room, and its body is never drawn flat for it", () => {
  // Two bodies 150 m apart, both always in view, and a share that holds one body's textures at their widest and a third more.
  const share = 1.4e6;
  const w = world([{ mesh: 0, z: 0 }, { mesh: 1, z: 150 }], {}, { gpuBytes: 4e6, textureShare: share / 4e6 });
  w.run(4, -3.5);
  expect([tops(w, 0), tops(w, 1)]).toEqual([WIDE, NARROW]);
  // Beside the second body, the first is 146 m off and still holds its 512s. As many are given back as the second needs room for.
  const far = [64, 64, 64, 64, 256, 256];
  w.run(6, 146.5);
  expect([tops(w, 0), tops(w, 1), w.r.stats.shrunk]).toEqual([far, WIDE, 4]);
  // And back again. Nothing was let go, neither body was ever drawn flat for it, and the share was kept to.
  w.run(6, -3.5);
  expect([tops(w, 0), tops(w, 1), w.r.stats.shrunk, w.dropped.textures, [...w.lapsed]]).toEqual([WIDE, far, 8, 0, [0, 0]]);
  expect(w.card.mostTex).toBeLessThanOrEqual(share * OVERFLOW);
  // It settles: nothing is asked for while nothing moves.
  const { requests } = w.r.stats;
  w.run(3, -3.5);
  expect(w.r.stats.requests - requests).toBe(0);
});

test("what cannot be had: a body is drawn without a normal, a texture stays at the step before a bad one, and a body without its surface or its base colour stays flat", () => {
  const set: Set = { files: SET.files, manifest: JSON.parse(JSON.stringify(SET.manifest)) as Manifest };
  const bad = "0000000000000000";
  const steps = (texture: number): string[] => set.manifest.textures![texture]!.in.bc!.hash;
  steps(NORMAL)[0] = bad;
  steps(MAPS + BASE)[2] = bad;
  set.manifest.meshes[2]!.levels[0]!.parts[1]!.hash = bad;
  steps(3 * MAPS + MASK2)[0] = bad;
  const w = world([0, 1, 2, 3].map((i) => ({ mesh: i, x: 3 * i, z: 0 })), { latencyMs: 20 }, {}, set);
  w.run(8, -3.5);
  // A normal whose first step is wrong is asked for twice. Its body is drawn with its materials all the same.
  expect([kinds(w, texSlot(set, NORMAL)), w.shown[0], tops(w, 0)]).toEqual([["", "fresh"], 1, [512, 0, 256, 256, 256, 256]]);
  // A base colour whose 256 is wrong stays at 128. The 256 was asked for twice, with the two steps before it.
  expect([kinds(w, texSlot(set, MAPS + BASE)), w.shown[1], tops(w, 1)[BASE]]).toEqual([["", "x2", "x3", "x3 fresh"], 1, 128]);
  // A surface that is wrong came with its level, twice. Then the level was asked for alone, and is drawn flat.
  expect([kinds(w, w.r.slot(2, 0)), w.drawn[2], w.shown[2]]).toEqual([["x3", "x3 fresh", ""], 0, 0]);
  // A mask that cannot be had at all leaves its body flat.
  expect([kinds(w, texSlot(set, 3 * MAPS + MASK2)), w.drawn[3], w.shown[3]]).toEqual([["", "fresh"], 0, 0]);
  expect([w.r.stats.dead, w.r.stats.skipped, w.r.flying]).toEqual([4, 0, 0]);
  const { requests } = w.r.stats;
  w.run(3, -3.5);
  expect(w.r.stats.requests - requests).toBe(0);
});

test("low poly asks for no surface and no texture: its requests and uploads are those of a scene that never asked", () => {
  const things = [0, 1, 2, 3].map((i) => ({ mesh: i, x: 3 * i, z: 200 }));
  const net = { latencyMs: 80, bytesPerSecond: 1.2e6, loss: 0.1, seed: 4 };
  const flights = [true, false].map((asking) => {
    const w = assetWorld(SET, things, net, tierOf("lowpoly"), asking ? "bc" : undefined);
    const ups: string[] = [];
    for (let f = 0, z = 0; f < 600; f++) {
      w.frame((z += 0.4));
      for (const u of w.packet.assetUploads) ups.push(`${f} ${Object.entries(u).map(([k, v]) => (k === "data" ? u.data.length : v))}`);
      expect([w.packet.texUploads.length, w.packet.texDrops.length, w.shown.some((s) => s === 1)]).toEqual([0, 0, false]);
    }
    return [w.port.log, ups, w.r.stats, w.r.ledger];
  });
  expect(flights[0]).toEqual(flights[1]!);
  const log = flights[0]![0] as string[];
  // Every request was for one part, the flat one, of a level.
  expect([log.length > 4, log.some((line) => line.includes("x") || Number(line.split(" ")[2]) >= LEVELS * 4)]).toEqual([true, false]);
});

test("the variant is the one the device takes, the tier caps how wide, and a card that loses or refuses a texture is sent it again", () => {
  const set = texturedSet(1, 256, ["bc", "rgba"], 400);
  const wide = WIDE.map((top) => top >> 1);
  const w = world([{ mesh: 0, z: 0 }], {}, { uploadBytes: 8 * 1024 }, set, "rgba");
  w.run(3, -1);
  const formats = (): string[] => [...new Set([...w.card.textures.values()].map((copy) => copy.format))];
  expect([tops(w, 0), formats()]).toEqual([wide, ["rgba"]]);

  // The shell learns the device takes another variant: every texture goes at once, the body is flat, and they come in that one.
  w.assets.format = "bc";
  w.frame(-1);
  expect([w.packet.texDrops.length, w.shown[0], w.card.texBytes]).toEqual([MAPS, 0, 0]);
  w.run(3, -1);
  expect([tops(w, 0), formats(), w.shown[0]]).toEqual([wide, ["bc"], 1]);

  // The card refuses a texture. Its body is flat for the frames it takes to send again, from what the port kept.
  const fetched = w.r.stats.fetched;
  w.card.forget(BASE);
  w.r.failedTexture(BASE);
  w.frame(-1);
  expect(w.shown[0]).toBe(0);
  w.run(2, -1);
  expect([w.shown[0], tops(w, 0), w.r.stats.fetched]).toEqual([1, wide, fetched]);

  // The context is lost while a copy is half made: everything is sent again, that copy from its first row.
  const lost = world([{ mesh: 0, z: 0 }], {}, { uploadBytes: 2 * 1024 }, set);
  let frames = 0;
  while (frames++ < 200 && (lost.card.making.size === 0 || lost.card.textures.size < 2)) lost.frame(-1);
  expect(lost.card.making.size).toBeGreaterThan(0);
  lost.card.clear();
  lost.r.reset();
  lost.run(8, -1);
  expect([tops(lost, 0), lost.shown[0], lost.card.making.size]).toEqual([wide, 1, 0]);

  // A tier that takes nothing wider than 128.
  const narrow = world([{ mesh: 0, z: 0 }], {}, { texture: 128 }, set);
  narrow.run(3, -1);
  expect(tops(narrow, 0)).toEqual([128, 128, 64, 64, 64, 128]);

  // Asked to keep everything, the library asks for each streamed level with its surface and skin, and each texture as far as the tier takes it.
  const parts = (cap: number): number[] => [
    ...set.manifest.meshes[0]!.levels.slice(0, 2).flatMap((level) => level.parts.map((p) => p.bytes)),
    ...set.manifest.textures!.flatMap((tex, t) => Array.from({ length: Math.min(stepOf(tex.top), cap - (t === MRO || t === MASK || t === MASK2 ? 1 : 0)) + 1 }, (_, k) => stepBytes("bc", tex.role, k))),
  ];
  expect([narrow.r.download(), narrow.port.filled]).toEqual([parts(1).reduce((a, b) => a + b, 0), parts(1)]);
  lost.r.download();
  expect(lost.port.filled).toEqual(parts(4));
  const low = assetWorld(set, [{ mesh: 0, z: 0 }], {}, tierOf("lowpoly"), "bc");
  low.frame(-1);
  low.r.download();
  expect(low.port.filled).toEqual(set.manifest.meshes[0]!.levels.slice(0, 2).map((level) => level.parts[0]!.bytes));
});

test("the tube as the splitter lays it out: a level in the boot file takes its surface from the mesh file, and a level in the mesh file comes with its own", () => {
  const set = splitPack(tubePack(), "tube");
  const rng = new Rng(8);
  const { bytes, placed } = writeTextureFile("rgba", set.manifest.textures!.map((tex) => ({ role: tex.role, pictures: Array.from({ length: 7 }, (_, k) => noise(pictureBytes("rgba", tex.role, 1 << k), rng)) })));
  set.files.push({ name: "tube.tex.rgba.sntx", role: "tex", bytes });
  set.manifest.files.push({ name: "tube.tex.rgba.sntx", bytes: bytes.length, role: "tex", format: "rgba" });
  set.manifest.textures!.forEach((tex, t) => (tex.in.rgba = { file: 2, ...placed[t]! }));
  parseManifest(JSON.stringify(set.manifest));
  expect(set.manifest.meshes[0]!.levels.map((level) => [level.file, level.surface?.file ?? -1, level.parts.length])).toEqual([[1, -1, 3], [0, 1, 3], [0, -1, 1]]);
  const w = world([{ mesh: 0, z: 0 }], { latencyMs: 50 }, {}, set, "rgba");
  // From far off the flat level is wanted, and nothing is asked for: no surface, and no texture either.
  w.run(1, -200);
  expect([w.drawn[0], w.shown[0], w.port.log]).toEqual([2, 0, []]);
  // The middle level is in the boot file and is drawn at once, flat. Its surface and skin are asked for by themselves,
  // from the mesh file. The card checks them against their hashes, so they were read from the right place.
  w.frame(-100);
  expect([w.drawn[0], w.shown[0]]).toEqual([1, 0]);
  w.run(1, -100);
  expect([w.shown[0], kinds(w, 3 + w.r.slot(0, 1)), w.card.surfaces.has(w.r.slot(0, 1))]).toEqual([1, ["x2"], true]);
  // The finest level comes with its surface and skin in one request, and until it does the tube is drawn as it was.
  w.run(1, -5);
  expect([w.drawn[0], w.shown[0], kinds(w, w.r.slot(0, 0)), w.lapsed[0], once(w)]).toEqual([0, 1, ["x3"], 0, true]);
  expect([...w.card.textures.values()].map((copy) => copy.top)).toEqual([64, 64, 64, 64, 64]);
  // Asked to keep everything: the finest level whole, the surface and skin of the middle one, whose first part the boot file has, and the textures.
  const [fine, middle] = set.manifest.meshes[0]!.levels;
  w.r.download();
  expect(w.port.filled).toEqual([...fine!.parts, ...middle!.parts.slice(1)].map((p) => p.bytes).concat(set.manifest.textures!.map((tex) => stepBytes("rgba", tex.role, 0))));
});
