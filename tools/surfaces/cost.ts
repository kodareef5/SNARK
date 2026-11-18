// The world finishes' bytes for each lit tier and texture variant, from a client build's manifest: what the card holds
// (every layer of each role's array, mips and all) and what is fetched for it (the stored steps), and on a touch-first
// device whose rule keeps the light finish, the base colour's alone.
// bun tools/surfaces/cost.ts <dist>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { TIERS, forTouch } from "../../client/core/assets/tiers.ts";
import { SURFACE_PREFIX } from "../../content/surfaces.ts";
import { parseManifest, readPages, storedStep } from "../../shared/pack/manifest.ts";
import { TEXTURE_FORMATS, blockOf, stepOf, textureBytes, topIn } from "../../shared/pack/texture.ts";

const dist = process.argv[2] ?? "client/dist";
const m = parseManifest(readFileSync(join(dist, "assets/manifest.json"), "utf8"));
readPages(m, (f) => new Uint8Array(readFileSync(join(dist, "assets", m.files[f]!.name))), (stored) => new Uint8Array(inflateRawSync(stored)));
const world = (m.materials ?? []).filter((x) => x.id.startsWith(SURFACE_PREFIX));
const rows = TIERS.filter((t) => t.finishes > 0).flatMap((t) => [t, forTouch(t, true)].filter((v, k) => k === 0 || v.finish === "light")).flatMap((tier) => TEXTURE_FORMATS.map((format) => {
  let card = 0, fetched = 0;
  const roles = tier.finish === "light" ? 1 : 3;
  for (const material of world) for (const [t, side] of ([[material.base, tier.finishes], [material.normal, tier.finishes], [material.mro, tier.finishes / 2]] as const).slice(0, roles)) {
    const tex = m.textures![t]!, v = tex.in[format];
    if (!v) continue;
    const top = Math.min(side, topIn(format, tex.top));
    card += textureBytes(format, tex.role, top, blockOf(format, v));
    for (let s = 0; s <= stepOf(top); s++) fetched += storedStep(v, format, tex.role, s);
  }
  return { tier: tier.name + (roles === 1 ? " touch" : ""), side: tier.finishes, format, cardMB: +(card / 2 ** 20).toFixed(1), fetchedMB: +(fetched / 2 ** 20).toFixed(1) };
}));
console.log(JSON.stringify(rows, null, 1));
