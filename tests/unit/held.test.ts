// An item's piece: held on the prop bone of a hand, and lying on the ground as `<id>/dropped`, made from the held one or
// modelled. Blender is never run here: the models are written in code as Blender would export them.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { B_PROP_L, B_PROP_R, HUMAN } from "../../shared/anim/human.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { encodePng } from "../../tools/pack/image.ts";
import { convertPieces, heldOn, packOf, type Built } from "../../tools/art/build.ts";
import { GRIP_SLACK, checkAsset, heldFaults, lyingFaults, measureSurface } from "../../tools/art/check.ts";
import type { PiecesAsset } from "../../tools/art/spec.ts";
import { boundsOf, lying, thinnest } from "../../tools/pack/lying.ts";
import { splitPack } from "../../tools/pack/split.ts";
import { boxMesh, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";
import { tubeGlb, tubePictures, writeGlb } from "../fixtures/textured.ts";

const built = (): Built => ({ meshes: [], rigs: [], clips: [], lines: [], warnings: [], faults: [] });

/** A box of half sizes `half`, its centre at `at`. */
function box(half: readonly [number, number, number], at: readonly [number, number, number] = [0, 0, 0], color = 228): SourceLod {
  const lod = boxMesh(half, color);
  for (let v = 0; v < lod.positions.length; v += 3) for (let k = 0; k < 3; k++) lod.positions[v + k]! += at[k]!;
  return lod;
}

/** A model of boxes as Blender writes one: each its own node, `<name>` and `<name>_LOD<n>` after it, in a material "Wood". */
function boxesGlb(name: string, levels: readonly SourceLod[]): Uint8Array {
  const data: [Float32Array | Uint16Array, string][] = [];
  const meshes = levels.map((lod) => {
    data.push([Float32Array.from(lod.positions), "VEC3"], [Uint16Array.from(lod.indices), "SCALAR"]);
    return { primitives: [{ attributes: { POSITION: data.length - 2 }, indices: data.length - 1, material: 0 }] };
  });
  const nodes = levels.map((_, k) => ({ name: k === 0 ? name : `${name}_LOD${k}`, mesh: k }));
  return writeGlb({ scene: 0, scenes: [{ nodes: nodes.map((_, k) => k) }], nodes, meshes, materials: [{ name: "Wood", pbrMetallicRoughness: { baseColorFactor: [0.1, 0.05, 0.02, 1] } }] }, data);
}

/** Calls `work` with a folder of its own and removes it after. */
function scratch(work: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "snark-held-"));
  try {
    work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A stick held by its end: 3 cm across, 8 cm tall and 50 cm long, from 5 cm behind the grip. Its second level is thinner. */
const STICK = [box([0.015, 0.04, 0.25], [0, 0.01, 0.2]), box([0.01, 0.03, 0.25], [0, 0.01, 0.2])];

function asset(dir: string, pieces: PiecesAsset["pieces"], over: Partial<PiecesAsset> = {}) {
  const spec: PiecesAsset = { kind: "pieces", source: { scripts: [] }, pieces, budgets: { triangles: [64, 64] }, ...over };
  return { id: "t:sticks", name: "sticks", dir, file: join(dir, "sticks.snpk"), spec };
}

test("a held piece is put on the prop bone of its hand, every vertex of every level, and lies on its broadest side as <id>/dropped", () => {
  scratch((dir) => {
    writeFileSync(join(dir, "stick.glb"), boxesGlb("stick", STICK));
    const files = { stick: join(dir, "stick.glb") };
    const rigid = built();
    convertPieces(asset(dir, [{ id: "t:stick", object: "stick" }]), files, rigid);
    const out = built();
    const left = asset(dir, [{ id: "t:stick", object: "stick", hold: "prop_l", dropped: "auto" }]);
    convertPieces(left, files, out);
    expect([out.faults, out.warnings, out.meshes.map((m) => m.id)]).toEqual([[], [], ["t:stick", "t:stick/dropped"]]);
    const [held, dropped] = out.meshes as [SourceMesh, SourceMesh];
    // In the hand it is where it was modelled, on the human skeleton, and on nothing but the left prop bone.
    expect([held.skeleton, held.lods.length]).toEqual([HUMAN.id, 2]);
    held.lods.forEach((lod, level) => {
      expect([...lod.positions]).toEqual([...rigid.meshes[0]!.lods[level]!.positions]);
      expect([lod.bones!.length, new Set(lod.bones)]).toEqual([lod.positions.length / 3, new Set([B_PROP_L])]);
    });
    expect(heldOn(rigid.meshes[0]!, "prop_r").lods[0]!.bones!.every((b) => b === B_PROP_R)).toBe(true);
    // On the ground it is rigid, turned so its thinnest side, across x, is up: 8 cm wide, 3 cm tall, 50 cm long, resting
    // on y = 0 over the origin. Both levels move together, so the second still lies on the first.
    expect([dropped.skeleton, dropped.lods.map((l) => l.bones)]).toEqual([undefined, [undefined, undefined]]);
    const [lo, hi] = boundsOf(dropped.lods[0]!);
    expect([...lo, ...hi].map((v) => +v.toFixed(4))).toEqual([-0.04, 0, -0.25, 0.04, 0.03, 0.25]);
    const [lo1, hi1] = boundsOf(dropped.lods[1]!);
    expect([...lo1, ...hi1].map((v) => +v.toFixed(4))).toEqual([-0.03, 0.005, -0.25, 0.03, 0.025, 0.25]);
    for (const lod of dropped.lods) expect(measureSurface(lod)).toMatchObject({ holes: 0, flipped: 0, insideOut: 0 });

    // The client finds the bone of a held mesh in the manifest, from its first vertex. The lying one has none.
    const file = packOf(out);
    const manifest = splitPack(file, "t").manifest;
    expect(manifest.meshes.map((m) => [m.id, m.skeleton, m.bone])).toEqual([["t:stick", HUMAN.id, B_PROP_L], ["t:stick/dropped", undefined, undefined]]);
    // A straight stick is not a left-hand piece: the left hand holds a bow, its limbs along Y.
    expect(checkAsset(left, parsePack(file)).faults).toEqual(["t:stick: held in the left hand, its limbs do not run along Y: it spans 3.0, 8.0, 50.0 cm across x, y and z"]);
    expect(out.lines[1]).toMatch(/^t:stick\/dropped +triangles +12 +12 $/);
    expect(out.lines[0]).toMatch(/held on prop_l$/);
  });
});

test("a lying piece named in the model is converted as it is, and the check finds one that floats or is missing", () => {
  scratch((dir) => {
    writeFileSync(join(dir, "stick.glb"), boxesGlb("stick", STICK.slice(0, 1)));
    writeFileSync(join(dir, "flat.glb"), boxesGlb("flat", [box([0.1, 0.02, 0.1], [0.3, 0.02, 0])]));
    const files = { stick: join(dir, "stick.glb"), flat: join(dir, "flat.glb") };
    const named = asset(dir, [{ id: "t:stick", object: "stick", hold: "prop_r", dropped: "flat" }], { budgets: { triangles: [64] } });
    const out = built();
    convertPieces(named, files, out);
    expect([out.faults, out.meshes.map((m) => [m.id, m.skeleton])]).toEqual([[], [["t:stick", HUMAN.id], ["t:stick/dropped", undefined]]]);
    // As modelled: off to one side, and resting on the ground.
    expect([...boundsOf(out.meshes[1]!.lods[0]!).flat()].map((v) => +v.toFixed(4))).toEqual([0.2, 0, -0.1, 0.4, 0.04, 0.1]);
    expect(checkAsset(named, parsePack(packOf(out))).faults).toEqual([]);

    // One that floats, or that the pack lacks, is a fault.
    writeFileSync(join(dir, "flat.glb"), boxesGlb("flat", [box([0.1, 0.02, 0.1], [0, 0.05, 0])]));
    const floats = built();
    convertPieces(named, files, floats);
    expect(checkAsset(named, parsePack(packOf(floats))).faults).toEqual(["t:stick/dropped: its lowest point is at 3.0 cm, and a lying piece rests on y = 0 (within 0.2 cm)"]);
    const bare = built();
    convertPieces({ ...named, spec: { ...named.spec, pieces: [{ id: "t:stick", object: "stick", hold: "prop_r" }] } }, files, bare);
    expect(checkAsset(named, parsePack(packOf(bare))).faults).toEqual(["t:stick/dropped: not in the pack"]);
  });
});

test("a held piece drawn with materials keeps its surface on the hand, and the check holds it to its grip and its length", () => {
  scratch((dir) => {
    mkdirSync(join(dir, "tex"));
    for (const [role, picture] of Object.entries(tubePictures())) writeFileSync(join(dir, "tex", `${role}.png`), encodePng(picture));
    writeFileSync(join(dir, "tube.glb"), tubeGlb());
    // The tube stands two metres along +Y from its origin: a grip at its foot, and its length the wrong way.
    const spec: PiecesAsset = {
      kind: "pieces", source: { scripts: [] }, pieces: [{ id: "t:tube", object: "tube", hold: "prop_r", dropped: "auto" }],
      materials: { hide: { base: "tex/base.png", normal: "tex/normal.png", packed: "tex/mro.png" }, horn: { base: "tex/base.png" } },
      budgets: { triangles: [512] },
    };
    const tube = { id: "t:tubes", name: "tubes", dir, file: join(dir, "tubes.snpk"), spec };
    const out = built();
    convertPieces(tube, { tube: join(dir, "tube.glb") }, out);
    expect(out.faults).toEqual([]);
    const [held, dropped] = out.meshes as [SourceMesh, SourceMesh];
    // On the hand its finest level keeps its surface and loses the tube's own bones and weights.
    expect([held.flat, held.lods[0]!.uvs !== undefined, held.lods[0]!.joints, new Set(held.lods[0]!.bones)]).toEqual([1, true, undefined, new Set([B_PROP_R])]);
    // Lying, it is turned on its side, its normals with it. It is as wide across x as across z, and x comes first: x goes
    // up, and its length, along y, lies along -x.
    expect(thinnest(held.lods[0]!)).toBe(0);
    const n = dropped.lods[0]!.normals!;
    const p = dropped.lods[0]!.positions;
    // Each normal still points out from the tube's axis, which now runs along x at the height of its radius.
    for (let v = 0; v < p.length / 3; v++) expect(Math.abs(n[v * 3]!)).toBeLessThan(1e-6);
    expect(boundsOf(dropped.lods[0]!)[0][1]).toBeCloseTo(0, 6);
    const faults = checkAsset(tube, parsePack(packOf(out))).faults;
    expect(faults.filter((f) => f.startsWith("t:tube:"))).toEqual(["t:tube: its length does not run along +Z: it spans 50.0, 200.0, 50.0 cm across x, y and z, from -25.0 to 25.0 cm along z"]);
  });
});

test("the grip and the length of a held piece, and the ground under a lying one, are what the check holds them to", () => {
  const stick = (at: readonly [number, number, number], half: readonly [number, number, number] = [0.015, 0.04, 0.25]): SourceMesh => heldOn({ id: "t:stick", lods: [box(half, at)] }, "prop_r");
  expect(heldFaults(stick([0, 0, 0.2]), "prop_r")).toEqual([]);
  // The haft's end may stop short of the grip by GRIP_SLACK, and no further.
  expect(heldFaults(stick([0, 0, 0.25 + GRIP_SLACK - 0.001]), "prop_r")).toEqual([]);
  expect(heldFaults(stick([0, 0, 0.27]), "prop_r")).toEqual(["t:stick: its grip, the origin, lies 2.0 cm outside it, and a held piece is modelled with its grip at the origin (within 1.0 cm)"]);
  expect(heldFaults(stick([0, 0.06, 0.2]), "prop_r")[0]).toMatch(/its grip, the origin, lies 2\.0 cm outside it/);
  // Held backwards, or longest across.
  expect(heldFaults(stick([0, 0, -0.2]), "prop_r")).toEqual(["t:stick: its length does not run along +Z: it spans 3.0, 8.0, 50.0 cm across x, y and z, from -45.0 to 5.0 cm along z"]);
  expect(heldFaults(stick([0, 0, 0], [0.3, 0.02, 0.05]), "prop_r")[0]).toMatch(/its length does not run along \+Z/);
  // In the other hand, or off the human skeleton. The left hand holds a bow: limbs along Y either side of the grip, whichever
  // way it reaches, and a stick along +Z is not one.
  expect(heldFaults(stick([0, 0, 0.2]), "prop_l")).toEqual(["t:stick: 24 vertices are not on the prop bone of the hand it is held in (prop_l, bone 26)", "t:stick: held in the left hand, its limbs do not run along Y: it spans 3.0, 8.0, 50.0 cm across x, y and z"]);
  const bow = (at: readonly [number, number, number]): SourceMesh => heldOn({ id: "t:bow", lods: [box([0.03, 0.6, 0.02], at)] }, "prop_l");
  expect([heldFaults(bow([0, 0, 0]), "prop_l"), heldFaults(bow([0, 0.4, 0]), "prop_l")]).toEqual([[], []]);
  expect(heldFaults(bow([0, 0, 0]), "prop_r")[1]).toMatch(/its length does not run along \+Z/);
  expect(heldFaults({ ...stick([0, 0, 0.2]), skeleton: "dodo" }, "prop_r")).toEqual(["t:stick: it is held, and is not on the human skeleton"]);
  const ground = lying(stick([0, 0, 0.2]), "t:stick/dropped");
  expect(lyingFaults(ground)).toEqual([]);
  expect(lyingFaults({ ...ground, skeleton: HUMAN.id })).toEqual([`t:stick/dropped: a lying piece is on the skeleton ${HUMAN.id}, and lies rigid`]);
});

test("a piece lies with its thinnest side up, turned and not mirrored, and the held mesh is left as it was", () => {
  // Thinnest along y: it lies as it is held, only moved to rest on the ground over the origin.
  const flat: SourceMesh = { id: "t:flat", lods: [box([0.1, 0.01, 0.3], [0.05, 0.2, 0.1])] };
  const was = Float32Array.from(flat.lods[0]!.positions);
  const laid = lying(flat, "t:flat/dropped");
  expect([...boundsOf(laid.lods[0]!).flat()].map((v) => +v.toFixed(4))).toEqual([-0.1, 0, -0.3, 0.1, 0.02, 0.3]);
  expect(flat.lods[0]!.positions).toEqual(was);
  // Thinnest along z, which goes up: its height lies along -z.
  const disc: SourceMesh = { id: "t:disc", lods: [box([0.2, 0.1, 0.01])] };
  expect([thinnest(disc.lods[0]!), ...boundsOf(lying(disc, "d").lods[0]!).flat()].map((v) => +v.toFixed(4))).toEqual([2, -0.2, 0, -0.1, 0.2, 0.02, 0.1]);
  // A normal and a tangent turn with the points, and a tangent keeps its sign.
  const one: SourceMesh = { id: "t:one", lods: [{ ...box([0.01, 0.1, 0.3]), normals: new Float32Array(72).map((_, i) => (i % 3 === 0 ? 1 : 0)), tangents: new Float32Array(96).map((_, i) => [0, 0, 1, -1][i % 4]!) }] };
  const turned = lying(one, "t:one/dropped").lods[0]!;
  expect([...turned.normals!.subarray(0, 3), ...turned.tangents!.subarray(0, 4)].map((v) => v + 0)).toEqual([0, 1, 0, 0, 0, 1, -1]);
  for (const mesh of [flat, disc, one]) expect(measureSurface(lying(mesh, "x").lods[0]!)).toMatchObject({ holes: 0, flipped: 0, insideOut: 0 });
});
