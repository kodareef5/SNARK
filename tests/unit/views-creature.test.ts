// The review sheet of the example creature, with its materials beside its flat views, each tier's levels, its texture
// coordinates and its regions. Apart from views.test.ts, whose other sheet it would wait behind, so the two run side by
// side.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { checkAsset } from "../../tools/art/check.ts";
import { drawSheet, type SheetCell } from "../../tools/art/sheet.ts";

const EXAMPLE = join(import.meta.dir, "../../tools/blender/example");

test("the sheet of a creature with pictures draws it with its materials beside its flat views, each tier from where its levels begin, its texture coordinates and its regions", async () => {
  const pup = (await findAssets(EXAMPLE)).find((a) => a.id === "demo:pup")!;
  const pack = parsePack(new Uint8Array(readFileSync(pup.file)));
  const sheet = drawSheet(pup, pack, checkAsset(pup, pack), null)!;
  expect(sheet.pages.map((p) => p.name)).toEqual(["views", "levels", "materials", "rig", "clips-1"]);
  const of = (what: SheetCell["what"]): SheetCell[] => sheet.cells.filter((c) => c.what === what);
  // Levels 0 and 1 have materials and level 2 is flat. Level 0 is drawn both ways.
  expect([of("materials").map((c) => c.level), of("shaded").map((c) => c.level)]).toEqual([[...Array(8).fill(0), ...Array(8).fill(1)], [...Array(8).fill(0), ...Array(8).fill(2)]]);
  expect([of("checker").length, of("regions").map((c) => c.dye)]).toEqual([4, [...Array(4).fill("asset"), ...Array(4).fill("loud")]]);
  // Low poly draws level 1 from the start, so only level 2 begins on it. Each tier with textures turns it flat where level 2 begins.
  expect(of("as seen").map((c) => [c.tier, c.level, c.textured])).toEqual([["medium", 1, true], ["high", 1, true], ["ultra", 1, true], ["lowpoly", 2, false], ["medium", 2, false], ["high", 2, false], ["ultra", 2, false]]);
  expect(of("handover").map((c) => [c.tier, c.level, c.textured])).toEqual(["medium", "high", "ultra"].flatMap((t) => [[t, 1, true], [t, 2, false]]));
  const pixels = (c: SheetCell): number[][] => {
    const page = sheet.pages.find((p) => p.name === c.page)!;
    const out: number[][] = [];
    for (let y = c.y; y < c.y + c.height; y += 2) for (let x = c.x; x < c.x + c.width; x += 2) out.push([...page.pixels.subarray((y * page.width + x) * 4, (y * page.width + x) * 4 + 3)]);
    return out;
  };
  const differ = (a: SheetCell, b: SheetCell): number => {
    const other = pixels(b);
    return pixels(a).filter((p, i) => p.some((v, k) => Math.abs(v - other[i]![k]!) > 12)).length;
  };
  // Each side with its materials is lit apart from the same side flat.
  for (const c of of("materials").filter((c) => c.level === 0)) expect(differ(c, of("shaded").find((f) => f.around === c.around && f.level === 0)!)).toBeGreaterThan(200);
  // The loud dyes show magenta on the coat and lime on the legs, which the asset's own colours never are. Within 60 a
  // channel: lit as the lit tiers light it, a tan of its own (199, 150, 112) is 69 from lime each way.
  const share = (cells: SheetCell[], near: number[]): number => cells.flatMap(pixels).filter((p) => p.every((v, k) => Math.abs(v - near[k]!) < 60)).length;
  const [own, loud] = [of("regions").filter((c) => c.dye === "asset"), of("regions").filter((c) => c.dye === "loud")];
  expect([share(loud, [218, 43, 218]) > 500, share(loud, [130, 218, 43]) > 50, share(own, [218, 43, 218]), share(own, [130, 218, 43])]).toEqual([true, true, 0, 0]);
  // The checker puts saturated squares and near-white ones on it.
  const checker = of("checker").flatMap(pixels);
  expect([checker.filter((p) => Math.max(...p) - Math.min(...p) > 120).length > 300, checker.filter((p) => Math.min(...p) > 200 && Math.max(...p) - Math.min(...p) < 20).length > 100]).toEqual([true, true]);
});
