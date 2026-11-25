// What a base's own walls and ceilings hide (client/core/render/base-occluders.ts): which pieces may be plates and that
// their meshes are closed at every level, where the plates lie, that a wall's going takes its plate in that frame, and
// that over random bases, cameras and removals a frame with plates is the picture of the frame without them.

import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { BasePlates, PLATE_SLAB, PLATE_WALL } from "../../client/core/render/base-occluders.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { OCCLUDER } from "../../client/core/render/hide.ts";
import { Scene } from "../../client/core/render/scene.ts";
import "../../client/core/render/city-late.ts";
import { RemoteSample } from "../../client/core/session.ts";
import { FORMS } from "../../content/building/forms.ts";
import type { Registry } from "../../shared/content/registry.ts";
import { MATERIAL_BLEND, MATERIAL_CUTOUT, parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { Rng } from "../../shared/rng.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE } from "../../shared/world/lattice/module.ts";
import type { StructureStore } from "../../shared/world/structures.ts";
import { grayboxMeshes, withArt } from "../../tools/pack/build.ts";
import { bakeMetal } from "../../tools/pack/pieces/metal.ts";
import { STONE } from "../../tools/pack/pieces/stone.ts";
import { tierShapes } from "../../tools/pack/pieces/tier.ts";
import { WOOD } from "../../tools/pack/pieces/wood.ts";
import { buildPack, unpackMeshes, type SourceLod, type SourceMesh } from "../../tools/pack/write.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { artTest } from "../fixtures/needs-art.ts";
import { corePack } from "../fixtures/pack.ts";
import { baseAt, batchesOf, putAt, standInTrims } from "../fixtures/trims.ts";
import { turnedRegistry, turnedWorld } from "../fixtures/turned.ts";
import { coreRegistry } from "../fixtures/world.ts";

/** A level of a mesh set down with its origin at a place. */
type Set = readonly [lod: SourceLod, at: readonly number[]];

/** How far along the ray from `o` along `d` it first meets a triangle of `set` that faces its start, or Infinity. */
function firstFacing(set: readonly Set[], o: readonly number[], d: readonly number[]): number {
  let best = Infinity;
  for (const [lod, at] of set) {
    const p = lod.positions, ix = lod.indices;
    const ox = o[0]! - at[0]!, oy = o[1]! - at[1]!, oz = o[2]! - at[2]!;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3;
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
      const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const den = nx * d[0]! + ny * d[1]! + nz * d[2]!;
      if (den >= -1e-12) continue;
      const k = (nx * (p[a]! - ox) + ny * (p[a + 1]! - oy) + nz * (p[a + 2]! - oz)) / den;
      if (k < 0 || k >= best) continue;
      const x = ox + d[0]! * k, y = oy + d[1]! * k, z = oz + d[2]! * k;
      let inside = true;
      for (let e = 0; e < 3 && inside; e++) {
        const i = ix[t + e]! * 3, j = ix[t + ((e + 1) % 3)]! * 3;
        const ex = p[j]! - p[i]!, ey = p[j + 1]! - p[i + 1]!, ez = p[j + 2]! - p[i + 2]!;
        inside = (ey * (z - p[i + 2]!) - ez * (y - p[i + 1]!)) * nx + (ez * (x - p[i]!) - ex * (z - p[i + 2]!)) * ny + (ex * (y - p[i + 1]!) - ey * (x - p[i]!)) * nz >= -1e-9;
      }
      if (inside) best = k;
    }
  }
  return best;
}

/** A plate is shrunk this much (base-occluders.ts), and a piece's slot ends this far from its middle. */
const SHRINK = 0.03;
const END = 1.4995;
/** A face a millimetre behind the sheet is the sheet's: a thing is hidden only 2 cm behind a plate. */
const BEHIND = 0.001;

/**
 * Of `rays` lines of sight through the middle sheet of the piece at the origin, from both sides and up to 80 degrees off
 * square: how many reach the sheet with no face of `set` turned to them met first. A wall's sheet is its own z = 0, a
 * ceiling's its own y = 0, and across it a ray goes through (u, v), each `near` an end of its span or anywhere in it.
 */
