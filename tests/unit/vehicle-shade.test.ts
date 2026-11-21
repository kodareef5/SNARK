// A wheeled vehicle's shade on itself: its arches, its floor and its tyres' tops (client/core/render/vehicle-shade.ts).
import { expect, test } from "bun:test";
import { SURFACE_VERTEX, surfaceFragment } from "../../client/core/render/surface.ts";
import { WHEEL_FINISH_GLSL } from "../../client/core/render/street-finish.ts";
import { ARCH_MOST, VEHICLE_SHADE_GLSL, VEHICLE_SHADE_UNIFORMS, bodyOpen, tyreOpen } from "../../client/core/render/vehicle-shade.ts";

// The compact's rig and box: the chassis, then its four wheels of 0.3 m.
const rest = [0,0.6,0, 0.78,0.30,1.25, -0.78,0.30,1.25, 0.78,0.30,-1.25, -0.78,0.30,-1.25];
const wheels = 0b11110, center = [0,0.75,0], half = [0.9,0.75,2];
const body = (x: number, y: number, z: number, nx: number, ny: number, nz: number, down = -ny) => bodyOpen(x,y,z,nx,ny,nz,down,rest,wheels,center,half);

test("an arch is darkest deep inside and at its top, keeps light at its lip, and leaves the outside of the body alone", () => {
  // The right front arch (x < 0): the liner over the tyre, deep in and at the outer edge, and its lip.
  const deepTop = body(-0.62,0.66,1.25, 0,-1,0, 0);
  const outerTop = body(-0.84,0.66,1.25, 0,-1,0, 0);
  const lip = body(-0.86,0.40,1.62, -0.7,0,-0.7, 0);
  const lowerBack = body(-0.70,0.30,0.88, 0,0,1, 0);
  expect(deepTop).toBeCloseTo(1-ARCH_MOST,2);
  expect(outerTop).toBeGreaterThan(deepTop);
  expect(lip).toBeGreaterThan(outerTop);
  expect(lip).toBeLessThan(0.95);
  expect(lowerBack).toBeGreaterThan(deepTop);
  // The arch's inner wall, looking out of the car's side, and the chassis seen through the arch.
  expect(body(-0.55,0.35,1.30, -1,0,0)).toBeLessThan(0.3);
  // The fender over the arch, the door behind it and the bumper, all facing out: untouched.
  expect(body(-0.86,0.72,1.25, -0.6,0.8,0)).toBeCloseTo(1,2);
  expect(body(-0.88,0.45,1.70, -1,0,0.1)).toBeGreaterThan(0.97);
  expect(body(-0.90,0.60,0.40, -1,0,0)).toBe(1);
  expect(body(-0.40,0.40,2.0, 0,0,1)).toBe(1);
  // Both sides and both axles alike.
  expect(body(0.62,0.66,-1.25, 0,-1,0, 0)).toBeCloseTo(deepTop,6);
  // A monster truck's wheels (0.8 m, 1.16 m out) stand past its body: the body's side keeps its sky beside them, while
  // its fender's return over the tyre and the frame inboard of the tyre are shaded.
  const big = [0,1.2,0, 1.16,0.8,1.41, -1.16,0.8,1.41], box = [0,1.32,0], wide = [1.5,1.32,2.29];
  const truck = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => bodyOpen(x,y,z,nx,ny,nz,-ny,big,0b110,box,wide);
  expect(truck(-1.0,1.3,1.0, -1,0,0)).toBe(1);
  expect(truck(-1.0,1.5,2.0, -1,0.2,0)).toBe(1);
  // Its lower panels tuck under a little over the wheels, and keep their sky too.
  expect(truck(-1.0,1.25,1.1, -0.9,-0.4,0)).toBeGreaterThan(0.95);
  // Its narrow body's side stands inboard of the wheels: shaded behind a tyre, not past it.
  expect(truck(-0.81,1.3,1.6, -1,0,0)).toBeLessThan(0.7);
  expect(truck(-0.81,1.6,2.3, -1,0,0)).toBe(1);
  expect(truck(-1.2,1.75,1.41, 0,-1,0)).toBeLessThan(0.7);
  expect(truck(-0.6,1.0,1.41, -1,0,0)).toBeLessThan(0.35);
});

test("a face turned down under the floor sees the shaded ground, less so at the footprint's edge", () => {
  const middle = body(0,0.18,0, 0,-1,0), edge = body(0.86,0.2,0, 0,-1,0), roof = body(0,1.45,0, 0,1,0);
  expect(middle).toBeCloseTo(0.4,2);
  expect(edge).toBeGreaterThan(middle);
  expect(roof).toBe(1);
  // A floor face is shaded by how it looks in the world: a car on its back shows its floor to the sky.
  expect(body(0,0.18,0, 0,-1,0, -1)).toBe(1);
});

test("a tyre's top under its arch and its inner wall keep less sky than its bottom and outer wall, and its rim little less", () => {
  const top = tyreOpen(0.98,0,1), bottom = tyreOpen(-0.98,0,1), outerTop = tyreOpen(0.75,0.32,1), inner = tyreOpen(0,-0.33,1);
  expect(top).toBeLessThan(0.45);
  expect(bottom).toBe(1);
  expect(outerTop).toBeGreaterThan(top);
  expect(inner).toBeLessThan(0.7);
  expect(tyreOpen(0.5,0.31,0)).toBeGreaterThan(0.95);
  expect(tyreOpen(0.98,-0.33,1)).toBeGreaterThanOrEqual(0.12);
});

test("SURFACE reads the shade and the tyre's relief from what the draw already has, with no texture more", () => {
  const fragment = surfaceFragment("rgba", "");
  for (const text of [VEHICLE_SHADE_GLSL, VEHICLE_SHADE_UNIFORMS, WHEEL_FINISH_GLSL]) expect(text).not.toMatch(/texture|texelFetch|sampler/);
  expect(fragment).toContain("own = bodyOpen(vWheelPoint");
  expect(fragment).toContain("own = tyreOpen(vWheel.y");
  expect(fragment).toContain("mro.r = min(mro.r,own)");
  expect(SURFACE_VERTEX).toContain("vWheel = vec4(aNormal, 0.0)");
});
