// The art tool: the asset folders it finds, what its check counts as a fault, and the sheet it draws. Blender is never run here.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Clip } from "../../shared/anim/clip.ts";
import { ZONE_TORSO } from "../../shared/anim/human.ts";
import { CLIP_ROOT_STEPS, parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { main } from "../../tools/art.ts";
import { findAssets, isNode, type Asset } from "../../tools/art/assets.ts";
import { checkAsset, measureSurface } from "../../tools/art/check.ts";
import { readPacks } from "../../tools/art/source.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";
import { withArt } from "../../tools/pack/build.ts";
import { fitCapsule } from "../../tools/pack/creature.ts";
import { readPng } from "../../tools/pack/png-read.ts";
import { boxMesh, buildPack, type SourceLod } from "../../tools/pack/write.ts";
import { ASSETS } from "../fixtures/assets.ts";

/** The examples of scripted assets, which are in no game pack. */
const EXAMPLES = await findAssets(join(import.meta.dir, "../../tools/blender/example"));

/**
 * A node pack (trees, rocks, plants) is many meshes of crowns and cards, whose errors are stated rather than measured on
 * their points, and that measure takes seconds on such a pack. Its maker sees it in `bun run art -- <id> --check`. Here a
 * node pack is checked without it, and its stated errors are held to rise level by level while its triangles fall.
 */
function unmeasured(asset: Asset): Asset {
  if (!isNode(asset) || asset.spec.kind !== "pieces") return asset;
  return { ...asset, spec: { ...asset.spec, pieces: asset.spec.pieces.map(({ errors: _, ...p }) => p) } };
}

test("every asset folder has its pack, named as the folder is, and the pack passes its check; so do the examples", () => {
  expect(ASSETS.length).toBeGreaterThan(0);
  expect(EXAMPLES.map((a) => [a.id, a.spec.kind])).toEqual([["demo:pup", "creature"], ["demo:mallet", "pieces"], ["demo:crate", "pieces"]]);
  for (const asset of [...ASSETS, ...EXAMPLES]) {
    expect([asset.id, basename(asset.file), basename(dirname(asset.file)), existsSync(asset.file)]).toEqual([asset.id, `${asset.name}.snpk`, asset.name, true]);
    expect([asset.id, checkAsset(unmeasured(asset), parsePack(new Uint8Array(readFileSync(asset.file)))).faults]).toEqual([asset.id, []]);
  }
});

// A first flat level may carry more triangles than the textured level before it: it builds in geometry what that level
// cuts out of a picture (a palmetto's fingers, a fern's leaflets). From there on they never rise, and end under the first.
test("a node pack's levels state errors that rise and carry triangles that do not", () => {
  for (const asset of ASSETS.filter(isNode)) {
    const pack = parsePack(new Uint8Array(readFileSync(asset.file)));
    for (const mesh of pack.header.meshes) {
      const errors = mesh.lods.slice(1).map((l) => l.error);
      const triangles = mesh.lods.map((l) => l.indexCount / 3);
      expect([mesh.id, errors.every((e, i) => e > (errors[i - 1] ?? 0))]).toEqual([mesh.id, true]);
      expect([mesh.id, triangles.every((t, i) => i < 2 || t <= triangles[i - 1]!) && triangles.at(-1)! < triangles[0]!]).toEqual([mesh.id, true]);
    }
  }
});

/** `lod` without its triangle `t`, or with it turned over. */
function without(lod: SourceLod, t: number, turn = false): SourceLod {
  const indices = Array.from(lod.indices);
  const [a, b, c] = indices.splice(t * 3, 3) as [number, number, number];
  if (turn) indices.push(a, c, b);
  return { ...lod, indices: Uint32Array.from(indices) };
}

test("a surface is counted: its holes, faces turned against their neighbours, and parts inside out", () => {
  const box = boxMesh([1, 0.5, 2], REGION_BASE);
  expect(measureSurface(box)).toEqual({ parts: 1, openEdges: 0, holes: 0, flipped: 0, insideOut: 0, crowded: 0, collapsed: 0 });
  expect(measureSurface(without(box, 3))).toMatchObject({ parts: 1, openEdges: 3, holes: 1, flipped: 0, insideOut: 0 });
  expect(measureSurface(without(box, 3, true))).toMatchObject({ openEdges: 0, holes: 0, flipped: 3, insideOut: 0 });
  // Every triangle the other way round: the surface is whole, and looks inward.
  const inward = { ...box, indices: Uint32Array.from(box.indices, (_, i) => box.indices[i - (i % 3) + [0, 2, 1][i % 3]!]!) };
  expect(measureSurface(inward)).toMatchObject({ holes: 0, flipped: 0, insideOut: 1 });
  // Two boxes apart are two parts, and one of them inside out is counted alone.
  const far = { ...inward, positions: inward.positions.map((v, i) => (i % 3 === 0 ? v + 5 : v)) };
  const both: SourceLod = { positions: Float32Array.from([...box.positions, ...far.positions]), colors: new Uint8Array(48).fill(REGION_BASE), indices: Uint32Array.from([...box.indices, ...Array.from(far.indices, (i) => i + 24)]) };
  expect(measureSurface(both)).toMatchObject({ parts: 2, holes: 0, insideOut: 1 });
  // A sheet with an edge to it is open, and is not called inside out whichever way it faces.
  expect(measureSurface({ ...box, indices: box.indices.slice(0, 6) })).toMatchObject({ parts: 1, openEdges: 4, holes: 1, insideOut: 0 });
  // A thin plate turned inward still holds a body's volume for its area, and is inside out.
  const plate = boxMesh([1, 0.05, 1], REGION_BASE);
  expect(measureSurface({ ...plate, indices: Uint32Array.from(plate.indices, (_, i) => plate.indices[i - (i % 3) + [0, 2, 1][i % 3]!]!) })).toMatchObject({ holes: 0, insideOut: 1 });
  // What a simplified level leaves of a small part: two triangles back to back, closed, and no volume but rounding's.
  const sliver: SourceLod = { positions: Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.2, 0.31, 0.12, 0.45, 0.29]), colors: new Uint8Array(3).fill(REGION_BASE), indices: Uint32Array.from([0, 1, 2, 0, 2, 1]) };
  expect(measureSurface(sliver)).toMatchObject({ parts: 1, openEdges: 0, holes: 0, flipped: 0, insideOut: 0 });
  // Nor is a thin closed card a body: one whose two sides have crossed is not called inside out.
  const card = boxMesh([0.2, 0.0002, 0.1], REGION_BASE);
  expect(measureSurface({ ...card, indices: Uint32Array.from(card.indices, (_, i) => card.indices[i - (i % 3) + [0, 2, 1][i % 3]!]!) })).toMatchObject({ holes: 0, insideOut: 0 });
});

