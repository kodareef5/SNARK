// Texture files: a painted region map into the two masks of weights, the file's layout, a material's maps together,
// and the stress cards.
import { expect, test } from "bun:test";
import { parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { TEXTURE_HEADER_BYTES, TEXTURE_MAGIC, pictureBytes, stepBytes, stepOf, stepOffset, stepSize, textureBytes, type TextureRole } from "../../shared/pack/texture.ts";
import { Rng } from "../../shared/rng.ts";
import { asPicture, baseMips, normalMips, packedMips, type Picture } from "../../tools/pack/image.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import { REGION_COLOURS, checkMasks, maskMips, readMasks, readRegions, regionMasks } from "../../tools/pack/mask.ts";
import { MASK_BANDS, STEP_COLOURS, STRESS_CARDS, cardPicture, stressTextures } from "../../tools/pack/stress.ts";
import { SMALLER_MOVE, SMALLER_TURN, isNeutral, materialMips, neededSide, pictureOffset, rgbaPicture, rgbaTexture, smallerBy, writeTextureFile } from "../../tools/pack/texture.ts";

const [BLACK, RED, GREEN, CYAN] = [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 255, 255]] as const;

/** An 8-bit picture with `at(x, y)` for each pixel, as many channels as it returns. */
function paint(size: number, at: (x: number, y: number) => readonly number[]): Picture {
  const channels = at(0, 0).length;
  const data = new Uint8Array(size * size * channels);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(at(x, y), (y * size + x) * channels);
  return { width: size, height: size, channels, depth: 8, data };
}

const pixel = (mip: Uint8Array, i = 0): number[] => [...mip.subarray(i * 4, i * 4 + 4)];
const noise = (rng: Rng, bytes: number): Uint8Array => Uint8Array.from({ length: bytes }, () => rng.int(256));

test("a painted region map is read by the nearest of ARK's seven colours, and what was near none of them is counted", () => {
  // Regions 0 to 5 in their colours, then black: each region's weight lands in its own channel of its own mask.
  const flat = paint(8, (x) => REGION_COLOURS[x] ?? BLACK);
  const read = readRegions(flat);
  expect(read.stray).toBe(0);
  for (let x = 0; x < 8; x++) expect([...read.weights.subarray(x * 6, x * 6 + 6)]).toEqual([0, 1, 2, 3, 4, 5].map((k) => (k === x ? 1 : 0)));
  const { mask, mask2 } = maskMips(read);
  expect([0, 1, 2, 3, 4, 5, 6].map((x) => pixel(mask[3]!, x).slice(0, 3))).toEqual([[255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  expect([0, 1, 2, 3, 4, 5, 6].map((x) => pixel(mask2![3]!, x).slice(0, 3))).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255], [0, 0, 0]]);
  // Every mip is the mean of what is under it: an eighth of each region in the one pixel.
  expect([pixel(mask[0]!), pixel(mask2![0]!)]).toEqual([[32, 32, 32, 255], [32, 32, 32, 255]]);

  // A sloppy map: colours a little off are still their region; colours between two, white and half-dark are guessed and counted.
  const painted: [number[], number, boolean][] = [
    [[230, 30, 20], 0, false], [[20, 200, 40], 1, false], [[0, 0, 255], 2, false], [[10, 250, 240], 3, false], [[250, 5, 250], 4, false], [[240, 240, 10], 5, false], [[40, 40, 40], -1, false],
    [[255, 128, 0], 5, true], [[255, 120, 0], 0, true], [[255, 255, 255], 3, true], [[100, 0, 0], -1, true],
  ];
  const sloppy = readRegions(paint(4, (x, y) => painted[y * 4 + x]?.[0] ?? BLACK));
  painted.forEach(([, region], i) => expect([...sloppy.weights.subarray(i * 6, i * 6 + 6)].indexOf(1)).toBe(region));
  expect(sloppy.stray).toBe(4 / 16);
});

