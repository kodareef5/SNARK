// Garment cuts: the print sheets lay their panels inside the sheet and apart, each garment names a cut that is cooked on
// both bodies within its level budgets, a shoe follows one bone a point, and the hem bands of the skin zones lie where
// the hems fall.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CORE_CONTENT } from "../../content/core.ts";
import { B_FOOT_L, B_FOOT_R, B_HAND_L, B_LOWER_ARM_L, B_LOWER_LEG_L, B_NECK, B_SPINE, B_TOE_L, B_TOE_R, B_UPPER_CHEST, HUMAN } from "../../shared/anim/human.ts";
import { SKIN_ABDOMEN, SKIN_ANKLE_L, SKIN_CHEST, SKIN_COLLAR, SKIN_FOREARM_L, SKIN_SHIN_L, SKIN_WAIST, SKIN_WRIST_L, SKIN_ZONE_COUNT, skinZoneAt } from "../../shared/anim/skin-zones.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { CUTS, EDITION_REGIONS, SHEETS, cutMesh } from "../../shared/people/cuts.ts";
import { REGION_BASE } from "../../shared/pack/palette.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";

const PACK = new URL("../../assets/source/core/humans/human-bodies/human-bodies.snpk", import.meta.url);
const inside = (a: readonly number[], b: readonly number[]): boolean => a[0]! >= b[0]! - 1e-9 && a[1]! >= b[1]! - 1e-9 && a[0]! + a[2]! <= b[0]! + b[2]! + 1e-9 && a[1]! + a[3]! <= b[1]! + b[3]! + 1e-9;

test("each sheet's panels lie inside it and apart, and each print starts on a panel", () => {
  for (const sheet of Object.values(SHEETS)) {
    for (const p of sheet.panels) expect(inside(p.rect, [0, 0, 1, 1])).toBe(true);
    for (const [i, a] of sheet.panels.entries()) for (const b of sheet.panels.slice(i + 1)) {
      const apart = a.rect[0] + a.rect[2] <= b.rect[0] + 1e-9 || b.rect[0] + b.rect[2] <= a.rect[0] + 1e-9 || a.rect[1] + a.rect[3] <= b.rect[1] + 1e-9 || b.rect[1] + b.rect[3] <= a.rect[1] + 1e-9;
      expect(apart).toBe(true);
    }
  }
  for (const cut of Object.values(CUTS)) expect(SHEETS[cut.sheet].panels.some((p) => inside(cut.print, p.rect))).toBe(true);
  expect([...EDITION_REGIONS]).toEqual([1, 4, 5]);
});

test("every garment names a cut on the sheet table, and every cut is made", () => {
  const reg = compileContent(CORE_CONTENT).registry!;
  const named = reg.defs.flatMap((d) => (d?.type === "item" && d.garment?.cut ? [d.garment.cut] : []));
  for (const cut of named) expect(CUTS[cut]).toBeDefined();
  expect(new Set(named)).toEqual(new Set(Object.keys(CUTS)));
});

test("each cut is cooked on both bodies within its level budgets, a shoe on one bone a point", () => {
  const meshes = unpackMeshes(parsePack(new Uint8Array(readFileSync(PACK))));
  for (const sex of ["m", "f"]) for (const [name, cut] of Object.entries(CUTS)) {
    const mesh = meshes.find((m) => m.id === cutMesh(`core:human_${sex}`, name));
    expect(mesh?.id).toBe(cutMesh(`core:human_${sex}`, name));
    expect([mesh!.lods.length, mesh!.flat]).toEqual([cut.levels.length, cut.flat]);
    mesh!.lods.forEach((lod, k) => {
      expect(lod.indices.length / 3).toBeLessThanOrEqual(cut.levels[k]!);
      expect(lod.zones?.every((z) => z < SKIN_ZONE_COUNT)).toBe(true);
    });
    if (name !== "trainers") continue;
    for (const lod of mesh!.lods) for (let v = 0; v < lod.positions.length / 3; v++) {
      expect([B_FOOT_L, B_FOOT_R, B_TOE_L, B_TOE_R]).toContain(lod.bones![v]!);
      if (lod.weights) expect(lod.weights[v * 4]!).toBeCloseTo(1, 5);
    }
  }
});

