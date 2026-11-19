import { expect, test } from "bun:test";
import { SURFACE_NAMES, surfaceIndex } from "../../content/surfaces.ts";
import { STUDIO_SHORE, studioGround } from "../../client/core/title-route.ts";

test("the menu's portrait stands on a beach: every sample a sand colour, none the palette's missing one, and the sea to its left", () => {
  const hf = studioGround();
  const sand = SURFACE_NAMES.indexOf("sand");
  const kinds = new Map<number, number>();
  for (const t of hf.tint) kinds.set(t, (kinds.get(t) ?? 0) + 1);
  expect(kinds.has(0)).toBe(false);
  expect([...kinds.keys()].every((t) => surfaceIndex(t, true) === sand)).toBe(true);
  expect(kinds.size).toBe(3);

  const x = hf.sizeX / 2, z = hf.sizeZ / 2;
  expect(hf.seaLevel).toBe(0);
  expect(hf.heightAt(x, z)).toBeGreaterThan(0.5);
  expect(hf.waterAt(x - STUDIO_SHORE - 20, z)).toBeGreaterThan(hf.heightAt(x - STUDIO_SHORE - 20, z));
  let wet = 0;
  for (let i = 0; i < hf.nx; i++) if (hf.heightAt(i * hf.cell, z) < hf.seaLevel) wet++;
  expect(wet).toBeGreaterThan(0);
  expect(wet).toBeLessThan(hf.nx / 2);
});
