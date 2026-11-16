// The game's asset files as the software rasterizer takes them: the core pack split as a build splits it, and its
// textures in the rgba variant, the one variant the rasterizer reads. The textures are made from the pictures in the
// asset folders. That takes seconds, so each texture is kept under .cache/snap by the bytes it was made from.

import { worldMaterial, worldSurfaceMesh } from "../surfaces/build.ts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import type { Manifest, ManifestTexture } from "../../shared/pack/manifest.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { pictureBytes, topIn, type TextureRole } from "../../shared/pack/texture.ts";
import { findAssets } from "../art/assets.ts";
import { materialsOf, mipsOf, pictureFiles, type Material } from "../art/materials.ts";
import { SOURCE, readPacks } from "../art/source.ts";
import { buildCorePack, grayboxMeshes, withArt } from "../pack/build.ts";
import { mannequinMeshes } from "../pack/mannequin.ts";
import { splitPack } from "../pack/split.ts";
import { rgbaTexture, writeTextureFile } from "../pack/texture.ts";
import { weaponMeshes } from "../pack/weapons.ts";
import { buildPack, type SourceMesh } from "../pack/write.ts";

export const SNAP_CACHE = resolve(import.meta.dir, "../../.cache/snap");

/** A texture in the rgba variant: its pictures, smallest first, from one pixel across up to `top`, which is 1024 at most. */
export interface RgbaTexture {
  role: TextureRole;
  top: number;
  pictures: Uint8Array[];
}

/** The pictures of a material that each role is made from, as `pictureFiles` names them. */
const MADE_FROM: Readonly<Record<TextureRole, readonly string[]>> = {
  base: ["base"],
  normal: ["normal"],
  mro: ["normal", "packed", "occlusion", "roughness", "metal"],
  mask: ["regions", "mask", "mask2"],
  mask2: ["regions", "mask", "mask2"],
  layer: ["hurt", "decay"],
};

/** The code that makes a texture from its pictures. A change to it makes every texture again. */
const MAKERS = ["../pack/image.ts", "../pack/mask.ts", "../pack/texture.ts", "../art/materials.ts", "files.ts"];
let makers: string | null = null;

/**
 * One of a material's textures in the rgba variant, its pack having it at `top`. It is read from `cache` where the
 * pictures it is made from and the code that makes it are the same bytes as when it was kept there, and kept there
 * where the cache can be written.
 */
export function rgbaOf(m: Material, role: TextureRole, top: number, cache: string | null = SNAP_CACHE): RgbaTexture {
  const side = topIn("rgba", top);
  const sizes = Array.from({ length: Math.log2(side) + 1 }, (_, k) => pictureBytes("rgba", role, 1 << k));
  const hash = createHash("sha256").update((makers ??= MAKERS.map((f) => readFileSync(join(import.meta.dir, f), "utf8")).join("\0")));
  hash.update(JSON.stringify([role, top]));
  const files = pictureFiles(m);
  for (const what of MADE_FROM[role]) if (files[what] !== undefined && existsSync(files[what])) hash.update(what).update(readFileSync(files[what]));
  const key = hash.digest("hex");
  const file = cache === null ? null : join(cache, key.slice(0, 2), key);
  let bytes = file !== null && existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
  if (bytes === null || bytes.length !== sizes.reduce((a, b) => a + b, 0)) {
    const made = rgbaTexture(role, mipsOf(m, role, top)).pictures;
    bytes = new Uint8Array(made.reduce((n, p) => n + p.length, 0));
    made.reduce((at, p) => (bytes!.set(p, at), at + p.length), 0);
    // A cache that cannot be written to, as from a painter's sandbox, is only read.
    if (file !== null) {
      try {
        mkdirSync(join(cache!, key.slice(0, 2)), { recursive: true });
        writeFileSync(file, bytes);
      } catch {}
    }
  }
  let at = 0;
  return { role, top: side, pictures: sizes.map((n) => bytes!.subarray(at, (at += n))) };
}

/** Every texture the packs under `source` name, by id, with the material it is made from and its top as the pack has it. */
export async function namedTextures(source: string = SOURCE): Promise<Map<string, { material: Material; role: TextureRole; top: number }>> {
  const out = new Map<string, { material: Material; role: TextureRole; top: number }>();
  for (const asset of await findAssets(source)) {
    if (!existsSync(asset.file)) continue;
    const materials = materialsOf(asset);
    for (const t of parsePack(new Uint8Array(readFileSync(asset.file))).header.textures ?? []) {
      const material = materials.find((m) => t.id === `${m.id}/${t.role}`);
      if (!material) throw new Error(`${asset.id}: its pack names the texture ${t.id}, which no material in its asset.ts has. Build it again`);
      out.set(t.id, { material, role: t.role, top: t.top });
    }
  }
  if (resolve(source) === resolve(SOURCE)) {
    const material = worldMaterial();
    for (const t of worldSurfaceMesh().textures!) out.set(t.id, { material, role: t.role, top: t.top });
  }
  return out;
}

/** The core pack as `buildCorePack` makes it, from the packs under `source`, with `extra` meshes besides. */
export function corePack(source: string = SOURCE, extra: SourceMesh[] = []): Uint8Array {
  if (resolve(source) === resolve(SOURCE)) return buildCorePack(extra);
  const art = readPacks(source);
  const made = [...grayboxMeshes(CORE_CONTENT), ...mannequinMeshes(), ...weaponMeshes()];
  return buildPack([...withArt(made, art.meshes), ...extra], defaultPalette(), [...art.clips, ...authoredClips()], art.rigs, art.details);
}

export interface GameFiles {
  /** The boot file, the mesh file and the rgba texture file, as a client fetches them. */
  files: Uint8Array[];
  manifest: Manifest;
}

/**
 * A whole pack split as a build splits it, with the rgba variant of every texture its manifest names, as `texture`
 * gives each. One given smaller than the variant holds it is listed at the size it is given.
 */
export function splitWithTextures(whole: Uint8Array, texture: (t: ManifestTexture) => RgbaTexture): GameFiles {
  const { files, manifest } = splitPack(whole, "core");
  const textures = (manifest.textures ?? []).map((t) => {
    const made = texture(t);
    if (made.top < topIn("rgba", t.top)) t.top = made.top;
    return made;
  });
  if (textures.length > 0) {
    const file = writeTextureFile("rgba", textures);
    manifest.textures!.forEach((t, i) => (t.in.rgba = { file: files.length, ...file.placed[i]! }));
    files.push({ name: "core.tex.rgba.sntx", role: "tex", bytes: file.bytes });
    manifest.files.push({ name: "core.tex.rgba.sntx", bytes: file.bytes.length, role: "tex", format: "rgba" });
  }
  return { files: files.map((f) => f.bytes), manifest };
}

/**
 * The core pack of the asset folders under `source`, split as a build splits it, with the rgba variant of its textures.
 * `extra` meshes, drawn flat, are put in with the rest: a test's code-made saddles.
 */
export async function gameFiles(source: string = SOURCE, cache: string | null = SNAP_CACHE, extra: SourceMesh[] = []): Promise<GameFiles> {
  const named = await namedTextures(source);
  return splitWithTextures(corePack(source, extra), (t) => {
    const n = named.get(t.id);
    if (!n) throw new Error(`texture ${t.id} is named by a mesh, and no asset under ${source} has its pictures`);
    return rgbaOf(n.material, t.role, t.top, cache);
  });
}
