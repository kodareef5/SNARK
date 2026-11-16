// Delivered native meshes, not source declarations, must retain the instancing and walkable-opening contract.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import { shapeHalf } from "../../shared/content/defs.ts";
import { cruiseParts, type CruisePrototype } from "../../content/landmarks/cruise-layout.ts";
import { parsePack } from "../../shared/pack/pack.ts";
import { nearestColour } from "../../shared/pack/palette.ts";
import { measureSurface } from "../../tools/art/check.ts";
import { unpackMeshes, type SourceLod } from "../../tools/pack/write.ts";

const pack = parsePack(new Uint8Array(readFileSync(new URL("../../assets/source/core/landmarks/cruise/cruise.snpk", import.meta.url))));
const meshes = unpackMeshes(pack), byId = new Map(meshes.map(mesh => [mesh.id, mesh]));

test("repeated cruise placements use bounded six-level native prototypes and shared original materials", () => {
  expect([...byId.keys()].sort()).toEqual(CRUISE_LAYOUT.prototypes.map(p => p.mesh).sort());
  expect(CRUISE_LAYOUT.instances.length).toBeGreaterThan(CRUISE_LAYOUT.prototypes.length * 5);
  const totals = new Array<number>(6).fill(0), faults: string[] = [];
  for (const p of CRUISE_LAYOUT.prototypes as readonly CruisePrototype[]) {
    const mesh = byId.get(p.mesh)!, parts = cruiseParts(p), look = p.look ? cruiseParts(p.look) : undefined;
    const half = shapeHalf(parts.boxes ?? [], parts.hulls, look);
    expect(mesh.lods.length, p.id).toBe(6); expect(mesh.flat, p.id).toBe(1);
    expect(mesh.materials!.length, p.id).toBeLessThanOrEqual(3);
    for (const [level, lod] of mesh.lods.entries()) {
      totals[level]! += lod.indices.length / 3;
      expect(lod.indices.length, p.id).toBeGreaterThan(0);
      expect(lod.positions.every(Number.isFinite), p.id).toBe(true);
      const surface = measureSurface(lod);
      if (surface.holes || surface.flipped || surface.insideOut) faults.push(`${p.id} L${level}: open or inward surface`);
      for (let axis = 0; axis < 3; axis++) {
        let lo = Infinity, hi = -Infinity;
        for (let v = axis; v < lod.positions.length; v += 3) { lo = Math.min(lo, lod.positions[v]!); hi = Math.max(hi, lod.positions[v]!); }
        if (lo < Math.max(-half[axis]!, p.visualBounds.min[axis]!) - .006 || hi > Math.min(half[axis]!, p.visualBounds.max[axis]!) + .006) faults.push(`${p.id} L${level} axis${axis}: mesh escapes native bounds`);
      }
      if (level) expect(lod.error!, p.id).toBeGreaterThanOrEqual(.008);
    }
  }
  expect(faults).toEqual([]);
  for (let i = 1; i < 6; i++) expect(totals[i]!).toBeLessThanOrEqual(totals[i - 1]!);
  expect(totals[5]!).toBeLessThan(totals[0]!);
  const textureBytes = (pack.header.textures ?? []).reduce((sum, texture) => {
    let pixels = 0; for (let s = texture.top; s >= 1; s = Math.floor(s / 2)) pixels += s * s;
    return sum + pixels * 4;
  }, 0);
  expect(textureBytes).toBeGreaterThan(0); expect(textureBytes).toBeLessThanOrEqual(64 * 1024 ** 2);
});

/** Intersect a short segment through the actual wall plane, retaining furniture beyond the wall as distinct. */
function blocked(lod: SourceLod, x: number, y: number, z: number): boolean {
  const p = lod.positions;
  for (let i = 0; i < lod.indices.length; i += 3) {
    const a = lod.indices[i]! * 3, b = lod.indices[i + 1]! * 3, c = lod.indices[i + 2]! * 3;
    const ay = p[a + 1]!, az = p[a + 2]!, by = p[b + 1]!, bz = p[b + 2]!, cy = p[c + 1]!, cz = p[c + 2]!;
    const d = (bz - cz) * (ay - cy) + (cy - by) * (az - cz);
    if (Math.abs(d) < 1e-10) continue;
    const u = ((bz - cz) * (y - cy) + (cy - by) * (z - cz)) / d;
    const v = ((cz - az) * (y - cy) + (ay - cy) * (z - cz)) / d;
    if (u >= 0 && v >= 0 && u + v <= 1 && Math.abs(u * p[a]! + v * p[b]! + (1 - u - v) * p[c]! - x) < .2) return true;
  }
  return false;
}