function seenThrough(set: readonly Set[], wall: boolean, rng: Rng, rays: number, u: readonly [number, number], v: readonly [number, number], near: number): number {
  const pick = (span: readonly [number, number]): number => (near > 0 && rng.int(2) === 0 ? (rng.int(2) === 0 ? span[0] + rng.range(0, near) : span[1] - rng.range(0, near)) : rng.range(span[0], span[1]));
  let through = 0;
  for (let n = 0; n < rays; n++) {
    const a = pick(u), b = pick(v), side = n & 1 ? 1 : -1;
    const tilt = rng.range(0, 1.4), round = rng.range(0, Math.PI * 2);
    const dn = -side * Math.cos(tilt), da = Math.sin(tilt) * Math.cos(round), db = Math.sin(tilt) * Math.sin(round);
    const at = wall ? [a, b, 0] : [a, 0, b], dir = wall ? [da, db, dn] : [da, dn, db];
    if (firstFacing(set, at.map((c, i) => c - dir[i]! * 10), dir) > 10 + BEHIND) through++;
  }
  return through;
}

/** The kinds that may be plates, each with what it is and whether its rows are one plate with those over them. */
function plated(reg: Registry): [id: string, what: number, stacks: number][] {
  const plates = new BasePlates(reg);
  return reg.defs.flatMap((d, k): [string, number, number][] => (d && plates.plate[k] ? [[d.id, plates.plate[k]!, plates.stacks[k]!]] : []));
}

test("stone's wall and ceiling and metal's wall may be plates, and only metal's stack", () => {
  expect(plated(coreRegistry()).sort()).toEqual([["core:ceiling_stone", PLATE_SLAB, 0], ["core:wall_metal", PLATE_WALL, 1], ["core:wall_stone", PLATE_WALL, 0]]);
});

/**
 * Holds each kind that may be a plate to a mesh among `meshes` that nothing is seen through, drawn with no cut-out:
 * each level alone, over its slot less what a plate is shrunk by; each level with any level beside it, across the
 * whole of its slot that way; and where its rows are one plate with those over them, with any level over and under it.
 */
function closed(meshes: readonly SourceMesh[], where: string): void {
  const by = new Map(meshes.map((m) => [m.id, m] as const));
  const rng = new Rng(11);
  const [whole, less]: [number, number][] = [[-END, END], [-1.5 + SHRINK, 1.5 - SHRINK]];
  for (const [id, what, stacks] of plated(coreRegistry())) {
    const mesh = by.get(id), wall = what === PLATE_WALL;
    expect(mesh, `${where} has ${id}`).toBeDefined();
    for (const m of mesh!.materials ?? []) expect(m.flags & (MATERIAL_CUTOUT | MATERIAL_BLEND), `${where} ${id} ${m.id}`).toBe(0);
    mesh!.lods.forEach((lod, level) => {
      expect(seenThrough([[lod, [0, 0, 0]]], wall, rng, 4000, less!, less!, SHRINK), `${where} ${id} level ${level} alone`).toBe(0);
      mesh!.lods.forEach((other, beside) => {
        // A wall's neighbours stand along its x; a ceiling's along both, and at its corners.
        const round = [-3, 0, 3].flatMap((a) => (wall ? [[a, 0, 0]] : [-3, 0, 3].map((b) => [a, 0, b]))).filter((at) => at.some((c) => c !== 0));
        const set: Set[] = [[lod, [0, 0, 0]], ...round.map((at): Set => [other, at])];
        expect(seenThrough(set, wall, rng, 1500, whole!, wall ? less! : whole!, 2 * SHRINK), `${where} ${id} level ${level} beside level ${beside}`).toBe(0);
        if (stacks === 0) return;
        const over: Set[] = [[lod, [0, 0, 0]], ...[-3, 0, 3].flatMap((a) => [-3, 0, 3].map((b) => [a, b, 0])).filter((at) => at.some((c) => c !== 0)).map((at): Set => [other, at])];
        expect(seenThrough(over, true, rng, 1500, whole!, whole!, 2 * SHRINK), `${where} ${id} level ${level} among level ${beside}`).toBe(0);
      });
    });
  }
}

