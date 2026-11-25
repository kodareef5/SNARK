// The screens on props (client/core/render/screens.ts): the faces in reach, in view and turned to the eye, nearest
// first and as many as a frame keeps, from the tables the client holds and else from the map's statics; and their quads.
import { expect, test } from "bun:test";
import { heapStats } from "bun:jsc";
import { BILLBOARD_FACE } from "../../content/street.ts";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { FACE, FACE_FLOATS, FACE_LED, FACE_TOP, FACE_TOP_BEFORE, FramePacket, MAX_FACES } from "../../client/core/render/packet.ts";
import { fitPicture } from "../../client/core/admin/screens-faces.ts";
import { pictureCrop } from "../../client/core/render/picture-crop.ts";
import { FACE_LIFT, FaceFinder, writeFace, type FaceShow } from "../../client/core/render/screens.ts";
import { FaceScreens } from "../../client/core/video/faces.ts";
import type { ScreenFace } from "../../shared/video/face.ts";
import type { CityStatics } from "../../shared/world/city.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { coreRegistry } from "../fixtures/world.ts";

const BILLBOARD: ScreenFace = { type: "billboard", face: [-7.4, 7.4, 9.55, 14.4, 1.55], led: true };
const TV: ScreenFace = { type: "tv", face: [-0.5, 0.5, 0.6, 1.2, 0.05] };
/** Kinds: 1 a billboard, 2 a TV, 3 a bare billboard with no face. */
const FACES: (ScreenFace | null)[] = [null, BILLBOARD, TV, null];
const DIMS = { chunksX: 40, chunksZ: 40 };
const half = Float32Array.of(0, 7.5, 0.6, 7.5);
const REACH = tierOf("high").screens;

const store = (): StructureStore => new StructureStore(DIMS, half, half, half);
/** A camera at (x, 2, z) looking along +z. */
function eye(x = 1280, z = 1000): Camera {
  const cam = new Camera();
  [cam.x, cam.y, cam.z, cam.aspect] = [x, 2, z, 16 / 9];
  cam.update();
  return cam;
}
/** Its face toward a camera on the −z side: its +z turned to −z. */
const FACING = 32768;

test("faces are found in their type's reach, in view and turned to the eye, nearest first", () => {
  const s = store(), finder = new FaceFinder(FACES), cam = eye();
  s.add(1, 1280, 0, 1300, FACING, 0, 1);
  s.add(1, 1290, 0, 1760, FACING, 0, 1);
  s.add(1, 1280, 0, 1900, FACING, 0, 1);
  // Turned away, behind the eye, and a TV past 60 m.
  s.add(1, 1300, 0, 1200, 0, 0, 1);
  s.add(1, 1280, 0, 800, FACING, 0, 1);
  s.add(2, 1281, 0, 1080, FACING, 0, 1);
  s.add(2, 1280, 0, 1040, FACING, 0, 1);
  const list = finder.find({ structs: s }, cam, REACH);
  expect(list.count).toBe(3);
  expect(Array.from(list.kind.subarray(0, list.count))).toEqual([2, 1, 1]);
  expect(Array.from(list.z.subarray(0, list.count))).toEqual([1040, 1300, 1760]);
  expect(list.distance[0]!).toBeLessThan(list.distance[1]!);
  // The farthest fades out over the last tenth of its reach.
  expect(list.fade[1]!).toBe(1);
  expect(list.fade[2]!).toBeGreaterThan(0);
  expect(list.fade[2]!).toBeLessThan(1);
  // Nothing at all where the tier draws none, nor where no kind has a face.
  expect(finder.find({ structs: s }, cam, { reach: 0, near: 0, count: 0 }).count).toBe(0);
  expect(new FaceFinder([null, null]).any).toBe(false);
});

test("a frame keeps the nearest of many, and counts them all", () => {
  const s = store(), finder = new FaceFinder(FACES), cam = eye();
  for (let k = 0; k < 40; k++) s.add(1, 1280 + (k % 5) * 40 - 80, 0, 1100 + (39 - k) * 15, FACING, 0, 1);
  const list = finder.find({ structs: s }, cam, REACH);
  expect([list.count, list.seen]).toEqual([MAX_FACES, 40]);
  const d = Array.from(list.distance.subarray(0, list.count));
  expect(d).toEqual([...d].sort((a, b) => a - b));
  expect(Math.max(...d)).toBeLessThan(Math.hypot(80, 13, 1100 + 32 * 15 - 1000));
});

test("a chunk the client holds is read as it stands, and one it does not as the map placed it", () => {
  const s = store(), finder = new FaceFinder(FACES), cam = eye();
  // The map's statics: two billboards, one in a chunk the client holds, where it is bare now.
  const statics = { first: new Uint32Array(DIMS.chunksX * DIMS.chunksZ + 1), kind: Uint16Array.of(1, 1), x: Float32Array.of(1280, 1290), y: Float32Array.of(0, 0), z: Float32Array.of(1300, 1600), yaw: Uint16Array.of(FACING, FACING) };
  const a = Math.floor(1300 / 64) * DIMS.chunksX + 20, b = Math.floor(1600 / 64) * DIMS.chunksX + 20;
  for (let c = 0; c < statics.first.length; c++) statics.first[c] = c <= a ? 0 : c <= b ? 1 : 2;
  const world = { structs: s, statics: statics as unknown as CityStatics };
  expect(Array.from(finder.find(world, cam, REACH).z.subarray(0, 2))).toEqual([1300, 1600]);
  s.add(3, 1280, 0, 1300, FACING, 0, 1);
  const list = finder.find(world, cam, REACH);
  expect([list.count, list.z[0]]).toEqual([1, 1600]);
  // Its ref is its chunk and its place among the chunk's statics, as a slot's is.
  expect(list.ref[0]).toBe(b * 65536);
});

