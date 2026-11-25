import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FACE_PLAIN } from "../../client/core/render/piece-fit.ts";
import { ALL_FORMS } from "../../content/building/forms.ts";
import { TEK_INLAY_COLOUR, TEK_RAIL_COLOUR } from "../../content/building/tek-wall.ts";
import { defaultPalette, REGION_BASE } from "../../shared/pack/palette.ts";
import { MADE_PIECE_TRIANGLES, TRIM_TRIANGLES } from "../../tools/art/check.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { bakeTek } from "../../tools/pack/pieces/tek.ts";

test("every Tek form and fitted trim bakes its intended opaque finish", () => {
  const kit = bakeTek(ALL_FORMS);
  const shipped = readFileSync(new URL("../../assets/source/core/structures/tek/tek.snpk", import.meta.url));
  expect(shipped.equals(buildPack(kit, defaultPalette()))).toBe(true);
  expect(new Set(kit.map(mesh => mesh.id))).toEqual(new Set(
    [...Object.keys(ALL_FORMS), ...Object.keys(TRIM_TRIANGLES)].map(name => `core:${name}_tek`),
  ));
  for (const mesh of kit) {
    const name = mesh.id.slice(5, -4), wall = name === "wall";
    const limits = TRIM_TRIANGLES[name] ?? MADE_PIECE_TRIANGLES.map(([, max]) => max);
    for (const [i, lod] of mesh.lods.entries()) {
      expect(lod.indices.length / 3).toBeLessThanOrEqual(limits[i]!);
      expect(lod.colors.length).toBeGreaterThan(0);
      if (wall) expect(lod.bones?.some(v => (v & FACE_PLAIN) !== 0) ?? false).toBe(false);
      else expect(lod.bones?.every(v => (v & FACE_PLAIN) !== 0)).toBe(true);
    }
    if (["wall", "door", "ceiling", "foundation", "gate"].includes(name)) {
      expect(mesh.lods[0]!.colors).toContain(REGION_BASE);
      expect(mesh.lods[0]!.colors).toContain(TEK_RAIL_COLOUR);
      expect(mesh.lods[0]!.colors.includes(TEK_INLAY_COLOUR)).toBe(!wall);
    }
  }
});
