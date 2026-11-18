import { expect, test } from "bun:test";
import { ORBIT_FAR, ORBIT_NEAR, ORBIT_NOTCH, Orbit, rig, type OrbitRig } from "../../client/core/orbit.ts";
import { CHASE_DOWN, CHASE_UP, EASE_MS, ORBIT_BACK, Viewpoint } from "../../client/core/viewpoint.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { HIT_NONE, castWorld } from "../../shared/world/ray.ts";
import { flatWorld } from "../fixtures/world.ts";

const at = (yaw: number, pitch: number, back = 0, side = 0, rise = 0): OrbitRig => ({ yaw, pitch, back, side, rise });

test("the orbit's camera sits on its bearing at its distance from the pivot and looks at it", () => {
  const vp = new Viewpoint(), cam = new Camera(), out = [0, 0, 0];
  for (const [yaw, pitch, back] of [[0, 0, 3.4], [1.2, -.6, 5], [-2.5, .9, 1.5], [7, CHASE_DOWN, 10]] as const) {
    vp.placeRig(cam, null, 10, 2, 10, at(yaw, pitch, back));
    expect(cam.x).toBeCloseTo(10 - Math.sin(yaw) * Math.cos(pitch) * back, 9);
    expect(cam.y).toBeCloseTo(2 - Math.sin(pitch) * back, 9);
    expect(cam.z).toBeCloseTo(10 - Math.cos(yaw) * Math.cos(pitch) * back, 9);
    expect([cam.yaw, cam.pitch, cam.roll]).toEqual([yaw, pitch, 0]);
    cam.update();
    expect(cam.project(10, 2, 10, out)).toBe(true);
    // The view's matrix is single precision.
    expect(out[0]!).toBeCloseTo(.5, 5);
    expect(out[1]!).toBeCloseTo(.5, 5);
    expect(out[2]!).toBeCloseTo(back, 4);
  }
  // The player's own view through the same rig is exactly the place it always had.
  const a = new Camera(), b = new Camera(), w = flatWorld();
  vp.thirdPerson = true;
  vp.place(a, w, 64, 1.62, 64, .4, -.3);
  vp.placeRig(b, w, 64, 1.62, 64, vp.own(rig(), .4, -.3));
  expect([b.x, b.y, b.z, b.yaw, b.pitch]).toEqual([a.x, a.y, a.z, a.yaw, a.pitch]);
});

test("the orbit keeps its pitch to the chase camera's limits and its distance to its shares, and looks one to one", () => {
  const o = new Orbit(), view = at(.3, -.2);
  expect(o.place(view, ORBIT_BACK, 16)).toBeNull();
  // Off, it takes neither look nor wheel.
  o.look(1, 1);
  expect(o.wheel(1)).toBe(false);
  expect([o.yaw, o.pitch, o.zoom]).toEqual([0, 0, 1]);
  o.set(true);
  const first = o.place(view, ORBIT_BACK, 16)!;
  // Its first frame is the view it came from, then it pulls back along the same bearing.
  expect([first.yaw, first.pitch, first.back, first.side, first.rise]).toEqual([.3, -.2, 0, 0, 0]);
  o.look(.25, 0);
  expect(o.place(view, ORBIT_BACK, 16)!.yaw).toBeCloseTo(.55, 12);
  o.look(0, 10);
  expect(o.pitch).toBe(CHASE_UP);
  o.look(0, -10);
  expect(o.pitch).toBe(CHASE_DOWN);
  for (let i = 0; i < 40; i++) o.place(view, ORBIT_BACK, 16);
  expect(o.shown.back).toBeCloseTo(ORBIT_BACK, 9);
  // A notch is a fixed share; a flung wheel moves at most three notches an event; the shares bound it either way.
  expect(o.wheel(1)).toBe(true);
  expect(o.zoom).toBeCloseTo(ORBIT_NOTCH, 12);
  o.wheel(-1);
  o.wheel(100);
  expect(o.zoom).toBeCloseTo(ORBIT_NOTCH ** 3, 12);
  for (let i = 0; i < 20; i++) o.wheel(100);
  expect(o.zoom).toBe(ORBIT_FAR);
  for (let i = 0; i < 20; i++) o.wheel(-100);
  expect(o.zoom).toBe(ORBIT_NEAR);
  expect(o.wheel(NaN)).toBe(false);
  // The shown distance follows the wheel within a few frames, no frame taking a fifth of the way.
  let last = o.place(view, ORBIT_BACK, 16)!.back;
  const way = last - ORBIT_BACK * ORBIT_NEAR;
  for (let i = 0; i < 30; i++) {
    const back = o.place(view, ORBIT_BACK, 16)!.back;
    expect(Math.abs(back - last)).toBeLessThan(way / 5);
    last = back;
  }
  expect(last).toBeCloseTo(ORBIT_BACK * ORBIT_NEAR, 2);
});

