// Sun shadow cascades as numbers: the splits and spheres, the squares snapped in a light space fixed to the world, which
// casters a cascade takes and at which level, and the farthest cascade drawn every other frame.
import { expect, test } from "bun:test";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Cascades, DEPTH_STEPS, MAX_REACH, casterLevel, reach, sliceSphere, splitDepths, type ShadowSetup } from "../../client/core/render/shadow.ts";
import { Rng } from "../../shared/rng.ts";

const MEDIUM: ShadowSetup = tierOf("medium").shadows;
const HIGH: ShadowSetup = tierOf("high").shadows;
const ULTRA: ShadowSetup = tierOf("ultra").shadows;
/** Medium on a phone, as the lighting design has it: the farther cascade every other frame. */
const PHONE: ShadowSetup = { ...MEDIUM, size: 1024, distance: 48, everyOther: true };
const SETUPS = [MEDIUM, HIGH, ULTRA, PHONE];
const f32 = Math.fround;

/** A unit vector toward a sun `elevation` degrees up, `azimuth` degrees round from +z toward +x. */
function sun(elevation: number, azimuth: number): [number, number, number] {
  const e = (elevation * Math.PI) / 180;
  const a = (azimuth * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}

function camera(x: number, y: number, z: number, yaw = 0, pitch = 0): Camera {
  const cam = new Camera();
  cam.x = x;
  cam.y = y;
  cam.z = z;
  cam.yaw = yaw;
  cam.pitch = pitch;
  return cam;
}

/** A camera-relative point through cascade i's matrix: x and y in texels of its map, z in steps of its depth. */
function texelOf(c: Cascades, i: number, size: number, x: number, y: number, z: number): [number, number, number] {
  const m = c.matrix;
  const k = i * 16;
  const at = (row: number): number => m[k + row]! * x + m[k + 4 + row]! * y + m[k + 8 + row]! * z + m[k + 12 + row]!;
  return [((at(0) + 1) / 2) * size, ((at(1) + 1) / 2) * size, ((at(2) + 1) / 2) * DEPTH_STEPS];
}

/** The same in float32 throughout, as the card works it from the packet's matrices and float32 camera-relative positions. */
function texelOnCard(m: Float32Array, i: number, size: number, x: number, y: number, z: number): [number, number, number] {
  const k = i * 16;
  const [fx, fy, fz] = [f32(x), f32(y), f32(z)];
  const at = (row: number): number => f32(f32(f32(f32(m[k + row]! * fx) + f32(m[k + 4 + row]! * fy)) + f32(m[k + 8 + row]! * fz)) + m[k + 12 + row]!);
  return [f32(f32(at(0) * 0.5 + 0.5) * size), f32(f32(at(1) * 0.5 + 0.5) * size), f32(f32(at(2) * 0.5 + 0.5) * DEPTH_STEPS)];
}

/** The eight corners of slice i of the view, camera-relative. */
function sliceCorners(cam: Camera, c: Cascades, i: number): number[][] {
  const corners: number[][] = [];
  const dir = [0, 0, 0];
  const cp = Math.cos(cam.pitch);
  const f = [Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp];
  for (const d of [c.splits[i]!, c.splits[i + 1]!]) {
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      cam.ray(sx, sy, dir);
      const along = dir[0]! * f[0]! + dir[1]! * f[1]! + dir[2]! * f[2]!;
      corners.push([(dir[0]! * d) / along, (dir[1]! * d) / along, (dir[2]! * d) / along]);
    }
  }
  return corners;
}

test("splits blend even and logarithmic spacing as the lighting design tabulates them", () => {
  const out = new Float64Array(5);
  const want = [[0.25, 9.6, 64], [0.25, 8.1, 26.4, 128], [0.25, 6.0, 15.8, 47.2, 192]];
  [MEDIUM, HIGH, ULTRA].forEach((s, t) => {
    splitDepths(0.25, s.distance, s.cascades, s.blend, out);
    want[t]!.forEach((d, k) => expect(Math.abs(out[k]! - d)).toBeLessThan(0.05));
  });
});

