import { expect, test } from "bun:test";
import { CORE_CONTENT } from "../../content/core.ts";
import { B_PROP_R, HUMAN } from "../../shared/anim/human.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { findAssets } from "../../tools/art/assets.ts";
import { checkAsset } from "../../tools/art/check.ts";
import { unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";

const asset = (await findAssets()).find((a) => a.id === "core:launcher")!;
const pack = parsePack(await Bun.file(asset.file).bytes());
const meshes = unpackMeshes(pack);
const launcher = meshes.find((m) => m.id === "core:rocket_launcher")!;
const round = meshes.find((m) => m.id === "core:rocket_round")!;
const item = CORE_CONTENT.find((d) => d.type === "item" && d.id === "core:rocket_launcher")!;
const weapon = (item as { weapon: { muzzle: readonly number[]; vent: readonly number[]; round: readonly number[] } }).weapon;
/** A storage step of a mesh a metre long, and a little more. */
const STEP = 0.001;

/** A level's points as [x, y, z]. */
const points = (lod: SourceLod): number[][] => Array.from({ length: lod.positions.length / 3 }, (_, v) => [...lod.positions.subarray(v * 3, v * 3 + 3)]);
/** How far a point of the launcher lies from its tube's axis, which content's three points are on. */
const fromAxis = (p: readonly number[]): number => Math.hypot(p[0]! - weapon.muzzle[0]!, p[1]! - weapon.muzzle[1]!);
const span = (values: readonly number[]): [number, number] => [Math.min(...values), Math.max(...values)];

/** The round's radius `along` it: between its rings, the straight line from one to the next. */
function roundRadius(along: number): number {
  const rings = new Map<number, number>();
  for (const [x, y, z] of points(round.lods[0]!)) rings.set(Math.round(z! * 1000), Math.max(rings.get(Math.round(z! * 1000)) ?? 0, Math.hypot(x!, y!)));
  const at = [...rings].map(([mm, r]) => [mm / 1000, r] as const).sort((a, b) => a[0] - b[0]);
  const next = at.findIndex(([z]) => z >= along);
  if (next <= 0) return at[Math.max(next, 0)]![1];
  const [[z0, r0], [z1, r1]] = [at[next - 1]!, at[next]!];
  return r0 + ((r1 - r0) * (along - z0)) / (z1 - z0);
}

test("the packed launcher and its round pass the art check", () => {
  expect(checkAsset(asset, pack, true).faults).toEqual([]);
});

test("the launcher is held on the right prop bone, its grip at the origin", () => {
  expect(launcher.skeleton).toBe(HUMAN.id);
  for (const lod of launcher.lods) expect(new Set(lod.bones)).toEqual(new Set([B_PROP_R]));
  const at = points(launcher.lods[0]!);
  for (const k of [0, 1, 2]) {
    const [lo, hi] = span(at.map((p) => p[k]!));
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
  }
  expect(meshes.some((m) => m.id === "core:rocket_launcher/dropped")).toBe(true);
});

test("the launcher keeps to the held budget at every level, two materials close and flat far", () => {
  expect(launcher.lods.length).toBe(4);
  launcher.lods.forEach((lod, level) => expect(lod.indices.length / 3).toBeLessThanOrEqual([1200, 480, 160, 48][level]!));
  expect(launcher.materials!.map((m) => m.id).sort()).toEqual(["core:launcher/furniture", "core:launcher/metal"]);
  expect(launcher.flat).toBe(2);
  for (const level of [0, 1]) expect(new Set(launcher.lods[level]!.sections).size).toBe(2);
  for (const level of [2, 3]) expect(launcher.lods[level]!.uvs).toBeUndefined();
});

test("the round keeps to its budget, in the launcher's metal alone", () => {
  expect(round.skeleton).toBeUndefined();
  expect(round.lods.length).toBe(3);
  round.lods.forEach((lod, level) => expect(lod.indices.length / 3).toBeLessThanOrEqual([160, 64, 24][level]!));
  expect(round.materials!.map((m) => m.id)).toEqual(["core:launcher/metal"]);
  expect(round.flat).toBe(1);
});

test("the launcher and its round share two small sets of pictures", () => {
  const textures = new Map(meshes.flatMap((m) => m.textures ?? []).map((t) => [t.id, t.top]));
  expect([...textures.keys()].sort()).toEqual(["furniture", "metal"].flatMap((m) => ["base", "mro", "normal"].map((role) => `core:launcher/${m}/${role}`)));
  for (const top of textures.values()) expect(top).toBeLessThanOrEqual(512);
});

test("the tube holds the muzzle, the vent and the loaded round's place that content names", () => {
  const at = points(launcher.lods[0]!);
  const [back, front] = span(at.map((p) => p[2]!));
  // The vent is the tube's own end. The muzzle is in its mouth: the flared lip stands a little past it.
  expect(back).toBeCloseTo(weapon.vent[2]!, 2);
  expect(front).toBeGreaterThanOrEqual(weapon.muzzle[2]!);
  expect(front - weapon.muzzle[2]!).toBeLessThan(0.03);
  // Each end is a ring about the axis the three points lie on.
  for (const end of [back, front]) {
    const ring = at.filter((p) => Math.abs(p[2]! - end) < STEP);
    for (const k of [0, 1]) expect(ring.reduce((sum, p) => sum + p[k]!, 0) / ring.length).toBeCloseTo(weapon.muzzle[k]!, 2);
  }
  for (const k of [0, 1]) expect([weapon.vent[k], weapon.round[k]]).toEqual([weapon.muzzle[k], weapon.muzzle[k]]);
  // The bore is open from the round's place to the muzzle: nothing of the launcher is inside it there, at any level.
  for (const lod of launcher.lods.slice(0, 2)) {
    const inside = points(lod).filter((p) => p[2]! > weapon.round[2]! - STEP && fromAxis(p) < 0.036);
    expect(inside).toEqual([]);
  }
});

test("the round is 0.55 m long from its tail at the origin, and its motor fits the bore", () => {
  const header = pack.header.meshes.find((m) => m.id === "core:rocket_round")!;
  expect(header.center[2] - header.half[2]).toBeCloseTo(0, 3);
  expect(header.center[2] + header.half[2]).toBeCloseTo(0.55, 3);
  expect(Math.abs(header.center[0])).toBeLessThan(STEP);
  expect(Math.abs(header.center[1])).toBeLessThan(STEP);
  const seated = weapon.muzzle[2]! - weapon.round[2]!;
  for (const lod of round.lods) {
    const at = points(lod);
    // Its fins and motor, the part in the bore, and its warhead, which stands out of the muzzle.
    expect(Math.max(...at.filter((p) => p[2]! <= seated + STEP).map((p) => Math.hypot(p[0]!, p[1]!)))).toBeLessThanOrEqual(0.036 + STEP);
    expect(Math.max(...at.map((p) => Math.hypot(p[0]!, p[1]!)))).toBeGreaterThan(0.04);
  }
  expect(Math.max(...points(round.lods[0]!).map((p) => Math.hypot(p[0]!, p[1]!)))).toBeLessThanOrEqual(0.045 + STEP);
});

test("the loaded round clears the launcher everywhere along the bore and the lip", () => {
  for (const p of points(launcher.lods[0]!)) {
    const along = p[2]! - weapon.round[2]!;
    if (along > 0 && fromAxis(p) < 0.07) expect(fromAxis(p)).toBeGreaterThan(roundRadius(along) + STEP);
  }
});

test("the sight stands over the tube on the shooter's left, where the head is", () => {
  const up = weapon.muzzle[1]! + 0.07;
  const sight = points(launcher.lods[0]!).filter((p) => p[1]! > up && Math.abs(p[2]! - 0.05) < 0.11);
  expect(sight.length).toBeGreaterThan(40);
  // +X is the left of a thing that faces +Z (tools/art/spec.ts, Vec3).
  for (const p of sight) expect(p[0]!).toBeGreaterThan(0);
  expect(Math.max(...sight.map((p) => p[1]!)) - weapon.muzzle[1]!).toBeGreaterThan(0.1);
});
