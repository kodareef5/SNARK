import { expect, test } from "bun:test";
import { Camera } from "../../client/core/render/camera.ts";
import type { ModelView } from "../../tools/snap.ts";
import { PICK_SKY } from "../../tools/snap/raster.ts";
import { cast } from "../../tools/wiki/photography.ts";
import { fitPortrait, spacePair } from "../../tools/wiki/posters.ts";

test("the product camera fits a rolled, deep model with room on every side", () => {
  const corners = [-8, 8].flatMap((x) => [-1, 3].flatMap((y) => [-4, 4].flatMap((z) => [x, y, z])));
  const camera = new Camera();
  const [around, above, roll] = [39, 16, Math.PI / 5];
  const f = fitPortrait(corners, around, above, 1.33, roll);
  const [a, e] = [around * Math.PI / 180, above * Math.PI / 180];
  camera.aspect = 1.33;
  camera.fovY = 0.36;
  camera.yaw = a + Math.PI;
  camera.pitch = -e;
  camera.roll = roll;
  camera.x = f.centre[0] + f.distance * Math.sin(a) * Math.cos(e);
  camera.y = f.centre[1] + f.distance * Math.sin(e);
  camera.z = f.centre[2] + f.distance * Math.cos(a) * Math.cos(e);
  camera.update();
  const m = camera.viewProj;
  let largest = 0;
  for (let k = 0; k < corners.length; k += 3) {
    const [x, y, z] = [corners[k]! - camera.x, corners[k + 1]! - camera.y, corners[k + 2]! - camera.z];
    const w = m[3]! * x + m[7]! * y + m[11]! * z;
    const px = (m[0]! * x + m[4]! * y + m[8]! * z) / w;
    const py = (m[1]! * x + m[5]! * y + m[9]! * z) / w;
    largest = Math.max(largest, Math.abs(px), Math.abs(py));
    expect(w).toBeGreaterThan(0);
  }
  expect(largest).toBeCloseTo(0.85, 4);
});

test("a studio shadow shifts opposite the key light and softens at its edges", () => {
  const cam = new Camera();
  cam.y = 3;
  cam.z = 8;
  cam.yaw = Math.PI;
  cam.pitch = -0.21;
  cam.aspect = 1;
  cam.fovY = 0.65;
  cam.near = 0.1;
  cam.far = 40;
  cam.update();
  const n = 80;
  const pickKind = new Uint8Array(n * n).fill(PICK_SKY);
  const depth = new Float32Array(n * n).fill(Infinity);
  const at = n * 40 + 40;
  const distance = 8;
  depth[at] = (cam.far + cam.near) / (cam.far - cam.near) + cam.viewProj[14]! / distance;
  pickKind[at] = PICK_SKY === 0 ? 1 : 0;
  const view = { cam, raster: { width: n, height: n, pickKind, depth } } as unknown as ModelView;
  const left = cast(view, n, n, 0, 0, [0.1, 0.9, -0.8]);
  const right = cast(view, n, n, 0, 0, [0.1, 0.9, 0.8]);
  const middle = (mask: Uint8Array) => {
    const weight = mask.reduce((t, v) => t + v, 0);
    expect(weight).toBeGreaterThan(0);
    return mask.reduce((t, v, i) => t + (i % n) * v, 0) / weight;
  };
  expect(middle(right) - middle(left)).toBeGreaterThan(12);
  expect(Math.max(...right)).toBeLessThan(255);
});

test("a pair of worn gloves keeps both shapes and closes the body's spacing", () => {
  const xs = Float64Array.from([-0.9, -0.7, 0.7, 0.9]);
  expect(spacePair(xs, 0)).toBe(true);
  expect(xs[1]! - xs[0]!).toBeCloseTo(0.2);
  expect(xs[3]! - xs[2]!).toBeCloseTo(0.2);
  expect(xs[2]! - xs[1]!).toBeCloseTo(0.076);
  const single = Float64Array.from([-0.2, -0.05, 0.05, 0.12]);
  expect(spacePair(single, 0)).toBe(false);
  expect([...single]).toEqual([-0.2, -0.05, 0.05, 0.12]);
});