test("a slice's sphere is the smallest holding its eight corners, and texels are the design's at 70 degrees and 16:9", () => {
  const out = new Float64Array(2);
  const rng = new Rng(3);
  for (let n = 0; n < 500; n++) {
    const tanY = Math.tan(rng.range(0.1, 1.6) / 2);
    const aspect = rng.range(0.5, 3);
    const d0 = rng.range(0.05, 50);
    const d1 = d0 + rng.range(0.1, 200);
    sliceSphere(d0, d1, tanY, aspect, out);
    let far = 0;
    for (const d of [d0, d1]) {
      const lateral = d * tanY * Math.hypot(1, aspect);
      far = Math.max(far, Math.hypot(d - out[0]!, lateral));
    }
    expect(far).toBeLessThanOrEqual(out[1]! * (1 + 1e-12));
    expect(far).toBeGreaterThanOrEqual(out[1]! * (1 - 1e-12));
  }
  const c = new Cascades();
  const cam = camera(100, 20, 100);
  const texels = (s: ShadowSetup): number[] => {
    c.fit(cam, ...sun(40, 30), s, 0);
    return Array.from(c.texel.subarray(0, c.count), (t) => Math.round(t * 1000) / 10);
  };
  expect(texels(MEDIUM)).toEqual([1.3, 8.9]);
  expect(texels(HIGH)).toEqual([1.1, 3.7, 17.9]);
  expect(texels(ULTRA)).toEqual([0.8, 2.2, 6.6, 26.8]);
});

test("each cascade's square holds its slice of the view, turned any way, anywhere on the map", () => {
  const rng = new Rng(11);
  const c = new Cascades();
  let worst = 0;
  for (let n = 0; n < 300; n++) {
    const s = SETUPS[n % SETUPS.length]!;
    const cam = camera(rng.range(0, 8192), rng.range(-20, 400), rng.range(0, 8192), rng.range(-Math.PI, Math.PI), rng.range(-1.5, 1.5));
    cam.aspect = rng.range(0.6, 2.4);
    c.fit(cam, ...sun(rng.range(-1.9, 89), rng.range(0, 360)), s, 0);
    for (let i = 0; i < c.count; i++) {
      for (const [x, y, z] of sliceCorners(cam, c, i)) {
        const sp = Math.hypot(x! - c.sphere[i * 4]!, y! - c.sphere[i * 4 + 1]!, z! - c.sphere[i * 4 + 2]!);
        expect(sp).toBeLessThanOrEqual(c.sphere[i * 4 + 3]! * (1 + 1e-9));
        const [u, v, w] = texelOf(c, i, s.size, x!, y!, z!);
        worst = Math.max(worst, Math.abs(u / s.size - 0.5), Math.abs(v / s.size - 0.5), Math.abs(w / DEPTH_STEPS - 0.5));
      }
      // The whole sphere too, whose ends along the light space's axes are its widest there.
      for (const a of [0, 3, 6]) {
        for (const side of [-1, 1]) {
          const r = c.sphere[i * 4 + 3]! * side;
          const [u, v, w] = texelOf(c, i, s.size, c.sphere[i * 4]! + r * c.basis[a]!, c.sphere[i * 4 + 1]! + r * c.basis[a + 1]!, c.sphere[i * 4 + 2]! + r * c.basis[a + 2]!);
          worst = Math.max(worst, Math.abs(u / s.size - 0.5), Math.abs(v / s.size - 0.5), Math.abs(w / DEPTH_STEPS - 0.5));
        }
      }
    }
  }
  expect(worst).toBeLessThanOrEqual(0.5 + 1e-9);
});

