// Offline review of the texture bytes a prepared build serves, decoded at their actual top size.
// This does not change the runtime RGBA cap, prove GPU residency, or validate a source mesh against the build.
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { NEUTRAL } from "../../client/core/render/surface.ts";
import { parseManifest, readPages, storedStep, type ManifestTexture } from "../../shared/pack/manifest.ts";
import { textureOf, type Pack } from "../../shared/pack/pack.ts";
import { unfilterPart } from "../../shared/pack/stored.ts";
import { blockOf, pictureBytes, stepBytes, stepOf, TEXTURE_ROLES, topIn, type TextureFormat, type TextureRole } from "../../shared/pack/texture.ts";
import { decodeAstc } from "../pack/astc.ts";
import { decodeBc5, decodeBc7 } from "../pack/bc.ts";
import { partHash } from "../pack/manifest.ts";
import type { ModelView } from "../snap.ts";

export interface BuiltTextureEvidence {
  manifestSha256: string;
  format: TextureFormat;
  textures: { slot: number; id: string; role: TextureRole; top: number; file: string | null; steps: string[]; decodedSha256: string }[];
}

/**
 * Bind the prepared build's materials to source-pack slots in a ModelView. A build may share or omit neutral maps,
 * so match through material IDs and roles, not texture IDs. Every stored step is restored and hash-checked before
 * decoding. Reads only the relevant file ranges; it does not load multi-gigabyte texture files to inspect one asset.
 * Keep the returned report beside the image, with the source pack's hash. A matching material is necessary, but
 * does not establish that the source geometry or source pictures have remained unchanged since this build.
 */
export function bindBuiltTextures(view: ModelView, pack: Pack, dist: string, format: TextureFormat = "bc"): BuiltTextureEvidence {
  const folder = join(dist, "assets"), manifestBytes = readFileSync(join(folder, "manifest.json"));
  const manifest = parseManifest(manifestBytes.toString("utf8"));
  readPages(manifest, f => new Uint8Array(readFileSync(join(folder, manifest.files[f]!.name))), bytes => new Uint8Array(inflateRawSync(bytes)));
  const report: BuiltTextureEvidence = { manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"), format, textures: [] };
  const files = new Map<number, number>(), made = new Map<number, { pictures: Uint8Array[]; hashes: string[]; file: string; top: number }>();
  const bound = new Map<number, number>();
  const read = (file: number, at: number, length: number): Uint8Array => {
    if (!files.has(file)) files.set(file, openSync(join(folder, manifest.files[file]!.name), "r"));
    const bytes = new Uint8Array(length);
    let got = 0;
    while (got < length) {
      const n = readSync(files.get(file)!, bytes, got, length - got, at + got);
      if (n === 0) throw new Error(`built textures: truncated ${manifest.files[file]!.name} at ${at + got}`);
      got += n;
    }
    return bytes;
  };
  const decode = (t: ManifestTexture): { pictures: Uint8Array[]; hashes: string[]; file: string; top: number } => {
    const v = t.in[format];
    if (!v) throw new Error(`built textures: ${t.id} has no ${format} variant`);
    const top = topIn(format, t.top), block = blockOf(format, v), steps: Uint8Array[] = [];
    for (let step = 0, at = v.at; step <= stepOf(top); step++) {
      const length = storedStep(v, format, t.role, step), bytes = stepBytes(format, t.role, step, block);
      const stored = read(v.file, at, length);
      const restored = length < bytes ? unfilterPart(new Uint8Array(inflateRawSync(stored)), bytes) : stored;
      if (!restored || restored.length !== bytes || partHash(restored) !== v.hash[step]) throw new Error(`built textures: ${t.id} step ${step} failed its stored hash`);
      steps.push(restored); at += length;
    }
    const all = Buffer.concat(steps), pictures: Uint8Array[] = [];
    for (let size = 1, at = 0; size <= top; size <<= 1) {
      const length = pictureBytes(format, t.role, size, block), data = all.subarray(at, at + length); at += length;
      if (format === "rgba") { pictures.push(data); continue; }
      const kind = t.role === "base" || t.role === "layer" ? "srgb" : t.role === "normal" ? "normal" : "linear";
      const rgba = format === "astc" ? decodeAstc(data, size, size, kind, block) : t.role === "normal" ? decodeBc5(data, size, size) : decodeBc7(data, size, size);
      const y = format === "astc" ? 3 : 1;
      pictures.push(t.role === "normal" ? Uint8Array.from({ length: size * size * 2 }, (_, i) => rgba[(i >> 1) * 4 + (i & 1 ? y : 0)]!) : rgba);
    }
    return { pictures, top, file: manifest.files[v.file]!.name, hashes: [...v.hash] };
  };
  try {
    for (const material of pack.header.materials ?? []) {
      const built = manifest.materials?.find(m => m.id === material.id);
      if (!built) throw new Error(`built textures: material ${material.id} is absent; prepare a matching build`);
      for (const role of TEXTURE_ROLES) {
        const slot = textureOf(material, role); if (slot < 0) continue;
        const from = textureOf(built, role);
        if (bound.has(slot)) {
          if (bound.get(slot) !== from) throw new Error(`built textures: source slot ${slot} maps to two different built textures`);
          continue;
        }
        bound.set(slot, from);
        const t = from < 0 ? undefined : manifest.textures?.[from];
        if (from >= 0 && (!t || t.role !== role)) throw new Error(`built textures: ${material.id}/${role} has no matching texture row`);
        if (t && !made.has(from)) made.set(from, decode(t));
        const loaded = made.get(from);
        const pictures = loaded?.pictures ?? [Uint8Array.from(NEUTRAL[role].slice(0, role === "normal" ? 2 : 4))];
        view.texture(slot, role, pictures);
        const digest = createHash("sha256"); for (const picture of pictures) digest.update(picture);
        report.textures.push({ slot, id: t?.id ?? `${material.id}/${role}:neutral`, role, top: loaded?.top ?? 1, file: loaded?.file ?? null, steps: loaded?.hashes ?? [], decodedSha256: digest.digest("hex") });
      }
    }
  } finally { for (const fd of files.values()) closeSync(fd); }
  return report;
}