test("the recipes' meshes are closed about their middle, alone and side by side", () => {
  closed([...tierShapes(STONE, FORMS), ...bakeMetal(FORMS)], "the recipes");
});

artTest("the installed meshes are closed about their middle, alone and side by side", () => {
  closed(unpackMeshes(corePack()), "the installed pack");
});

let made: Pack | null = null;
/** The turned fixtures' kinds as grey boxes, with stone, metal and wood as their recipes make them, and stone's stand-in trims with `trims`. */
function pack(trims = false): Pack {
  const build = (extra: readonly SourceMesh[]): Pack => parsePack(buildPack(withArt(grayboxMeshes(turnedRegistry().defs.flatMap((d) => (d ? [d] : []))), [...tierShapes(STONE, FORMS), ...tierShapes(WOOD, FORMS), ...bakeMetal(FORMS), ...extra]), defaultPalette()));
  return trims ? build(standInTrims("stone")) : (made ??= build([]));
}

const O = [0, 0, 0, 0] as const;
const sq = (i: number, j: number): number[] => [2 * i, 0, 0, 2 * j];

/** A world with one scene that hides by plates and one that does not, each drawn by a rasterizer of its own. */
function world(width: number, height: number, tier = "lowpoly", trims = false) {
  const w = turnedWorld(4);
  const reg = w.reg;
  const scenes = [true, false].map((plating) => {
    const scene = new Scene({ dims: w.dims, hf: w.hf, structs: w.structs }, reg, pack(trims));
    scene.assets.tier = { ...tierOf(tier), split: 0 };
    scene.plating = plating;
    return { scene, raster: new Rasterizer(width, height, pack(trims), w.hf) };
  });
  const cam = new Camera();
  cam.aspect = width / height;
  const remote = new RemoteSample();
  /** Draws a frame in both scenes from the camera: how many pixels differ, and what the plates hid. */
  const look = (settle = 2): { differ: number; hidden: number; occluders: number; tris: number[] } => {
    const tris: number[] = [];
    for (const { scene, raster } of scenes) {
      for (let f = 0; f < settle; f++) raster.take(scene.build(cam, remote));
      const p = scene.build(cam, remote);
      raster.render(p);
      tris.push(p.triangles);
    }
    const [a, b] = [scenes[0]!.raster.color, scenes[1]!.raster.color];
    let differ = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differ++;
    const stats = scenes[0]!.scene.hiding.stats;
    return { differ, hidden: scenes[0]!.scene.hiding.on ? stats.hidden : 0, occluders: scenes[0]!.scene.hiding.on ? stats.occluders : 0, tris };
  };
  const plates = (): number[][] => [...batchesOf(scenes[0]!.scene).values()].flatMap((b) => Array.from({ length: b.plates.length / OCCLUDER }, (_, k) => Array.from(b.plates.subarray(k * OCCLUDER, (k + 1) * OCCLUDER))));
  return { w, reg, structs: w.structs as StructureStore, cam, remote, look, plates, scenes };
}

/** Each plate as its two ends on the ground and its foot and top, to the millimetre, sorted: a wall's along its row, a ceiling's across its corners. */
function spans(plates: readonly number[][]): number[][] {
  const cm = (v: number): number => Math.round(v * 1000) / 1000;
  return plates.map(([x, y, z, hx, hy, hz, c, s]) => [cm(x! - c! * hx! - s! * hz!), cm(z! + s! * hx! - c! * hz!), cm(x! + c! * hx! + s! * hz!), cm(z! - s! * hx! + c! * hz!), cm(y! - hy!), cm(y! + hy!)]).sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]! || p[4]! - q[4]!);
}