test("a world point keeps its place in its shadow texel over 100 sub-texel camera moves and turns, 8 km from the origin", () => {
  const rng = new Rng(7);
  const report: string[] = [];
  for (const s of SETUPS) {
    const c = new Cascades();
    const cam = camera(8100.37, 61.2, 7950.81, 0.7, -0.2);
    const light = sun(30, 75);
    c.fit(cam, ...light, s, 0);
    const step = c.texel[0]!;
    // Points spread through the inner half of each sphere, which the slice keeps inside its square through the walk.
    const points: number[][] = [];
    for (let i = 0; i < c.count; i++) {
      for (let k = 0; k < 16; k++) {
        const r = c.sphere[i * 4 + 3]! * 0.5 * Math.cbrt(rng.float());
        const [a, b] = [rng.range(0, 2 * Math.PI), Math.acos(rng.range(-1, 1))];
        points.push([i, cam.x + c.sphere[i * 4]! + r * Math.sin(b) * Math.cos(a), cam.y + c.sphere[i * 4 + 1]! + r * Math.cos(b), cam.z + c.sphere[i * 4 + 2]! + r * Math.sin(b) * Math.sin(a)]);
      }
    }
    const matrices = new Float32Array(64);
    const spheres = new Float32Array(16);
    const start = points.map(([i, x, y, z]) => texelOf(c, i!, s.size, x! - cam.x, y! - cam.y, z! - cam.z));
    c.write(matrices, spheres);
    const startCard = points.map(([i, x, y, z]) => texelOnCard(matrices, i!, s.size, x! - cam.x, y! - cam.y, z! - cam.z));
    const unsnapped = (i: number, x: number, y: number, z: number): number => {
      const b = c.basis;
      const rx = x - cam.x - c.sphere[i * 4]!, ry = y - cam.y - c.sphere[i * 4 + 1]!, rz = z - cam.z - c.sphere[i * 4 + 2]!;
      return (rx * b[0]! + ry * b[1]! + rz * b[2]!) / c.texel[i]!;
    };
    const startLoose = points.map(([i, x, y, z]) => unsnapped(i!, x!, y!, z!));
    const off = (d: number): number => Math.abs(d - Math.round(d));
    let exact = 0, card = 0, depth = 0, cardDepth = 0, loose = 0, moved = 0;
    for (let n = 1; n <= 100; n++) {
      // Each move is under a texel of the finest cascade, so under one of every cascade.
      const a = rng.range(0, 2 * Math.PI), b = Math.acos(rng.range(-1, 1)), len = rng.range(0.05, 0.95) * step;
      cam.x += len * Math.sin(b) * Math.cos(a);
      cam.y += len * Math.cos(b);
      cam.z += len * Math.sin(b) * Math.sin(a);
      cam.yaw += rng.range(-0.002, 0.002);
      cam.pitch += rng.range(-0.001, 0.001);
      c.fit(cam, ...light, s, n);
      c.write(matrices, spheres);
      points.forEach(([i, x, y, z], p) => {
        const [u, v, w] = texelOf(c, i!, s.size, x! - cam.x, y! - cam.y, z! - cam.z);
        const [u0, v0, w0] = start[p]!;
        exact = Math.max(exact, off(u - u0), off(v - v0));
        depth = Math.max(depth, off(w - w0));
        moved = Math.max(moved, Math.abs(u - u0), Math.abs(v - v0));
        const [cu, cv, cw] = texelOnCard(matrices, i!, s.size, x! - cam.x, y! - cam.y, z! - cam.z);
        card = Math.max(card, off(cu - startCard[p]![0]!), off(cv - startCard[p]![1]!));
        cardDepth = Math.max(cardDepth, off(cw - startCard[p]![2]!));
        loose = Math.max(loose, off(unsnapped(i!, x!, y!, z!) - startLoose[p]!));
      });
    }
    report.push(`${s.cascades}x${s.size}/${s.distance}: ${exact.toExponential(1)} ${card.toExponential(1)} texel, depth ${depth.toExponential(1)} ${cardDepth.toExponential(1)} step, squares moved ${moved.toFixed(0)} texels, unsnapped ${loose.toFixed(2)}`);
    // Worked in double the place is exact; on the card it moves a few thousandths of a texel, under the 1/256 a texture unit resolves.
    expect(exact).toBeLessThan(1e-6);
    expect(depth).toBeLessThan(1e-6);
    expect(card).toBeLessThan(2e-3);
    expect(cardDepth).toBeLessThan(0.1);
    // The squares did move, by whole texels; without the snap the same walk slides points across their texels.
    expect(moved).toBeGreaterThan(2);
    expect(loose).toBeGreaterThan(0.3);
  }
  if (process.env.SHADOW_REPORT) console.log(report.join("\n"));
});

