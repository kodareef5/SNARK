import { expect, test } from "bun:test";
import { FORMS } from "../../content/building/forms.ts";
import { TEK_RAIL_COLOUR, TEK_WALL } from "../../content/building/tek-wall.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { MADE_PIECE_TRIANGLES, measureSurface } from "../../tools/art/check.ts";
import { bakeTekWall } from "../../tools/pack/pieces/tek.ts";
import { coreRegistry } from "../fixtures/world.ts";

test("Tek wall fits Metal and unlocks at the Fabricator after the Metal wall", () => {
  const reg = coreRegistry();
  const def = (name: string) => reg.defs[reg.index.get(`core:${name}`)!];
  const metal = def("wall_metal"), wall = def("wall_tek");
  if (metal?.type !== "structure" || wall?.type !== "structure") throw new Error("Missing wall");
  expect(wall).toMatchObject({ shape: metal.shape, half: metal.half, material: metal.material, made: "tek_field", hp: 12500 });
  expect(def("piece_wall_tek")).toMatchObject({
    places: ["core:wall_tek"], craft: { at: "core:fabricator", needs: [
      { item: "core:ingot", count: 35 }, { item: "core:polymer", count: 20 },
      { item: "core:crystal", count: 15 }, { item: "core:electronics", count: 2 },
    ] },
  });
  expect(def("engram-piece_wall_tek")).toMatchObject({
    level: 90, requires: ["core:engram-piece_fabricator", "core:engram-piece_wall_metal"],
  });
});

test("Tek wall keeps its two inset field faces and a sealed far silhouette", () => {
  const mesh = bakeTekWall(FORMS.wall);
  expect(mesh.id).toBe("core:wall_tek");
  for (const [level, lod] of mesh.lods.entries()) {
    expect(lod.indices.length / 3).toBeLessThanOrEqual(MADE_PIECE_TRIANGLES[level]![1]);
    expect(measureSurface(lod)).toMatchObject({ holes: 0, flipped: 0, insideOut: 0 });
    const front: number[][] = [], back: number[][] = [];
    for (let i = 0; i < lod.colors.length; i++) {
      if (lod.colors[i] !== REGION_BASE) continue;
      const [x, y, z] = lod.positions.subarray(i * 3, i * 3 + 3);
      (z > 0 ? front : back).push([x, y, z]);
    }
    expect(front.length).toBeGreaterThan(0);
    expect(back.length).toBe(front.length);
    if (level > 2) continue;
    for (const face of [front, back]) {
      expect(Math.max(...face.map(([x]) => Math.abs(x)))).toBeCloseTo(TEK_WALL.panelX);
      expect(Math.max(...face.map(([, y]) => Math.abs(y)))).toBeCloseTo(TEK_WALL.panelY);
      for (const [, , z] of face) expect(Math.abs(z)).toBeCloseTo(TEK_WALL.panelZ);
    }
    for (const x of [-1.4, 1.4]) {
      expect(lod.positions.some((v, i) => i % 3 === 0 && Math.abs(v - x) < 1e-5)).toBe(true);
    }
  }
});

test("projectors stand off both faces and a single side carries the service latch", () => {
  const [lod] = bakeTekWall(FORMS.wall).lods;
  const points: number[][] = [];
  for (let i = 0; i < lod!.colors.length; i++) {
    if (lod!.colors[i] !== REGION_BASE) points.push([...lod!.positions.subarray(i * 3, i * 3 + 3), lod!.colors[i]!]);
  }
  for (const face of [-1, 1]) {
    const proud = points.filter(([, , z]) => face * z > TEK_WALL.panelZ + .01);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const tip = proud.filter(([x, y]) => sx * x > .80 && sx * x < 1.16 && sy * y > .80 && sy * y < 1.16);
      const depths = tip.map(([, , z]) => face * z);
      expect(Math.min(...depths)).toBeLessThan(.078);
      expect(Math.max(...depths)).toBeGreaterThan(.083);
      expect(tip.some(([, , , colour]) => colour === TEK_RAIL_COLOUR)).toBe(true);
    }
    const latch = proud.filter(([x, y]) => Math.abs(x) > 1.03 && Math.abs(x) < 1.23 && y > -.51 && y < -.15);
    expect(latch.length).toBeGreaterThan(0);
    expect(latch.every(([x]) => x > 0)).toBe(true);
    expect(proud.some(([x, y]) => Math.abs(x) < .78 && Math.abs(y) < .78)).toBe(false);
  }
});
