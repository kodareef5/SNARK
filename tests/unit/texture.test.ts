// Texture files: the mask's ring rule, the file's layout, a material's maps together, and the stress cards.
import { expect, test } from "bun:test";
import { parseManifest, type Manifest } from "../../shared/pack/manifest.ts";
import { TEXTURE_HEADER_BYTES, TEXTURE_MAGIC, pictureBytes, stepBytes, stepOf, stepOffset, stepSize, textureBytes, type TextureRole } from "../../shared/pack/texture.ts";
import { Rng } from "../../shared/rng.ts";
import { packedMips, type Picture } from "../../tools/pack/image.ts";
import { partHash } from "../../tools/pack/manifest.ts";
import { MASK_RING, checkMask, maskMips } from "../../tools/pack/mask.ts";
import { MASK_BANDS, STEP_COLOURS, STRESS_CARDS, cardPicture, stressTextures } from "../../tools/pack/stress.ts";
import { materialMips, pictureOffset, rgbaPicture, rgbaTexture, writeTextureFile } from "../../tools/pack/texture.ts";

type Rgb = readonly [number, number, number];
const [BLACK, RED, YELLOW, GREEN]: Rgb[] = [[0, 0, 0], [255, 0, 0], [255, 255, 0], [0, 255, 0]];

/** An 8-bit picture with `at(x, y)` for each pixel, as many channels as it returns. */
function paint(size: number, at: (x: number, y: number) => readonly number[]): Picture {
  const channels = at(0, 0).length;
  const data = new Uint8Array(size * size * channels);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(at(x, y), (y * size + x) * channels);
  return { width: size, height: size, channels, depth: 8, data };
}

/** A mip as a picture again. */
const picture = (mip: Uint8Array): Picture => ({ width: Math.sqrt(mip.length / 4), height: Math.sqrt(mip.length / 4), channels: 4, depth: 8, data: mip });
const pixel = (mip: Uint8Array, i = 0): number[] => [...mip.subarray(i * 4, i * 4 + 4)];
const noise = (rng: Rng, bytes: number): Uint8Array => Uint8Array.from({ length: bytes }, () => rng.int(256));

test("the ring check fails red beside green and says where, passes red beside yellow, and passes red and green with black between", () => {
  const split = (left: Rgb, right: Rgb, gap = 0): Picture => paint(64, (x) => (x < 32 - gap ? left : x < 32 ? BLACK : right));
  const bad = checkMask(split(RED, GREEN));
  expect([bad.faults, bad.where]).toEqual([63, ["red touches green in 63 places, first at 31, 0"]]);
  expect([bad.impure, bad.cover]).toEqual([0, [0.5, 0, 0.5, 0, 0, 0]]);
  expect(checkMask(split(RED, YELLOW)).faults).toBe(0);
  expect(checkMask(split(RED, GREEN, 1)).faults).toBe(0);
  expect(checkMask(split([255, 0, 255], RED)).faults).toBe(0);
  // Filtering reaches across a corner as well as an edge.
  expect(checkMask(paint(64, (x, y) => (x < 32 && y < 32 ? RED : x >= 32 && y >= 32 ? GREEN : BLACK))).where).toEqual(["red touches green in 1 places, first at 31, 31"]);
  // A mask that tiles has its right edge beside its left.
  expect(checkMask(split(RED, GREEN, 1), true).where).toEqual(["red touches green in 64 places, first at 63, 0"]);
  // Three regions around a point are named pair by pair.
  expect(checkMask(paint(4, (x, y) => (y < 2 ? RED : x < 2 ? GREEN : [0, 0, 255]))).where.map((w) => w.split(" in ")[0])).toEqual(["red touches green", "red touches blue", "green touches blue"]);

  // What is not black or one of the six colours is counted. A soft edge between neighbours is no fault; white is no region.
  const soft = checkMask(paint(64, (x, y) => (y < 2 && x === 31 ? [255, 128, 0] : y === 63 && x < 8 ? [255, 255, 255] : x < 32 ? RED : YELLOW)));
  expect([soft.faults, soft.impure]).toEqual([0, 10 / 4096]);
  expect(MASK_RING).toEqual(["red", "yellow", "green", "cyan", "blue", "magenta"]);
});

