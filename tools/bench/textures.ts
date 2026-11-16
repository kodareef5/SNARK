// Rows for the texture build: how close each block variant comes to the picture it was given, how long a megapixel
// takes on one core, and how long the test set takes on all of them. The set is the feather and the wood under
// planning/artist-test, each map at 1,024. `bun tools/bench/textures.ts` runs these alone.

import { availableParallelism } from "node:os";
import { join } from "node:path";
import { TEXTURE_ROLES, blockOf, pictureBytes, type TextureRole } from "../../shared/pack/texture.ts";
import { decodeAstc, encodeAstc } from "../pack/astc.ts";
import { decodeBc5, decodeBc7, encodeBc5, encodeBc7 } from "../pack/bc.ts";
import { encodeTextures, encodingOf, type TextureSource } from "../pack/encode.ts";
import { packMro, readPicture } from "../pack/image.ts";
import { materialMips, pictureOffset } from "../pack/texture.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const SIZE = 1024;
/** No picture of the set may come back further from its source than this. */
const FLOOR_DB = 40;

/** Decibels of `got` against `want`, pixel by pixel, in the channels listed as pairs of where each is in the two. 99 for no difference. */
function decibels(want: Uint8Array, got: Uint8Array, channels: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let p = 0; p < want.length; p += 4) for (const [w, g] of channels) sum += (want[p + w]! - got[p + g]!) ** 2;
  return sum === 0 ? 99 : 10 * Math.log10((255 * 255 * (want.length / 4) * channels.length) / sum);
}

export async function benchTextures(section: Section, record: Row): Promise<void> {
  section("Textures: the feather and the wood at 1,024, as bc and astc against the pictures given (99 dB is exact)");
  const art = (name: string) => readPicture(join(import.meta.dir, "../../planning/artist-test", name));
  const sets: Record<string, Partial<Record<TextureRole, Uint8Array[]>>> = {
    feather: materialMips({ base: art("feather/feather_base.png"), normal: art("feather/feather_normal.png"), mro: packMro(art("feather/feather_ao.png"), art("feather/feather_rough.png")), regions: art("feather/feather_mask.png") }),
    wood: materialMips({ base: art("wood/wood_base.png"), normal: art("wood/wood_normal.png"), mro: art("wood/wood_orm.png"), regions: art("wood/wood_mask.png") }),
  };
  const sources: TextureSource[] = [];
  for (const [name, maps] of Object.entries(sets)) for (const role of TEXTURE_ROLES) if (maps[role]) sources.push({ id: `${name} ${role}`, role, top: SIZE, mips: () => maps[role]! });

  // One core: each map's largest picture through each encoder, whole.
  const megapixels = (SIZE * SIZE) / 1e6;
  const took = { bc7: [0, 0], bc5: [0, 0], astc: [0, 0] };
  const alone: Uint8Array[][] = [];
  let under = 0;
  for (const s of sources) {
    const top = s.mips()[Math.log2(SIZE)]!;
    const made: Uint8Array[] = [];
    for (const format of ["bc", "astc"] as const) {
      const how = encodingOf(format, s.role, false);
      const t0 = performance.now();
      const blocks = how.with === "astc" ? encodeAstc(top, SIZE, SIZE, how.kind, how.block) : how.with === "bc5" ? encodeBc5(top, SIZE, SIZE) : encodeBc7(top, SIZE, SIZE, how.channels);
      took[how.with][0]! += (performance.now() - t0) / 1000;
      took[how.with][1]! += megapixels;
      made.push(blocks);
      // A normal is its red and green. BC5 gives them back there, ASTC in red and alpha.
      const db =
        how.with === "bc7" ? decibels(top, decodeBc7(blocks, SIZE, SIZE), [[0, 0], [1, 1], [2, 2]])
        : how.with === "bc5" ? decibels(top, decodeBc5(blocks, SIZE, SIZE), [[0, 0], [1, 1]])
        : decibels(top, decodeAstc(blocks, SIZE, SIZE, how.kind, how.block), how.kind === "normal" ? [[0, 0], [1, 3]] : [[0, 0], [1, 1], [2, 2]]);
      if (db < FLOOR_DB) under++;
      record(`${s.id}, ${format}`, db, "dB");
    }
    alone.push(made);
  }
  record(`pictures under the floor of ${FLOOR_DB} dB`, under, "", 0);
  record("BC7 on one core, a megapixel", took.bc7[0]! / took.bc7[1]!, "s", 3);
  record("BC5 on one core, a megapixel", took.bc5[0]! / took.bc5[1]!, "s", 1.5);
  record("ASTC on one core, a megapixel", took.astc[0]! / took.astc[1]!, "s", 1.5);

  // Every core: the whole set as a build encodes it, every mip in both variants, with nothing kept from before.
  const t0 = performance.now();
  const { variants, report } = await encodeTextures(sources, { cache: null });
  record(`the set on ${availableParallelism()} cores, every mip, bc and astc`, (performance.now() - t0) / 1000, "s");
  record("megapixels encoded in that", report.megapixels, "");
  let differ = 0;
  sources.forEach((s, i) => {
    variants.slice(0, 2).forEach((v, f) => {
      const block = blockOf(v.format, v.placed[i]!);
      const at = v.placed[i]!.at + pictureOffset(v.format, s.role, SIZE, block);
      if (!Buffer.from(alone[i]![f]!).equals(v.bytes.subarray(at, at + pictureBytes(v.format, s.role, SIZE, block)))) differ++;
    });
  });
  record("pictures whose bytes differ between one core and all", differ, "", 0);
}

if (import.meta.main) {
  await benchTextures(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
