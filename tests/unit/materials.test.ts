// An asset's materials: from the pictures its asset.ts names to a pack with surfaces, sections and materials, the
// textures the build is given, and what the check says of the pictures. Blender is never run here: the models are
// written in code.
import { expect, spyOn, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "../../shared/pack/manifest.ts";
import { MATERIAL_CUTOUT, MATERIAL_TWO_SIDED, parsePack, type PackMaterial } from "../../shared/pack/pack.ts";
import { RAMP_BASE, REGION_BASE, SKIN_BASE, defaultPalette, nearestColour } from "../../shared/pack/palette.ts";
import { findAssets, type Asset } from "../../tools/art/assets.ts";
import { convertModel, convertPieces, packOf, repack, type Built } from "../../tools/art/build.ts";
import { bothWays, checkAsset } from "../../tools/art/check.ts";
import { describe, gameTextures, materialsOf } from "../../tools/art/materials.ts";
import { shared, type CreatureAsset, type MaterialSpec, type PiecesAsset } from "../../tools/art/spec.ts";
import { ART } from "../../tools/art/source.ts";
import * as image from "../../tools/pack/image.ts";
import * as surfaces from "../../tools/surfaces/build.ts";
import { encodePng, readPicture, type Picture } from "../../tools/pack/image.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { tangentsOf } from "../../tools/pack/surface.ts";
import { buildPack, unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";
import { importGlb } from "../../tools/pack/glb.ts";
import { corePack } from "../fixtures/pack.ts";
import { tubeGlb, tubeMesh, tubePictures } from "../fixtures/textured.ts";

const palette = defaultPalette();
const EXAMPLES = await findAssets(join(import.meta.dir, "../../tools/blender/example"));
const example = (id: string): Asset => EXAMPLES.find((a) => a.id === id)!;
const built = (): Built => ({ meshes: [], rigs: [], clips: [], lines: [], warnings: [], faults: [] });

/** Calls `work` with a folder of its own and removes it after. */
async function scratch(work: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "snark-materials-"));
  try {
    await work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The tube as an asset folder under `root`: its five pictures, its model as Blender would write it, and what its asset.ts says. */
function tube(root: string, over: Partial<CreatureAsset> = {}): { asset: Asset & { spec: CreatureAsset }; glb: string } {
  const dir = join(root, "t/creatures/tube");
  mkdirSync(join(dir, "tex"), { recursive: true });
  for (const [role, picture] of Object.entries(tubePictures())) writeFileSync(join(dir, "tex", `${role}.png`), encodePng(picture));
  const glb = join(root, "tube.glb");
  writeFileSync(glb, tubeGlb());
  const spec: CreatureAsset = {
    kind: "creature", source: { scripts: [] }, scale: 1, skeleton: { id: "tube", root: "lower" }, zones: [], sockets: [], clips: [], feet: [], gaits: {},
    regions: [{ name: "one", sample: 8 }, { name: "two", sample: 7 }, { name: "three", sample: 14 }, { name: "four", sample: 6 }],
    materials: {
      hide: { base: "tex/base.png", normal: "tex/normal.png", packed: "tex/mro.png", regions: { mask: "tex/mask.png", mask2: "tex/mask2.png" } },
      horn: { base: "tex/base.png", tint: [0.9, 0.8, 0.55], twoSided: true },
    },
    budgets: { triangles: [512, 256, 128, 64], texture: { top: 64, megabytes: 1 } },
    flat: 2,
    ...over,
  };
  writeFileSync(join(dir, "asset.ts"), `export default ${JSON.stringify(spec)};\n`);
  return { asset: { id: "t:tube", name: "tube", dir, file: join(dir, "tube.snpk"), spec }, glb };
}

test("a creature whose materials name pictures converts to a mesh drawn with them, and its pack round-trips through the split and the manifest", async () => {
  await scratch(async (root) => {
    const { asset, glb } = tube(join(root, "source"));
    const out = built();
    convertModel(asset, glb, out);
    expect([out.faults, out.warnings, out.rigs[0]!.names]).toEqual([[], [], ["lower", "upper"]]);
    const mesh = out.meshes[0]!;
    const want = tubeMesh();
    // The finest level is the model's, with its surface and four bones a vertex. The asset's budgets and its first flat level make the rest.
    expect([mesh.flat, mesh.lods.map((l) => l.uvs !== undefined), mesh.lods[0]!.indices.length / 3]).toEqual([2, [true, true, false, false], 512]);
    mesh.lods.forEach((lod, level) => expect(lod.indices.length / 3).toBeLessThanOrEqual(asset.spec.budgets.triangles[level]!));
    expect([mesh.lods[0]!.sections, mesh.lods[0]!.joints, mesh.lods[0]!.bones]).toEqual([want.lods[0]!.sections!, want.lods[0]!.joints!, want.lods[0]!.bones!]);
    // A material's tint is its asset's, 1 where it gives none, and never the model's colour. Its grey and span are measured.
    const [hide, horn] = mesh.materials as [PackMaterial, PackMaterial];
    expect([hide.id, hide.tint, hide.grey, hide.span, hide.flags]).toEqual(["t:tube/hide", [1, 1, 1], want.materials![0]!.grey, want.materials![0]!.span, 0]);
    expect([horn.id, horn.tint, horn.grey, horn.span, horn.flags, horn.mask]).toEqual(["t:tube/horn", [0.9, 0.8, 0.55], 1, want.materials![1]!.span, MATERIAL_TWO_SIDED, -1]);
    // Flat, it is its four regions and the palette colour nearest the horn under its tint, on every level.
    for (const lod of mesh.lods) expect([...new Set(lod.colors)].sort((a, b) => a - b)).toEqual([nearestColour(palette, 214, 194, 137), 240, 241, 242, 243]);

    const file = packOf(out);
    const pack = parsePack(file);
    expect(pack.header.textures).toEqual(["hide/base", "hide/mask", "hide/mask2", "hide/mro", "hide/normal", "horn/base"].map((name) => ({ id: `t:tube/${name}`, role: name.split("/")[1] as "base", top: 64 })));
    expect(pack.header.materials!.map((m) => [m.id, m.base, m.normal, m.mro, m.mask, m.mask2])).toEqual([["t:tube/hide", 0, 4, 3, 1, 2], ["t:tube/horn", 5, -1, -1, -1, -1]]);
    expect(pack.header.meshes[0]!.lods.map((l) => [l.surfaceOffset !== undefined, l.skinOffset !== undefined, (l.sections?.length ?? 0) / 3])).toEqual([[true, true, 2], [true, true, 2], [false, false, 0], [false, false, 0]]);
    const back = unpackMeshes(pack)[0]!;
    expect([back.flat, back.materials, back.textures, back.lods[0]!.sections]).toEqual([2, mesh.materials, mesh.textures, mesh.lods[0]!.sections]);
    const { files, manifest } = splitPack(file, "t");
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
    expect([manifest.materials, manifest.textures!.map((t) => t.id), manifest.meshes[0]!.flat, manifest.meshes[0]!.levels.map((l) => l.parts.length)]).toEqual([pack.header.materials, pack.header.textures!.map((t) => t.id), 2, [3, 3, 1, 1]]);
    expect(files.map((f) => parsePack(f.bytes).header.meshes[0]!.lods.length)).toEqual([3, 1]);

    // Written again from itself, it is the same pack twice over, and its levels can be made again from its pictures.
    const once = repack(file, false);
    expect([parsePack(once).header.materials, parsePack(once).header.textures, repack(once, false)]).toEqual([pack.header.materials, pack.header.textures, once]);
    const again = unpackMeshes(parsePack(repack(file, true, asset)))[0]!;
    expect([again.flat, again.lods.map((l) => l.uvs !== undefined), again.lods.every((l, level) => l.indices.length / 3 <= asset.spec.budgets.triangles[level]!)]).toEqual([2, [true, true, false, false], true]);
    expect(() => repack(file, true)).toThrow("its levels are made again only from its asset's pictures");

    // The build is given every texture the pack names, each with a way to its pictures, which are read only when asked for.
    writeFileSync(asset.file, file);
    const sources = await gameTextures(join(root, "source"));
    expect(sources.map((s) => [s.id, s.role, s.top])).toEqual(manifest.textures!.map((t) => [t.id, t.role, t.top]));
    for (const s of sources) expect(s.mips().map((m) => m.length)).toEqual(Array.from({ length: 7 }, (_, i) => 4 ** i * 4));
    rmSync(join(asset.dir, "tex/mro.png"));
    expect((await gameTextures(join(root, "source"))).length).toBe(6);
    expect(() => sources[3]!.mips()).toThrow();
  });
});

test("the check notes a map that draws as none would, one larger than its content needs, and a picture two materials name; `tops` stores a map smaller", async () => {
  await scratch(async (root) => {
    const black: Picture = { width: 64, height: 64, channels: 3, depth: 8, data: new Uint8Array(64 * 64 * 3) };
    const soft: Picture = { width: 256, height: 256, channels: 3, depth: 8, data: new Uint8Array(256 * 256 * 3) };
    for (let p = 0; p < 256 * 256; p++) soft.data.set([128 + Math.round(3 * Math.sin(((p % 256) * Math.PI) / 32)), 128, 255], p * 3);
    const hide: MaterialSpec = { base: "tex/base.png", packed: "tex/mro.png", regions: "tex/black.png", normal: "tex/soft.png" };
    const { asset, glb } = tube(join(root, "source"), { materials: { hide, horn: { base: "tex/base.png", twoSided: true } }, budgets: { triangles: [512, 256, 128, 64], texture: { top: 256, megabytes: 1 } } });
    writeFileSync(join(asset.dir, "tex/black.png"), encodePng(black));
    writeFileSync(join(asset.dir, "tex/soft.png"), encodePng(soft));
    const out = built();
    convertModel(asset, glb, out);
    const report = checkAsset(asset, parsePack(packOf(out)), true);
    const kept = "and the build keeps one texture of what the two make alike";
    // The tube is open at its ends: its holes are no matter here.
    expect([report.textures[0]!.tops, [...report.faults, ...report.notes].filter((n) => n.startsWith("t:tube/"))]).toEqual([
      { base: 64, mask: 64, mro: 64, normal: 256 },
      [
        "t:tube/hide: its mask is everywhere what a material without one draws, and the build leaves it out",
        expect.stringMatching(/^t:tube\/hide: its normal needs 64 pixels and is stored at 256: from 64 up no texel turns more than [0-2]\.\d degrees \(tops: \{ normal: 64 \}\)$/),
        `t:tube/hide: its base picture is t:tube/horn's too, ${kept}`,
        `t:tube/horn: its base picture is t:tube/hide's too, ${kept}`,
      ],
    ]);
    const told = (tops: MaterialSpec["tops"]) => describe({ name: "hide", id: "t:tube/hide", dir: asset.dir, spec: { ...hide, tops } }, 256, palette).textures.map((t) => [t.role, t.top]);
    expect(told({ normal: 64 })).toEqual([["base", 64], ["mask", 64], ["mro", 64], ["normal", 64]]);
    expect(() => told({ normal: 96 })).toThrow("t:tube/hide: it stores its normal at 96 pixels, and a texture is a power of two from 64 to 4096");
  });
});

test("pieces take their materials by name: one of the asset's own, one that several assets share, and their flat colours from the pictures or the asset", async () => {
  await scratch((root) => {
    const dir = join(root, "t/structures/posts");
    mkdirSync(join(dir, "tex"), { recursive: true });
    for (const [role, picture] of Object.entries(tubePictures())) writeFileSync(join(dir, "tex", `${role}.png`), encodePng(picture));
    writeFileSync(join(root, "post.glb"), tubeGlb());
    const hide: MaterialSpec = shared(join(dir, "tex"), "t:hide", { base: "base.png", normal: "normal.png", packed: "mro.png", tiles: 2 });
    const spec: PiecesAsset = { kind: "pieces", source: { scripts: [] }, pieces: [{ id: "t:post", object: "post" }], materials: { hide, horn: { base: "tex/base.png", flat: [200, 40, 40], cutout: true } }, budgets: { triangles: [512, 256, 128, 64, 32] } };
    const asset = { id: "t:posts", name: "posts", dir, file: join(dir, "posts.snpk"), spec };
    const out = built();
    convertPieces(asset, { post: join(root, "post.glb") }, out);
    expect([out.faults, out.warnings]).toEqual([[], ["t:post: it has a skin, which is not read without a skeleton to follow"]]);
    const mesh = out.meshes[0]!;
    // The shared material keeps its own id and the span it says it tiles at. The other is the asset's, measured on the mesh.
    expect(mesh.materials!.map((m) => [m.id, m.span, m.tint, m.flags, m.cutoff])).toEqual([["t:hide", 2, [1, 1, 1], 0, 0], ["t:posts/horn", tubeMesh().materials![1]!.span, [1, 1, 1], MATERIAL_CUTOUT, 0.5]]);
    expect(mesh.textures!.map((t) => [t.id, t.top])).toEqual([["t:hide/base", 64], ["t:hide/mro", 64], ["t:hide/normal", 64], ["t:posts/horn/base", 64]]);
    // It keeps the authored geometry. Coarse flat levels keep their material colour;
    // textured levels use local picture colours while streaming, honoring explicit flat overrides.
    const mean = describe(materialsOf(asset)[0]!, 64, palette);
    expect([mesh.flat, mesh.lods.length > 2, mean.flat, palette[mean.flat * 4]! > 150]).toEqual([1, true, mean.flat, true]);
    for (const lod of mesh.lods.slice(mesh.flat)) expect([...new Set(lod.colors)].sort((a, b) => a - b)).toEqual([mean.flat, nearestColour(palette, 200, 40, 40)].sort((a, b) => a - b));
    const fine = mesh.lods[0]!, imported = importGlb(tubeGlb(), "t:post", palette).mesh.lods[0]!;
    expect(fine.positions).toEqual(imported.positions); expect(fine.uvs).toEqual(imported.uvs);
    expect(new Set(fine.colors).size).toBeGreaterThan(2);
    for (let triangle = 0; triangle < fine.indices.length / 3; triangle++) {
      const got = Array.from(fine.indices.subarray(triangle * 3, triangle * 3 + 3)), original = Array.from(imported.indices.subarray(triangle * 3, triangle * 3 + 3));
      expect([0, 1, 2].some(turn => got.every((v, k) => v === original[(k + turn) % 3]))).toBe(true);
      if (fine.sections?.[triangle] === 1) expect(fine.colors[got[2]!]).toBe(nearestColour(palette, 200, 40, 40));
    }
    expect(parsePack(packOf(out)).header.materials!.map((m) => m.id)).toEqual(["t:hide", "t:posts/horn"]);

    // Made with another palette, here the block made by rule in reverse, and written again, it has today's colours:
    // a material's read off its pictures again, and any other the nearest of its old colour.
    const today = repack(packOf(out), false);
    const other = palette.slice();
    const turn = (c: number): number => (c >= RAMP_BASE && c < SKIN_BASE ? RAMP_BASE + SKIN_BASE - 1 - c : c);
    for (let i = RAMP_BASE; i < SKIN_BASE; i++) other.set(palette.subarray(i * 4, i * 4 + 4), turn(i) * 4);
    const old = buildPack(out.meshes.map((m) => ({ ...m, lods: m.lods.map((lod) => ({ ...lod, colors: lod.colors.map(turn) })) })), other);
    expect([repack(old, false, asset), repack(old, false)]).toEqual([today, today]);

    // A piece may state the errors of its first levels after the finest. They arrive in the pack as stated, the levels
    // it leaves out are measured as before, and the check sets what it measures beside each stated one. Written again
    // from itself with its asset, the pack keeps them; a piece that states none is written as it always was.
    const stating = { ...asset, spec: { ...spec, pieces: [{ ...spec.pieces[0]!, errors: [0.0125, 0.05] }] } };
    const told = built();
    convertPieces(stating, { post: join(root, "post.glb") }, told);
    const errorsOf = (file: Uint8Array): number[] => parsePack(file).header.meshes[0]!.lods.map((l) => l.error);
    const [was, now] = [errorsOf(packOf(out)), errorsOf(packOf(told))];
    expect([told.faults, now.slice(0, 3), now.slice(3)]).toEqual([[], [0, 0.0125, 0.05], was.slice(3)]);
    expect(was[1]).not.toBe(0.0125);
    const facts = checkAsset(stating, parsePack(packOf(told))).meshes[0]!.levels;
    expect(facts.map((l) => (l.measured === undefined ? undefined : Math.round(l.measured * 1e5) / 1e5))).toEqual([undefined, was[1], was[2], ...was.slice(3).map(() => undefined)]);
    expect(errorsOf(repack(packOf(told), false, stating))).toEqual(now);
    expect(errorsOf(repack(packOf(told), false, asset))).toEqual(was);
    expect(repack(packOf(out), false, asset)).toEqual(repack(packOf(out), false));
    const over = built();
    convertPieces({ ...asset, spec: { ...spec, pieces: [{ ...spec.pieces[0]!, errors: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07] }] } }, { post: join(root, "post.glb") }, over);
    expect(over.faults).toEqual([`t:post: it states errors for 7 levels after the finest, and has ${mesh.lods.length - 1}`]);

    // Asked for, its levels are made from its finest, and the first flat one is the asset's.
    const made = built();
    convertPieces({ ...asset, spec: { ...spec, flat: 2 } }, { post: join(root, "post.glb") }, made);
    expect([made.faults, made.meshes[0]!.flat, made.meshes[0]!.lods.map((l) => l.uvs !== undefined)]).toEqual([[], 2, [true, true, false, false, false]]);
    // A level its script brings follows the made ones as its last, in its own flat colour, taking the last budget.
    writeFileSync(join(root, "far.glb"), tubeGlb(true));
    const far = built();
    convertPieces({ ...asset, spec: { ...spec, flat: 2, budgets: { triangles: [512, 256, 128, 64, 32, 4] } } }, { post: join(root, "far.glb") }, far);
    const lods = far.meshes[0]!.lods;
    expect([far.faults, lods.map((l) => l.indices.length / 3 <= 4), [...new Set(lods.at(-1)!.colors)]]).toEqual([[], [false, false, false, false, false, true], [nearestColour(palette, 32, 64, 96)]]);
    // A shared material that does not say how far it tiles could differ from one asset to the next.
    const loose = built();
    convertPieces({ ...asset, spec: { ...spec, materials: { hide: { ...hide, tiles: undefined } } } }, { post: join(root, "post.glb") }, loose);
    expect(loose.faults).toEqual(["t:hide: a material several assets share says how far it tiles, so that it is the same on all of them"]);
    // Masks that dye a pixel more than wholly are refused, and a region that covers half a material or more is its flat colour.
    const full: Picture = { width: 64, height: 64, channels: 3, depth: 8, data: new Uint8Array(64 * 64 * 3).fill(255) };
    writeFileSync(join(dir, "tex/full.png"), encodePng(full));
    writeFileSync(join(dir, "tex/red.png"), encodePng({ ...full, data: full.data.map((_, i) => (i % 3 === 0 ? 255 : 0)) }));
    const of = (regions: MaterialSpec["regions"]) => describe({ name: "m", id: "t:m", dir, spec: { base: "tex/base.png", regions } }, 64, palette);
    expect(of({ mask: "tex/full.png" }).faults).toEqual(["t:m: the weights of 100.00% of its masks' pixels sum past 1, to as much as 3.00"]);
    expect([of("tex/red.png").flat, of("tex/red.png").textures.map((t) => t.role), of({ mask: "tex/red.png" }).material.grey < 1]).toEqual([REGION_BASE, ["base", "mask"], true]);
    // Before its pictures are painted a material may have its region map alone. It has no base colour, which reads as
    // white, so it is drawn in its dyes; adding the pictures later changes nothing else.
    const bare = describe({ name: "m", id: "t:m", dir, spec: { regions: "tex/red.png", twoSided: true, cutout: true } }, 64, palette);
    expect([bare.faults, bare.textures.map((t) => t.role), bare.material.base, bare.material.normal, bare.material.grey, bare.flat]).toEqual([[], ["mask"], -1, -1, 1, REGION_BASE]);
  });
});

test("every texture the game's packs name has its pictures listed for the texture build, and listing them reads no picture", async () => {
  const named = corePack().header.textures ?? [];
  const read = spyOn(image, "readPicture");
  const bake = spyOn(surfaces, "worldMaterial");
  let sources: Awaited<ReturnType<typeof gameTextures>>;
  try {
    sources = await gameTextures();
    expect(read).not.toHaveBeenCalled();
    expect(bake).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
    bake.mockRestore();
  }
  if (ART) expect(named.length).toBeGreaterThan(0);
  else expect([named, sources]).toEqual([[], []]);
  for (const t of named) expect([t.id, sources.find((s) => s.id === t.id)?.role, sources.find((s) => s.id === t.id)?.top]).toEqual([t.id, t.role, t.top]);
  // The examples are in no game pack, and theirs are found the same way.
  expect((await gameTextures(join(import.meta.dir, "../../tools/blender/example"))).map((s) => `${s.id} ${s.top}`)).toEqual(["demo:pup/Hide/base 64", "demo:pup/Hide/mask 64", "demo:pup/Hide/mro 64", "demo:pup/Hide/normal 64", "demo:crate/Planks/base 64", "demo:crate/Planks/mro 64", "demo:crate/Planks/normal 64"]);
});

test("the check measures the examples' pictures: sizes, a tile that wraps, a normal map that agrees with its height, a region map of flat colours", () => {
  const crate = checkAsset(example("demo:crate"), parsePack(new Uint8Array(readFileSync(example("demo:crate").file))), true);
  expect([crate.faults, crate.notes, crate.pictures, crate.megabytes.budget, crate.megabytes.textures < 0.2]).toEqual([[], [], true, 1, true]);
  const planks = crate.textures[0]!;
  expect([planks.id, planks.tiles, planks.span, planks.tops, planks.layers.map((l) => [l.what, l.width, l.depth])]).toEqual(["demo:crate/Planks", true, 1, { base: 64, mro: 64, normal: 64 }, [["base", 64, 8], ["normal", 64, 8], ["height", 64, 16], ["packed", 64, 8]]]);
  for (const layer of planks.layers) expect(Math.max(...layer.seam!)).toBeLessThan(1.5);
  expect([planks.normal!.x > 0.99, planks.normal!.y > 0.99, Math.abs(planks.normal!.length - 1) < 0.01]).toEqual([true, true, true]);
  // The crate is drawn with two materials, the one with pictures at 64 pixels a metre. Its lid has no texture coordinates and is flat.
  expect(crate.meshes.map((m) => [m.id, m.levels[0]!.materials, m.levels[0]!.bothWays, m.materials?.map((d) => [d.id, d.span, d.texels])])).toEqual([["demo:crate", 2, 0, [["demo:crate/Iron", 1, 0], ["demo:crate/Planks", 1, 64]]], ["demo:crate_lid", undefined, undefined, undefined]]);

  const pup = checkAsset(example("demo:pup"), parsePack(new Uint8Array(readFileSync(example("demo:pup").file))), true);
  expect([pup.faults, pup.meshes[0]!.levels.map((l) => l.materials)]).toEqual([[], [1, 1, undefined]]);
  const hide = pup.textures[0]!;
  expect([hide.tiles, hide.tops, hide.regions!.stray, hide.regions!.over, hide.regions!.cover.map((c) => Math.round(c * 100))]).toEqual([false, { base: 64, mask: 64, mro: 64, normal: 64 }, 0, 0, [69, 25, 0, 0, 0, 0]]);
  // Without the pictures read, only their sizes are known, and nothing is said of what was not measured.
  const quick = checkAsset(example("demo:pup"), parsePack(new Uint8Array(readFileSync(example("demo:pup").file))));
  expect([quick.faults, quick.pictures, quick.textures[0]!.layers.length, quick.textures[0]!.regions, quick.textures[0]!.normal]).toEqual([[], false, 5, undefined, undefined]);
});

test("the check faults pictures that would draw wrong, and a vertex whose triangles lay the picture both ways round", async () => {
  await scratch((root) => {
    const crate = example("demo:crate");
    const pack = parsePack(new Uint8Array(readFileSync(crate.file)));
    const spec = crate.spec as PiecesAsset;
    /** The crate checked with its pictures changed by `change`, which may return another spec for it. */
    const faults = (change: (tex: string) => PiecesAsset | void): string[] => {
      const dir = mkdtempSync(join(root, "crate-"));
      cpSync(join(crate.dir, "tex"), join(dir, "tex"), { recursive: true });
      return checkAsset({ ...crate, dir, spec: change(join(dir, "tex")) ?? spec }, pack, true).faults;
    };
    const redrawn = (file: string, pixel: (x: number, y: number, was: ArrayLike<number>) => number[]): void => {
      const p = readPicture(file);
      for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) p.data.set(pixel(x, y, p.data.subarray((y * p.width + x) * p.channels, (y * p.width + x + 1) * p.channels)), (y * p.width + x) * p.channels);
      writeFileSync(file, encodePng(p));
    };
    expect(faults(() => {})).toEqual([]);
    expect(faults((tex) => redrawn(join(tex, "planks_normal.png"), (_x, _y, was) => [was[0]!, 255 - was[1]!, was[2]!]))).toEqual(["demo:crate/Planks: its normal map's green points down the picture (-1.00 against its height): it would be lit upside down"]);
    expect(faults((tex) => redrawn(join(tex, "planks_base.png"), (x) => [x * 4, x * 3, x * 2]))[0]).toMatch(/^demo:crate\/Planks: its base picture does not wrap: it jumps \d+\.\d+ and 0\.00 times as hard across its edge/);
    expect(faults((tex) => rmSync(join(tex, "planks_packed.png")))).toEqual(["demo:crate/Planks: its packed picture, tex/planks_packed.png, is not there"]);
    expect(faults((tex) => writeFileSync(join(tex, "planks_base.png"), encodePng({ width: 64, height: 32, channels: 3, depth: 8, data: new Uint8Array(64 * 32 * 3) })))).toEqual(["demo:crate/Planks: its base picture is 64 by 32, and a texture is square"]);
    expect(faults(() => ({ ...spec, budgets: { ...spec.budgets, texture: { top: 64, megabytes: 0.01 } } }))).toEqual(["its textures take 0.1 MB in one variant, and its budget is 0.01 MB"]);
    // A material the pack was not built with, and one it was built with that the asset no longer names.
    expect(faults(() => ({ ...spec, materials: { ...spec.materials, Iron: { base: "tex/planks_base.png" } } }))).toEqual(["demo:crate/Iron: its asset names a base picture, and the pack has no such texture. Build the asset again"]);
    expect(faults(() => ({ ...spec, materials: {} }))).toEqual(["the pack names the texture demo:crate/Planks/base, which no material in asset.ts has. Build the asset again", "the pack names the texture demo:crate/Planks/mro, which no material in asset.ts has. Build the asset again", "the pack names the texture demo:crate/Planks/normal, which no material in asset.ts has. Build the asset again"]);
    // A large picture is held against the small one it grew from.
    const small = (tex: string, pixel: (x: number, y: number) => number[]): PiecesAsset => {
      const data = new Uint8Array(32 * 32 * 3);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) data.set(pixel(x, y), (y * 32 + x) * 3);
      writeFileSync(join(tex, "small.png"), encodePng({ width: 32, height: 32, channels: 3, depth: 8, data }));
      return { ...spec, materials: { Planks: { ...spec.materials!.Planks, small: { base: "tex/small.png" } } } };
    };
    const base = readPicture(join(crate.dir, "tex/planks_base.png"));
    const mean = (x: number, y: number): number[] => [0, 1, 2].map((c) => Math.round([0, 1, 64, 65].reduce((sum, at) => sum + base.data[((y * 2 * 64 + x * 2 + at) * 3 + c)]!, 0) / 4));
    expect(faults((tex) => small(tex, mean))).toEqual([]);
    expect(faults((tex) => small(tex, (x, y) => [x * 8, y * 8, 0]))[0]).toMatch(/^demo:crate\/Planks: its base picture, shrunk, is not its small one \(\d+\.\d dB\)$/);

    // A region map that is not flat colours.
    const pup = example("demo:pup");
    const dir = join(root, "pup");
    cpSync(join(pup.dir, "tex"), join(dir, "tex"), { recursive: true });
    redrawn(join(dir, "tex/hide_regions.png"), (x, y) => [x * 4, y * 4, 128]);
    expect(checkAsset({ ...pup, dir }, parsePack(new Uint8Array(readFileSync(pup.file))), true).faults[0]).toMatch(/^demo:pup\/Hide: \d+\.\d% of its region map is no region's colour$/);
  });

  // A square of two triangles, the second laid on the picture mirrored about the edge they share: the two vertices
  // of that edge serve both, and each has one tangent.
  const lod: SourceLod = {
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), colors: new Uint8Array(4).fill(1), indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    uvs: Float32Array.from([0, 1, 1, 1, 1, 0, 1, 1]), normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  };
  const mixed: number[] = [];
  tangentsOf({ ...lod, uvs: lod.uvs!, normals: lod.normals! }, mixed);
  expect([bothWays(lod), mixed, bothWays({ ...lod, uvs: Float32Array.from([0, 1, 1, 1, 1, 0, 0, 0]) })]).toEqual([[0, 2], [0, 2], []]);
  const material: PackMaterial = { id: "t:wall/plain", base: -1, normal: -1, mro: -1, mask: -1, mask2: -1, tint: [1, 1, 1], grey: 1, emissive: 0, flags: 0, cutoff: 0, span: 1 };
  const wall = parsePack(buildPack([{ id: "t:wall", lods: [lod], flat: 1, materials: [material], textures: [] }], palette));
  const report = checkAsset({ id: "t:walls", name: "walls", dir: "", file: "", spec: { kind: "pieces", source: { scripts: [] }, pieces: [{ id: "t:wall", object: "wall" }], budgets: { triangles: [2] } } }, wall);
  expect(report.faults.filter((f) => !f.includes("hole"))).toEqual(["t:wall level 0: 2 vertices are shared by triangles that lay the picture both ways round, so one side of each is lit wrongly (the first at 0.000, 0.000, 0.000). A model whose export writes tangents has such vertices twice"]);
});