test("masks are made a size below a region map with soft borders: red beside green is half of each, and nothing else", () => {
  const map = paint(64, (x) => (x < 31 ? RED : GREEN));
  const made = regionMasks(map, 32);
  expect([made.stray, made.mask2, made.mask.width]).toEqual([0, undefined, 32]);
  expect([14, 15, 16].map((x) => pixel(made.mask.data as Uint8Array, x))).toEqual([[255, 0, 0, 255], [128, 128, 0, 255], [0, 255, 0, 255]]);
  const report = checkMasks(made.mask);
  expect([report.sameSize, report.over, report.most]).toEqual([true, 0, 256 / 255]);
  expect(report.cover.map((c) => Math.round(c * 1000))).toEqual([484, 516, 0, 0, 0, 0]);
  expect(() => regionMasks(map, 128)).toThrow("does not make masks of 128");
  // The mips are the plain average of the map's own weights all the way down.
  expect(maskMips(readRegions(map)).mask).toEqual(packedMips(map));

  // A map of regions 3 to 5 alone has a first mask with nothing in it and a second with everything.
  const high = regionMasks(paint(8, () => CYAN), 8);
  expect([pixel(high.mask.data as Uint8Array), pixel(high.mask2!.data as Uint8Array)]).toEqual([[0, 0, 0, 255], [255, 0, 0, 255]]);
  // A map that is not a power of two across is resized like any source, and its weights still sum to 1 or less.
  const odd = maskMips(readRegions(paint(48, (x, y) => REGION_COLOURS[((x >> 3) + (y >> 3)) % 6]!)));
  expect([odd.mask.length, odd.mask2!.length]).toEqual([7, 7]);
  for (let i = 0; i < 7; i++) expect(checkMasks(asPicture(odd.mask[i]!), asPicture(odd.mask2![i]!)).over).toBe(0);
});

test("two masks made by hand are taken as they are, and the pair is checked: one size, weights that sum to 1 or less, the cover of each region", () => {
  const mask = paint(8, (x) => (x < 4 ? [255, 0, 0] : [0, 128, 0]));
  const mask2 = paint(8, (x) => (x < 4 ? [0, 0, 0] : [0, 0, 127]));
  const mips = maskMips(readMasks(mask, mask2));
  expect([mips.mask, mips.mask2]).toEqual([packedMips(mask), packedMips(mask2)]);
  const report = checkMasks(mask, mask2);
  expect([report.sameSize, report.over, report.most]).toEqual([true, 0, 1]);
  expect(report.cover.map((c) => Math.round(c * 1000))).toEqual([500, 251, 0, 0, 0, 249]);
  // Without a second mask, or with an empty one, there is none to store.
  expect([Object.keys(maskMips(readMasks(mask))), Object.keys(maskMips(readMasks(mask, paint(8, () => BLACK))))]).toEqual([["mask"], ["mask"]]);

  // Two halves that round up together are within rounding. More than that is dyed more than wholly.
  const heavy = checkMasks(paint(8, (x) => (x < 2 ? [200, 100, 0] : [128, 128, 0])));
  expect([heavy.over, heavy.most]).toEqual([0.25, 300 / 255]);
  // A mask of 16 bits beside one of 8 is weighed on its own scale.
  const deep: Picture = { width: 8, height: 8, channels: 3, depth: 16, data: new Uint16Array(8 * 8 * 3).fill(0x1111) };
  expect([checkMasks(mask2, deep).most, checkMasks(deep).cover[0]]).toEqual([127 / 255 + 0x3333 / 65535, 0x1111 / 65535]);
  expect(checkMasks(mask, paint(4, () => BLACK)).sameSize).toBe(false);
  expect(() => readMasks(mask, paint(4, () => BLACK))).toThrow("not one size: 8x8 and 4x4");
});

