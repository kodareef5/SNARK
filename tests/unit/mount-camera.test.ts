import { expect, test } from "bun:test";
import { CameraBody } from "../../client/core/camera-body.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { Viewpoint } from "../../client/core/viewpoint.ts";
import { Solved, type Skeleton } from "../../shared/anim/skeleton.ts";
import { flatWorld } from "../fixtures/world.ts";
import { capsuleFree, groundUnder } from "../../shared/world/collide.ts";
import { castWorld, HIT_NONE } from "../../shared/world/ray.ts";

// A long body with a tall rear plate: the upward orbit crosses both, unlike an eye-height sphere.
function body(): CameraBody {
  const rig: Skeleton = { id: "test:camera", bones: 2, names: ["body", "plate"], parent: new Int8Array([-1, 0]),
    rest: new Float32Array(6), zoneBones: 2, zone: new Uint8Array([1, 1]),
    capA: new Float32Array([0, 1, -3, 0, 2, -1]), capB: new Float32Array([0, 1, 2, 0, 4, -1]), capR: new Float32Array([1, .12]) };
  const solved = new Solved(2); solved.rot[3] = solved.rot[7] = 1;
  return new CameraBody().set(rig, solved, 9, 2, 1, 0, 64, 0, 64, 0);
}

test("a mount camera clears its animated body and near-plane corners through continuous and abrupt upward orbits", () => {
  const obstruction = body(), cam = new Camera(), view = new Viewpoint(), ray = new Float64Array(3);
  let shortened = 0;
  for (const aspect of [4 / 3, 16 / 9, 21 / 9]) for (const fov of [70, 100]) {
    cam.aspect = aspect; cam.fovY = fov * Math.PI / 180;
    for (let i = 0; i < 72; i++) {
      const yaw = i * Math.PI / 36, pitch = i % 4 === 0 ? 1.3 : .3 + i / 80;
      view.placeVehicle(cam, null, 64, 4.7, 64.65, yaw, pitch, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
      expect(cam.yaw).toBe(yaw); expect(cam.pitch).toBe(Math.max(-1.35, Math.min(1.15, pitch - .12)));
      expect([cam.x, cam.y, cam.z].every(Number.isFinite)).toBe(true);
      if (Math.hypot(cam.x - 64, cam.y - 4.7, cam.z - 64.65) < 6) shortened++;
      for (const u of [0, .5, 1]) for (const v of [0, .5, 1]) {
        cam.ray(u, v, ray);
        // The entire segment to each near-plane sample is clear; testing just the camera centre misses clipping corners.
        const forward = ray[0]! * Math.sin(cam.yaw) * Math.cos(cam.pitch) + ray[1]! * Math.sin(cam.pitch) + ray[2]! * Math.cos(cam.yaw) * Math.cos(cam.pitch);
        const length = cam.near / forward;
        expect(obstruction.cast(cam.x, cam.y, cam.z, ray[0]!, ray[1]!, ray[2]!, length, 0)).toBe(length);
      }
    }
  }
  expect(shortened).toBeGreaterThan(50);
});

test("body collision also clips a host-switch ease, recovers an engulfed anchor, and combines with a nearer wall", () => {
  const obstruction = body(), cam = new Camera(), view = new Viewpoint(), world = flatWorld();
  view.place(cam, null, 64, 1, 60, 0, 0);
  for (let n = 0; n < 24; n++) {
    view.placeVehicle(cam, null, 64, 4.7, 64.65, 0, .9, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
    expect(obstruction.cast(cam.x, cam.y, cam.z, 0, 1, 0, .001, .4)).toBe(.001);
  }
  view.placeVehicle(cam, null, 64, 1, 64, 0, 1.3, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
  expect(obstruction.cast(cam.x, cam.y, cam.z, 0, 1, 0, .001, .4)).toBe(.001);
  // A high anchor and level view clear the plate; a wall behind the body is still the nearer obstruction.
  const stone = world.reg.index.get("core:wall_stone")!;
  for (const y of [1.5, 4.5, 7.5]) world.structs.add(stone, 64, y, 62, 0, 1, 10000);
  for (let n = 0; n < 30; n++) view.placeVehicle(cam, world, 64, 4.7, 64.65, 0, 0, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
  expect(cam.z).toBeGreaterThan(62.2); expect(cam.z).toBeLessThan(64.65);
});

test("posed camera obstruction rotates and scales once, and clearing it removes old body collisions", () => {
  const obstruction = body(), rig = obstruction.rig!, solved = obstruction.solved!;
  for (const size of [.25, .6, 1]) for (const yaw of [0, Math.PI / 2, Math.PI]) {
    obstruction.set(rig, solved, 9, 2, 1, 0, 6000, 23, 4000, yaw, size, 4.13);
    expect(obstruction.standingHeight).toBe(4.13 * size);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hit = obstruction.cast(6000 + c * 4 * size, 23 + size, 4000 - s * 4 * size, -c, 0, s, 8 * size, .2 * size);
    expect(hit).toBeCloseTo(2.8 * size, 6);
  }
  obstruction.clear();
  expect(obstruction.cast(6000, 23, 4000, 0, 1, 0, 20, 1)).toBe(20);
});

test("slow upward look has a continuous camera route above a tall plate instead of snapping at its tangent", () => {
  const obstruction = body(), cam = new Camera(), view = new Viewpoint();
  let x = 0, y = 0, z = 0, most = 0;
  for (let frame = 0; frame <= 300; frame++) {
    const pitch = -.25 + frame * .005;
    view.placeVehicle(cam, null, 64, 4.7, 64.65, 0, pitch, 0, 0, 1000 / 60, false, { vx: 0, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
    if (frame) most = Math.max(most, Math.hypot(cam.x - x, cam.y - y, cam.z - z));
    expect(cam.y).toBeGreaterThanOrEqual(obstruction.top(0));
    expect(cam.pitch).toBe(Math.min(1.15, pitch - .12));
    x = cam.x; y = cam.y; z = cam.z;
  }
  // A .005-radian step on this boom travels under 4cm. Grazing a plate must not add a metres-long discontinuity.
  expect(most).toBeLessThan(.06);
});

test("lowering a charging head below the authored focus does not drop a skyward camera", () => {
  const obstruction = body(), rig = obstruction.rig!, solved = obstruction.solved!, cam = new Camera(), view = new Viewpoint();
  let height = 0;
  for (let frame = 0; frame < 120; frame++) {
    // Alternate the posed high bone between raised and charging postures. Both remain below the authored focus.
    solved.pos[4] = frame % 40 < 20 ? 0 : -1;
    obstruction.set(rig, solved, 9, 2, 1, frame, 64, 0, 64, 0);
    view.placeVehicle(cam, null, 64, 4.9, 64.65, 0, .9, 0, 0, 1000 / 60, false, { vx: 0, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
    if (frame) expect(cam.y).toBe(height);
    expect(cam.y).toBeGreaterThanOrEqual(4.9);
    height = cam.y;
  }
});

test("an engulfed padded anchor cannot escape through a low roof when the real plate fits below it", () => {
  const obstruction = body(), cam = new Camera(), view = new Viewpoint(), world = flatWorld(), ray = new Float64Array(3);
  // Plate top 4.12 m; ceiling underside 4.30 m. There is room for the animal but not a camera above its plate.
  world.structs.add(world.kind("core:ceiling"), 64, 4.4, 63, 0, 1, 100);
  for (const wall of [false, true]) {
    if (wall) for (const y of [1.5, 4.5]) world.structs.add(world.kind("core:wall_stone"), 64, y, 62, 0, 1, 100);
    // Both an anchor initially below the roof and one authored above it must stay in the enclosure.
    for (const anchor of [4.2, 4.65]) for (const pitch of [0, .65, .9, 1.3]) for (let frame = 0; frame < 8; frame++) {
      view.placeVehicle(cam, world, 64, anchor, 63, 0, pitch, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
      expect(cam.y).toBeLessThan(4.2);
      expect(obstruction.cast(cam.x, cam.y, cam.z, 0, 1, 0, .001, .4)).toBe(.001);
      for (const u of [0, .5, 1]) for (const v of [0, .5, 1]) {
        cam.ray(u, v, ray);
        const forward = ray[1]! * Math.sin(cam.pitch) + ray[2]! * Math.cos(cam.pitch);
        const length = cam.near / forward;
        expect(castWorld(world, cam.x, cam.y, cam.z, ray[0]!, ray[1]!, ray[2]!, length)).toBe(HIT_NONE);
      }
    }
  }
});

test("a mount camera approaches and leaves a low roof continuously with the animal or camera entering first", () => {
  const obstruction = body(), rig = obstruction.rig!, solved = obstruction.solved!, world = flatWorld(), ray = new Float64Array(3);
  world.structs.add(world.kind("core:ceiling"), 64, 4.4, 63, 0, 1, 100);
  for (const yaw of [0, -Math.PI / 2, Math.PI / 2]) for (const pitch of [0, .9]) {
    const cam = new Camera(), view = new Viewpoint();
    cam.aspect = 16 / 9; cam.fovY = 70 * Math.PI / 180;
    let x = 0, y = 0, z = 0, most = 0;
    for (let frame = 0; frame <= 1200; frame++) {
      const originX = 54 + frame / 60;
      obstruction.set(rig, solved, 9, 2, 1, frame, originX, 0, 64, 0);
      view.placeVehicle(cam, world, originX, 4.65, 63, yaw, pitch, 0, 1, 1000 / 60, false, { vx: 1, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
      if (frame) most = Math.max(most, Math.hypot(cam.x - x, cam.y - y, cam.z - z));
      expect(obstruction.cast(cam.x, cam.y, cam.z, 0, 1, 0, .001, .4)).toBe(.001);
      if (frame % 10 === 0) for (const u of [0, .5, 1]) for (const v of [0, .5, 1]) {
        cam.ray(u, v, ray);
        const forward = ray[0]! * Math.sin(cam.yaw) * Math.cos(cam.pitch) + ray[1]! * Math.sin(cam.pitch) + ray[2]! * Math.cos(cam.yaw) * Math.cos(cam.pitch);
        expect(castWorld(world, cam.x, cam.y, cam.z, ray[0]!, ray[1]!, ray[2]!, cam.near / forward)).toBe(HIT_NONE);
      }
      x = cam.x; y = cam.y; z = cam.z;
    }
    // One metre per second is 1.67 cm per frame. A gradual roof approach may add vertical travel, not a metres-long cut.
    expect(most).toBeLessThan(.05);
  }
});

test("a low obstacle behind a passing mount does not pull an otherwise clear camera underneath it", () => {
  const obstruction = body(), rig = obstruction.rig!, solved = obstruction.solved!;
  for (const obstacle of ["core:ceiling", "core:zslope_slab30"]) for (const pitch of [0, .9]) {
    const world = flatWorld(), kind = world.kind(obstacle);
    // Both pieces are behind the animal. The sloped piece has a high end but no continuous, passable underside.
    world.structs.add(kind, 64, .3 + world.reg.halfY[kind]!, 60, 0, 1, 100);
    const cam = new Camera(), control = new Camera(), view = new Viewpoint(), free = new Viewpoint();
    cam.aspect = control.aspect = 16 / 9; cam.fovY = control.fovY = 70 * Math.PI / 180;
    for (let frame = 0; frame <= 600; frame++) {
      const x = 59 + frame / 60;
      obstruction.set(rig, solved, 9, 2, 1, frame, x, 0, 67, 0, 1, 4.13);
      const motion = { vx: 1, vy: 0, vz: 0, id: 9, boom: 7.5 };
      view.placeVehicle(cam, world, x, 4.65, 66, 0, pitch, 0, 1, 1000 / 60, false, motion, obstruction);
      free.placeVehicle(control, null, x, 4.65, 66, 0, pitch, 0, 1, 1000 / 60, false, motion, obstruction);
      expect(cam.x).toBe(control.x); expect(cam.y).toBe(control.y); expect(cam.z).toBe(control.z);
    }
  }
});

test("an overhead wide view begins its roof descent early enough to retain a gentle continuous path", () => {
  const obstruction = body(), rig = obstruction.rig!, solved = obstruction.solved!, world = flatWorld(), ray = new Float64Array(3);
  const roof = world.kind("core:zslope_slab30");
  world.structs.add(roof, 64, 4.3 + world.reg.halfY[roof]!, 63, 8192, 1, 100);
  const cam = new Camera(), view = new Viewpoint();
  cam.aspect = 21 / 9; cam.fovY = 100 * Math.PI / 180;
  let x = 0, y = 0, z = 0, most = 0;
  for (let frame = 0; frame <= 2160; frame++) {
    const originX = 46 + frame / 60;
    obstruction.set(rig, solved, 9, 2, 1, frame, originX, 0, 64, 0, 1, 4.13);
    view.placeVehicle(cam, world, originX, 4.65, 63, 0, -1.23, 0, 1, 1000 / 60, false, { vx: 1, vy: 0, vz: 0, id: 9, boom: 9 }, obstruction);
    if (frame) most = Math.max(most, Math.hypot(cam.x - x, cam.y - y, cam.z - z));
    if (frame % 10 === 0) for (const u of [0, .5, 1]) for (const v of [0, .5, 1]) {
      cam.ray(u, v, ray);
      const forward = ray[1]! * Math.sin(cam.pitch) + ray[2]! * Math.cos(cam.pitch);
      expect(castWorld(world, cam.x, cam.y, cam.z, ray[0]!, ray[1]!, ray[2]!, cam.near / forward)).toBe(HIT_NONE);
    }
    x = cam.x; y = cam.y; z = cam.z;
  }
  expect(most).toBeLessThan(.05);
});


test("a partial sloped roof leaves the whole view clear when a dinosaur fits under its high side", () => {
  const cam = new Camera(), ray = new Float64Array(3);
  cam.aspect = 16 / 9; cam.fovY = 70 * Math.PI / 180;
  for (const height of [3.17, 4.13]) {
    const world = flatWorld(), roof = world.kind("core:zslope_slab30"), obstruction = body();
    const rig = obstruction.rig!; rig.capB[4] = height - .13;
    world.structs.add(roof, 64, height - .6 + world.reg.halfY[roof]!, 64, 0, 1, 100);
    obstruction.set(rig, obstruction.solved!, 9, 2, 1, 0, 64, 0, 64, 0, 1, height);
    const half = cam.near * Math.tan(cam.fovY / 2), radius = Math.hypot(cam.near, half, half * cam.aspect) + .02;
    for (const yaw of [0, Math.PI / 2]) for (const pitch of [0, .65, .9, 1.3]) {
      const view = new Viewpoint();
      view.placeVehicle(cam, world, 64, height + .52, 63, yaw, pitch, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
      expect(obstruction.cast(cam.x, cam.y, cam.z, 0, 1, 0, .001, radius)).toBe(.001);
      for (const u of [0, .5, 1]) for (const v of [0, .5, 1]) {
        cam.ray(u, v, ray);
        const front = (ray[0]! * Math.sin(yaw) + ray[2]! * Math.cos(yaw)) * Math.cos(cam.pitch) + ray[1]! * Math.sin(cam.pitch);
        expect(castWorld(world, cam.x, cam.y, cam.z, ray[0]!, ray[1]!, ray[2]!, cam.near / front)).toBe(HIT_NONE);
      }
    }
  }
});

test("crossing the passable edge of a low sloped roof keeps the chase view continuous", () => {
  const height = 3.17, obstruction = body(), rig = obstruction.rig!, solved = obstruction.solved!;
  const cam = new Camera(), view = new Viewpoint(), world = flatWorld(), kind = world.kind("core:zslope_slab30");
  world.structs.add(kind, 64, height - .3 + world.reg.halfY[kind]!, 64, 0, 1, 100);
  cam.aspect = 16 / 9;
  cam.fovY = 70 * Math.PI / 180;
  let previousX = 0, previousY = 0, previousZ = 0, maxStep = 0;
  for (let frame = 0; frame <= 1200; frame++) {
    const x = 54 + frame / 60;
    obstruction.set(rig, solved, 9, 2, 1, frame, x, 0, 64, 0, 1, height);
    view.placeVehicle(cam, world, x, height + .52, 63, 0, 0, 0, 1, 1000 / 60, false, { vx: 1, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
    if (frame) maxStep = Math.max(maxStep, Math.hypot(cam.x - previousX, cam.y - previousY, cam.z - previousZ));
    previousX = cam.x; previousY = cam.y; previousZ = cam.z;
  }
  expect(maxStep).toBeLessThan(.05);
});

test("the ultrawide chase camera travels under the low side of a roof with its entire rendered near plane clear", () => {
  const cam = new Camera(), obstruction = body(), rig = obstruction.rig!, solved = obstruction.solved!;
  const height = 4.13, world = flatWorld(), roof = world.kind("core:zslope_slab30");
  world.structs.add(roof, 64, 1.25 + world.reg.halfY[roof]!, 62, 0, 1, 100);
  cam.aspect = 21 / 9; cam.fovY = 100 * Math.PI / 180; cam.split = 384;
  const view = new Viewpoint(), ray = new Float64Array(3);
  let previousX = 0, previousY = 0, previousZ = 0, maxStep = 0, narrowest = cam.near;
  for (let frame = 0; frame <= 2400; frame++) {
    const x = 44 + frame / 60;
    obstruction.set(rig, solved, 9, 2, 1, frame, x, 0, 64, 0, 1, height);
    view.placeVehicle(cam, world, x, height + .52, 63, 0, 0, 0, 1, 1000 / 60, false,
      { vx: 1, vy: 0, vz: 0, id: 9, boom: 7.5 }, obstruction);
    if (frame) maxStep = Math.max(maxStep, Math.hypot(cam.x - previousX, cam.y - previousY, cam.z - previousZ));
    previousX = cam.x; previousY = cam.y; previousZ = cam.z;
    narrowest = Math.min(narrowest, cam.near);
    if (frame % 10 !== 0) continue;
    const half = cam.near * Math.tan(cam.fovY / 2), radius = Math.hypot(cam.near, half, half * cam.aspect) + .02;
    expect(capsuleFree(world, cam.x, cam.y - radius, cam.z, radius, 2 * radius)).toBe(true);
    expect(obstruction.cast(cam.x, cam.y, cam.z, 0, 1, 0, .001, radius)).toBe(.001);
    // Confirm the plane actually drawn by both projection matrices, including their depth split.
    cam.update();
    cam.ray(.5, .5, ray);
    for (const matrix of [cam.viewProj, cam.ranges[0]]) {
      const z = cam.near * (matrix[2]! * ray[0]! + matrix[6]! * ray[1]! + matrix[10]! * ray[2]!) + matrix[14]!;
      expect(z / cam.near).toBeCloseTo(-1, 5);
    }
  }
  expect(narrowest).toBeGreaterThanOrEqual(.05);
  expect(narrowest).toBeLessThan(.2);
  expect(maxStep).toBeLessThan(.05);
  expect(cam.near).toBe(.25);
  // A direct mount, dismount or cockpit transition restores the caller's own projection, including a custom near plane.
  cam.near = .3;
  for (const mode of ["on foot", "vehicle", "cockpit"]) {
    obstruction.set(rig, solved, 9, 2, 1, 0, 64, 0, 64, 0, 1, height);
    view.placeVehicle(cam, world, 64, height + .52, 63, 0, 0, 0, 0, 16, false, undefined, obstruction);
    expect(cam.near).toBeLessThan(.2);
    if (mode === "on foot") view.place(cam, world, 64, 1.6, 64, 0, 0);
    if (mode === "vehicle") view.placeVehicle(cam, world, 64, 2, 64, 0, 0, 0, 0, 16);
    if (mode === "cockpit") view.placeCockpit(cam, 64, 2, 64, { x: 64, y: 2, z: 64, yaw: 0, pitch: 0, roll: 0 }, 0, 0);
    expect(cam.near).toBe(.3);
  }
});

test("a mounted camera rounds the high edge when a pitched slab's low lip meets rising ground", () => {
  const world = flatWorld(), roof = world.kind("core:zslope_slab30"), { hf } = world;
  const height = 3.17, obstruction = body(), rig = obstruction.rig!, solved = obstruction.solved!;
  rig.capB[4] = height - .13;
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    hf.setSample(i, j, (i * hf.cell - 64) * -.06 + (j * hf.cell - 64) * -.10);
  }
  world.structs.add(roof, 64, .7 + world.reg.halfY[roof]!, 62, 0, 1, 100);
  for (const path of ["traverse", "orbit", "enclosure"]) {
    const orbit = path === "orbit", enclosure = path === "enclosure";
    if (enclosure) for (let x = 61; x <= 67; x += 3) for (let z = 60; z <= 72; z += 3) {
      world.structs.add(world.kind("core:ceiling_stone"), x, 6.25, z, 0, 1, 100);
    }
    const view = new Viewpoint(), cam = new Camera(), frames = orbit ? 600 : 1200;
    cam.aspect = 21 / 9; cam.fovY = 100 * Math.PI / 180;
    let x0 = 0, y0 = 0, z0 = 0, maxStep = 0;
    for (let i = 0; i <= frames; i++) {
      const x = path === "traverse" ? 54 + i / 60 : 64, z = enclosure ? 74 - i / 60 : 64;
      const y = groundUnder(hf, x, z, 1.25);
      if (!capsuleFree(world, x, y, z, 1.25, height)) {
        expect(enclosure && i > 300).toBe(true);
        break;
      }
      const yaw = orbit ? -Math.PI + i / frames * 2 * Math.PI : 0;
      const heading = enclosure ? Math.PI : 0;
      obstruction.set(rig, solved, 9, 2, 1, i, x, y, z, heading, 1, height);
      view.placeVehicle(cam, world, x, y + 4.9, z + Math.cos(heading), yaw, orbit || enclosure ? .9 : 0, heading, orbit ? 0 : 1, 1000 / 60,
        false, { id: 9, vx: path === "traverse" ? 1 : 0, vy: 0, vz: enclosure ? -1 : 0, boom: 9 }, obstruction);
      const half = cam.near * Math.tan(cam.fovY / 2), radius = Math.hypot(cam.near, half, half * cam.aspect) + .02;
      expect(capsuleFree(world, cam.x, cam.y - radius, cam.z, radius, 2 * radius)).toBe(true);
      expect(obstruction.cast(cam.x, cam.y, cam.z, 0, 1, 0, .001, radius)).toBe(.001);
      if (i) maxStep = Math.max(maxStep, Math.hypot(cam.x - x0, cam.y - y0, cam.z - z0));
      x0 = cam.x; y0 = cam.y; z0 = cam.z;
    }
    expect(maxStep).toBeLessThan(enclosure ? .15 : orbit ? .12 : .05);
  }
});

test("a newly visible sloped roof leaves a continuous route back into view of the saddle", () => {
  const world = flatWorld(), { hf } = world, slab = world.kind("core:zslope_slab30");
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    hf.setSample(i, j, -.06 * (i * hf.cell - 64) - .10 * (j * hf.cell - 64));
  }
  const mount = body(), rig = { ...mount.rig!, sockets: new Map([["seat", { bone: 0, x: 0, y: 2.9, z: 0 }]]) };
  const y = groundUnder(hf, 64, 64, 1.25);
  mount.set(rig, mount.solved!, 9, 2, 1, 0, 64, y, 64, 0, 1, 3.17);
  const cam = new Camera(), view = new Viewpoint(), motion = { id: 9, vx: 0, vy: 0, vz: 0, boom: 9 };
  cam.fovY = 100 * Math.PI / 180; cam.aspect = 21 / 9;
  const focus = new Float64Array(6);
  expect(mount.saddleFocus(focus)).toBe(true);
  const sight = (slot: number) => {
    const dx = focus[slot]! - cam.x, dy = focus[slot + 1]! - cam.y, dz = focus[slot + 2]! - cam.z;
    const reach = Math.hypot(dx, dy, dz);
    return castWorld(world, cam.x, cam.y, cam.z, dx / reach, dy / reach, dz / reach, reach);
  };
  for (let frame = 0; frame < 200; frame++) {
    if (frame === 10) {
      world.structs.add(slab, 64, .7 + world.reg.halfY[slab]!, 62, 0, 1, 100);
      expect(sight(0)).not.toBe(HIT_NONE);
    }
    const x = cam.x, y0 = cam.y, z = cam.z;
    view.placeVehicle(cam, world, 64, y + 4.9, 65, 0, 0, 0, 0, 1000 / 60, false, motion, mount);
    if (frame > 0) expect(Math.hypot(cam.x - x, cam.y - y0, cam.z - z)).toBeLessThan(.15);
  }
  expect(sight(0)).toBe(HIT_NONE);
  expect(sight(3)).toBe(HIT_NONE);
  expect(cam.yaw).toBe(0);
  expect(cam.pitch).toBe(-.12);
});
