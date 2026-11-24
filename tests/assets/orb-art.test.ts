// The orb's pack (assets/source/core/structures/orb): the shell its own pass paints, and the plinth it stands in.
// The pack is in git, so these run without the art release.

import { expect, test } from "bun:test";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { checkAsset } from "../../tools/art/check.ts";
import { unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";

const asset = (await findAssets()).find((a) => a.id === "core:orb")!;
const file = await Bun.file(asset.file).bytes();
const pack = parsePack(file);
const meshes = unpackMeshes(pack);
const shell = meshes.find((m) => m.id === "core:orb/shell")!;
const plinth = meshes.find((m) => m.id === "core:orb/plinth")!;
/** Metres: the sphere, how far under its centre the shell stops, and how far under it the ground is. */
const RADIUS = 78;
const CUT = 40;
const GROUND = 34;
/** A point is stored to 2.4 mm on each axis of a mesh 156 m across. */
const STEP = 0.01;

/** A level's points as [x, y, z], y up. */
const points = (lod: SourceLod): number[][] => Array.from({ length: lod.positions.length / 3 }, (_, v) => [...lod.positions.subarray(v * 3, v * 3 + 3)]);
const triangles = (lod: SourceLod): number => lod.indices.length / 3;

/** The furthest the middle of an edge above the ground lies inside the sphere: how far the outline strays from round. */
function strays(lod: SourceLod): number {
  const at = points(lod);
  let most = 0;
  for (let t = 0; t < lod.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = at[lod.indices[t + k]!]!, b = at[lod.indices[t + ((k + 1) % 3)]!]!;
      if (Math.min(a[1]!, b[1]!) < -GROUND) continue;
      most = Math.max(most, RADIUS - Math.hypot((a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2, (a[2]! + b[2]!) / 2));
    }
  }
  return most;
}

test("the packed orb passes the art check and is under 60 KB", () => {
  expect(checkAsset(asset, pack, true).faults).toEqual([]);
  expect(file.length).toBeLessThan(60_000);
});

test("the pack holds the shell and the plinth, three flat levels each, within budget", () => {
  expect(meshes.map((m) => m.id).sort()).toEqual(["core:orb/plinth", "core:orb/shell"]);
  for (const [mesh, most] of [[shell, [6000, 1400, 400]], [plinth, [600, 240, 80]]] as const) {
    expect(mesh.lods.length).toBe(3);
    mesh.lods.forEach((lod, level) => expect([mesh.id, level, triangles(lod) <= most[level]!]).toEqual([mesh.id, level, true]));
    // No pictures and no texture coordinates: the shell's program needs none, and the plinth is lit flat.
    expect([mesh.flat ?? 0, mesh.materials ?? [], mesh.lods.some((lod) => lod.uvs !== undefined)]).toEqual([0, [], false]);
  }
  // From far off the two together are a few hundred triangles.
  expect(triangles(shell.lods[2]!) + triangles(plinth.lods[2]!)).toBeLessThan(400);
});

test("every point of the shell is on the sphere of radius 78, and none is under the cut", () => {
  for (const lod of shell.lods) {
    const at = points(lod);
    for (const p of at) {
      expect(Math.abs(Math.hypot(p[0]!, p[1]!, p[2]!) - RADIUS)).toBeLessThan(2 * STEP);
      expect(p[1]!).toBeGreaterThan(-CUT - STEP);
    }
    // It runs from its top down to the cut, which is under the ground.
    const heights = at.map((p) => p[1]!);
    expect(Math.max(...heights)).toBeCloseTo(RADIUS, 1);
    expect(Math.min(...heights)).toBeCloseTo(-CUT, 1);
  }
});

test("the shell's outline stays round: its edges stray more only as its levels coarsen", () => {
  const [near, middle, far] = shell.lods.map(strays) as [number, number, number];
  expect(near).toBeLessThan(0.1);
  expect(middle).toBeGreaterThan(near);
  expect(middle).toBeLessThan(0.25);
  expect(far).toBeGreaterThan(middle);
  expect(far).toBeLessThan(1.1);
  // A level is drawn once its error passes for the distance, so the errors must rise with the straying.
  const errors = pack.header.meshes.find((m) => m.id === shell.id)!.lods.map((l) => l.error);
  expect([errors[0], errors[1]! > 0, errors[2]! > errors[1]!]).toEqual([0, true, true]);
});

test("the plinth stands on the ground about the axis, low, with its foot under the ground", () => {
  for (const lod of plinth.lods) {
    const at = points(lod);
    const heights = at.map((p) => p[1]!);
    expect(Math.min(...heights)).toBeLessThan(-0.5);
    expect(Math.max(...heights)).toBeGreaterThan(5);
    expect(Math.max(...heights)).toBeLessThanOrEqual(6);
    // Its ring is about the axis: as far one way as the other.
    for (const k of [0, 2]) expect(Math.max(...at.map((p) => p[k]!)) + Math.min(...at.map((p) => p[k]!))).toBeCloseTo(0, 1);
  }
});

test("the plinth's wall is outside the sphere's foot and its roof runs in under the screen", () => {
  const at = points(plinth.lods[0]!);
  // The sphere meets the ground 70.2 m out. The wall's foot is about 76 m out, and nothing of the plinth is inside the foot.
  const foot = Math.sqrt(RADIUS ** 2 - GROUND ** 2);
  const wall = at.filter((p) => p[1]! < 3 && Math.hypot(p[0]!, p[2]!) < 78).map((p) => Math.hypot(p[0]!, p[2]!));
  expect(Math.min(...wall)).toBeGreaterThan(73);
  expect(Math.max(...wall)).toBeLessThan(77);
  expect(Math.min(...at.map((p) => Math.hypot(p[0]!, p[2]!)))).toBeGreaterThan(foot);
  // At every level the roof's inner corners are inside the sphere at their height, so no gap shows between the two.
  for (const lod of plinth.lods) {
    const top = Math.max(...points(lod).map((p) => p[1]!));
    const inner = points(lod).filter((p) => p[1]! > top - STEP).map((p) => Math.hypot(p[0]!, p[2]!));
    expect(Math.min(...inner)).toBeLessThan(Math.sqrt(RADIUS ** 2 - (GROUND - top) ** 2) - 0.5);
  }
});

test("a flat canopy faces each cardinal direction", () => {
  // Only the canopies reach past 78 m, each about one of the four axes.
  const out = points(plinth.lods[0]!).filter((p) => Math.hypot(p[0]!, p[2]!) > 78);
  const sides = new Set(out.map((p) => (Math.abs(p[0]!) > Math.abs(p[2]!) ? (p[0]! > 0 ? "+x" : "-x") : p[2]! > 0 ? "+z" : "-z")));
  expect([...sides].sort()).toEqual(["+x", "+z", "-x", "-z"]);
  for (const p of out) {
    expect(Math.min(Math.abs(p[0]!), Math.abs(p[2]!))).toBeLessThan(6);
    expect(p[1]!).toBeGreaterThan(3);
    expect(p[1]!).toBeLessThan(4);
  }
});