test("a row of walls is a plate, a doorway parts it, and metal's storeys are one", () => {
  const { w, reg, structs, cam, look, plates } = world(96, 54);
  const f = baseAt(structs, 100, 0.375, 100, 0);
  for (let i = 0; i < 4; i++) putAt(structs, reg, f, "core:foundation_stone", CLS_SQUARE, sq(i, 0), 0, 0);
  // A front of four walls on two storeys, the second of the lower ones a doorway with its door; behind, a row of wood.
  for (const lvl of [0, 4]) for (let i = 0; i < 4; i++) putAt(structs, reg, f, lvl === 0 && i === 1 ? "core:doorframe_stone" : "core:wall_stone", CLS_EDGE, sq(i, 0), 0, lvl);
  putAt(structs, reg, f, "core:door_stone", CLS_EDGE, sq(1, 0), 0, 0);
  for (let i = 0; i < 4; i++) putAt(structs, reg, f, "core:wall_wood", CLS_EDGE, sq(i, 1), 0, 0);
  for (let i = 0; i < 4; i++) putAt(structs, reg, f, "core:ceiling_stone", CLS_SQUARE, sq(i, 0), 0, 8);
  // A second base: two metal walls on two storeys, with a wooden ceiling.
  const g = baseAt(structs, 100, 0.375, 120, 0);
  for (let i = 0; i < 2; i++) {
    putAt(structs, reg, g, "core:foundation_metal", CLS_SQUARE, sq(i, 0), 0, 0);
    for (const lvl of [0, 4]) putAt(structs, reg, g, "core:wall_metal", CLS_EDGE, sq(i, 0), 0, lvl);
    putAt(structs, reg, g, "core:ceiling_wood", CLS_SQUARE, sq(i, 0), 0, 8);
  }
  [cam.x, cam.y, cam.z, cam.yaw] = [106, 2, 80, 0];
  look();
  // Stone: the lower row either side of the doorway, the upper row whole, and the ceilings. Metal: both storeys as one. Each 3 cm in from its edge.
  expect(spans(plates())).toEqual([
    [100.03, 100, 102.97, 100, 0.405, 3.345],
    [100.03, 100, 111.97, 100, 3.405, 6.345],
    [100.03, 100.03, 111.97, 102.97, 6.25, 6.25],
    [100.03, 120, 105.97, 120, 0.405, 6.345],
    [106.03, 100, 111.97, 100, 0.405, 3.345],
  ]);
  expect(w.kind("core:wall_wood")).toBeGreaterThan(0);
});

test("a wall 30 degrees round in a base at an odd yaw has its plate along it", () => {
  const { reg, structs, cam, look, plates } = world(96, 54);
  // Two walls end to end along the base's 30 degree direction, on triangles' sides.
  const f = baseAt(structs, 100, 0.375, 100, 4000);
  for (const [a, d] of [[O, 1], [[0, 2, 0, 0], 1]] as const) {
    putAt(structs, reg, f, "test:triangle_foundation", CLS_TRIANGLE, a, d, 0);
    putAt(structs, reg, f, "core:wall_stone", CLS_EDGE, a, d, 0);
  }
  [cam.x, cam.y, cam.z, cam.yaw] = [100, 2, 80, 0];
  look();
  const [plate] = plates();
  expect(plates().length).toBe(1);
  // From the base's corner 6 m along its 30 degree direction, which lies that far from its own +X toward +Z, to the lattice's own rounding.
  const turn = Math.PI / 6 - (4000 / 65536) * 2 * Math.PI;
  const [x, , z, hx, hy, , c, s] = plate!;
  expect(Math.hypot(x! - (100 + 3 * Math.cos(turn)), z! - (100 + 3 * Math.sin(turn)))).toBeLessThan(0.01);
  expect([Math.abs(hx! - 2.97) < 0.01, Math.abs(hy! - 1.47) < 1e-9, Math.abs(c! - Math.cos(turn)) < 0.002, Math.abs(s! + Math.sin(turn)) < 0.002]).toEqual([true, true, true, true]);
});

test("a wall that gives way to a joint is a plate by itself, cut back by what it gives", () => {
  const { reg, structs, cam, look, plates } = world(96, 54, "lowpoly", true);
  const f = baseAt(structs, 100, 0.375, 100, 0);
  // A corner: the walls end at a joint and give way to it, and their far ends are free.
  putAt(structs, reg, f, "core:foundation_stone", CLS_SQUARE, O, 0, 0);
  putAt(structs, reg, f, "core:wall_stone", CLS_EDGE, O, 0, 0);
  putAt(structs, reg, f, "core:wall_stone", CLS_EDGE, O, 3, 0);
  [cam.x, cam.y, cam.z, cam.yaw] = [106, 2, 80, 0];
  look();
  expect(spans(plates())).toEqual([[100, 100.13, 100, 102.87, 0.405, 3.345], [100.13, 100, 102.87, 100, 0.405, 3.345]]);
});

