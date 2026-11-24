import { expect, test } from "bun:test";
import { DetailMips, type DetailCard } from "../../client/core/assets/detail-mips.ts";
import { atlasBytes, mipOffset } from "../../shared/pack/details.ts";
import { detailsAtlas, parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { storeParts } from "../../tools/pack/store.ts";
import { buildPack } from "../../tools/pack/write.ts";

test("a split atlas keeps the original cell grid and every mip byte", async () => {
  for (const side of [128, 256, 512]) {
    const pixels = Uint8Array.from({ length: atlasBytes(side) }, (_, i) => i * 17 + (i >> 7));
    const header = { atlas: { offset: 0, side }, pictures: [], effects: [], sheets: [], inputs: "" };
    const whole = buildPack([], defaultPalette(), [], [], { header, atlas: pixels });
    const split = splitPack(whole, "test");
    const { files } = await storeParts(split.files, split.manifest);
    const boot = parsePack(files[0]!.bytes);
    const fine = files.find(f => f.role === "details");
    expect(boot.header.details!.atlas.side).toBe(side);
    expect(boot.header.details!.atlas.firstMip ?? 0).toBe(Math.log2(side / 128));
    const at = mipOffset(side, Math.log2(side / 128));
    expect(!!fine).toBe(side > 128);
    expect(Buffer.compare(fine?.bytes ?? new Uint8Array(), pixels.subarray(0, at))).toBe(0);
    expect(Buffer.compare(detailsAtlas(boot), pixels.subarray(at))).toBe(0);
  }
});

test("a delayed atlas survives a reset and sharpens without losing a cell", async () => {
  const boot = new Uint8Array(atlasBytes(128)), fine = new Uint8Array(mipOffset(512, 2));
  let resolve!: (bytes: Uint8Array) => void, reject!: (error: Error) => void, reads = 0;
  const mips = new DetailMips(512, 2, boot, () => {
    reads++;
    return new Promise((yes, no) => { resolve = yes; reject = no; });
  });
  const levels: number[][] = [], limits: number[][] = [];
  const card: DetailCard = {
    upload: (bytes, first, end) => {
      expect(bytes).toBe(first === 2 ? boot : fine);
      levels.push([first, end]);
    },
    sample: (base, minimum) => { limits.push([base, minimum]); },
  };
  mips.restore(card);
  expect([reads, levels, limits]).toEqual([0, [[2, 10]], [[2, 0]]]);
  mips.afterDraw(card, 0);
  mips.afterDraw(card, 10);
  mips.restore(card);
  expect(reads).toBe(1);
  resolve(boot);
  await Bun.sleep(0);
  mips.afterDraw(card, 900);
  expect(reads).toBe(1);
  mips.afterDraw(card, 1010);
  reject(new Error("offline"));
  await Bun.sleep(0);
  mips.afterDraw(card, 3020);
  expect(reads).toBe(3);
  resolve(fine);
  await Bun.sleep(0);
  expect(levels).toEqual([[2, 10], [2, 10]]);
  for (const now of [3030, 3155, 3280]) mips.afterDraw(card, now);
  expect(levels.at(-1)).toEqual([0, 2]);
  expect(limits.slice(-3)).toEqual([[0, 2], [0, 1], [0, 0]]);
  mips.restore(card);
  mips.afterDraw(card, 9000);
  expect(levels.slice(-2)).toEqual([[2, 10], [0, 2]]);
  expect(limits.at(-1)).toEqual([0, 0]);
  expect(reads).toBe(3);
});