const FRAMES = 20;

/** A clip of the hopper: `at` gives the root's offset on each frame. Nothing turns. */
function clip(name: string, loop: boolean, at: (f: number) => [number, number, number]): Clip {
  const rot = new Float32Array(FRAMES * 2 * 4);
  for (let k = 3; k < rot.length; k += 4) rot[k] = 1;
  return { id: `t:hopper/${name}`, bones: 2, frames: FRAMES, loop, rot, root: Float32Array.from({ length: FRAMES * 3 }, (_, k) => at(Math.floor(k / 3))[k % 3]!) };
}

/**
 * A box with a box for a tail, on two bones. Its root is its foot. In "hop" the foot is down for half the clip and
 * moves back five centimetres a frame, so its stride is one metre. "drift" ends 38 cm from where it starts.
 */
function hopper(spec: Partial<CreatureAsset> = {}, body: SourceLod = boxMesh([0.3, 0.3, 0.5], REGION_BASE)): { asset: Asset; file: Uint8Array } {
  const tail = boxMesh([0.1, 0.1, 0.4], REGION_BASE + 1);
  const lod: SourceLod = {
    positions: Float32Array.from([...Array.from(body.positions, (v, i) => (i % 3 === 1 ? v + 0.5 : v)), ...Array.from(tail.positions, (v, i) => (i % 3 === 1 ? v + 0.5 : i % 3 === 2 ? v - 0.9 : v))]),
    colors: Uint8Array.from([...body.colors, ...tail.colors]),
    indices: Uint32Array.from([...body.indices, ...Array.from(tail.indices, (i) => i + body.positions.length / 3)]),
    bones: Uint8Array.from([...new Array<number>(body.positions.length / 3).fill(0), ...new Array<number>(24).fill(1)]),
  };
  const rig: PackRig = { id: "t:hopper", skeleton: "hop", rest: [0, 0.5, 0, 0, 0.5, -0.8], names: ["body", "tail"], parent: [-1, 0], caps: [0, ZONE_TORSO, 0, 0, -0.2, 0, 0, 0.2, 0.3], sockets: [{ name: "seat", bone: 0, x: 0, y: 0.3, z: 0 }] };
  const clips = [
    clip("hop", true, (f) => (f <= 10 ? [0, 0, 0.25 - 0.05 * f] : [0, 0.3 * Math.sin((Math.PI * (f - 10)) / 10), -0.25 + 0.05 * (f - 10)])),
    clip("drift", true, (f) => [0.02 * f, 0, 0]),
    clip("once", false, (f) => [0.02 * f, 0, 0]),
  ];
  const full: CreatureAsset = {
    kind: "creature",
    source: { scripts: ["model.py"] },
    scale: 1,
    skeleton: { id: "hop", root: "body" },
    zones: [{ zone: "torso", on: "body", a: [0, 0, -0.2], b: [0, 0, 0.2], radius: 0.3 }],
    sockets: [{ name: "seat", bone: "body", offset: [0, 0.3, 0] }],
    regions: [{ name: "body", material: "Body", sample: 9 }, { name: "tail", material: "Tail", sample: 8 }],
    clips: [{ name: "hop", source: "Hop", loop: true }, { name: "once", source: "Once", loop: false }],
    feet: ["body"],
    gaits: { hop: { stride: 1 } },
    budgets: { triangles: [24] },
    ...spec,
  };
  return { asset: { id: "t:hopper", name: "hopper", dir: "", file: "", spec: full }, file: buildPack([{ id: "t:hopper", skeleton: "hop", rig: "t:hopper", lods: [lod] }], defaultPalette(), clips, [rig]) };
}