test("a wall that goes takes its plate in that frame, and what it hid is drawn", () => {
  const { reg, structs, cam, remote, look, plates } = world(160, 90);
  const f = baseAt(structs, 100, 0.375, 100, 0);
  const walls: number[] = [];
  for (let i = 0; i < 3; i++) {
    putAt(structs, reg, f, "core:foundation_stone", CLS_SQUARE, sq(i, 0), 0, 0);
    walls.push(putAt(structs, reg, f, "core:wall_stone", CLS_EDGE, sq(i, 0), 0, 0));
  }
  // A body close behind the middle wall, and the camera square to it.
  remote.count = 1;
  [remote.id[0], remote.kind[0], remote.x[0], remote.y[0], remote.z[0], remote.flags[0]] = [7, reg.index.get("core:dodo")!, 104.5, 0.4, 101, 1];
  [cam.x, cam.y, cam.z, cam.yaw] = [104.5, 1.2, 94, 0];
  const before = look();
  expect([before.differ, before.hidden > 0, plates().length]).toEqual([0, true, 1]);
  structs.remove(walls[1]!);
  // No frame to settle: the frame after the wall went is the one compared.
  const after = look(0);
  expect([after.differ, plates().length]).toEqual([0, 2]);
  expect(after.tris[0]).toBe(after.tris[1]!);
  expect(before.tris[0]).toBeLessThan(before.tris[1]!);
});

/** A base of rooms `nx` by `nz` on `storeys` storeys in `tier`, set down by key, with boxes and bodies in and round it: what stands, to be taken up and put back. */
function fort(structs: StructureStore, reg: Registry, rng: Rng, x: number, z: number, yaw: number, tier: string, nx: number, nz: number, storeys: number): { put: (() => number)[]; refs: Map<number, number> } {
  const f = baseAt(structs, x, 0.375, z, yaw);
  const put: (() => number)[] = [];
  const piece = (id: string, cls: number, a: readonly number[], d: number, lvl: number): void => void put.push(() => putAt(structs, reg, f, id, cls, a, d, lvl));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) piece(`core:foundation_${tier}`, CLS_SQUARE, sq(i, j), 0, 0);
  for (let s = 0; s < storeys; s++) {
    for (let line = 0; line <= Math.max(nx, nz); line++) {
      for (let c = 0; c < Math.max(nx, nz); c++) {
        for (const [a, d, outer, fits] of [[sq(c, line), 0, line === 0 || line === nz, c < nx && line <= nz], [sq(line, c), 3, line === 0 || line === nx, c < nz && line <= nx]] as const) {
          if (!fits || (!outer && rng.int(3) > 0)) continue;
          const pick = rng.int(14);
          const form = pick === 0 ? "doorframe" : pick === 1 && tier !== "thatch" ? "windowframe" : "wall";
          piece(`core:${form}_${tier}`, CLS_EDGE, a, d, 4 * s);
          if (form === "doorframe") piece(`core:door_${tier}`, CLS_EDGE, a, d, 4 * s);
        }
      }
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) piece(`core:ceiling_${tier}`, CLS_SQUARE, sq(i, j), 0, 4 * s + 4);
  }
  const refs = new Map<number, number>();
  put.forEach((set, k) => refs.set(k, set()));
  return { put, refs };
}

