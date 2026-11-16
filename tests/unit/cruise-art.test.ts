// Delivered map-local cells retain the near walking spaces while far levels omit hidden fittings.
import { expect, test } from "bun:test";
import { CRUISE_LAYOUT } from "../../content/landmarks/cruise.ts";
import type { CruiseLayout } from "../../content/landmarks/cruise-layout.ts";
import { toTriangle } from "../../tools/pack/error.ts";
import type { SourceLod } from "../../tools/pack/write.ts";
import { cruiseArt, cruiseArtGroups, cruiseArtSections, cruiseOwnerLod } from "../fixtures/cruise-art.ts";

const layout: CruiseLayout = CRUISE_LAYOUT;

test("rendered cruise cells stay inside their actual 16 m cubes with retained authored stages and shared native materials", () => {
  const expected = new Set([...layout.cells!.map(c => c.id), ...layout.prototypes.filter(p => p.mesh !== "none").map(p => p.mesh)]);
  expect([...cruiseArt.byId.keys()].sort()).toEqual([...expected].sort());
  const totals = new Array<number>(6).fill(0), faults: string[] = [];
  for (const cell of layout.cells!) {
    const mesh = cruiseArt.byId.get(cell.id)!, header = cruiseArt.pack.header.meshes[cruiseArt.pack.meshIndex.get(cell.id)!]!;
    const retained = cruiseArtGroups.meshes.find(m => m.id === cell.id)!.levels;
    expect(mesh.lods.length, cell.id).toBe(retained.length);
    expect(mesh.lods.length, cell.id).toBeGreaterThanOrEqual(2); expect(mesh.lods.length, cell.id).toBeLessThanOrEqual(6);
    expect(mesh.flat, cell.id).toBe(retained.filter(l => l.authoredLevel < 2).length);
    expect(cell.yaw).toBe(0); expect(mesh.materials!.length, cell.id).toBeLessThanOrEqual(3);
    for (const [level, lod] of mesh.lods.entries()) {
      if (!lod.indices.length || !lod.positions.every(Number.isFinite)) faults.push(`${cell.id} L${level}: absent or non-finite geometry`);
      for (let axis = 0; axis < 3; axis++) {
        const tolerance = header.half[axis]! / 32767 + .000004;
        for (let v = axis; v < lod.positions.length; v += 3) {
          const value = lod.positions[v]! + cell.origin[axis]!;
          if (value < cell.bounds.min[axis]! - tolerance || value > cell.bounds.max[axis]! + tolerance) { faults.push(`${cell.id} L${level}: geometry escapes its spatial budget cell`); break; }
        }
      }
    }
    for (let stage = 0; stage < 6; stage++) totals[stage]! += retained.findLast(l => l.authoredLevel <= stage)!.triangles;
  }
  expect(faults.slice(0, 30)).toEqual([]);
  for (let i = 1; i < 6; i++) expect(totals[i]!).toBeLessThanOrEqual(totals[i - 1]!);
  expect(totals[5]!).toBeLessThan(totals[0]!);
  const textureBytes = (cruiseArt.pack.header.textures ?? []).reduce((sum, texture) => {
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

test("real cabin doorway geometry survives both textured levels after cells are clipped and merged", () => {
  const cabin = layout.instances.find(i => i.placed && layout.prototypes.find(p => p.id === (i.sourcePrototype ?? i.prototype))?.category === "cabin")!;
  for (const level of [0, 1]) {
    const parts = cruiseArtSections(level).filter(s => s.instance.id === cabin.id).map(cruiseOwnerLod);
    expect(parts.length).toBeGreaterThan(0);
    for (const y of [.6, 1.4, 2.3]) for (const z of [-.65, 0, .65]) expect(parts.some(p => blocked(p, -3.93, y, z)), `L${level} doorway`).toBe(false);
  }
  // Window glazing is permitted to be a closed slab with an inward cutout picture, as current main specifies.
  // Its visibility is reviewed through the native textured camera, not rejected for having actual geometry.
});

test("the packed elevated basin retains dry-room headroom at both playable textured levels", () => {
  const room = layout.rooms.find(r => r.id === "pool_under")!;
  for (const level of [0, 1]) {
    const parts = cruiseArtSections(level).filter(s => s.instance.id === "prototype_pool");
    expect(parts.length).toBeGreaterThan(0);
    let bottom = Infinity;
    for (const part of parts) for (const v of part.indices) bottom = Math.min(bottom, part.positions[v * 3 + 1]!);
    expect(bottom - room.bounds.min[1]!).toBeGreaterThanOrEqual(2.6);
  }
});

test("visible window panels, balcony slabs and upper stairs survive every authored distance stage", () => {
  // Whole-ship exterior rays exposed these broad faces after the old far rule removed them.
  // Test actual surfaces, independently of which logical owner a merged far panel receives.
  const witnesses = [
    [-27.050781, 24.532944, 108.352951], [-27.050781, 27.266668, 106.046280], // navy cabin panes
    [-28.900391, 29.079220, 109.334122], [-28.900391, 25.612944, 99.732559], // starboard floor / canopy
    [28.900391, 29.079218, 109.334122], [28.900391, 25.612942, 99.732559], // port floor / canopy
    [-.8, 58.109875, 63.866669], [.8, 51.289608, -71.444443], // exposed fore / aft stair flights
  ];
  const errors = [0, .0125, .025, .06, .13, .25];
  const records = new Map(cruiseArtGroups.meshes.map(record => [record.id, record]));
  for (let stage = 0; stage < errors.length; stage++) for (const point of witnesses) {
    const tolerance = errors[stage]! + .003; // includes native vertex/origin quantization
    let distance = Infinity;
    for (const cell of layout.cells!) {
      if (point.some((value, axis) => value < cell.bounds.min[axis]! - tolerance || value > cell.bounds.max[axis]! + tolerance)) continue;
      const retained = records.get(cell.id)!.levels.findLast(level => level.authoredLevel <= stage)!;
      const lod = cruiseArt.byId.get(cell.id)!.lods[retained.level]!;
      const x = point[0]! - cell.origin[0]!, y = point[1]! - cell.origin[1]!, z = point[2]! - cell.origin[2]!;
      for (let i = 0; i < lod.indices.length; i += 3)
        distance = Math.min(distance, toTriangle(x, y, z, lod.positions, lod.indices[i]! * 3, lod.indices[i + 1]! * 3, lod.indices[i + 2]! * 3));
    }
    expect(distance, `stage ${stage}, exterior face ${point.join(",")}`).toBeLessThanOrEqual(tolerance);
  }
});

test("the AquaDome entrance remains open between its glazed sides at every distance stage", () => {
  for (let stage = 0; stage < 6; stage++) {
    const shell = cruiseArtSections(stage).filter(section => section.prototype.art?.kind === "dome_dense");
    expect(shell.length).toBeGreaterThan(0);
    const hits = (x: number): boolean => {
      const y = 47.2;
      for (const section of shell) {
        const p = section.positions, indices = section.indices;
        for (let i = 0; i < indices.length; i += 3) {
          const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
          const d = (p[b + 1]! - p[c + 1]!) * (p[a]! - p[c]!) + (p[c]! - p[b]!) * (p[a + 1]! - p[c + 1]!);
          if (Math.abs(d) < 1e-10) continue;
          const u = ((p[b + 1]! - p[c + 1]!) * (x - p[c]!) + (p[c]! - p[b]!) * (y - p[c + 1]!)) / d;
          const v = ((p[c + 1]! - p[a + 1]!) * (x - p[c]!) + (p[a]! - p[c]!) * (y - p[c + 1]!)) / d;
          if (u < 0 || v < 0 || u + v > 1) continue;
          const z = u * p[a + 2]! + v * p[b + 2]! + (1 - u - v) * p[c + 2]!;
          if (z >= 74 && z <= 88) return true;
        }
      }
      return false;
    };
    expect(hits(5), `stage ${stage}, entrance`).toBe(false);
    expect(hits(-12), `stage ${stage}, starboard glazing`).toBe(true);
    expect(hits(12), `stage ${stage}, port glazing`).toBe(true);
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

test("the Pearl retains a front-facing inner shell across both near levels and mixed adjacent cells", () => {
  const parts = (level: number) => cruiseArtSections(level).filter(s => s.prototype.category === "pearl");
  const faults: string[] = [], zs = [-4.7, -1.8, .3, 2.6, 4.8];
  const configurations = [parts(0), parts(1), [...parts(0).filter(s => Number(s.mesh.split("_").at(-1)) % 2 === 0),
    ...parts(1).filter(s => Number(s.mesh.split("_").at(-1)) % 2 === 1)]];
  for (const [configuration, sections] of configurations.entries()) {
    expect(sections.length).toBeGreaterThan(0);
    const lods = sections.map(cruiseOwnerLod);
    for (const z of zs) for (let i = 0; i < 160; i++) {
      const angle = (i + .23) * Math.PI * 2 / 160;
      if (!pearlFrontHit(lods, z, angle)) faults.push(`configuration${configuration} z${z} angle${angle.toFixed(4)}`);
    }
  }
  expect(faults.slice(0, 20)).toEqual([]);
});
