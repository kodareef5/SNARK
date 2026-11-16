// The texture build: the three variant files of a list of textures, on any number of threads, keeping what it has
// encoded before. The textures are the tube's, 64 pixels across, so nothing here takes long.
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { MATERIAL_CUTOUT } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { MAP_ROLES, TEXTURE_FORMATS, TEXTURE_HEADER_BYTES, blockOf, pictureBytes, stepBytes, type TextureFormat, type TextureRole } from "../../shared/pack/texture.ts";
import { decodeAstc, encodeAstc } from "../../tools/pack/astc.ts";
import { decodeBc5, decodeBc7, encodeBc5, encodeBc7 } from "../../tools/pack/bc.ts";
import { astcBlock, buildTextures, encodeTextures, encodingOf, type TextureSource } from "../../tools/pack/encode.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { materialMips, pictureOffset } from "../../tools/pack/texture.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { TUBE, TUBE_PIXELS, tubePack, tubePictures } from "../fixtures/textured.ts";

const mips = materialMips(tubePictures()) as Record<TextureRole, Uint8Array[]>;
/** The tube's five textures, as a build is given them. */
const tube = (): TextureSource[] => MAP_ROLES.map((role) => ({ id: `${TUBE}/${role}`, role, top: TUBE_PIXELS, mips: () => mips[role] }));
/** Pictures in the block variants of the five: seven sizes of each, twice. */
const PICTURES = 5 * 7 * 2;

interface Variant {
  format: TextureFormat;
  bytes: Uint8Array;
  placed: { at: number; block?: number }[];
}

/** The picture `size` pixels across of texture `i`, as a variant's file holds it. */
function pictureOf(v: Variant, i: number, role: TextureRole, size: number): Uint8Array {
  const block = blockOf(v.format, v.placed[i]!);
  const at = v.placed[i]!.at + pictureOffset(v.format, role, size, block);
  return v.bytes.subarray(at, at + pictureBytes(v.format, role, size, block));
}

/** A picture of a block variant as pixels again. A normal comes back as the red and green the rgba variant keeps. */
function decoded(v: Variant, i: number, role: TextureRole, size: number): Uint8Array {
  const blocks = pictureOf(v, i, role, size);
  const how = encodingOf(v.format as "bc" | "astc", role, true);
  if (how.with === "bc7") return decodeBc7(blocks, size, size);
  const back = how.with === "bc5" ? decodeBc5(blocks, size, size) : decodeAstc(blocks, size, size, how.kind, blockOf(v.format, v.placed[i]!));
  if (role !== "normal") return back;
  // BC5 has x in red and y in green. ASTC has x in red and y in alpha.
  return Uint8Array.from({ length: size * size * 2 }, (_, k) => back[(k >> 1) * 4 + (k & 1) * (how.with === "bc5" ? 1 : 3)]!);
}

test("the same textures give the same three files on one thread or three, however the blocks are cut, and each picture is what its encoder makes of it whole", async () => {
  const one = await encodeTextures(tube(), { workers: 1, cut: 1e9, cache: null });
  const three = await encodeTextures(tube(), { workers: 3, cut: 7, cache: null });
  expect(one.variants.map((v) => v.format)).toEqual(["bc", "astc", "rgba"]);
  expect(three.variants).toEqual(one.variants);
  expect([one.report.pictures, one.report.encoded, Math.round(one.report.megapixels * 1e6)]).toEqual([PICTURES, PICTURES, (PICTURES * 5461) / 7]);
  const [bc, astc] = three.variants;
  tube().forEach((s, i) => {
    mips[s.role].forEach((mip, k) => {
      const size = 1 << k;
      expect(pictureOf(bc!, i, s.role, size)).toEqual(s.role === "normal" ? encodeBc5(mip, size, size) : encodeBc7(mip, size, size, 3));
      expect(pictureOf(astc!, i, s.role, size)).toEqual(encodeAstc(mip, size, size, s.role === "base" ? "srgb" : s.role === "normal" ? "normal" : "linear", astcBlock(s.role, false)));
    });
  });
  // Each file is its header and the one step of each texture.
  for (const v of one.variants) expect(v.bytes.length).toBe(MAP_ROLES.reduce((sum, role, i) => sum + stepBytes(v.format, role, 0, blockOf(v.format, v.placed[i]!)), TEXTURE_HEADER_BYTES));
});