// Over random bases, cameras and removals a frame with plates is the picture of the frame without them: on three tiers, and with stone's walls giving way to stand-in joints.
for (const [seed, tier, trims] of [[1, "lowpoly", false], [2, "medium", false], [3, "lowpoly", true], [4, "high", false]] as const) {
  test(`plates change no pixel over random bases, cameras and removals: ${tier}${trims ? ", trims" : ""}`, () => {
    let frames = 0, hidden = 0, withPlates = 0, saved = 0, near = 0;
    const { reg, structs, cam, remote, look, plates } = world(240, 135, tier, trims);
    const rng = new Rng(seed);
    // Stone and metal bases along the lattice and at odd yaws, a wooden one among them, and a mixed one of every turn class.
    const forts = [
      fort(structs, reg, rng, 96, 96, 0, "stone", 4, 3, 2),
      fort(structs, reg, rng, 124, 100, 7000 + 911 * seed, "stone", 3, 3, 3),
      fort(structs, reg, rng, 100, 124, 0, "metal", 3, 2, 2),
      fort(structs, reg, rng, 126, 128, 30000 + 77 * seed, "wood", 3, 3, 1),
      fort(structs, reg, rng, 70, 110, 12345, "stone", 2, 5, 1),
    ];
    const mixed = baseAt(structs, 112, 0.375, 112, 3000 * seed);
    const mixedRefs: (() => number)[] = [];
    for (let k = 0; k < 6; k++) {
      // Six triangles round a corner, a stone wall on each one's outer side, of every turn class.
      const corner = [0, 1, 2, 3].map((i) => 2 * [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 1, 0, 0, -1, 0, 1, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 1, 0, -1, 0, 0, 1, 0, -1][((2 * k) % 12) * 4 + i]!);
      putAt(structs, reg, mixed, "test:triangle_foundation", CLS_TRIANGLE, O, 2 * k, 0);
      mixedRefs.push(() => putAt(structs, reg, mixed, "core:wall_stone", CLS_EDGE, corner, (2 * k + 4) % 12, 0));
    }
    const mixedStanding = mixedRefs.map((set) => set());
    // Bodies and boxes in and round the bases: what a plate may hide.
    const dodo = reg.index.get("core:dodo")!, box = reg.index.get("core:storage_box")!;
    remote.count = 160;
    for (let n = 0; n < remote.count; n++) [remote.id[n], remote.kind[n], remote.x[n], remote.y[n], remote.z[n], remote.yaw[n], remote.flags[n]] = [100 + n, dodo, rng.range(60, 140), rng.int(3) === 0 ? 0.375 + 3 * rng.int(3) : 0, rng.range(86, 140), rng.range(0, 6), 1];
    for (let n = 0; n < 60; n++) structs.add(box, rng.range(60, 140), 0.3 + (rng.int(3) === 0 ? 0.375 + 3 * rng.int(2) : 0), rng.range(86, 140), rng.int(65536), 1, 100);
    for (let step = 0; step < 80; step++, frames++) {
      // Now and then a piece goes or comes back, or a door turns.
      for (let n = rng.int(3); step > 0 && n > 0; n--) {
        const which = rng.int(forts.length + 1);
        if (which === forts.length) {
          const k = rng.int(mixedRefs.length);
          if (mixedStanding[k]! >= 0) {
            structs.remove(mixedStanding[k]!);
            mixedStanding[k] = -1;
          } else mixedStanding[k] = mixedRefs[k]!();
          continue;
        }
        const { put, refs } = forts[which]!, k = rng.int(put.length), ref = refs.get(k);
        if (ref === undefined) {
          try {
            refs.set(k, put[k]!());
          } catch {
            // Its place is taken, or what held it is gone.
          }
        } else {
          const t = structs.chunks[Math.floor(ref / 65536)]!, kind = t.kind[ref & 0xffff]!;
          if (reg.opens[kind] !== 0 && rng.int(2) === 0) structs.swap(ref, reg.opens[kind]!);
          else {
            structs.remove(ref);
            refs.delete(k);
          }
        }
      }
      // From outside at any height, from close against a wall, or from inside a base, toward a place among the bases.
      const mode = rng.int(8);
      const [tx, tz] = [rng.range(80, 130), rng.range(92, 132)];
      if (mode === 0) [cam.x, cam.y, cam.z] = [96 + rng.range(0.4, 11.6), 0.375 + 3 * rng.int(2) + rng.range(0.3, 2.6), 96 + rng.range(0.4, 8.6)];
      else if (mode === 1) [cam.x, cam.y, cam.z] = [96 + rng.range(-0.6, 12.6), rng.range(0.6, 6), 96 + (rng.int(2) === 0 ? rng.range(-0.6, 0.6) : 9 + rng.range(-0.6, 0.6))];
      else [cam.x, cam.y, cam.z] = [tx + rng.range(-70, 70), mode === 2 ? rng.range(12, 50) : rng.range(0.5, 9), tz + rng.range(-70, 70)];
      if (mode === 1) near++;
      [cam.yaw, cam.pitch] = [Math.atan2(tx - cam.x, tz - cam.z), Math.atan2(rng.range(0, 6) - cam.y, Math.hypot(tx - cam.x, tz - cam.z))];
      const got = look(step === 0 ? 4 : 1);
      expect(got.differ, `seed ${seed} step ${step}: camera ${cam.x.toFixed(2)} ${cam.y.toFixed(2)} ${cam.z.toFixed(2)} yaw ${cam.yaw.toFixed(3)} pitch ${cam.pitch.toFixed(3)}`).toBe(0);
      hidden += got.hidden;
      if (got.occluders > 0) withPlates++;
      if (got.tris[0]! < got.tris[1]!) saved++;
    }
    expect(plates().length).toBeGreaterThan(8);
    // The plates were in most frames, hid things in many, and the camera stood against walls.
    expect([frames, withPlates > 50, saved > 20, hidden > 300, near > 2], `${withPlates} with plates, ${saved} drew less, ${hidden} hidden, ${near} near`).toEqual([80, true, true, true, true]);
  });
}