test("finding faces frame after frame makes nothing", () => {
  const s = store(), finder = new FaceFinder(FACES), cam = eye(), p = new FramePacket(), faces = new FaceScreens();
  for (let k = 0; k < 40; k++) s.add(1 + (k % 2), 1280 + (k % 5) * 10 - 20, 0, 1010 + k * 10, FACING, 0, 1);
  const view = { states: [], tick: 0, now: 0, option: true, pixel: cam.fovY / 1080, count: 32, layers: 16, video: 2, fps: 30, artIdle: true };
  const frame = (n: number): void => {
    p.beginFrame();
    cam.yaw = Math.sin(n / 50) * 0.2;
    cam.update();
    const list = finder.find({ structs: s }, cam, REACH);
    faces.step(list, FACES, { ...view, now: n * 16 }, p);
    for (let i = 0; i < list.count; i++) writeFace(p, list, i, FACES[list.kind[i]!]!, cam, faces.shows[i]!, 1);
  };
  for (let n = 0; n < 300; n++) frame(n);
  Bun.gc(true);
  const before = heapStats().objectCount;
  for (let n = 300; n < 900; n++) frame(n);
  Bun.gc(true);
  // The view's copy above is the test's own: one a frame.
  expect(heapStats().objectCount - before).toBeLessThan(40);
});

test("a quad lies on its face, a little toward the eye, turned as its structure is", () => {
  const s = store(), finder = new FaceFinder(FACES), cam = eye(), p = new FramePacket();
  s.add(1, 1280, 0, 1300, FACING, 0, 1);
  const list = finder.find({ structs: s }, cam, REACH);
  const show: FaceShow = { layer: 3, before: -1, wipe: 1, crop: Float64Array.of(1, 0.5, 0, 0.25), cropBefore: Float64Array.of(1, 1, 0, 0), mean: 0xff102030, meanBefore: 0, top: 5, topBefore: 2 };
  writeFace(p, list, 0, BILLBOARD, cam, show, 1.5);
  const f = p.faces;
  // Turned round, its left is at +x and its face 1.55 m toward the eye.
  expect(f[FACE.corner]!).toBeCloseTo(7.4, 4);
  expect(f[FACE.corner + 1]!).toBeCloseTo(9.55 - 2, 4);
  expect(f[FACE.corner + 2]!).toBeCloseTo(300 - 1.55 - FACE_LIFT, 4);
  expect([f[FACE.across]!, f[FACE.across + 2]!].map((v) => Math.round(v * 100) / 100 + 0)).toEqual([-14.8, 0]);
  expect(f[FACE.up + 1]!).toBeCloseTo(4.85, 4);
  expect([f[FACE.layer], f[FACE.before], f[FACE.wipe], f[FACE.bright], f[FACE.crop + 1], f[FACE.crop + 3]]).toEqual([3, -1, 1, 1.5, 0.5, 0.25]);
  expect([p.faceWords[FACE.flags], p.faceWords[FACE.mean], p.faceCount]).toEqual([FACE_LED | (5 << FACE_TOP) | (2 << FACE_TOP_BEFORE), 0xff102030, 1]);
  expect(FACE_FLOATS).toBe(24);
});

test("a picture fills its face cropped, or fits it whole with bars, keeping its own shape", () => {
  const out = new Float64Array(4), r = (): number[] => Array.from(out, (v) => Math.round(v * 1000) / 1000 + 0);
  const billboard = 14.8 / 4.85, wide = 16 / 9;
  // A 16:9 picture filling a billboard about 3:1 keeps its middle rows; fitted, the face runs past its sides.
  pictureCrop(wide, billboard, true, out);
  expect(r()).toEqual([1, 0.583, 0, 0.209]);
  pictureCrop(wide, billboard, false, out);
  expect(r()).toEqual([1.716, 1, -0.358, 0]);
  // A 3:1 picture filling a 16:9 TV keeps its middle columns; fitted, the face runs past its top and bottom.
  pictureCrop(3, wide, true, out);
  expect(r()).toEqual([0.593, 1, 0.204, 0]);
  pictureCrop(3, wide, false, out);
  expect(r()).toEqual([1, 1.688, 0, -0.344]);
  // The Screens page's preview reads the same crop.
  for (const fill of [true, false]) {
    const m = fitPicture(wide, billboard, fill);
    expect([m.sx, m.sy, m.ox, m.oy]).toEqual(Array.from(pictureCrop(wide, billboard, fill, out)));
  }
});

test("the billboard's static carries an LED face on its road side, and its bare form none", () => {
  const reg = coreRegistry();
  const face = reg.screenFace[reg.index.get("core:zzstreet_billboard")!];
  expect(face).toEqual(BILLBOARD_FACE);
  expect(reg.screenFace[reg.index.get("core:zzstreet_billboard_bare")!]).toBeNull();
});