const faultsOf = (spec: Partial<CreatureAsset> = {}, body?: SourceLod): string[] => {
  const h = hopper(spec, body);
  return checkAsset(h.asset, parsePack(h.file)).faults;
};

test("the check faults what would draw wrong: a level over its budget, a hole, a loop that jumps, a foot that slides", () => {
  const h = hopper();
  const report = checkAsset(h.asset, parsePack(h.file));
  expect(report.faults).toEqual([]);
  expect(report.meshes[0]!.levels.map((l) => [l.triangles, l.budget, l.parts, l.holes])).toEqual([[24, 24, 2, 0]]);
  expect(report.rig).toEqual({ skeleton: "hop", bones: 2, capsules: 1, buried: [], sockets: ["seat"] });
  // The foot is down for eleven frames of twenty, holds at the stride given within a step of the root, and that stride is the one measured.
  const gait = report.gaits[0]!;
  expect([gait.clip, gait.stride, gait.feet[0]!.bone, gait.feet[0]!.planted]).toEqual(["hop", 1, "body", 11 / 20]);
  expect(gait.measured).toBeCloseTo(1, 5);
  expect(gait.feet[0]!.slide).toBeLessThan(1 / CLIP_ROOT_STEPS);
  expect(report.clips.map((c) => [c.name, c.loop, c.wrap === undefined])).toEqual([["hop", true, false], ["once", false, true]]);
  expect(report.clips[0]!.wrap!).toBeLessThan(report.clips[0]!.step * 1.01);

  expect(faultsOf({ budgets: { triangles: [23] } })).toEqual(["t:hopper level 0: 24 triangles, and its budget is 23"]);
  expect(faultsOf({ budgets: { triangles: [] } })).toEqual([]);
  expect(faultsOf({}, without(boxMesh([0.3, 0.3, 0.5], REGION_BASE), 0))).toEqual(["t:hopper level 0: 1 hole (3 open edges)"]);
  expect(faultsOf({}, without(boxMesh([0.3, 0.3, 0.5], REGION_BASE), 0, true))).toEqual(["t:hopper level 0: 3 edges between faces that look opposite ways"]);
  // At twice the stride the body outruns its planted foot by half a metre.
  expect(faultsOf({ gaits: { hop: { stride: 2 } } })).toEqual(['clip "hop": body slides 50.0 cm while planted at a stride of 2 m (it holds best at 1.00 m)']);
  // A loop that ends away from where it starts jumps back. The same clip played once is no fault.
  expect(faultsOf({ clips: [{ name: "drift", source: "Drift", loop: true }, { name: "once", source: "Once", loop: false }], gaits: {} })).toEqual(['clip "drift" jumps 38.0 cm as it wraps, and its largest step is 2.0 cm: its last pose does not lead into its first']);
  // What the asset names and the pack lacks.
  expect(faultsOf({ clips: [{ name: "swim", source: "Swim", loop: true }], feet: ["toe"], gaits: { fly: { stride: 1 } } })).toEqual(['clip "swim" is not in the pack', 'foot "toe" is not a bone of the rig', 'gait "fly" is not one of the clips']);
  expect(faultsOf({ clips: [{ name: "hop", source: "Hop", loop: false }], gaits: {} })).toEqual(['clip "hop" loops, and the asset says otherwise']);
  // A loop that walks and has no stride is remarked on, and is no fault.
  const loose = hopper({ gaits: {} });
  expect(checkAsset(loose.asset, parsePack(loose.file))).toMatchObject({ faults: [], gaits: [], notes: ['clip "hop" walks about 1.00 m a turn and has no stride in asset.ts'] });
});

