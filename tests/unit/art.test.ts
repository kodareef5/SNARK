// The art tool: the asset folders it finds and what its check counts as a fault. Blender is never run here.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Clip } from "../../shared/anim/clip.ts";
import { ZONE_TORSO } from "../../shared/anim/human.ts";
import { parsePack, type PackRig } from "../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import type { Asset } from "../../tools/art/assets.ts";
import { checkAsset, measureSurface } from "../../tools/art/check.ts";
import { readPacks } from "../../tools/art/source.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";
import { withArt } from "../../tools/pack/build.ts";
import { boxMesh, buildPack, type SourceLod } from "../../tools/pack/write.ts";
import { ASSETS } from "../fixtures/assets.ts";

test("every asset folder has its pack, named as the folder is, and the pack passes its check", () => {
  expect(ASSETS.length).toBeGreaterThan(0);
  for (const asset of ASSETS) {
    expect([asset.id, basename(asset.file), basename(dirname(asset.file)), existsSync(asset.file)]).toEqual([asset.id, `${asset.name}.snpk`, asset.name, true]);
    expect([asset.id, checkAsset(asset, parsePack(new Uint8Array(readFileSync(asset.file)))).faults]).toEqual([asset.id, []]);
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
  expect(measureSurface(box)).toEqual({ parts: 1, openEdges: 0, holes: 0, flipped: 0, insideOut: 0, crowded: 0, flat: 0 });
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
  // The foot is down for eleven frames of twenty, holds at the stride given, and that stride is the one measured.
  const gait = report.gaits[0]!;
  expect([gait.clip, gait.stride, gait.feet[0]!.bone, gait.feet[0]!.planted]).toEqual(["hop", 1, "body", 11 / 20]);
  expect(gait.measured).toBeCloseTo(1, 5);
  expect(gait.feet[0]!.slide).toBeLessThan(1e-5);
  expect(report.clips.map((c) => [c.name, c.loop, c.wrap === undefined])).toEqual([["hop", true, false], ["once", false, true]]);
  expect(report.clips[0]!.wrap!).toBeLessThan(report.clips[0]!.step * 1.01);

  expect(faultsOf({ budgets: { triangles: [23] } })).toEqual(["t:hopper level 0: 24 triangles, and its budget is 23"]);
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