test("turning and moving leave every cascade's scale alone, and keep the matrices' offsets small enough for float32", () => {
  const rng = new Rng(5);
  for (const s of SETUPS) {
    const c = new Cascades();
    const light = sun(52, 200);
    c.fit(camera(4000, 50, 4000), ...light, s, 0);
    const first = new Float32Array(64);
    c.write(first, new Float32Array(16));
    const half = Array.from(c.half);
    const now = new Float32Array(64);
    for (let n = 0; n < 1000; n++) {
      const cam = camera(rng.range(0, 8192), rng.range(-20, 600), rng.range(0, 8192), rng.range(-Math.PI, Math.PI), rng.range(-1.55, 1.55));
      c.fit(cam, ...light, s, 2 * n);
      c.write(now, new Float32Array(16));
      expect(Array.from(c.half)).toEqual(half);
      for (let i = 0; i < c.count; i++) {
        for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(now[i * 16 + k]).toBe(first[i * 16 + k]!);
        for (const k of [12, 13, 14]) expect(Math.abs(c.matrix[i * 16 + k]!)).toBeLessThanOrEqual(1);
      }
    }
  }
});

test("a caster is taken where its shadow can reach a cascade and nowhere else", () => {
  const c = new Cascades();
  // Ground at 0, the camera 1.7 m up looking along +z, the sun 20 degrees up behind it.
  const cam = camera(1000, 1.7, 1000);
  cam.update();
  const light = sun(20, 180);
  c.fit(cam, ...light, MEDIUM, 0);
  const pillar = (z: number, x = 0, height = 10): [number, number, number, number, number, number] => [x - 0.5, -1.7, z - 0.5, x + 0.5, height - 1.7, z + 0.5];
  const stretch = reach(10, light[1]);
  expect(stretch).toBeCloseTo(10 / Math.sin((20 * Math.PI) / 180), 9);
  // 20 m behind the camera, out of view; its shadow is 27.5 m long and reaches 7.5 m ahead.
  expect(cam.boxVisible(...pillar(-20))).toBe(false);
  expect(c.mask(...pillar(-20), 0.5, stretch)).toBe(0b11);
  expect(c.mask(...pillar(-20), 0.5, 0)).toBe(0b10);
  // 80 m behind, its shadow ends 52 m behind the camera.
  expect(c.mask(...pillar(-80), 0.5, stretch)).toBe(0);
  // Beside the farthest square, and 150 m past the farthest sphere's centre away from the sun.
  expect(c.mask(...pillar(40, 130), 0.5, stretch)).toBe(0);
  const [bx, by, bz] = [c.sphere[4]! - 150 * light[0], c.sphere[5]! - 150 * light[1], c.sphere[6]! - 150 * light[2]];
  expect(c.mask(bx - 5, by - 5, bz - 5, bx + 5, by + 5, bz + 5, 5, stretch)).toBe(0);
  expect(c.mask(bx - 5, by - 5, bz - 5 - 100, bx + 5, by + 5, bz + 5, 5, stretch)).toBe(0b10);
  // A body is tested as a sphere.
  expect(c.sphereMask(0, 1, -20, 1, stretch)).toBe(0b11);
  expect(c.sphereMask(0, 1, -80, 1, stretch)).toBe(0);
  // Under 1.5 texels a caster leaves a cascade: 2.0 cm in medium's nearer, 13.4 cm in its farther.
  expect(c.mask(-0.1, -1.7, 2, 0.1, -1.5, 2.2, 0.05, stretch)).toBe(0b01);
  expect(c.mask(-0.1, -1.7, 2, 0.1, -1.5, 2.2, 0.015, stretch)).toBe(0);
  expect(c.mask(-0.1, -1.7, 2, 0.1, -1.5, 2.2, 0.2, stretch)).toBe(0b11);
});