test("the command checks an asset, draws its sheet and writes the pack again from itself, in any tree it is pointed at", async () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-art-test-"));
  try {
    const h = hopper();
    const folder = join(dir, "source/t/creatures/hopper");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "asset.ts"), `export default ${JSON.stringify(h.asset.spec)};\n`);
    writeFileSync(join(folder, "hopper.snpk"), h.file);
    const said: string[] = [];
    const run = (...args: string[]): Promise<number> => main(["--source", join(dir, "source"), "--out", join(dir, "out"), ...args], (line) => said.push(line));

    expect(await run()).toBe(0);
    expect(said.join("\n")).toContain("t:hopper");
    await expect(run("t:nothing")).rejects.toThrow(/no asset "t:nothing".*t:hopper/);

    expect(await run("--all", "--check", "--sheet")).toBe(0);
    expect(said.join("\n")).toMatch(/gait hop: stride 1 m, holds best at 1\.00 m[\s\S]*\n {2}ok/);
    const out = join(dir, "out/t/hopper");
    const facts = JSON.parse(readFileSync(join(out, "sheet.json"), "utf8")) as { id: string; faults: string[]; sheet: { width: number; height: number; pages: { name: string; file: string; y: number; height: number }[]; cells: { page: string; what: string; x: number; y: number; width: number; height: number; clip?: string; frame?: number; around?: number }[] } };
    expect([facts.id, facts.faults, facts.sheet.pages.map((p) => p.name)]).toEqual(["t:hopper", [], ["views", "rig", "clips-1"]]);
    // Eight sides, four of wireframe, three each of bones and capsules, and six frames of each of two clips.
    const count = (what: string): number => facts.sheet.cells.filter((c) => c.what === what).length;
    expect([count("shaded"), count("wireframe"), count("bones"), count("capsules"), count("clip")]).toEqual([8, 4, 3, 3, 12]);
    expect(facts.sheet.cells.filter((c) => c.clip === "hop").map((c) => c.frame)).toEqual([0, 3, 7, 10, 13, 17]);
    // The whole sheet is its pages one under another.
    const whole = new DataView(new Uint8Array(readFileSync(join(out, "sheet.png"))).buffer);
    expect([whole.getUint32(16), whole.getUint32(20)]).toEqual([facts.sheet.width, facts.sheet.pages.reduce((h, p) => h + p.height, 0)]);
    expect(facts.sheet.pages.map((p) => p.y)).toEqual(facts.sheet.pages.map((_, i) => facts.sheet.pages.slice(0, i).reduce((h, p) => h + p.height, 0)));
    // Each picture lies on its page, with something drawn in it.
    for (const p of facts.sheet.pages) {
      const page = readPng(join(out, p.file));
      expect([page.width, page.height, page.channels]).toEqual([facts.sheet.width, p.height, 4]);
      const at = (x: number, y: number): number => (page.data[(y * page.width + x) * 4]! << 16) | (page.data[(y * page.width + x) * 4 + 1]! << 8) | page.data[(y * page.width + x) * 4 + 2]!;
      for (const c of facts.sheet.cells.filter((c) => c.page === p.name)) {
        expect(c.x >= 0 && c.y >= 0 && c.x + c.width <= page.width && c.y + c.height <= page.height).toBe(true);
        const empty = at(c.x + c.width - 2, c.y + c.height - 2);
        let drawn = 0;
        for (let y = c.y + 30; y < c.y + c.height; y += 6) for (let x = c.x; x < c.x + c.width; x += 6) if (at(x, y) !== empty) drawn++;
        expect([c.what, c.around, c.frame, drawn > 20]).toEqual([c.what, c.around, c.frame, true]);
      }
    }

    // Written again from itself, the pack says the same, and a second time it is the same bytes.
    await run("t:hopper", "--repack");
    const once = readFileSync(join(folder, "hopper.snpk"));
    expect(parsePack(new Uint8Array(once)).clips.hash).toBe(parsePack(h.file).clips.hash);
    await run("--all", "--repack", "--levels");
    expect(readFileSync(join(folder, "hopper.snpk")).equals(once)).toBe(true);

    // An asset described before it is built is listed as such, and nothing is asked of it.
    const early = join(dir, "source/t/creatures/early");
    mkdirSync(early, { recursive: true });
    writeFileSync(join(early, "asset.ts"), `export default ${JSON.stringify(h.asset.spec)};\n`);
    said.length = 0;
    expect([await run(), await run("--all", "--check")]).toEqual([0, 0]);
    expect(said.join("\n")).toMatch(/t:early +creature .*\(not built yet\)[\s\S]*t:early: not built yet/);

    // A fault is counted and told.
    const over = join(dir, "over/t/hopper");
    mkdirSync(over, { recursive: true });
    writeFileSync(join(over, "asset.ts"), `export default ${JSON.stringify({ ...h.asset.spec, budgets: { triangles: [8] } })};\n`);
    writeFileSync(join(over, "hopper.snpk"), h.file);
    said.length = 0;
    expect(await main(["--source", join(dir, "over"), "t:hopper", "--check"], (line) => said.push(line))).toBe(1);
    expect(said.join("\n")).toContain("FAULT: t:hopper level 0: 24 triangles, and its budget is 8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the pack build takes every pack it finds, refuses the same id from two, and lets a modelled mesh replace a grey box", () => {
  const dir = mkdtempSync(join(tmpdir(), "snark-art-test-"));
  try {
    const h = hopper();
    mkdirSync(join(dir, "a/deep"), { recursive: true });
    writeFileSync(join(dir, "a/deep/hopper.snpk"), h.file);
    writeFileSync(join(dir, "wall.snpk"), buildPack([{ id: "t:wall", lods: [boxMesh([1, 1, 0.1], 5)] }], defaultPalette()));
    const art = readPacks(dir);
    expect([art.meshes.map((m) => m.id), art.rigs.map((r) => r.id), art.clips.map((c) => c.id)]).toEqual([["t:hopper", "t:wall"], ["t:hopper"], ["t:hopper/drift", "t:hopper/hop", "t:hopper/once"]]);
    const grey = [{ id: "t:wall", lods: [boxMesh([2, 2, 2], 1)] }, { id: "t:floor", lods: [boxMesh([2, 0.1, 2], 1)] }];
    const merged = withArt(grey, art.meshes);
    expect(merged.map((m) => [m.id, m.lods[0]!.colors[0]])).toEqual([["t:floor", 1], ["t:hopper", REGION_BASE], ["t:wall", 5]]);
    writeFileSync(join(dir, "again.snpk"), h.file);
    expect(() => readPacks(dir)).toThrow(/mesh "t:hopper" is in both .*hopper\.snpk and .*again\.snpk/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hit capsule runs between the joints its zone names, or, naming none, along its vertices' own longest axis", () => {
  // A rod half a metre long, rising along (0.8, 0.6, 0) from (0, 1, 0), its surface 5 cm from its axis.
  const along = [0.8, 0.6, 0];
  const round = [[-0.6, 0.8, 0], [0, 0, 1]];
  const positions: number[] = [];
  for (let i = 0; i <= 40; i++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      for (let c = 0; c < 3; c++) positions.push([0, 1, 0][c]! + (i / 40) * 0.5 * along[c]! + 0.05 * (Math.cos(a) * round[0]![c]! + Math.sin(a) * round[1]![c]!));
    }
  }
  const verts = Array.from({ length: positions.length / 3 }, (_, v) => v);
  const own = fitCapsule(positions, verts, null, null)!;
  const d = [0, 1, 2].map((c) => own.b[c]! - own.a[c]!);
  const length = Math.hypot(d[0]!, d[1]!, d[2]!);
  expect(Math.abs(d[0]! * along[0]! + d[1]! * along[1]!) / length).toBeCloseTo(1, 6);
  expect(own.radius).toBeCloseTo(0.05, 6);
  // Its middle is the rod's, and its round ends reach about as far as the rod does.
  expect([0, 1, 2].map((c) => (own.a[c]! + own.b[c]!) / 2)).toEqual([expect.closeTo(0.2, 2), expect.closeTo(1.15, 2), expect.closeTo(0, 6)]);
  expect(length + 2 * own.radius * 0.6).toBeGreaterThan(0.45);
  // Two joints that lie 10 cm off the rod give a capsule along their line, made wide enough to hold the rod.
  const off = fitCapsule(positions, verts, [-0.06, 1.08, 0], [0.34, 1.38, 0])!;
  expect(off.radius).toBeGreaterThan(0.12);
  expect(fitCapsule(positions, [], null, null)).toBeNull();
});
