// A built piece destroyed or blasted throws 6 to 10 chunks cut from its form along its tier's grain
// (content/building/breaks.ts); the client throws them (client/core/fragments.ts, rubble.ts) and draws each tier's from its
// pack's `<piece>/break` mesh (tools/pack/pieces/breaks.ts). These hold the cut, the packs, where the chunks start and the cap.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { BreakSets, POSE, SET_PIECE, fragmentPose, type Broken } from "../../client/core/fragments.ts";
import { Camera } from "../../client/core/render/camera.ts";
import "../../client/core/render/city-late.ts";
import { DRAW_SKINNED } from "../../client/core/render/packet.ts";
import { FrameTable, PIECE_FRAMED, PIECE_FIT_AT, PIECE_STATE_AT, PieceFit, fitOfForm, pieceWord } from "../../client/core/render/piece-fit.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { Falling, MOST_PIECE_BREAKS } from "../../client/core/rubble.ts";
import type { Rubble } from "../../client/core/session.ts";
import { TIER_FORMS } from "../../content/building.ts";
import { LEAST_GROUPS, MOST_PIECE_GROUPS, pieceBreak } from "../../content/building/breaks.ts";
import { FORMS, boxed, formBoxes, formHulls } from "../../content/building/forms.ts";
import { INSTANCE_BYTES, parsePack } from "../../shared/pack/pack.ts";
import { REGION_BASE, defaultPalette } from "../../shared/pack/palette.ts";
import { hullOf, hullPoint } from "../../shared/world/convex.ts";
import type { FormDef } from "../../shared/world/lattice/forms.ts";
import { GONE_BLAST, GONE_DESTROYED, GONE_FELL } from "../../shared/world/structures.ts";
import { SOURCE } from "../../tools/art/source.ts";
import { pieceBreakRows } from "../../tools/bench/piece-breaks.ts";
import { colliderBox } from "../../tools/pack/pieces/lod.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { buildPack, unpackMeshes, type SourceMesh } from "../../tools/pack/write.ts";
import { turnedBy } from "../fixtures/trims.ts";
import { Base, dodecagon, mixedHouse, turnedRegistry, turnedWorld } from "../fixtures/turned.ts";
import { coreRegistry } from "../fixtures/world.ts";

const ROWS: Readonly<Record<string, FormDef>> = FORMS;
const TIERS = Object.keys(TIER_FORMS);
/** The tiers whose packs draw their pieces with materials, and so carry their breaks. Metal is flat: its sets are made on the client. */
const PACKED = ["wood", "stone", "thatch"];