test("real cabin entry and window apertures survive textured and near-flat fallback with distinct furnishings", () => {
  const cabin = CRUISE_LAYOUT.prototypes.find(p => p.category === "cabin")!, mesh = byId.get(cabin.mesh)!;
  const linen = nearestColour(pack.palette, 229, 223, 209), oak = nearestColour(pack.palette, 139, 102, 67), carpet = nearestColour(pack.palette, 52, 86, 114);
  for (const level of [0, 1]) {
    const lod = mesh.lods[level]!;
    for (const y of [.6, 1.4, 2.3]) {
      for (const z of [-.65, 0, .65]) expect(blocked(lod, -3.93, y, z), `L${level} doorway`).toBe(false);
      for (const z of [-2.4, 0, 2.4]) expect(blocked(lod, 3.93, y, z), `L${level} window`).toBe(false);
    }
  }
  for (const lod of mesh.lods.slice(1)) {
    expect(lod.colors.includes(linen)).toBe(true); expect(lod.colors.includes(oak)).toBe(true); expect(lod.colors.includes(carpet)).toBe(true);
  }
});

test("elevated decorative basin retains real dry-room headroom in every delivered level", () => {
  const placed = CRUISE_LAYOUT.instances.find(i => i.id === "prototype_pool")!;
  const proto = CRUISE_LAYOUT.prototypes.find(p => p.id === placed.prototype)!;
  const room = CRUISE_LAYOUT.rooms.find(r => r.id === "pool_under")!;
  for (const lod of byId.get(proto.mesh)!.lods) {
    let bottom = Infinity; for (let v = 1; v < lod.positions.length; v += 3) bottom = Math.min(bottom, lod.positions[v]! + placed.at[1]!);
    expect(bottom - room.bounds.min[1]!).toBeGreaterThanOrEqual(2.6);
  }
});

/** A one-sided interior ray models the native backface rule; a two-sided hit hid the original Pearl fault. */
function pearlFrontHit(lods: readonly SourceLod[], z: number, angle: number): boolean {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  for (const lod of lods) {
    const p = lod.positions;
    for (let i = 0; i < lod.indices.length; i += 3) {
      const a = lod.indices[i]! * 3, b = lod.indices[i + 1]! * 3, c = lod.indices[i + 2]! * 3;
      const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!;
      const ux = p[b]! - ax, uy = p[b + 1]! - ay, uz = p[b + 2]! - az;
      const vx = p[c]! - ax, vy = p[c + 1]! - ay, vz = p[c + 2]! - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, facing = nx * dx + ny * dy;
      if (facing >= -1e-9) continue;
      const t = (nx * ax + ny * ay + nz * (az - z)) / facing;
      if (t < 4 || t > 8) continue;
      const qx = t * dx - ax, qy = t * dy - ay, qz = z - az;
      const uu = ux * ux + uy * uy + uz * uz, vv = vx * vx + vy * vy + vz * vz, uv = ux * vx + uy * vy + uz * vz;
      const qu = qx * ux + qy * uy + qz * uz, qv = qx * vx + qy * vy + qz * vz, d = uu * vv - uv * uv;
      if (d <= 1e-16) continue;
      const s = (qu * vv - qv * uv) / d, r = (qv * uu - qu * uv) / d;
      if (s >= -1e-6 && r >= -1e-6 && s + r <= 1.000001) return true;
    }
  }
  return false;
}

test("assembled Pearl retains a visible inner shell at every level and across adjacent mixed levels", () => {
  const shells = CRUISE_LAYOUT.prototypes.filter(p => p.category === "pearl").map(p => byId.get(p.mesh)!);
  expect(shells.length).toBe(16);
  const faults: string[] = [], zs = [-4.7, -1.8, .3, 2.6, 4.8];
  for (let level = 0; level < 6; level++) {
    const lods = shells.map(m => m.lods[level]!);
    for (const z of zs) for (let i = 0; i < 80; i++) {
      const angle = (i + .23) * Math.PI * 2 / 80;
      if (!pearlFrontHit(lods, z, angle)) faults.push(`L${level} z${z} angle${angle.toFixed(4)}`);
    }
  }
  for (let level = 1; level < 6; level++) {
    const lods = shells.map((m, i) => m.lods[i % 2 ? level : 0]!);
    for (const z of zs) for (let seam = 0; seam < 16; seam++) for (const side of [-1, 1]) {
      const angle = seam * Math.PI / 8 + side * .003;
      if (!pearlFrontHit(lods, z, angle)) faults.push(`L0/${level} z${z} seam${seam} side${side}`);
    }
  }
  expect(faults.slice(0, 20)).toEqual([]);
});