test("no caster that can shade a receiver in a cascade is ever left out of it", () => {
  const rng = new Rng(19);
  const c = new Cascades();
  let checked = 0;
  for (let n = 0; n < 400; n++) {
    const s = SETUPS[n % SETUPS.length]!;
    const cam = camera(rng.range(0, 8192), rng.range(0, 300), rng.range(0, 8192), rng.range(-Math.PI, Math.PI), rng.range(-1.5, 1.5));
    const light = sun(rng.range(-1.9, 89), rng.range(0, 360));
    c.fit(cam, ...light, s, 0);
    const stretch = reach(rng.range(0, 80), light[1]);
    for (let k = 0; k < 10; k++) {
      const i = rng.int(c.count);
      // A receiver anywhere in the sphere, and a caster up to `stretch` toward the sun from it.
      const r = c.sphere[i * 4 + 3]! * Math.cbrt(rng.float());
      const [a, b] = [rng.range(0, 2 * Math.PI), Math.acos(rng.range(-1, 1))];
      const along = rng.range(0, stretch);
      const x = c.sphere[i * 4]! + r * Math.sin(b) * Math.cos(a) + light[0] * along;
      const y = c.sphere[i * 4 + 1]! + r * Math.cos(b) + light[1] * along;
      const z = c.sphere[i * 4 + 2]! + r * Math.sin(b) * Math.sin(a) + light[2] * along;
      expect(c.mask(x - 0.01, y - 0.01, z - 0.01, x + 0.01, y + 0.01, z + 0.01, 10, stretch) & (1 << i)).not.toBe(0);
      expect(c.sphereMask(x, y, z, 10, stretch) & (1 << i)).not.toBe(0);
      checked++;
    }
  }
  expect(checked).toBe(4000);
});

test("cleared, as the scene clears them while the sun casts nothing, the cascades take nothing, and the farthest is drawn again after", () => {
  const c = new Cascades();
  const cam = camera(1000, 1.7, 1000);
  const big: [number, number, number, number, number, number, number, number] = [-50, -2, -50, 50, 30, 50, 5, MAX_REACH];
  c.fit(cam, ...sun(10, 90), HIGH, 0);
  expect([c.count, c.mask(...big)]).toEqual([3, 0b111]);
  c.clear();
  expect([c.count, c.drawn, c.mask(...big), c.sphereMask(0, 0, 5, 5, MAX_REACH)]).toEqual([0, 0, 0, 0]);
  // After a night the farthest cascade is drawn again, even on a frame it would otherwise have kept.
  c.fit(cam, ...sun(1, 90), PHONE, 0);
  c.fit(cam, ...sun(1, 90), PHONE, 1);
  expect(c.drawn).toBe(0b01);
  c.clear();
  c.fit(cam, ...sun(1, 90), PHONE, 3);
  expect(c.drawn).toBe(0b11);
});

test("reach is a caster's height over the sine of the sun's elevation, up to 192 m", () => {
  expect(reach(30, Math.sin((66.7 * Math.PI) / 180))).toBeCloseTo(32.66, 2);
  expect(reach(30, Math.sin((10 * Math.PI) / 180))).toBeCloseTo(172.76, 2);
  expect(reach(30, Math.sin((5 * Math.PI) / 180))).toBe(MAX_REACH);
  expect(reach(30, -0.01)).toBe(MAX_REACH);
  expect(reach(0, 0.5)).toBe(0);
});

