// The pictures artists judge their work by: a snapshot on a graphics tier with the game's textures, the textures the
// rasterizer is given and kept between runs, and an asset's review sheet with its materials. Only small pictures are
// read: the snapshot's textures are made here, and the sheet's asset is the example creature's.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_TEXTURED } from "../../client/core/render/packet.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { pictureBytes, type TextureRole } from "../../shared/pack/texture.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { checkAsset } from "../../tools/art/check.ts";
import { materialsOf, mipsOf } from "../../tools/art/materials.ts";
import { drawSheet, type SheetCell } from "../../tools/art/sheet.ts";
import { encodePng, readPicture } from "../../tools/pack/image.ts";
import { corePackBytes } from "../fixtures/pack.ts";
import { boxMesh, buildPack, type SourceLod } from "../../tools/pack/write.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import type { Asset } from "../../tools/art/assets.ts";
import { rgbaTexture } from "../../tools/pack/texture.ts";
import { houseScene, provingView, settle } from "../../tools/snap.ts";
import { rgbaOf, splitWithTextures, type GameFiles } from "../../tools/snap/files.ts";

const W = 240;
const H = 135;
const EXAMPLE = join(import.meta.dir, "../../tools/blender/example");

/** One pixel of each role: a tan base colour, a normal straight out, rough and not metal, and no region. */
const PIXEL: Record<TextureRole, readonly number[]> = { base: [190, 150, 100, 255], normal: [128, 128], mro: [255, 200, 0, 255], mask: [0, 0, 0, 0], mask2: [0, 0, 0, 0] };

/** The core pack split as a build splits it, each of its textures 64 pixels of one colour, so no large picture is read. */
function smallFiles(): GameFiles {
  return splitWithTextures(corePackBytes(), (t) => ({
    role: t.role,
    top: 64,
    pictures: Array.from({ length: 7 }, (_, k) => {
      const out = new Uint8Array(pictureBytes("rgba", t.role, 1 << k));
      for (let i = 0; i < out.length; i += PIXEL[t.role].length) out.set(PIXEL[t.role], i);
      return out;
    }),
  }));
}

test("a snapshot on a tier with textures draws the house with its materials once the card holds them, and on low poly what the whole pack gives", () => {
  const files = smallFiles();
  expect(files.manifest.textures!.length).toBeGreaterThan(0);
  const textured: Record<string, number> = {};
  const pictures: Record<string, Uint8ClampedArray> = {};
  for (const tier of ["lowpoly", "medium", "ultra"]) {
    const view = provingView(W, H, {}, files);
    view.scene.assets.tier = tierOf(tier);
    view.scene.viewHeight = H;
    houseScene(view, "thatch");
    const frames = settle(view);
    const p = view.scene.packet;
    // The last frame has nothing coming, and nothing waits on the card.
    expect([frames > 1, p.assetUploads.length + p.texUploads.length, view.scene.assets.residency.flying]).toEqual([true, 0, 0]);
    const draws = [...Array(p.drawCount).keys()].filter((d) => (p.drawFlags[d]! & DRAW_TEXTURED) !== 0);
    textured[tier] = draws.length;
    // What is drawn with materials is the building pieces, whose packs have pictures.
    for (const d of draws) expect(files.manifest.meshes[p.drawMesh[d]!]!.id).toMatch(/_(thatch|wood|stone)$/);
    pictures[tier] = view.raster.color.slice();
  }
  expect(textured.lowpoly).toBe(0);
  expect(textured.medium).toBeGreaterThan(0);
  expect(textured.ultra).toBeGreaterThanOrEqual(textured.medium!);
  expect(pictures.medium).not.toEqual(pictures.lowpoly);
  // Low poly takes no textures, so the files that carry them change nothing it draws.
  const whole = provingView(W, H);
  whole.scene.assets.tier = tierOf("lowpoly");
  whole.scene.viewHeight = H;
  houseScene(whole, "thatch");
  whole.render();
  expect(whole.raster.color).toEqual(pictures.lowpoly!);
});

test("a texture made from its pictures is kept by what it was made from, and made again when they change or what was kept is spoiled", async () => {
  const cache = mkdtempSync(join(tmpdir(), "snark-views-"));
  try {
    const pup = (await findAssets(EXAMPLE)).find((a) => a.id === "demo:pup")!;
    const hide = materialsOf(pup)[0]!;
    const made = rgbaOf(hide, "base", 64, cache);
    expect(made.pictures).toEqual([...rgbaTexture("base", mipsOf(hide, "base", 64)).pictures]);
    const kept = readdirSync(cache, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    expect(kept.length).toBe(1);
    const file = join(kept[0]!.parentPath, kept[0]!.name);
    expect(rgbaOf(hide, "base", 64, cache).pictures).toEqual(made.pictures);
    writeFileSync(file, new Uint8Array(10));
    expect(rgbaOf(hide, "base", 64, cache).pictures).toEqual(made.pictures);
    expect(readFileSync(file).length).toBe(made.pictures.reduce((n, p) => n + p.length, 0));
    // The same material with another base colour is another texture.
    const base = readPicture(join(hide.dir, hide.spec.base!));
    writeFileSync(join(cache, "base.png"), encodePng({ ...base, data: base.data.map((v) => 255 - v) }));
    const other = rgbaOf({ ...hide, dir: cache, spec: { ...hide.spec, base: "base.png" } }, "base", 64, cache);
    expect(other.pictures[6]).not.toEqual(made.pictures[6]);
    expect(readdirSync(cache, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.length === 64).length).toBe(2);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

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

test("the sheet of a node stands it on its origin and hides what it carries below the ground, and a piece stands on its underside", () => {
  // A stone of two boxes: a red one wholly below its origin and a green one above.
  const lift = (lod: SourceLod, y: number): SourceLod => ({ ...lod, positions: lod.positions.map((v, i) => (i % 3 === 1 ? v + y : v)) });
  const [below, above] = [lift(boxMesh([0.6, 0.49, 0.6], 8), -0.51), lift(boxMesh([0.5, 0.5, 0.5], 7), 0.5)];
  const lod: SourceLod = {
    positions: Float32Array.from([...below.positions, ...above.positions]),
    colors: Uint8Array.from([...below.colors, ...above.colors]),
    indices: Uint32Array.from([...below.indices, ...[...above.indices].map((i) => i + below.positions.length / 3)]),
  };
  const pack = parsePack(buildPack([{ id: "t:stone", lods: [lod] }], defaultPalette()));
  const reds = (dir: string): number => {
    const asset: Asset = { id: "t:rocks", name: "rocks", dir, file: "", spec: { kind: "pieces", source: { scripts: [] }, pieces: [{ id: "t:stone", object: "stone" }], budgets: { triangles: [100] } } };
    const sheet = drawSheet(asset, pack, checkAsset(asset, pack), null)!;
    let red = 0;
    let green = 0;
    for (const c of sheet.cells.filter((c) => c.what === "shaded")) {
      const page = sheet.pages.find((p) => p.name === c.page)!;
      for (let y = c.y; y < c.y + c.height; y++) {
        for (let x = c.x; x < c.x + c.width; x++) {
          const [r, g] = page.pixels.subarray((y * page.width + x) * 4, (y * page.width + x) * 4 + 2);
          if (r! > g! + 50) red++;
          if (g! > r! + 40) green++;
        }
      }
    }
    expect(green).toBeGreaterThan(5000);
    return red;
  };
  expect(reds("/art/t/nodes/rocks")).toBe(0);
  expect(reds("/art/t/props/rocks")).toBeGreaterThan(2000);
});
