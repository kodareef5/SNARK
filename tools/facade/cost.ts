// The facades' atlases encoded as the pack encodes a texture, and what each tier holds of them on the card and fetches,
// in each variant. Fetched is each step deflated as it is, which the build's store, trying its filters, betters a little.
// bun tools/facade/cost.ts

import { deflateRawSync } from "node:zlib";
import { FACADE_TIERS } from "../../client/core/render/facade.ts";
import { STEP0_SIZE, blockOf, stepOf, stepOffset, textureBytes, topIn, type TextureRole } from "../../shared/pack/texture.ts";
import { encodeTextures } from "../pack/encode.ts";
import { baseMips, normalMips, packedMips, readPicture } from "../pack/image.ts";
import { FACADE_ART, buildFacadeArt } from "./build.ts";

buildFacadeArt();
const normal = normalMips(readPicture(`${FACADE_ART}/elements-normal.png`));
const sources: { id: string; role: TextureRole; top: number; mips: () => Uint8Array[] }[] = [
  { id: "facade/elements/base", role: "base", top: 2048, mips: () => baseMips(readPicture(`${FACADE_ART}/elements-base.png`)) },
  { id: "facade/elements/normal", role: "normal", top: 2048, mips: () => normal.pictures },
  { id: "facade/elements/mro", role: "mro", top: 2048, mips: () => packedMips(readPicture(`${FACADE_ART}/elements-orm.png`), normal.lengths) },
  { id: "facade/rooms/base", role: "base", top: 2048, mips: () => baseMips(readPicture(`${FACADE_ART}/rooms.png`)) },
];
const encoded = await encodeTextures(sources, { workers: 2, alpha: new Set(["facade/elements/base"]) });
const rows: object[] = [];
for (const v of encoded.variants) {
  for (const [name, tier] of Object.entries(FACADE_TIERS)) {
    if (!tier) continue;
    let card = 0, fetched = 0;
    sources.forEach((s, i) => {
      const want = i < 3 ? tier.elements : tier.rooms;
      if (want === 0) return;
      const placed = v.placed[i]!, top = Math.min(want, topIn(v.format, s.top)), block = blockOf(v.format, placed);
      card += textureBytes(v.format, s.role, top, block);
      for (let step = 0; step <= stepOf(top); step++) {
        const at = placed.at + stepOffset(v.format, s.role, step, block), end = placed.at + stepOffset(v.format, s.role, step + 1, block);
        fetched += deflateRawSync(v.bytes.subarray(at, end), { level: 9 }).length;
      }
    });
    rows.push({ tier: name, format: v.format, elements: tier.elements, rooms: tier.rooms, cardMB: +(card / 2 ** 20).toFixed(2), fetchedMB: +(fetched / 2 ** 20).toFixed(2) });
  }
}
console.log(JSON.stringify({ encode: encoded.report, step0: STEP0_SIZE, rows }, null, 1));
