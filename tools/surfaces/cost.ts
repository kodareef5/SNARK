// Encodes only the world atlas, measures its actual bytes, and leaves derived variants under var/.
// bun tools/surfaces/cost.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { textureBytes, topIn } from "../../shared/pack/texture.ts";
import { mipsOf } from "../art/materials.ts";
import { encodeTextures } from "../pack/encode.ts";
import { worldMaterial, worldSurfaceMesh } from "./build.ts";

const material = worldMaterial(), textures = worldSurfaceMesh().textures!;
const started = performance.now();
const encoded = await encodeTextures(textures.map((t) => ({ ...t, mips: () => mipsOf(material, t.role, t.top) })), { workers: 2 });
mkdirSync("var/surfaces/encoded", { recursive: true });
const variants = encoded.variants.map((v) => {
  writeFileSync(`var/surfaces/encoded/atlas.${v.format}.sntx`, v.bytes);
  return { format: v.format, bytes: v.bytes.length, sha256: createHash("sha256").update(v.bytes).digest("hex"), tiers: TIERS.map((tier) => {
    const largest = Math.max(...textures.map((t) => topIn(v.format, t.top)));
    const maps = textures.map((t) => {
      const top = topIn(v.format, t.top);
      const side = tier.lit ? Math.min(tier.texture, largest) * top / largest : 0;
      return { role: t.role, side, bytes: side ? textureBytes(v.format, t.role, side) : 0 };
    });
    return { tier: tier.name, maps, bytes: maps.reduce((sum, m) => sum + m.bytes, 0), firstStepBytes: tier.lit ? textures.reduce((sum, t) => sum + textureBytes(v.format, t.role, 64), 0) : 0, addedDraws: 0, addedTriangles: 0 };
  }) };
});
const report = { seconds: (performance.now() - started) / 1000, encode: encoded.report, variants };
mkdirSync("assets/source/surfaces/evidence", { recursive: true });
writeFileSync("assets/source/surfaces/evidence/texture-cost.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