test("each block variant decodes to within a few levels of the rgba one, and to over 50 dB in bc and 45 in astc", async () => {
  const { variants } = await encodeTextures(tube(), { workers: 2, cache: null });
  const rgba = variants[2]!;
  for (const v of variants.slice(0, 2)) {
    let squares = 0;
    let count = 0;
    MAP_ROLES.forEach((role, i) => {
      for (let size = 1; size <= TUBE_PIXELS; size <<= 1) {
        const want = pictureOf(rgba, i, role, size);
        const got = decoded(v, i, role, size);
        expect(got.length).toBe(want.length);
        let worst = 0;
        // Colour only: nothing reads the alpha of the tube's textures.
        for (let p = 0; p < want.length; p++) {
          if (role !== "normal" && (p & 3) === 3) continue;
          worst = Math.max(worst, Math.abs(got[p]! - want[p]!));
          squares += (got[p]! - want[p]!) ** 2;
          count++;
        }
        // The mask four pixels across is the hardest picture here, four regions side by side in one block: BC7 has a channel of it 20 levels off.
        // ASTC blocks larger than 4 by 4 hold fewer bits a pixel.
        const most = size < 8 ? 20 : blockOf(v.format, v.placed[i]!) > 4 ? 16 : 6;
        expect([v.format, role, size, worst <= most]).toEqual([v.format, role, size, true]);
      }
    });
    expect(10 * Math.log10((255 * 255 * count) / squares)).toBeGreaterThan(v.format === "bc" ? 50 : 45);
  }
});