test("a mask's mips obey the ring rule too: neighbours average plainly, and others keep black between them", () => {
  // Neighbours: every mip is the plain average of the colours.
  const neighbours = paint(64, (x) => (x < 24 ? RED : YELLOW));
  expect(maskMips(neighbours)).toEqual(packedMips(neighbours));

  // Red, one column of black, green. The plain average would put a half-red pixel beside green from the first mip down.
  const apart = paint(64, (x) => (x < 31 ? RED : x === 31 ? BLACK : GREEN));
  const mips = maskMips(apart);
  expect(mips[6]).toEqual(packedMips(apart)[6]!);
  expect([13, 14, 15, 16, 17].map((x) => pixel(mips[5]!, x).slice(0, 3))).toEqual([RED, RED, BLACK, GREEN, GREEN].map((c) => [...c]));
  expect(pixel(mips[0]!)).toEqual([0, 128, 0, 255]);
  for (const m of mips) {
    expect(checkMask(picture(m)).faults).toBe(0);
    // No pixel reads as yellow, which is not in this mask.
    for (let i = 0; i < m.length; i += 4) expect(Math.min(m[i]!, m[i + 1]!)).toBe(0);
  }
  // The plain average is what breaks the rule.
  expect(checkMask(picture(packedMips(apart)[5]!)).faults).toBe(31);

  // Blots of every region in cells with black gutters: the painted mask passes, and so does every mip, tiled or not.
  const rng = new Rng(11);
  const cells = Array.from({ length: 64 }, () => rng.int(7));
  const blots = paint(64, (x, y) => ((x & 7) < 6 && (y & 7) < 6 ? MASK_BANDS[cells[(y >> 3) * 8 + (x >> 3)]!]! : BLACK));
  for (const wraps of [false, true]) {
    expect(checkMask(blots, wraps).faults).toBe(0);
    const made = maskMips(blots, wraps);
    expect(made[6]).toEqual(packedMips(blots)[6]!);
    expect(made.map((m) => checkMask(picture(m), wraps).faults)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  }
  expect(checkMask(picture(packedMips(blots)[4]!)).faults).toBeGreaterThan(0);
  // A mask that had to be resized is held to the rule from its top picture down.
  const resized = maskMips(paint(48, (x) => (x < 23 ? RED : x < 25 ? BLACK : GREEN)));
  expect(resized.map((m) => checkMask(picture(m)).faults)).toEqual([0, 0, 0, 0, 0, 0, 0]);
});

test("a texture file's sizes are the contract's, each step hashes as listed, and a smaller top is a prefix of a larger", () => {
  const rng = new Rng(3);
  const mips = (top: number): Uint8Array[] => Array.from({ length: Math.log2(top) + 1 }, (_, i) => noise(rng, 4 ** i * 4));
  const sources: [TextureRole, Uint8Array[]][] = [["base", mips(256)], ["normal", mips(128)], ["mask", mips(64)]];
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
      const from = at + stepOffset("rgba", role, step);
      expect(partHash(bytes.subarray(from, from + stepBytes("rgba", role, step)))).toBe(hash);
    });
    // Each picture lies where the layout says, as the variant holds it: a normal keeps red and green only.
    m.forEach((mip, i) => {
      const from = at + pictureOffset("rgba", role, 1 << i);
      expect(bytes.subarray(from, from + pictureBytes("rgba", role, 1 << i))).toEqual(rgbaPicture(role, mip));
    });
    at += textureBytes("rgba", role, top);
  });
  expect(bytes.length).toBe(at);
  expect([64, 256].map((size) => pictureOffset("rgba", "base", size))).toEqual([stepBytes("rgba", "base", 0) - 64 * 64 * 4, stepOffset("rgba", "base", 2)]);
  expect([...rgbaPicture("normal", Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))]).toEqual([1, 2, 5, 6]);

  // Steps 0 to k of a texture are the whole texture at 64 << k.
  const whole = writeTextureFile("rgba", [textures[0]!]);
  for (const k of [0, 1]) {
    const cut = writeTextureFile("rgba", [{ role: "base", pictures: textures[0]!.pictures.slice(0, 7 + k) }]);
    expect(cut.bytes.length).toBe(TEXTURE_HEADER_BYTES + textureBytes("rgba", "base", stepSize(k)));
    expect(cut.bytes.subarray(TEXTURE_HEADER_BYTES)).toEqual(whole.bytes.subarray(TEXTURE_HEADER_BYTES, cut.bytes.length));
    expect(cut.placed[0]!.hash).toEqual(whole.placed[0]!.hash.slice(0, k + 1));
  }

  // The manifest takes the file and what the writer returned.
  const manifest: Manifest = { version: 2, files: [{ name: "t.boot.snpk", bytes: 0, role: "boot" }, { name: "t.tex.rgba.sntx", bytes: bytes.length, role: "tex", format: "rgba" }], boot: 0, clipHash: 0, meshes: [] };
  manifest.textures = sources.map(([role, m], t) => ({ id: `t:${role}`, role, top: 1 << (m.length - 1), in: { rgba: { file: 1, ...placed[t]! } } }));
  expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);

  // Block pictures plug in the same way: a block is 16 bytes whatever it holds.
  const blocks = Array.from({ length: 9 }, (_, i) => noise(rng, pictureBytes("bc", "normal", 1 << i)));
  const bc = writeTextureFile("bc", [{ role: "normal", pictures: blocks }]);
  expect([bc.bytes.length, bc.placed[0]!.hash.length, new DataView(bc.bytes.buffer).getUint16(6, true)]).toEqual([TEXTURE_HEADER_BYTES + textureBytes("bc", "normal", 256), 3, 0]);

  const empty = (n: number): Uint8Array[] => Array.from({ length: n }, () => new Uint8Array(0));
  expect(() => writeTextureFile("rgba", [{ role: "base", pictures: empty(6) }])).toThrow("32 pixels across");
  expect(() => writeTextureFile("rgba", [{ role: "base", pictures: empty(12) }])).toThrow("2048 pixels across, which rgba does not hold");
  expect(() => writeTextureFile("bc", [{ role: "base", pictures: textures[0]!.pictures }])).toThrow("the 1-pixel picture of texture 0 is 4 bytes, not 16");
  // The rgba variant stops at 1024 however large the mips go.
  expect(rgbaTexture("mask", empty(13)).pictures.length).toBe(11);
});