/** A convex chunk's volume, from its hull's faces. */
function volume(corners: readonly (readonly [number, number, number])[]): number {
  const hull = hullOf({ corners });
  if (typeof hull === "string") throw new Error(hull);
  let v = 0;
  for (const ring of hull.rings) for (let k = 2; k < ring.length; k++) {
    const [a, b, c] = [corners[ring[0]!]!, corners[ring[k - 1]!]!, corners[ring[k]!]!];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

/** What a form's collider fills: its boxes, or its convex parts. */
function solidOf(f: FormDef): number {
  if (boxed(f)) return formBoxes(f).reduce((s, b) => s + 8 * b.half[0] * b.half[1] * b.half[2], 0);
  return formHulls(f).reduce((s, h) => s + volume(h.corners.map((c) => hullPoint(c, h.sixty === true))), 0);
}

test("every placed form of every tier breaks into 6 to 10 groups that fill it", () => {
  let forms = 0;
  for (const tier of TIERS) {
    for (const name of TIER_FORMS[tier]!) {
      const f = ROWS[name]!, groups = pieceBreak(f, tier), box = colliderBox(f);
      expect(groups.length, `${name} ${tier}`).toBeGreaterThanOrEqual(LEAST_GROUPS);
      expect(groups.length, `${name} ${tier}`).toBeLessThanOrEqual(MOST_PIECE_GROUPS);
      let filled = 0;
      for (const group of groups) for (const chunk of group) {
        filled += volume(chunk);
        for (const p of chunk) for (let a = 0; a < 3; a++) {
          expect(p[a]!, `${name} ${tier}`).toBeGreaterThanOrEqual(box[a]! - 1e-6);
          expect(p[a]!, `${name} ${tier}`).toBeLessThanOrEqual(box[a + 3]! + 1e-6);
        }
      }
      // The chunks are the piece: what its collider fills, to a part in a thousand.
      expect(Math.abs(filled - solidOf(f)) / solidOf(f), `${name} ${tier}`).toBeLessThan(1e-3);
      forms++;
    }
  }
  expect(forms).toBeGreaterThan(100);
});

test("the client finds a break set for every placed piece and none for a city piece", () => {
  const reg = coreRegistry(), sets = new BreakSets(reg);
  for (const tier of TIERS) for (const name of TIER_FORMS[tier]!) {
    const kind = reg.index.get(`core:${name}_${tier}`);
    expect(kind, `core:${name}_${tier}`).toBeDefined();
    const set = sets.piece(kind!)!;
    expect(set.key % 4).toBe(SET_PIECE);
    expect(set.groups.length).toBe(pieceBreak(ROWS[name]!, tier).length);
    expect(set.lump).toBe(set);
  }
  expect(sets.piece(reg.index.get("core:storage_box")!)).toBeNull();
});

for (const tier of PACKED) {
  const file = join(SOURCE, "core/structures", tier, `${tier}.snpk`);
  test.skipIf(!existsSync(file))(`${tier}'s pack draws every placed form's break in the piece's own material`, () => {
    const pack = parsePack(new Uint8Array(readFileSync(file)));
    const meshes = new Map(unpackMeshes(pack).map((m) => [m.id, m] as const));
    for (const name of TIER_FORMS[tier]!) {
      const piece = meshes.get(`core:${name}_${tier}`), made = meshes.get(`core:${name}_${tier}/break`);
      expect(made, `core:${name}_${tier}/break`).toBeDefined();
      const lod = made!.lods[0]!, groups = pieceBreak(ROWS[name]!, tier);
      expect(made!.lods.length).toBe(1);
      expect(lod.uvs, "it is drawn with materials").toBeDefined();
      expect(made!.materials!.length).toBe(1);
      expect(piece!.materials!.map((m) => m.id)).toContain(made!.materials![0]!.id);
      // Each vertex follows its group's bone and lies in its group's chunks' box, to the pack's quantizing.
      const lo = groups.map((g) => [0, 1, 2].map((a) => Math.min(...g.flat().map((p) => p[a]!))));
      const hi = groups.map((g) => [0, 1, 2].map((a) => Math.max(...g.flat().map((p) => p[a]!))));
      for (let v = 0; v < lod.positions.length / 3; v++) {
        const g = lod.bones![v]!;
        expect(g).toBeLessThan(groups.length);
        for (let a = 0; a < 3; a++) {
          expect(lod.positions[v * 3 + a]!).toBeGreaterThan(lo[g]![a]! - 2e-3);
          expect(lod.positions[v * 3 + a]!).toBeLessThan(hi[g]![a]! + 2e-3);
        }
      }
    }
    expect([...meshes.keys()].filter((id) => id.endsWith("/break")).length).toBe(TIER_FORMS[tier]!.length);
  });
}

/** Yaws of a base: 17 degrees, and some through each quarter turn. */
const YAWS = [turnedBy(3095).yaw, 5461, 12345, 40000, 61234];

test("a built piece's fragments start where it was drawn at any base yaw and turn class", () => {
  const pose = new Float64Array(POSE.length), table = new FrameTable(), fit = new PieceFit(), bytes = new Uint8Array(INSTANCE_BYTES);
  let worst = 0, unskewed = 0, pieces = 0;
  const classes = new Set<string>();
  for (const yaw of YAWS) {
    const w = turnedWorld(4), reg = turnedRegistry(), sets = new BreakSets(reg);
    const built = [mixedHouse(new Base(w, 128, 128, yaw)), dodecagon(new Base(w, 160, 200, yaw))];
    for (const ref of built.flatMap((b) => b.refs)) {
      const t = w.structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, kind = t.kind[s]!, form = reg.forms!.def[kind]!;
      const set = sets.piece(kind)!, tw = t.twAt(s), tri = form.cls === "triangle";
      // The piece as the vertex programs place it: on its base's vectors, framed, nothing clamped.
      table.clear();
      const slot = table.add(t.yaw[s]!), word = pieceWord(slot, t.yaw[s]!, tw);
      bytes[12] = word & 255;
      bytes[13] = word >>> 8;
      bytes[PIECE_STATE_AT] = PIECE_FRAMED;
      bytes[PIECE_FIT_AT] = fitOfForm(form) & ~15;
      fit.begin(table, bytes, 0);
      const e: Broken = { cause: GONE_DESTROYED, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, tw, tri, ox: t.x[s]! + 1, oy: 1, oz: t.z[s]!, radius: 0, wait: 0, under: 0, set };
      const off = (): number => {
        let far = 0;
        set.groups.forEach((group, g) => {
          fragmentPose(e, g, 0, 0, pose);
          for (const chunk of group) for (const [x, y, z] of chunk.corners) {
            fit.vertex(x, y, z);
            const [dx, dy, dz] = [e.x + fit.c * fit.x + fit.s * fit.z, e.y + fit.y, e.z - fit.s * fit.x + fit.c * fit.z];
            far = Math.max(far, Math.hypot(pose[0]! * x + pose[1]! * y + pose[2]! * z + pose[3]! - dx, pose[4]! * x + pose[5]! * y + pose[6]! * z + pose[7]! - dy, pose[8]! * x + pose[9]! * y + pose[10]! * z + pose[11]! - dz));
          }
        });
        return far;
      };
      worst = Math.max(worst, off());
      if (tri) {
        e.tri = false;
        unskewed = Math.max(unskewed, off());
      }
      classes.add(`${form.cls} ${tw}`);
      pieces++;
    }
  }
  expect([...classes].sort()).toEqual(["edge 0", "edge 1", "edge 2", "square 0", "square 1", "square 2", "triangle 0", "triangle 1", "triangle 2"]);
  expect(worst).toBeLessThan(1e-5);
  // Before, a triangle's fragments left from its first axis turned 60 degrees: a hair off the base's own second axis.
  expect(unskewed).toBeGreaterThan(1e-4);
  if (process.env.SNARK_DRAW_TABLE) console.log(`built pieces' fragments before they let go, worst over ${pieces}: ${worst.toExponential(2)} m; a triangle unskewed ${unskewed.toExponential(2)} m`);
});

/** `n` walls in a row from (x, z) eastward, gone by `cause`. */
function walls(kind: number, n: number, x: number, z: number, cause: number): Rubble[] {
  return Array.from({ length: n }, (_, k): Rubble => ({ kind, x: x + 3 * k, y: 1.5, z, yaw: 0, tw: -1, cause, ox: x, oy: 1, oz: z, tick: 10, radius: cause === GONE_BLAST ? 6 : 0, into: 0, map: 0 }));
}

test("at most the cap of built pieces break at once, the nearest the eye first", () => {
  const reg = coreRegistry(), kind = reg.index.get("core:wall_wood")!;
  const falling = new Falling(reg.halfY, () => 0, { reg });
  // The eye at the row's east end: the walls nearest it break, the rest fall whole.
  const row = walls(kind, 200, 0, 0, GONE_BLAST), far = 3 * 199;
  falling.absorb(row, 1000, far, 2, 0, 10);
  const broken = Array.from({ length: falling.count }, (_, i) => i).filter((i) => falling.sets[i]);
  expect(falling.count).toBe(200);
  expect(broken.length).toBe(MOST_PIECE_BREAKS);
  expect(Math.min(...broken.map((i) => falling.x0[i]!))).toBe(3 * (200 - MOST_PIECE_BREAKS));
  // While those are in the air no more break; a wall that fell drops whole.
  falling.absorb([...walls(kind, 3, 0, 9, GONE_DESTROYED), ...walls(kind, 3, 0, 12, GONE_FELL)], 1100, far, 2, 0, 12);
  expect(Array.from({ length: falling.count }, (_, i) => i).filter((i) => falling.sets[i]).length).toBe(MOST_PIECE_BREAKS);
  // A tier with fewer bones keeps fewer.
  const small = new Falling(reg.halfY, () => 0, { reg });
  small.pieceMost = 8;
  small.absorb([...walls(kind, 20, 0, 0, GONE_DESTROYED), ...walls(kind, 5, 0, 6, GONE_FELL)], 1000, 0, 2, 0, 10);
  expect(Array.from({ length: small.count }, (_, i) => i).filter((i) => small.sets[i]).length).toBe(8);
});

/** A flat mesh of a piece's break, a vertex a corner of a face of each chunk on its group's bone, as a pack would hold it. */
function flatBreak(id: string, f: FormDef, tier: string): SourceMesh {
  const positions: number[] = [], indices: number[] = [], bones: number[] = [];
  pieceBreak(f, tier).forEach((group, g) => {
    for (const chunk of group) {
      const hull = hullOf({ corners: chunk });
      if (typeof hull === "string") throw new Error(hull);
      for (const ring of hull.rings) {
        const first = positions.length / 3;
        for (const c of ring) positions.push(...chunk[c]!), bones.push(g);
        for (let k = 2; k < ring.length; k++) indices.push(first, first + k - 1, first + k);
      }
    }
  });
  return { id, lods: [{ positions: Float32Array.from(positions), colors: new Uint8Array(bones.length).fill(REGION_BASE), indices: Uint32Array.from(indices), bones: Uint8Array.from(bones) }] };
}

/** A turned house drawn from grey boxes, with or without a break mesh for its stone walls, and a client's falling pieces over it. */
function brokenHouse(packed: boolean) {
  const w = turnedWorld(4), reg = turnedRegistry();
  const built = mixedHouse(new Base(w, 128, 128, YAWS[0]!));
  const meshes = grayboxMeshes(reg.defs.flatMap((d) => (d ? [d] : [])));
  if (packed) meshes.push(flatBreak("core:wall_stone/break", ROWS.wall!, "stone"));
  const pack = parsePack(buildPack(meshes, defaultPalette()));
  const scene = new Scene({ dims: w.dims, hf: w.hf, structs: w.structs }, reg, pack);
  scene.assets.tier = { ...tierOf("high"), split: 0 };
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.yaw, cam.pitch] = [128, 9, 146, Math.PI, -0.35];
  const falling = (scene.falling = new Falling(reg.halfY, () => 0, { reg, structs: w.structs }));
  const stats = (scene as unknown as { looseEntities: { fragmentStats: { fine: number; coarse: number; bones: number; draws: number } } }).looseEntities.fragmentStats;
  const gone = (ref: number, cause: number, tick: number): Rubble => {
    const t = w.structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff, kind = t.kind[s]!;
    const r: Rubble = { kind, x: t.x[s]!, y: t.y[s]!, z: t.z[s]!, yaw: t.yaw[s]!, tw: t.twAt(s), cause, ox: 128, oy: 1, oz: 128, tick, radius: cause === GONE_BLAST ? 8 : 0, into: 0, map: 0 };
    w.structs.remove(ref, cause);
    return r;
  };
  return { w, reg, built, pack, scene, cam, falling, stats, gone };
}

test("a destroyed wall is drawn from its pack's break mesh, a bone a group", () => {
  for (const packed of [false, true]) {
    const h = brokenHouse(packed), ref = h.built.walls[0]![0];
    h.scene.build(h.cam, null);
    h.falling.absorb([h.gone(ref, GONE_DESTROYED, 30)], 1000, h.cam.x, h.cam.y, h.cam.z, 30);
    h.falling.step(1100, 31.5);
    let p = h.scene.build(h.cam, null);
    for (let f = 0; f < 4; f++) p = h.scene.build(h.cam, null);
    const groups = h.falling.sets[0]!.groups.length, mesh = h.pack.header.meshes.findIndex((m) => m.id === "core:wall_stone/break");
    expect([h.stats.fine, h.stats.coarse, h.stats.bones]).toEqual([1, 0, groups]);
    const ours = [...Array(p.drawCount).keys()].filter((d) => p.drawMesh[d] === mesh && (p.drawFlags[d]! & DRAW_SKINNED) !== 0);
    expect(ours.length > 0, packed ? "drawn from the pack" : "drawn from a set made on the client").toBe(packed);
  }
});

test("a wall that fell drops whole, and a blasted one breaks", () => {
  const h = brokenHouse(true), [fell, blasted] = [h.built.walls[1]![0], h.built.walls[2]![0]];
  h.falling.absorb([h.gone(fell, GONE_FELL, 30), h.gone(blasted, GONE_BLAST, 30)], 1000, h.cam.x, h.cam.y, h.cam.z, 30);
  expect([h.falling.sets[0], (h.falling.sets[1]?.key ?? 0) % 4]).toEqual([null, SET_PIECE]);
});

test.skipIf(!PACKED.every((tier) => existsSync(join(SOURCE, "core/structures", tier, `${tier}.snpk`))))("a blast of 256 built pieces holds the fragments' budgets on each tier", () => {
  // Pieces kept in fragments, and what they may add to the worst frame: triangles, and draws, which the tier's own cap holds too.
  const budgets = { lowpoly: [32, 6000, 16], medium: [64, 12000, 24], high: [64, 12000, 24] } as const;
  for (const [name, [pieces, triangles, draws]] of Object.entries(budgets)) {
    const r = pieceBreakRows(name);
    expect([r.kept, r.shown], name).toEqual([pieces, pieces]);
    expect(r.triangles, name).toBeLessThanOrEqual(triangles);
    expect(r.draws, name).toBeLessThanOrEqual(draws);
    if (process.env.SNARK_DRAW_TABLE) console.log(`${name}: ${r.kept} in fragments, ${r.triangles} triangles and ${r.draws} draws added; the pass ${r.median.toFixed(3)} ms median, ${r.worst.toFixed(3)} worst`);
  }
});