test("a texture file's sizes are the contract's, each step hashes as listed, and a smaller top is a prefix of a larger", () => {
  const rng = new Rng(3);
  const mips = (top: number): Uint8Array[] => Array.from({ length: Math.log2(top) + 1 }, (_, i) => noise(rng, 4 ** i * 4));
  const sources: [TextureRole, Uint8Array[]][] = [["base", mips(256)], ["normal", mips(128)], ["mask2", mips(64)]];
  const textures = sources.map(([role, m]) => rgbaTexture(role, m));
  const { bytes, placed } = writeTextureFile("rgba", textures);
  const view = new DataView(bytes.buffer);
  expect([view.getUint32(0, true), view.getUint16(4, true), view.getUint16(6, true), view.getUint32(8, true), view.getUint32(12, true)]).toEqual([TEXTURE_MAGIC, 1, 2, 3, 0]);
  let at = TEXTURE_HEADER_BYTES;
  sources.forEach(([role, m], t) => {
    const top = 1 << (m.length - 1);
    expect(placed[t]!.at).toBe(at);
    expect(placed[t]!.hash.length).toBe(stepOf(top) + 1);
    placed[t]!.hash.forEach((hash, step) => {
      const from = at + stepOffset("rgba", role, step, 1);
      expect(partHash(bytes.subarray(from, from + stepBytes("rgba", role, step, 1)))).toBe(hash);
    });
    // Each picture lies where the layout says, as the variant holds it: a normal keeps red and green only.
    m.forEach((mip, i) => {
      const from = at + pictureOffset("rgba", role, 1 << i, 1);
      expect(bytes.subarray(from, from + pictureBytes("rgba", role, 1 << i, 1))).toEqual(rgbaPicture(role, mip));
    });
    at += textureBytes("rgba", role, top, 1);
  });
  expect(bytes.length).toBe(at);
  expect([64, 256].map((size) => pictureOffset("rgba", "base", size, 1))).toEqual([stepBytes("rgba", "base", 0, 1) - 64 * 64 * 4, stepOffset("rgba", "base", 2, 1)]);
  expect([...rgbaPicture("normal", Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))]).toEqual([1, 2, 5, 6]);

  // Steps 0 to k of a texture are the whole texture at 64 << k.
  const whole = writeTextureFile("rgba", [textures[0]!]);
  for (const k of [0, 1]) {
    const cut = writeTextureFile("rgba", [{ role: "base", block: 1, pictures: textures[0]!.pictures.slice(0, 7 + k) }]);
    expect(cut.bytes.length).toBe(TEXTURE_HEADER_BYTES + textureBytes("rgba", "base", stepSize(k), 1));
    expect(cut.bytes.subarray(TEXTURE_HEADER_BYTES)).toEqual(whole.bytes.subarray(TEXTURE_HEADER_BYTES, cut.bytes.length));
    expect(cut.placed[0]!.hash).toEqual(whole.placed[0]!.hash.slice(0, k + 1));
  }

  // The manifest takes the file and what the writer returned.
  const manifest: Manifest = { version: 2, files: [{ name: "t.boot.snpk", bytes: 0, role: "boot" }, { name: "t.tex.rgba.sntx", bytes: bytes.length, role: "tex", format: "rgba" }], boot: 0, clipHash: 0, meshes: [] };
  manifest.textures = sources.map(([role, m], t) => ({ id: `t:${role}`, role, top: 1 << (m.length - 1), in: { rgba: { file: 1, ...placed[t]! } } }));
  expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);

  // Block pictures plug in the same way: a block is 16 bytes whatever it holds.
  const blocks = Array.from({ length: 9 }, (_, i) => noise(rng, pictureBytes("bc", "normal", 1 << i, 4)));
  const bc = writeTextureFile("bc", [{ role: "normal", block: 4, pictures: blocks }]);
  expect([bc.bytes.length, bc.placed[0]!.hash.length, new DataView(bc.bytes.buffer).getUint16(6, true)]).toEqual([TEXTURE_HEADER_BYTES + textureBytes("bc", "normal", 256, 4), 3, 0]);

  const empty = (n: number): Uint8Array[] => Array.from({ length: n }, () => new Uint8Array(0));
  expect(() => writeTextureFile("rgba", [{ role: "base", block: 1, pictures: empty(6) }])).toThrow("32 pixels across");
  expect(() => writeTextureFile("rgba", [{ role: "base", block: 1, pictures: empty(12) }])).toThrow("2048 pixels across, which rgba does not hold");
  expect(() => writeTextureFile("bc", [{ role: "base", block: 4, pictures: textures[0]!.pictures }])).toThrow("the 1-pixel picture of texture 0 is 4 bytes, not 16");
  // The rgba variant stops at 1024 however large the mips go.
  expect(rgbaTexture("mask", empty(13)).pictures.length).toBe(11);
});

