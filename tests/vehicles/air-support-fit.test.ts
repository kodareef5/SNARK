import { expect, test } from "bun:test";
import { AIR_FRAME as A, AIR_IMPELLERS, airBayZ, airMesh, type AirPiece } from "../../shared/world/air-support-art.ts";
import { airSupportMeshes } from "../../tools/pack/air-support.ts";
import type { SourceLod } from "../../tools/pack/write.ts";

const meshes = new Map(airSupportMeshes().map((mesh) => [mesh.id, mesh]));
const lod = (name: AirPiece, level = 0) => meshes.get(airMesh(name))!.lods[level]!;

/** The horizontal surfaces under a vertical line, ordered from the ground up. */
function heights(mesh: SourceLod, x: number, z: number): number[] {
  const hits: number[] = [],
    vertices = mesh.positions;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i]! * 3,
      b = mesh.indices[i + 1]! * 3,
      c = mesh.indices[i + 2]! * 3;
    const vx = vertices[b]! - vertices[a]!,
      vz = vertices[b + 2]! - vertices[a + 2]!,
      wx = vertices[c]! - vertices[a]!,
      wz = vertices[c + 2]! - vertices[a + 2]!;
    const det = vx * wz - vz * wx;
    if (Math.abs(det) < 1e-9) continue;
    const dx = x - vertices[a]!,
      dz = z - vertices[a + 2]!,
      s = (dx * wz - dz * wx) / det,
      t = (dz * vx - dx * vz) / det;
    if (s < -0.00001 || t < -0.00001 || s + t > 1.00001) continue;
    hits.push(vertices[a + 1]! + s * (vertices[b + 1]! - vertices[a + 1]!) + t * (vertices[c + 1]! - vertices[a + 1]!));
  }
  return hits.sort((a, b) => a - b);
}

test("both runners rest on the rubber saddles in every bay", () => {
  for (let bay = 0; bay < 6; bay++)
    for (const side of [-1, 1]) {
      const x = -0.34,
        zOffset = side * 0.139;
      const foot = heights(lod("drone"), -zOffset, x)[0]! + A.bayY;
      const seat = heights(lod("pod"), x, airBayZ(bay) + zOffset)
        .filter((y) => y < 0.8)
        .at(-1)!;
      expect(Math.abs(foot - seat)).toBeLessThan(0.012);
    }
});

test("each closed lifting toe bears against the upper corner shoe", () => {
  const x = A.jawX,
    z = 0.07;
  const grip = heights(lod("clamp"), x - 1.27, z)
    .map((y) => y + A.carrierY - 0.13)
    .filter((y) => y > A.jawY - 0.1 && y < A.jawY + 0.13);
  const aperture = heights(lod("pod"), x, A.jawZ + z).filter((y) => y > A.jawY + 0.03);
  expect(grip.length).toBeGreaterThan(0);
  expect(Math.abs(grip.at(-1)! - aperture[0]!)).toBeLessThan(0.012);
});

test("four complete impellers leave with the flying frame", () => {
  const parked = lod("drone"),
    frame = lod("droneFrame"),
    rotor = lod("impeller");
  expect(parked.indices.length - frame.indices.length).toBe(AIR_IMPELLERS.length * rotor.indices.length);
  for (const at of AIR_IMPELLERS) {
    const start = heights(frame, at.x + 0.09, at.z + 0.035);
    expect(start.some((h) => Math.abs(h - at.y) < 0.018)).toBe(false);
  }
  const halfBay = (airBayZ(1) - airBayZ(0)) / 2;
  let halfWidth = 0;
  for (let i = 0; i < parked.positions.length; i += 3) halfWidth = Math.max(halfWidth, Math.abs(parked.positions[i]!));
  expect(halfWidth).toBeLessThan(halfBay);
});

test("the finest model keeps curved normals and the street models stay light", () => {
  const best = lod("drone"),
    normals = best.normals!;
  expect(normals.length).toBe(best.positions.length);
  expect(normals.every(Number.isFinite)).toBe(true);
  expect(lod("carrier").indices.length / 3).toBeLessThan(18000);
  expect(best.indices.length / 3).toBeLessThan(9500);
  expect(lod("carrier", 2).indices.length / 3).toBeLessThan(1200);
  expect(lod("drone", 1).indices.length / 3).toBeLessThan(900);
});