// Metal's new forms (large_wall, half_wall, quarter_wall): the walls among them that close an edge are as opaque as
// its wall, so a plate could stand in each. BasePlates gives none yet: it names a full wall a storey high on one edge.

import { PLANNED_FORMS } from "../../content/building/forms.ts";

test("metal's large wall and low walls are closed about their middle at every level, beside a wall and under and over one", () => {
  const meshes = new Map(bakeMetal({ ...FORMS, ...PLANNED_FORMS }).map((m) => [m.id.slice(5, -6), m] as const));
  const rng = new Rng(17);
  const wall = meshes.get("wall")!;
  // Each by half its height about its origin, and the walls that stand in the cells round it.
  for (const [name, half] of [["large_wall", 6], ["half_wall", 0.75], ["quarter_wall", 0.375]] as const) {
    const mesh = meshes.get(name)!;
    const [across, up]: [number, number][] = [[-END, END], [-half + 0.0005, half - 0.0005]];
    mesh.lods.forEach((lod, level) => {
      expect(seenThrough([[lod, [0, 0, 0]]], true, rng, 4000, [-1.5 + SHRINK, 1.5 - SHRINK], [-half + SHRINK, half - SHRINK], SHRINK), `${name} level ${level} alone`).toBe(0);
      wall.lods.forEach((other, beside) => {
        // Walls a storey high beside it for its whole height, and one under it and one over it: its top is the foot of the wall above.
        const storeys = Array.from({ length: Math.ceil((2 * half) / 3) + 2 }, (_, i) => -half - 1.5 + 3 * i);
        const set: Set[] = [[lod, [0, 0, 0]], ...storeys.flatMap((y): Set[] => [[other, [-3, y, 0]], [other, [3, y, 0]]]), [other, [0, -half - 1.5, 0]], [other, [0, half + 1.5, 0]]];
        expect(seenThrough(set, true, rng, 1500, across!, up!, 2 * SHRINK), `${name} level ${level} among walls of level ${beside}`).toBe(0);
        mesh.lods.forEach((same, next) => {
          const row: Set[] = [[lod, [0, 0, 0]], [same, [-3, 0, 0]], [same, [3, 0, 0]], [other, [0, -half - 1.5, 0]], [other, [0, half + 1.5, 0]]];
          if (beside === 0) expect(seenThrough(row, true, rng, 1500, across!, up!, 2 * SHRINK), `${name} level ${level} in a row of level ${next}`).toBe(0);
        });
      });
    });
  }
});
