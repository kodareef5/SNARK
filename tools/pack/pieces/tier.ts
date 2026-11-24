// A tier's pieces as pack meshes: every form's levels from the tier's recipe, with the tier's pictures read for the
// colours its levels are drawn flat in. This is what a tier's asset.ts gives the art tool as its `bake`.

import { MOST_SECTIONS, setTexture, textureOf, type PackMaterial, type PackTexture } from "../../../shared/pack/pack.ts";
import { defaultPalette, nearestColour } from "../../../shared/pack/palette.ts";
import { TEXTURE_ROLES } from "../../../shared/pack/texture.ts";
import type { FormDef } from "../../../shared/world/lattice/forms.ts";
import { describe, type Described } from "../../art/materials.ts";
import type { MaterialSpec } from "../../art/spec.ts";
import { baker, painted } from "../bake.ts";
import { spanOf } from "../surface.ts";
import type { SourceLod, SourceMesh } from "../write.ts";
import { LEVEL_ERRORS, TEXTURED, flatLevels, levelsOf, type TierRecipe } from "./lod.ts";

/** A tier's meshes with no materials, every level in flat colours: the shapes alone, which need no pictures. */
export function tierShapes(recipe: TierRecipe, forms: Readonly<Record<string, FormDef>>): SourceMesh[] {
  const palette = defaultPalette();
  return Object.entries(forms).map(([name, form]) => ({ id: `core:${name}_${recipe.name}`, lods: flatLevels(recipe, name, form, palette) }));
}

/**
 * A tier's meshes as its pack holds them. `materials` are the tier's, by the names its recipe gives them, their
 * pictures under `dir`, no wider than `top` pixels.
 */
export function bakeTier(recipe: TierRecipe, forms: Readonly<Record<string, FormDef>>, dir: string, materials: Readonly<Record<string, MaterialSpec>>, top: number): SourceMesh[] {
  const palette = defaultPalette();
  const made = new Map<string, Described>(Object.entries(materials).map(([name, spec]) => [name, describe({ name, id: `core:${recipe.name}/${name}`, spec, dir }, top, palette)]));
  for (const d of made.values()) if (d.faults.length > 0) throw new Error(d.faults.join("; "));
  // Flat, a material is the colour read off its pictures, and a tone only flat levels have is the recipe's own.
  const tone = (mat: string): number => made.get(mat)?.flat ?? nearestColour(palette, ...(recipe.tones[mat]!) as [number, number, number]);
  const meshes = Object.entries(forms).map(([name, form]): SourceMesh => {
    const shapes = levelsOf(recipe, name, form);
    // The materials a piece is drawn with, in the order its finest level first uses them.
    const names = [...new Set(shapes.slice(0, TEXTURED).flatMap((s) => s.faces.map((f) => f.mat)))];
    if (names.length > MOST_SECTIONS) throw new Error(`${recipe.name} ${name} is drawn with ${names.join(", ")}, and a level may be drawn with ${MOST_SECTIONS}`);
    const textures: PackTexture[] = [];
    const used = names.map((mat): PackMaterial => {
      const d = made.get(mat);
      if (!d) throw new Error(`${recipe.name} ${name} is drawn with "${mat}", which the tier's asset does not name`);
      const material = { ...d.material };
      for (const role of TEXTURE_ROLES) if (textureOf(material, role) >= 0) setTexture(material, role, textureOf(material, role) + textures.length);
      textures.push(...d.textures);
      return material;
    });
    const lods = shapes.map((shape, level): SourceLod => {
      const lod = level < TEXTURED ? shape.lod(names, () => 0) : shape.lod(null, tone);
      return level > 0 ? { ...lod, error: LEVEL_ERRORS[level - 1]! } : lod;
    });
    // Where a client has no pictures yet, and on low poly, a textured level is drawn in the colours read off them.
    const colour = baker(lods[0]!, used, names.map((mat) => made.get(mat)!.maps), palette);
    return { id: `core:${name}_${recipe.name}`, flat: Math.min(TEXTURED, lods.length), materials: used, textures, lods: lods.map((lod, level) => (level < TEXTURED ? painted(lod, colour(lod)) : lod)) };
  });
  // A material that does not say how far it tiles takes the span measured on the meshes it is on: the widest.
  const span = new Map<string, number>();
  for (const mesh of meshes) mesh.materials!.forEach((m, k) => {
    if (m.span === 0 && mesh.lods[0]!.sections!.includes(k)) span.set(m.id, Math.max(span.get(m.id) ?? 0, spanOf(mesh.lods[0]!, k)));
  });
  for (const mesh of meshes) for (const m of mesh.materials!) if (m.span === 0) m.span = span.get(m.id) ?? 1;
  return meshes;
}