test("a caster's level is the coarsest the card holds within a texel, grouped into one entry per level", () => {
  const errors = [0, 0.004, 0.012, 0.05, 0.2];
  const all = 0b11111;
  expect(casterLevel(errors, 0.0134, all)).toBe(2);
  expect(casterLevel(errors, 0.0893, all)).toBe(3);
  expect(casterLevel(errors, 0.0893, 0b10111)).toBe(2);
  expect(casterLevel(errors, 0.0893, 0b10000)).toBe(4);
  expect(casterLevel(errors, 0.0893, 0b00001)).toBe(0);
  expect(casterLevel(errors, 0.0893, 0)).toBe(-1);
  expect(casterLevel(errors, 1, all)).toBe(4);

  const c = new Cascades();
  c.fit(camera(500, 2, 500), ...sun(45, 10), ULTRA, 0);
  const out = new Uint8Array(8);
  // Ultra's texels are 0.8, 2.2, 6.6 and 26.8 cm.
  expect(Array.from(out.subarray(0, 2 * c.entries(0b1111, errors, all, out)))).toEqual([1, 0b0001, 2, 0b0010, 3, 0b0100, 4, 0b1000]);
  expect(Array.from(out.subarray(0, 2 * c.entries(0b1110, errors, 0b00111, out)))).toEqual([2, 0b1110]);
  expect(Array.from(out.subarray(0, 2 * c.entries(0b0101, [0, 0.001], 0b11, out)))).toEqual([1, 0b0101]);
  expect(c.entries(0b1111, errors, 0, out)).toBe(0);
});

test("drawn every other frame, the farthest cascade keeps its square while that holds its slice", () => {
  const c = new Cascades();
  const cam = camera(2000, 10, 2000, 1, -0.1);
  const light = sun(35, 120);
  c.fit(cam, ...light, PHONE, 0);
  expect(c.drawn).toBe(0b11);
  const point = [cam.x + c.sphere[4]!, cam.y + c.sphere[5]! - 3, cam.z + c.sphere[6]!];
  const [u0, v0, w0] = texelOf(c, 1, PHONE.size, point[0]! - cam.x, point[1]! - cam.y, point[2]! - cam.z);
  const centre = Array.from(c.centre.subarray(3, 6));
  // A walking step and a small turn: kept, and its matrix still puts the world where it was drawn.
  cam.x += 0.06;
  cam.yaw += 0.01;
  c.fit(cam, ...light, PHONE, 1);
  expect(c.drawn).toBe(0b01);
  expect(Array.from(c.centre.subarray(3, 6))).toEqual(centre);
  const [u1, v1, w1] = texelOf(c, 1, PHONE.size, point[0]! - cam.x, point[1]! - cam.y, point[2]! - cam.z);
  expect(Math.max(Math.abs(u1 - u0), Math.abs(v1 - v0), Math.abs(w1 - w0))).toBeLessThan(1e-6);
  c.fit(cam, ...light, PHONE, 2);
  expect(c.drawn).toBe(0b11);
  // A sharp turn moves the slice out of the square, and a step of the sun turns the light space: either redraws it.
  cam.yaw += 0.5;
  c.fit(cam, ...light, PHONE, 3);
  expect(c.drawn).toBe(0b11);
  c.fit(cam, ...light, PHONE, 4);
  c.fit(cam, ...sun(35.05, 120), PHONE, 5);
  expect(c.drawn).toBe(0b11);

  // Over a walk turning up to 2 degrees a frame, every kept square still holds its slice.
  const rng = new Rng(23);
  let kept = 0;
  for (let n = 6; n < 600; n++) {
    cam.x += rng.range(-0.15, 0.15);
    cam.z += rng.range(-0.15, 0.15);
    cam.yaw += rng.range(-0.035, 0.035);
    cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + rng.range(-0.02, 0.02)));
    c.fit(cam, ...light, PHONE, n);
    if ((c.drawn & 0b10) !== 0) continue;
    kept++;
    for (const [x, y, z] of sliceCorners(cam, c, 1)) {
      const [u, v, w] = texelOf(c, 1, PHONE.size, x!, y!, z!);
      expect(Math.max(Math.abs(u / PHONE.size - 0.5), Math.abs(v / PHONE.size - 0.5), Math.abs(w / DEPTH_STEPS - 0.5))).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  }
  expect(kept).toBeGreaterThan(200);
});