test("a second build encodes nothing, and a changed pixel, role or encoder encodes again what it changed and no more", async () => {
  const cache = mkdtempSync(join(tmpdir(), "snark-textures-"));
  try {
    const opts = { workers: 2, cache };
    const first = await encodeTextures(tube(), opts);
    expect(first.report.encoded).toBe(PICTURES);
    const second = await encodeTextures(tube(), opts);
    expect([second.report.pictures, second.report.encoded, second.report.megapixels]).toEqual([PICTURES, 0, 0]);
    expect(second.variants).toEqual(first.variants);

    // A kept picture that was cut short, as by a build that was stopped, is encoded again.
    const folder = readdirSync(cache)[0]!;
    truncateSync(join(cache, folder, readdirSync(join(cache, folder))[0]!), 8);
    const mended = await encodeTextures(tube(), opts);
    expect([mended.report.encoded, mended.variants]).toEqual([1, first.variants]);

    // One pixel of the largest picture of the base colour: that picture again in both variants.
    const touched = mips.base.map((m) => m.slice());
    touched[6]![0]! ^= 1;
    const changed = await encodeTextures(tube().map((s) => (s.role === "base" ? { ...s, mips: () => touched } : s)), opts);
    expect(changed.report.encoded).toBe(2);
    expect(changed.variants).not.toEqual(first.variants);

    // The packed map's pictures under their own role are all kept. As a mask they go through the same encoders, and none is.
    const as = (role: TextureRole): TextureSource[] => [{ id: "test:other", role, top: TUBE_PIXELS, mips: () => mips.mro }];
    expect([(await encodeTextures(as("mro"), opts)).report.encoded, (await encodeTextures(as("mask"), opts)).report.encoded]).toEqual([0, 14]);

    // An encoder whose source has changed has nothing kept, and the other has everything.
    const edited = await encodeTextures(tube(), { ...opts, encoders: { bc: "// an encoder that was changed" } });
    expect([edited.report.encoded, edited.variants]).toEqual([PICTURES / 2, first.variants]);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test("pictures that are the same are encoded once, and alpha is kept only where something reads it", async () => {
  // A leaf: green, and see-through on its left half.
  const leaf = Array.from({ length: 7 }, (_, i) => {
    const size = 1 << i;
    return Uint8Array.from({ length: size * size * 4 }, (_, k) => ((k & 3) === 3 ? (((k >> 2) % size) * 2 < size ? 0 : 255) : (k & 3) === 1 ? 160 : 40));
  });
  const sources: TextureSource[] = ["test:leaf", "test:leaf_again", "test:wall"].map((id) => ({ id, role: "base", top: TUBE_PIXELS, mips: () => leaf }));
  const { variants, report } = await encodeTextures(sources, { workers: 2, cache: null, alpha: new Set(["test:leaf", "test:leaf_again"]) });
  // Two leaves share their pictures. The wall has the same pixels with no alpha to keep, which is another picture.
  expect([report.pictures, report.encoded]).toEqual([42, 28]);
  for (const v of variants.slice(0, 2)) {
    const alpha = (i: number): number[] => [...decoded(v, i, "base", 64)].filter((_, k) => (k & 3) === 3);
    expect(alpha(0)).toEqual([...leaf[6]!].filter((_, k) => (k & 3) === 3));
    expect(alpha(1)).toEqual(alpha(0));
    expect(Math.min(...alpha(2))).toBeGreaterThanOrEqual(254);
    expect(pictureOf(v, 0, "base", 64)).not.toEqual(pictureOf(v, 2, "base", 64));
  }
  // The rgba variant holds every picture as it was given.
  expect(pictureOf(variants[2]!, 2, "base", 64)).toEqual(leaf[6]!);

  // A hurt and decay layer's alpha says how soon, and is always kept, by a base colour's encoders.
  const layered = await encodeTextures([{ id: "test:layer", role: "layer", top: TUBE_PIXELS, mips: () => leaf }], { workers: 2, cache: null });
  layered.variants.slice(0, 2).forEach((v, k) => {
    expect([...decoded(v, 0, "layer", 64)].filter((_, c) => (c & 3) === 3)).toEqual([...leaf[6]!].filter((_, c) => (c & 3) === 3));
    expect(pictureOf(v, 0, "layer", 64)).toEqual(pictureOf(variants[k]!, 0, "base", 64));
  });
});

test("a build's manifest lists the three files and where each texture is in them, and parses", async () => {
  const { manifest } = splitPack(tubePack(), "tube");
  const named = manifest.textures!.map((t) => t.id);
  // The tube's top is see-through, and its materials read that only once one of them is cut out.
  const holed = mips.base.map((m) => m.slice());
  for (let p = 3; p < TUBE_PIXELS * 16 * 4; p += 4) holed[6]![p] = 0;
  manifest.materials![1]!.flags |= MATERIAL_CUTOUT;
  const extra: TextureSource = { id: "test:unnamed", role: "mask", top: TUBE_PIXELS, mips: () => mips.mro };
  // A third material names a texture that is the tube's normal again, and masks that dye nothing anywhere.
  manifest.textures!.push({ id: `${TUBE}/normal_again`, role: "normal", top: TUBE_PIXELS, in: {} }, { id: `${TUBE}/blank`, role: "mask", top: TUBE_PIXELS, in: {} });
  manifest.materials!.push({ ...manifest.materials![0]!, id: `${TUBE}/again`, normal: 5, mask: 6, mask2: -1 });
  const blank = mips.mask.map((m) => m.map((_, k) => ((k & 3) === 3 ? 255 : 0)));
  const again: TextureSource[] = [{ id: `${TUBE}/normal_again`, role: "normal", top: TUBE_PIXELS, mips: () => mips.normal }, { id: `${TUBE}/blank`, role: "mask", top: TUBE_PIXELS, mips: () => blank }];
  const sources = [extra, ...tube().map((s) => (s.role === "base" ? { ...s, mips: () => holed } : s)), ...again];
  const { files, report } = await buildTextures(manifest, sources, "tube", { workers: 2, cache: null });
  expect([report.pictures, report.encoded]).toEqual([PICTURES + 14, PICTURES + 14]);
  // The one is listed once and the other not at all, and the materials name what is left.
  expect(manifest.materials!.map((m) => [m.normal, m.mask, m.mask2])).toEqual([[4, 1, 2], [4, -1, -1], [4, -1, -1]]);
  expect(files.map((f) => [f.name, f.role, f.format])).toEqual([["tube.tex.bc.sntx", "tex", "bc"], ["tube.tex.astc.sntx", "tex", "astc"], ["tube.tex.rgba.sntx", "tex", "rgba"]]);
  const parsed = parseManifest(JSON.stringify(manifest));
  expect(parsed.files.slice(2)).toEqual(files.map((f) => ({ name: f.name, bytes: f.bytes.length, role: "tex", format: f.format })));
  // The textures the pack names keep their places, which its materials name them by. The one nothing names follows.
  expect(parsed.textures!.map((t) => t.id)).toEqual([...named, "test:unnamed"]);
  TEXTURE_FORMATS.forEach((format, k) => {
    let at = TEXTURE_HEADER_BYTES;
    for (const t of parsed.textures!) {
      const v = t.in[format]!;
      const bytes = stepBytes(format, t.role, 0, blockOf(format, v));
      expect([v.file, v.at, v.hash]).toEqual([2 + k, at, [partHash(files[k]!.bytes.subarray(at, at + bytes))]]);
      at += bytes;
    }
    expect(files[k]!.bytes.length).toBe(at);
  });
  const base = named.indexOf(`${TUBE}/base`);
  const variants = files.map((f, k): Variant => ({ format: f.format, bytes: f.bytes, placed: parsed.textures!.map((t) => t.in[TEXTURE_FORMATS[k]!]!) }));
  for (const v of variants.slice(0, 2)) expect([...decoded(v, base, "base", 64)].filter((_, k) => (k & 3) === 3)).toEqual([...holed[6]!].filter((_, k) => (k & 3) === 3));

  // A texture a mesh names must have its pictures, at the role and size the mesh has it.
  const fresh = () => splitPack(tubePack(), "tube").manifest;
  await expect(buildTextures(fresh(), tube().slice(1), "tube", { cache: null })).rejects.toThrow(`texture ${TUBE}/base is named by a mesh, and nothing has its pictures`);
  await expect(buildTextures(fresh(), tube().map((s) => ({ ...s, top: 32 })), "tube", { cache: null })).rejects.toThrow("is base at 64 to its mesh, and its pictures are base at 32");
  await expect(buildTextures(fresh(), [...tube(), ...tube()], "tube", { cache: null })).rejects.toThrow("two sources have one id");
  await expect(encodeTextures([{ ...extra, top: 128 }], { cache: null })).rejects.toThrow("texture test:unnamed: its pictures are not the sizes from 1 to 128 pixels across");

  // With no textures there are no files, and the manifest is as it was.
  const bare = splitPack(buildPack([{ id: "test:box", lods: [boxMesh([1, 1, 1], 0)] }], defaultPalette()), "bare").manifest;
  const before = JSON.stringify(bare);
  expect([await buildTextures(bare, [], "bare"), JSON.stringify(bare)]).toEqual([{ files: [], report: { pictures: 0, encoded: 0, megapixels: 0 } }, before]);
});