test("a material's maps become mips together: the packed map hears of its normals, and one region map gives both masks", () => {
  const maps = {
    base: paint(8, (x, y) => [x * 30, y * 30, 90]),
    normal: paint(8, (x) => [x & 1 ? 204 : 51, 128, 230]),
    mro: paint(8, () => [255, 64, 0]),
    regions: paint(8, (x) => (x < 4 ? RED : CYAN)),
  };
  const mips = materialMips(maps);
  expect(Object.keys(mips)).toEqual(["base", "normal", "mro", "mask", "mask2"]);
  expect([pixel(mips.mro![3]!), pixel(mips.mro![2]!)[1]! > 150]).toEqual([[255, 64, 0, 255], true]);
  expect([pixel(mips.mask![0]!), pixel(mips.mask2![0]!)]).toEqual([[128, 0, 0, 255], [128, 0, 0, 255]]);
  // Three regions or fewer need no second mask, and a material with no regions needs none at all.
  expect(Object.keys(materialMips({ ...maps, regions: paint(8, (x) => (x < 4 ? RED : GREEN)) }))).toEqual(["base", "normal", "mro", "mask"]);
  expect(Object.keys(materialMips({ base: maps.base }))).toEqual(["base"]);

  // The two masks may be given instead, and are refused if they do not go together.
  const [mask, mask2] = [paint(8, (x) => [x < 4 ? 255 : 0, 0, 0]), paint(8, (x) => [0, x < 4 ? 0 : 200, 0])];
  const given = materialMips({ mask, mask2 });
  expect([given.mask, given.mask2]).toEqual([packedMips(mask), packedMips(mask2)]);
  expect(() => materialMips({ mask, mask2: paint(8, () => [200, 0, 0]) })).toThrow("the weights of 50.00% of the pixels sum past 1, to as much as 1.78");
  expect(() => materialMips({ mask, mask2: paint(16, () => BLACK) })).toThrow("not one size");
});

test("a map that is its role's neutral everywhere is known, and one stored smaller is held at every step to what it loses", () => {
  // Masks that dye nothing, a normal map that leans nowhere, white: what a material without the map draws. Alpha counts where it is read.
  const white = baseMips(paint(256, () => [255, 255, 255, 0]));
  expect([isNeutral("mask", false, materialMips({ regions: paint(256, () => BLACK) }).mask!), isNeutral("normal", false, normalMips(paint(256, () => [128, 128, 255])).pictures), isNeutral("base", false, white), isNeutral("base", true, white)]).toEqual([true, true, true, false]);
  expect(isNeutral("mask", false, materialMips({ regions: paint(256, (x, y) => (x === 200 && y === 9 ? RED : BLACK)) }).mask!)).toBe(false);

  // Texel-sized detail needs every step. A soft ramp, and a normal map that leans a degree or so in soft waves, need no more than step 0's.
  const checker = baseMips(paint(256, (x, y) => ((x + y) & 1 ? [200, 200, 200] : [40, 40, 40])));
  expect([smallerBy("base", false, checker, 1) > SMALLER_MOVE, neededSide("base", false, checker)]).toEqual([true, { side: 256, change: 0 }]);
  expect(neededSide("base", false, baseMips(paint(256, (x) => [x >> 1, x >> 1, x >> 1]))).side).toBe(64);
  const waves = neededSide("normal", false, normalMips(paint(256, (x) => [128 + Math.round(3 * Math.sin((x * Math.PI) / 32)), 128, 255])).pictures);
  expect([waves.side, waves.change > 0 && waves.change < SMALLER_TURN]).toEqual([64, true]);
});

