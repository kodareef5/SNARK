import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FACE_PLAIN } from "../../client/core/render/piece-fit.ts";
import { ALL_FORMS } from "../../content/building/forms.ts";
import { TEK_INLAY_COLOUR, TEK_RAIL_COLOUR } from "../../content/building/tek-wall.ts";
import { defaultPalette, REGION_BASE } from "../../shared/pack/palette.ts";
import { MADE_PIECE_TRIANGLES, TRIM_TRIANGLES } from "../../tools/art/check.ts";
import { Shape, flatLod } from "../../tools/pack/pieces/kit.ts";
import { buildPack } from "../../tools/pack/write.ts";
import { bakeTek } from "../../tools/pack/pieces/tek.ts";

test("the Tek bake picks the same diagonal on nearly equal quads", () => {
  const quad = (offset: number): Shape => {
    const shape = new Shape();
    shape.faces.push({
      points: [[0, 0, 0], [1, 0, 0], [1 + offset, 1, 0], [0, 1, 0]],
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
      mat: "titanium",
    });
    return shape;
  };
  const legacyCut = [0, 1, 3, 1, 2, 3];
  for (const offset of [-1e-14, 0, 1e-14]) {
    expect([...flatLod(quad(offset), () => 1, false, { stableDiagonals: true }).indices]).toEqual([0, 1, 2, 0, 2, 3]);
  }
  expect([...flatLod(quad(.01), () => 1, false, { stableDiagonals: true }).indices]).toEqual(legacyCut);
  expect([...flatLod(quad(1e-14), () => 1).indices]).toEqual(legacyCut);
});

test("every Tek form and fitted trim bakes its intended opaque finish", () => {
  const kit = bakeTek(ALL_FORMS);
  const shipped = readFileSync(new URL("../../assets/source/core/structures/tek/tek.snpk", import.meta.url));
  expect(shipped.equals(buildPack(kit, defaultPalette()))).toBe(true);
  expect(new Set(kit.map(mesh => mesh.id))).toEqual(new Set(
    [...Object.keys(ALL_FORMS), ...Object.keys(TRIM_TRIANGLES), ...Array.from({ length: 15 }, (_, i) => `wall_join_${i + 1}`)].map(name => `core:${name}_tek`),
  ));
  for (const mesh of kit) {
    const name = mesh.id.slice(5, -4), wall = name === "wall" || name.startsWith("wall_join_");
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