test("a material's maps become mips together: the packed map hears of its normals, and a mask that breaks the ring is refused", () => {
  const maps = {
    base: paint(8, (x, y) => [x * 30, y * 30, 90]),
    normal: paint(8, (x) => [x & 1 ? 204 : 51, 128, 230]),
    mro: paint(8, () => [255, 64, 0]),
    mask: paint(8, (x) => (x < 4 ? RED : YELLOW)),
  };
  const mips = materialMips(maps);
  expect(Object.keys(mips)).toEqual(["base", "normal", "mro", "mask"]);
  expect([pixel(mips.mro![3]!), pixel(mips.mro![2]!)[1]! > 150]).toEqual([[255, 64, 0, 255], true]);
  expect(pixel(mips.mask![0]!)).toEqual([255, 128, 0, 255]);
  expect(Object.keys(materialMips({ base: maps.base }))).toEqual(["base"]);
  expect(() => materialMips({ ...maps, mask: paint(8, (x) => (x < 4 ? RED : GREEN)) })).toThrow("red touches green in 7 places, first at 3, 0");
});

test("the stress cards: seven textures, one to 4096, each step a flat colour that names it, and a mask of the six regions in bands", () => {
  expect([STRESS_CARDS.length, STRESS_CARDS.filter((c) => c.top === 4096).length, STRESS_CARDS.map((c) => c.role).join(" ")]).toEqual([7, 1, "mask base base base base base base"]);
  expect(new Set(STEP_COLOURS.map(String)).size).toBe(7);
  const base = STRESS_CARDS[1]!;
  expect([1, 8, 64, 128, 256].map((size) => pixel(cardPicture(base, size), size * size - 1))).toEqual([[255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 0, 0, 255], [255, 255, 0, 255]]);

  const mask = STRESS_CARDS[0]!;
  const bands = cardPicture(mask, 64);
  expect([0, 8, 16, 24, 32, 40, 48, 56].map((x) => pixel(bands, 64 * 63 + x).slice(0, 3))).toEqual(MASK_BANDS.map((c) => [...c]));
  const report = checkMask(picture(bands), true);
  expect([report.faults, report.impure, report.cover]).toEqual([0, 0, [0.125, 0.125, 0.125, 0.125, 0.125, 0.125]]);
  // Its pictures are its own mips: the same bands at every size that can hold them, and the ring rule below that.
  const mips = maskMips(picture(bands));
  for (const size of [1, 2, 4, 8, 16, 32]) {
    expect(cardPicture(mask, size)).toEqual(mips[Math.log2(size)]!);
    expect(checkMask(picture(cardPicture(mask, size))).faults).toBe(0);
  }

  // As a file: a pixel of any step of a base card is that step's colour, and the manifest takes the entries.
  const cards = [{ ...mask, top: 64 }, { ...base, top: 256 }, { ...STRESS_CARDS[6]!, top: 128 }];
  const { file, textures } = stressTextures(1, cards);
  expect([file.name, file.role, textures.map((t) => t.id)]).toEqual(["stress.tex.rgba.sntx", "tex", ["stress:card_0", "stress:card_1", "stress:card_6"]]);
  const manifest: Manifest = { version: 2, files: [{ name: "stress.boot.snpk", bytes: 0, role: "boot" }, { name: file.name, bytes: file.bytes.length, role: "tex", format: "rgba" }], boot: 0, clipHash: 0, meshes: [], textures };
  expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  for (const t of textures.slice(1)) {
    for (let step = 0; step <= stepOf(t.top); step++) {
      const from = t.in.rgba!.at + stepOffset("rgba", "base", step);
      const got = file.bytes.subarray(from, from + stepBytes("rgba", "base", step));
      expect(partHash(got)).toBe(t.in.rgba!.hash[step]!);
      expect([pixel(got), pixel(got, got.length / 4 - 1)]).toEqual([[...STEP_COLOURS[step]!, 255], [...STEP_COLOURS[step]!, 255]]);
    }
  }
});
