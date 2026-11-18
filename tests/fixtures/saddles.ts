// The sample raptor's saddle drawn both ways (D491), made in code before any saddle art exists: a box saddle on its
// Torso bone, worn as core:saddle_raptor's mesh, and the raptor's own model with a box of its own on its back, drawn in
// place of the bare body while it wears any saddle. Each is written as Blender would write it, the raptor's skeleton and
// mesh read back from its pack, and converted as an asset folder's model is (tools/art/build.ts convertModel).
//
// The two ways look alike on purpose but for their colours: the worn saddle is brown leather, the saddled model's red,
// so a picture says which was drawn.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { authoredClips } from "../../shared/anim/authored.ts";
import { readPacks } from "../../tools/art/source.ts";
import { convertModel, type Built } from "../../tools/art/build.ts";
import type { CreatureAsset } from "../../tools/art/spec.ts";
import { grayboxMeshes, withArt } from "../../tools/pack/build.ts";
import { mannequinMeshes } from "../../tools/pack/mannequin.ts";
import { weaponMeshes } from "../../tools/pack/weapons.ts";
import { boxMesh, buildPack, unpackMeshes, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";
import { writeGlb } from "./textured.ts";

export const RAPTOR = "core:raptor";
export const SADDLE = "core:saddle_raptor";
export const WORN = `${SADDLE}/worn`;
export const SADDLED = `${RAPTOR}/saddled`;
/** The Blender objects the two ways name: the box saddle, and the raptor again with a box on its back. */
export const SADDLE_OBJECT = "Saddle";
export const SADDLED_OBJECT = "Velociraptor_saddled";
/** What a pack may hold of the raptor's saddle: its worn mesh, its saddled model, or both, where the saddled model wins. */
export type Ways = "worn" | "saddled" | "both";

/**
 * The frozen raptor's original authoring contract (tests/fixtures/art/raptor.snpk): its skeleton
 * as its pack has it, its colour regions by the materials that take them, and its triangle budgets.
 */
const raptor = {
  skeleton: { id: "dino", root: "Body", drop: /^root$|_end$/, reparent: { "BackFoot.L": "BackLowLeg.L", "BackFoot.R": "BackLowLeg.R" } },
  regions: [{ name: "back", material: "Brown", sample: 5 }, { name: "belly", material: "LightBrown", sample: 15 }, { name: "claws", material: "Black", sample: 11 }],
  budgets: { triangles: [1500, 750, 375, 190, 95] },
} satisfies Partial<CreatureAsset>;

const linear = (byte: number): number => (byte / 255 <= 0.04045 ? byte / 255 / 12.92 : Math.pow((byte / 255 + 0.055) / 1.055, 2.4));
const material = (name: string, rgb: readonly [number, number, number]) => ({ name, pbrMetallicRoughness: { baseColorFactor: [...rgb.map(linear), 1] } });

/**
 * The saddle as boxes about the raptor's seat socket, in the model's space: a pad lying on its back, a pommel before it
 * and a cantle behind, and a flap down each side, each its own colour. `inSeat` is where the socket is.
 */
function saddleBoxes(inSeat: readonly number[]): { lod: SourceLod; part: number[] }[] {
  const [sx, sy, sz] = inSeat as [number, number, number];
  const parts: [half: [number, number, number], at: [number, number, number], part: number][] = [
    [[0.13, 0.03, 0.19], [0, 0.005, 0], 0],
    [[0.05, 0.05, 0.03], [0, 0.07, 0.16], 1],
    [[0.11, 0.045, 0.025], [0, 0.06, -0.17], 1],
    [[0.012, 0.11, 0.08], [0.125, -0.08, 0.01], 0],
    [[0.012, 0.11, 0.08], [-0.125, -0.08, 0.01], 0],
  ];
  return parts.map(([half, at, part]) => {
    const lod = boxMesh(half, 0);
    for (let i = 0; i < lod.positions.length; i++) lod.positions[i]! += [sx + at[0], sy + at[1], sz + at[2]][i % 3]!;
    return { lod, part: [part] };
  });
}

/**
 * The raptor's model as Blender would write it, read back from `pack`: its joints, its finest level as a primitive for each
 * colour region, and with `saddles` "Saddle" (the box saddle) and "Velociraptor_saddled" (the raptor again with a red box
 * saddle) beside it. Every vertex weighs wholly on one joint, and each box on the Torso bone, which carries the seat.
 */
export function saddleGlb(pack: Pack, saddles = true): Uint8Array {
  const rig = pack.header.rigs.find((r) => r.id === RAPTOR)!;
  const names = rig.names!;
  const body = unpackMeshes(pack).find((m) => m.id === RAPTOR)!.lods[0]!;
  const seat = rig.sockets!.find((s) => s.name === "seat")!;
  const torso = names.indexOf("Torso");
  if (seat.bone !== torso) throw new Error("the raptor's seat is no longer on its Torso bone");
  const inSeat = [0, 1, 2].map((k) => rig.rest[seat.bone * 3 + k]! + [seat.x, seat.y, seat.z][k]!);
  const regions = raptor.regions.map((r) => r.material!);
  type Data = Float32Array | Uint8Array | Uint16Array | Uint32Array;
  const data: [Data, string][] = [];
  const add = (array: Data, type: string): number => data.push([array, type]) - 1;
  /** One primitive of the triangles `tris` of `lod`, its vertices numbered afresh, each on `bone` or its own. */
  const primitive = (lod: SourceLod, tris: number[], mat: number, bone?: number) => {
    const at = new Map<number, number>();
    const order: number[] = [];
    const indices = tris.flatMap((t) => [0, 1, 2].map((k) => {
      const v = lod.indices[t * 3 + k]!;
      if (!at.has(v)) at.set(v, order.push(v) - 1);
      return at.get(v)!;
    }));
    return {
      material: mat,
      indices: add(Uint16Array.from(indices), "SCALAR"),
      attributes: {
        POSITION: add(Float32Array.from(order.flatMap((v) => [...lod.positions.subarray(v * 3, v * 3 + 3)])), "VEC3"),
        JOINTS_0: add(Uint8Array.from(order.flatMap((v) => [bone ?? lod.bones![v]!, 0, 0, 0])), "VEC4"),
        WEIGHTS_0: add(Float32Array.from(order.flatMap(() => [1, 0, 0, 0])), "VEC4"),
      },
    };
  };
  const all = (lod: SourceLod): number[] => Array.from({ length: lod.indices.length / 3 }, (_, t) => t);
  // The body as a primitive a region, each triangle by the region of its first corner.
  const bodyPrimitives = () => regions.map((_, r) => primitive(body, all(body).filter((t) => body.colors[body.indices[t * 3]!] === REGION_BASE + r), r));
  const boxes = saddleBoxes(inSeat);
  const saddle = (first: number) => boxes.map((b) => primitive(b.lod, all(b.lod), first + b.part[0]!, torso));
  const objects = saddles ? ["Velociraptor", SADDLE_OBJECT, SADDLED_OBJECT] : ["Velociraptor"];
  const joints = names.map((_, b) => objects.length + b);
  const meshes = [{ primitives: bodyPrimitives() }, { primitives: saddle(regions.length) }, { primitives: [...bodyPrimitives(), ...saddle(regions.length + 2)] }];
  return writeGlb(
    {
      scene: 0,
      scenes: [{ nodes: [...objects.keys(), joints[0]] }],
      nodes: [
        ...objects.map((name, mesh) => ({ name, mesh, skin: 0 })),
        ...names.map((name, b) => {
          const p = rig.parent![b]!;
          const translation = [0, 1, 2].map((k) => rig.rest[b * 3 + k]! - (p < 0 ? 0 : rig.rest[p * 3 + k]!));
          const children = joints.filter((_, c) => rig.parent![c] === b);
          return { name, translation, ...(children.length > 0 ? { children } : {}) };
        }),
      ],
      meshes: meshes.slice(0, objects.length),
      skins: [{ joints }],
      materials: [
        ...regions.map((name) => ({ name })),
        material("Leather", [118, 74, 40]),
        material("Horn", [64, 40, 24]),
        material("Lacquer", [150, 34, 30]),
        material("Brass", [196, 156, 70]),
      ],
    },
    data,
  );
}

/** The raptor's asset.ts as an art maker would write it for `ways`: in metres, the model above, and nothing but its saddle besides. */
export function saddleAsset(ways: Ways): CreatureAsset {
  return {
    kind: "creature",
    ...raptor,
    source: { scripts: [] },
    scale: 1,
    // Its rig, its clips and how it moves are the raptor's pack's; only its meshes are wanted here.
    zones: [],
    sockets: [],
    clips: [],
    gaits: {},
    feet: [],
    ...(ways !== "saddled" ? { worn: [{ item: SADDLE, object: SADDLE_OBJECT, budgets: { triangles: [60] } }] } : {}),
    ...(ways !== "worn" ? { saddled: { objects: [SADDLED_OBJECT], budgets: raptor.budgets } } : {}),
  };
}

const made = new WeakMap<Pack, Map<Ways, Built>>();

/** The meshes `saddleAsset(ways)` converts `saddleGlb(pack)` to, besides the bare body: built once a process for each pack and way. */
export function saddleMeshes(pack: Pack, ways: Ways): SourceMesh[] {
  const of = made.get(pack) ?? made.set(pack, new Map()).get(pack)!;
  let out = of.get(ways);
  if (!out) {
    out = { meshes: [], rigs: [], clips: [], lines: [], warnings: [], faults: [] };
    const dir = mkdtempSync(join(tmpdir(), "snark-saddles-"));
    try {
      const glb = join(dir, "raptor.glb");
      writeFileSync(glb, saddleGlb(pack));
      convertModel({ id: RAPTOR, name: "raptor", dir, file: join(dir, "raptor.snpk"), spec: saddleAsset(ways) }, glb, out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (out.faults.length > 0) throw new Error(out.faults.join("; "));
    of.set(ways, out);
  }
  return out.meshes.filter((m) => m.id !== RAPTOR);
}

let frozen: Pack | null = null;

/**
 * The frozen pack (tests/fixtures/pack.ts) with the raptor's saddle meshes for `ways` after every mesh of its own, so
 * those are numbered as they were.
 */
export function saddledFrozenPack(ways: Ways): Pack {
  const art = readPacks(join(import.meta.dir, "art"));
  const meshes = withArt([...grayboxMeshes(CORE_CONTENT), ...mannequinMeshes(), ...weaponMeshes()], art.meshes);
  const clips = [...art.clips, ...authoredClips()];
  frozen ??= parsePack(buildPack(meshes, defaultPalette(), clips, art.rigs));
  return parsePack(buildPack([...meshes, ...saddleMeshes(frozen, ways)], defaultPalette(), clips, art.rigs));
}