test("the stress cards: a flat colour names each step of a base colour card, and the two mask cards hold every region in bands", () => {
  expect([STRESS_CARDS.length, STRESS_CARDS.filter((c) => c.top === 4096).length, STRESS_CARDS.map((c) => c.role).join(" ")]).toEqual([8, 1, "mask base base base base base base mask2"]);
  expect(new Set(STEP_COLOURS.map(String)).size).toBe(7);
  const base = STRESS_CARDS[1]!;
  expect([1, 8, 64, 128, 256].map((size) => pixel(cardPicture(base, size), size * size - 1))).toEqual([[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 0, 0, 255], [255, 255, 0, 255]]);

  // Nothing, regions 0 to 5 side by side, and a band that is half region 0 and half region 5.
  const [mask, mask2] = [STRESS_CARDS[0]!, STRESS_CARDS[7]!];
  const bands = [cardPicture(mask, 64), cardPicture(mask2, 64)];
  for (let band = 0; band < 8; band++) expect([...pixel(bands[0]!, 64 * 63 + band * 8).slice(0, 3), ...pixel(bands[1]!, 64 * 63 + band * 8).slice(0, 3)]).toEqual([...MASK_BANDS[band]!]);
  expect(MASK_BANDS.map((b) => b.reduce((sum, w) => sum + w, 0))).toEqual([0, 255, 255, 255, 255, 255, 255, 255]);
  const report = checkMasks(asPicture(bands[0]!), asPicture(bands[1]!));
  expect([report.sameSize, report.over, report.most]).toEqual([true, 0, 1]);
  expect(report.cover.map((c) => Math.round(c * 8 * 255))).toEqual([383, 255, 255, 255, 255, 382]);
  // The pictures of a mask card are its own mips: the same bands at every size that holds them, and their average below.
  for (const [card, picture] of [[mask, bands[0]!], [mask2, bands[1]!]] as const) {
    const mips = packedMips(asPicture(picture));
    for (const size of [1, 2, 4, 8, 16, 32]) expect(cardPicture(card, size)).toEqual(mips[Math.log2(size)]!);
  }

  // As a file: a pixel of any step of a base card is that step's colour, and the manifest takes the entries.
  const cards = [{ ...mask, top: 64 }, { ...base, top: 256 }, { ...STRESS_CARDS[6]!, top: 128 }, { ...mask2, top: 64 }];
  const { file, textures } = stressTextures(1, cards);
  expect([file.name, file.role, textures.map((t) => t.id)]).toEqual(["stress.tex.rgba.sntx", "tex", ["stress:card_0", "stress:card_1", "stress:card_6", "stress:card_7"]]);
  const manifest: Manifest = { version: 2, files: [{ name: "stress.boot.snpk", bytes: 0, role: "boot" }, { name: file.name, bytes: file.bytes.length, role: "tex", format: "rgba" }], boot: 0, clipHash: 0, meshes: [], textures };
  expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  for (const t of textures.slice(1, 3)) {
    for (let step = 0; step <= stepOf(t.top); step++) {
      const from = t.in.rgba!.at + stepOffset("rgba", "base", step, 1);
      const got = file.bytes.subarray(from, from + stepBytes("rgba", "base", step, 1));
      expect(partHash(got)).toBe(t.in.rgba!.hash[step]!);
      expect([pixel(got), pixel(got, got.length / 4 - 1)]).toEqual([[...STEP_COLOURS[step]!, 255], [...STEP_COLOURS[step]!, 255]]);
    }
  }
});
