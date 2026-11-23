import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { withSurfaceLevels } from "./simplify.ts";
import { importGlb } from "./glb.ts";
import { baseMips, normalMips, packedMips, readPicture } from "./image.ts";
import type { TextureSource } from "./encode.ts";

const id = "core:skateboard";
const file = (name: string) => fileURLToPath(new URL("../../assets/raw/innerscene-board/" + name, import.meta.url));
const roles = ["base", "normal", "mro"] as const;
const textures = roles.map(role => ({ id: id + "/deck/" + role, role, top: role === "mro" ? 256 : role === "normal" ? 512 : 1024 }));

export const skateboardMaterial = { name: "deck", id: id + "/deck", dir: file(""), spec: { base: "base.png", normal: "normal.png", packed: "mro.png" } };
export function skateboardTextures(): TextureSource[] {
  return textures.map(t => ({ ...t, mips: () => {
    const image = readPicture(file(t.role + ".png"));
    const mips = t.role === "base" ? baseMips(image) : t.role === "normal" ? normalMips(image).pictures : packedMips(image);
    return mips.slice(0, Math.log2(t.top) + 1);
  } }));
}
export const skateboardRig = { id, skeleton: id, names: ["deck"], parent: [-1], rest: [0, .08, 0] };

let cached: ReturnType<typeof withSurfaceLevels> | undefined;
export function skateboardMesh() {
  if (cached) return cached;
  const palette = defaultPalette();
  const { mesh } = importGlb(readFileSync(file("deck.glb")), id, palette, { skeleton: id, rig: id });
  mesh.textures = textures;
  Object.assign(mesh.materials![0]!, { base: 0, normal: 1, mro: 2 });
  const image = readPicture(file("base.png"));
  return cached = withSurfaceLevels(mesh, { budgets: [5000, 2000, 700, 220], flat: 3, maps: [{ base: image }], palette });
}