test("the orbit starts and ends without a jump, ends on the view the player has, and a press mid-ease turns it round smoothly", () => {
  const o = new Orbit(), third = at(1, .1, 3.4, .55, .25);
  o.set(true);
  const step = (view: OrbitRig): OrbitRig => ({ ...o.place(view, ORBIT_BACK, 16)! });
  let prev = step(third);
  expect(prev).toEqual(third);
  const jump = (a: OrbitRig, b: OrbitRig): number => Math.max(Math.abs(Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw))), Math.abs(a.pitch - b.pitch), Math.abs(a.back - b.back), Math.abs(a.side - b.side), Math.abs(a.rise - b.rise));
  for (let i = 0; i < 30; i++) {
    const now = step(third);
    expect(jump(now, prev)).toBeLessThan(.1);
    prev = now;
  }
  // Settled: centred on the body, at third person's distance.
  expect(prev.side).toBeCloseTo(0, 9);
  expect(prev.rise).toBeCloseTo(0, 9);
  expect(prev.back).toBeCloseTo(3.4, 9);
  // Swung round to look at the body's face, then let go: the camera swings back the short way, and lands on the view.
  o.look(Math.PI - .2, -.4);
  prev = step(third);
  o.set(false);
  let frames = 0;
  while (o.inUse) {
    const shown = o.place(third, ORBIT_BACK, 16);
    if (!shown) break;
    expect(jump(shown, prev)).toBeLessThan(.25);
    prev = { ...shown };
    frames++;
  }
  expect(frames).toBe(Math.ceil(EASE_MS / 16) + 1);
  expect(prev).toEqual(third);
  expect(o.place(third, ORBIT_BACK, 16)).toBeNull();
  // Pressed again halfway back, the orbit starts from where the camera is, not from the view.
  o.set(true);
  step(third);
  o.look(2, 0);
  for (let i = 0; i < 40; i++) step(third);
  o.set(false);
  for (let i = 0; i < 10; i++) prev = step(third);
  o.set(true);
  const again = step(third);
  expect(jump(again, prev)).toBeLessThan(1e-9);
  expect(o.yaw).toBe(prev.yaw);
  // Cut by a forced view, the orbit is done at once.
  o.cut();
  expect([o.on, o.inUse, o.place(third, ORBIT_BACK, 16)]).toEqual([false, false, null]);
  // A change of what it goes round cuts it; following the same subject does not.
  o.set(true);
  expect(o.follow(5)).toBe(true);
  o.set(true);
  expect(o.follow(5)).toBe(false);
  expect(o.on).toBe(true);
});

test("the orbit is pulled in by a wall and by the ground as third person is, and never crosses them while easing", () => {
  const w = flatWorld(), vp = new Viewpoint(), cam = new Camera();
  vp.placeRig(cam, w, 64, 1.62, 64, at(0, 0, 3.4));
  expect(Math.hypot(cam.x - 64, cam.y - 1.62, cam.z - 64)).toBeCloseTo(3.4, 9);
  // A wall a metre behind: the camera behind the body is drawn in short of it, and in front it is not.
  w.structs.add(w.kind("core:wall"), 64, 1.5, 62.9, 0, 0, 1);
  vp.placeRig(cam, w, 64, 1.62, 64, at(0, 0, 3.4));
  expect(Math.hypot(cam.x - 64, cam.y - 1.62, cam.z - 64)).toBeLessThan(.9);
  expect(cam.z).toBeGreaterThan(63);
  vp.placeRig(cam, w, 64, 1.62, 64, at(Math.PI, 0, 3.4));
  expect(Math.hypot(cam.x - 64, cam.y - 1.62, cam.z - 64)).toBeCloseTo(3.4, 9);
  // Far out on the wheel and looking up from under the body, the ground stops it above itself.
  vp.placeRig(cam, w, 64, 1.62, 70, at(0, CHASE_UP, 3.4 * ORBIT_FAR));
  expect(cam.y).toBeGreaterThan(.2);
  expect(cam.y).toBeLessThan(1.62);
  // Orbiting out of first person and round the wall's end, nothing solid is ever between the eye and the camera.
  const o = new Orbit(), eye = at(0, -.1);
  vp.thirdPerson = false;
  vp.place(cam, w, 64, 1.62, 64, 0, -.1, 16);
  o.set(true);
  let behind = 0;
  for (let t = 0; t < 1500; t += 16) {
    vp.placeRig(cam, w, 64, 1.62, 64, o.place(eye, ORBIT_BACK, 16)!, 16);
    const dx = cam.x - 64, dy = cam.y - 1.62, dz = cam.z - 64, d = Math.hypot(dx, dy, dz);
    if (d > 1e-6) expect(castWorld(w, 64, 1.62, 64, dx / d, dy / d, dz / d, d)).toBe(HIT_NONE);
    if (cam.z < 62.9) behind++;
    o.look(.02, 0);
  }
  expect(behind).toBeGreaterThan(0);
});

test("a cut orbit turns the camera back with the position ease between views, and nothing else does", () => {
  const vp = new Viewpoint(), cam = new Camera();
  // On foot, orbiting to face the body; then a seat is taken and the chase view looks the other way.
  vp.placeRig(cam, null, 10, 1.62, 10, at(2.8, -.3, 3.4), 16);
  vp.turn();
  vp.placeVehicle(cam, null, 10, 2.5, 10, 0, 0, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, id: 7, boom: 5 });
  expect(Math.abs(cam.yaw - 2.8)).toBeLessThan(.05);
  let last = cam.yaw;
  for (let t = 16; t < EASE_MS + 32; t += 16) {
    vp.placeVehicle(cam, null, 10, 2.5, 10, 0, 0, 0, 0, 16, false, { vx: 0, vy: 0, vz: 0, id: 7, boom: 5 });
    expect(Math.abs(cam.yaw - last)).toBeLessThan(.3);
    last = cam.yaw;
  }
  expect(cam.yaw).toBe(0);
  // Getting off without an orbit cut keeps today's ease: the position eases, the bearing is the look's at once.
  vp.place(cam, null, 12, 1.62, 10, 1, 0, 16);
  expect(cam.yaw).toBe(1);
});