test("the hem bands are the ends of the zones beside them", () => {
  const rest = HUMAN.rest;
  const at = (b: number): number[] => [rest[b * 3]!, rest[b * 3 + 1]!, rest[b * 3 + 2]!];
  const lerp = (a: number[], b: number[], t: number): [number, number, number] => [0, 1, 2].map((k) => a[k]! + (b[k]! - a[k]!) * t) as [number, number, number];
  const [elbow, wrist] = [at(B_LOWER_ARM_L), at(B_HAND_L)];
  expect(skinZoneAt(B_LOWER_ARM_L, ...lerp(elbow, wrist, 0.5), rest)).toBe(SKIN_FOREARM_L);
  expect(skinZoneAt(B_LOWER_ARM_L, ...lerp(elbow, wrist, 0.95), rest)).toBe(SKIN_WRIST_L);
  const [knee, ankle] = [at(B_LOWER_LEG_L), at(B_FOOT_L)];
  expect(skinZoneAt(B_LOWER_LEG_L, ...lerp(knee, ankle, 0.5), rest)).toBe(SKIN_SHIN_L);
  expect(skinZoneAt(B_LOWER_LEG_L, ...lerp(knee, ankle, 0.95), rest)).toBe(SKIN_ANKLE_L);
  const [neck, spine] = [at(B_NECK), at(B_SPINE)];
  expect(skinZoneAt(B_UPPER_CHEST, neck[0]!, neck[1]! - 0.01, neck[2]! - 0.05, rest)).toBe(SKIN_COLLAR);
  expect(skinZoneAt(B_UPPER_CHEST, neck[0]!, neck[1]! - 0.15, neck[2]! + 0.1, rest)).toBe(SKIN_CHEST);
  expect(skinZoneAt(B_SPINE, spine[0]!, spine[1]! - 0.03, spine[2]! + 0.1, rest)).toBe(SKIN_WAIST);
  expect(skinZoneAt(B_SPINE, spine[0]!, spine[1]! + 0.08, spine[2]! + 0.1, rest)).toBe(SKIN_ABDOMEN);
});

test("a cut's flat levels show the print's region, its textured levels never", () => {
  const meshes = unpackMeshes(parsePack(new Uint8Array(readFileSync(PACK))));
  for (const sex of ["m", "f"]) for (const [name, cut] of Object.entries(CUTS)) {
    const mesh = meshes.find((m) => m.id === cutMesh(`core:human_${sex}`, name))!;
    mesh.lods.forEach((lod, k) => {
      const printed = lod.colors.filter((c) => c === REGION_BASE + 2).length;
      if (k < cut.flat) expect(printed).toBe(0);
      else expect(printed).toBeGreaterThan(0);
    });
  }
});

test("a tee's front is unmirrored from outside: across the sheet is the wearer's right to left", () => {
  const meshes = unpackMeshes(parsePack(new Uint8Array(readFileSync(PACK))));
  for (const sex of ["m", "f"]) {
    const lod = meshes.find((m) => m.id === cutMesh(`core:human_${sex}`, "tee"))!.lods[0]!, uv = lod.uvs!, p = lod.positions;
    // The print's place on the chest. The body faces +z with its left hand at +x: from in front, the viewer's left is -x.
    const [u0, v0, w, h] = CUTS.tee!.print;
    let n = 0, su = 0, sx = 0, sv = 0, sy = 0, sux = 0, svy = 0, suu = 0, svv = 0, front = 0;
    for (let i = 0; i < uv.length / 2; i++) {
      const u = uv[i * 2]!, v = uv[i * 2 + 1]!;
      if (u < u0 || u > u0 + w || v < v0 || v > v0 + h) continue;
      const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
      n++, su += u, sx += x, sv += v, sy += y, sux += u * x, svy += v * y, suu += u * u, svv += v * v;
      if (z > 0) front++;
    }
    expect(n).toBeGreaterThan(20);
    expect(front / n).toBeGreaterThan(0.95);
    // Metres of body a sheet's width: a sheet spans 1.4 m, less where the chest curves away.
    expect((sux / n - (su / n) * (sx / n)) / (suu / n - (su / n) ** 2)).toBeGreaterThan(0.8);
    expect((svy / n - (sv / n) * (sy / n)) / (svv / n - (sv / n) ** 2)).toBeLessThan(-0.8);
  }
});
