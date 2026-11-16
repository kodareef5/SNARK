// Delivered native cloth, including streamed palette fallback and every articulated coarse level.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import layout from "../../content/landmarks/koru-sails.json" with { type: "json" };
import { parsePack } from "../../shared/pack/pack.ts";
import { measureSurface } from "../../tools/art/check.ts";
import { unpackMeshes } from "../../tools/pack/write.ts";

const evidence = JSON.parse(readFileSync(new URL("../../assets/source/core/landmarks/koru-sails/ref/bounds.json", import.meta.url), "utf8")) as Record<string, { sourceSha256: string; boneBounds: number[][]; bounds: { center: number[]; radius: number } }>;

const assets = layout.sails.map(sail => {
  const bytes = new Uint8Array(readFileSync(new URL(`../../assets/source/core/landmarks/koru_sail_${sail.id}/koru_sail_${sail.id}.snpk`, import.meta.url)));
  const pack = parsePack(bytes);
  return { sail, bytes, pack, mesh: unpackMeshes(pack)[0]! };
});

test("five deployed sail rigs retain six closed authored levels, cloth colors and every hinge bone", () => {
  expect(assets.map(a => a.sail.id)).toEqual(["fore", "main", "mizzen", "outer", "inner"]);
  let total = 0;
  const faults: string[] = [];
  for (const { sail, pack, mesh } of assets) {
    expect(mesh.id).toBe(sail.mesh);
    expect(mesh.skeleton).toBe(sail.skeleton);
    expect(pack.header.rigs[0]!.names).toEqual(sail.bones);
    expect(pack.header.rigs[0]!.rest.every(v => v === 0)).toBe(true);
    expect(mesh.flat).toBe(1);
    expect(mesh.lods.length).toBe(6);
    total += mesh.lods[0]!.indices.length / 3;
    mesh.lods.forEach((lod, level) => {
      const surface = measureSurface(lod);
      if (surface.holes || surface.flipped || surface.insideOut) faults.push(`${sail.id} L${level}: open or inward cloth`);
      expect(lod.bones!.every(b => b < sail.bones.length)).toBe(true);
      if (level) {
        expect(lod.error!).toBeGreaterThanOrEqual(.008);
        expect(lod.indices.length).toBeLessThanOrEqual(mesh.lods[level - 1]!.indices.length);
      }
      // This includes L0's real untextured fallback during streaming, not only the coarser palette meshes.
      for (const color of new Set(lod.colors)) {
        expect(color).toBeLessThan(240);
        expect(Math.min(...pack.palette.slice(color * 4, color * 4 + 3))).toBeGreaterThan(170);
      }
    });
    expect(mesh.lods[5]!.indices.length).toBeLessThan(mesh.lods[0]!.indices.length / 3);
  }
  expect(faults).toEqual([]);
  expect(total).toBeLessThan(50_000);
});

test("every native sail vertex and skin influence fits its certified culling box at all six levels", () => {
  const faults: string[] = [];
  for (const { sail, bytes, mesh } of assets) {
    const record = evidence[sail.id]!;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(record.sourceSha256);
    expect(sail.boneBounds).toEqual(record.boneBounds);
    expect(sail.bounds).toEqual(record.bounds);
    expect(sail.bounds.radius).toBeLessThan(50);
    for (const lod of mesh.lods) for (let v = 0; v < lod.positions.length / 3; v++) {
      const bones = lod.weights ? [0, 1, 2, 3].filter(k => lod.weights![v * 4 + k]! > 0).map(k => lod.joints![v * 4 + k]!) : [lod.bones![v]!];
      for (const b of bones) for (let k = 0; k < 3; k++) {
        const p = lod.positions[v * 3 + k]!, box = sail.boneBounds[b]!;
        if (p < box[k]! || p > box[k + 3]!) faults.push(`${sail.id}: vertex ${v} outside bone ${b}`);
      }
    }
  }
  expect(faults).toEqual([]);
});

test("native head cloth remains attached around both sides of each rigid gaff peak", () => {
  for (const { sail, mesh } of assets) {
    if (!("gaff" in sail)) continue;
    const gaff = sail.gaff!, index = sail.bones.indexOf(gaff.bone), lod = mesh.lods[0]!;
    let tested = 0, leech = 0;
    for (let v = 0; v < lod.positions.length / 3; v++) {
      const y = lod.positions[v * 3 + 1]!, z = lod.positions[v * 3 + 2]!;
      if (Math.hypot(y - gaff.peak[1]!, z - gaff.peak[2]!) > .4) continue;
      let weight = 0; for (let k = 0; k < 4; k++) if (lod.joints![v * 4 + k] === index) weight += lod.weights![v * 4 + k]!;
      expect(weight, `${sail.id} peak neighborhood`).toBeGreaterThan(.85);
      tested++; if (z > gaff.peak[2]!) leech++;
    }
    expect(tested).toBeGreaterThan(10);
    expect(leech).toBeGreaterThan(0);
  }
});
