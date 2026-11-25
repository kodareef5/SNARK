// The orb's screen scene (client/core/render/orb.ts): a video's picture wrapped round the ball, facing each viewer or
// fixed; the change to and from it; the light it casts from the clip's colour track; and the player that plays it
// (client/core/video/player.ts), its rules tested without a page.
import { expect, test } from "bun:test";
import { TIERS } from "../../client/core/assets/tiers.ts";
import { srgbToLinear } from "../../client/core/render/color-space.ts";
import { ORB_FRAGMENT, ORB_SCREEN, OrbCast, SCREEN_AT, groundLine, orbScene, orbScreenUv, screenPicture, screenUv, screenWrap, setScreenPicture, writeOrb, type OrbScreen } from "../../client/core/render/orb.ts";
import "../../client/core/render/orb-late.ts";
import { ORB_COLOUR } from "../../client/core/render/orb-light.ts";
import { FRAME, FRAME_FLOATS, ORB_AT } from "../../client/core/render/packet.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { exposureFor, theSky } from "../../client/core/render/sky.ts";
import { MIN_PIXELS, ScreenPlayer, WAIT_FOR_ART, base64Bytes, mayPlay, mustSeek, orbPixels, readManifest, syncRate, type Picture, type VideoHost, type VideoLike, type Watch } from "../../client/core/video/player.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { NO_CLIP, SCREEN_FACING, SHOW_SCENES, SHOW_VIDEO, newScreenState, type ScreenState } from "../../shared/video/screen.ts";
import { ORB_WIPE, type OrbSite } from "../../shared/world/orb.ts";
import { cellColour, flatTrack, screenFrame } from "../../tools/orb/frame.ts";
import { compileErrors, linkErrors } from "../fixtures/glsl.ts";

const SITE: OrbSite = { name: "Sphere", x: 1000, y: 20, z: 1000, yaw: 9000, radius: 78, centre: 34 };
const W = 128, H = 72;
const PICTURE = screenPicture(W, H, screenFrame(W, H));
const NIGHT = 23;

/** What the player hands writeOrb: the test frame, its track `track`, seen by a camera looking `yaw` round and `pitch` up. */
function held(facing: boolean, fill: boolean, yaw: number, pitch: number, shows = 0, track: Uint8Array | null = null): OrbScreen {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return { shows, width: W, height: H, texWidth: W, texHeight: H, levels: 0, facing, fill, track, seconds: 1, upX: -sy * sp, upY: cp, upZ: -cy * sp };
}

/** A view of the ball: the eye, its forward to the ball's centre and its camera's yaw and pitch. */
interface View {
  readonly ex: number;
  readonly ey: number;
  readonly ez: number;
  readonly yaw: number;
  readonly pitch: number;
}
/** From `bearing` (0 from the south's +z side) at `distance` metres from the axis, 2 m over the ground, looking at the centre. */
function side(bearing: number, distance = 400): View {
  const ex = SITE.x + distance * Math.sin(bearing), ey = SITE.y + 2, ez = SITE.z + distance * Math.cos(bearing);
  const fx = SITE.x - ex, fy = SITE.y + SITE.centre - ey, fz = SITE.z - ez, l = Math.hypot(fx, fy, fz);
  return { ex, ey, ez, yaw: Math.atan2(fx, fz), pitch: Math.asin(fy / l) };
}
/** From 500 m over the top, looking down with the camera turned `yaw`. */
const above = (yaw: number): View => ({ ex: SITE.x, ey: SITE.y + SITE.centre + 500, ez: SITE.z, yaw, pitch: -Math.PI / 2 + 1e-4 });

/** The frame's lanes at night with the screen showing, seen from `v`. */
function frameFor(v: View, facing = true, fill = false, site = SITE, screen = held(facing, fill, v.yaw, v.pitch)): Float32Array {
  const f = new Float32Array(FRAME_FLOATS);
  f[FRAME.exposure] = exposureFor(NIGHT, theSky().lights);
  writeOrb(f, [site], [], 500, NIGHT, v.ex, v.ey, v.ez, null, 500 * TICK_RATE, TICK_RATE, -1, 1, null);
  writeOrb(f, [site], [], 500, NIGHT, v.ex, v.ey, v.ez, null, 500 * TICK_RATE, TICK_RATE, -1, 1, screen);
  return f;
}

/** The camera's forward, right and up for `v` (camera.ts). */
function axes(v: View): number[][] {
  const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), sp = Math.sin(v.pitch), cp = Math.cos(v.pitch);
  return [[sy * cp, sp, cy * cp], [-cy, 0, sy], [-sy * sp, cp, -cy * sp]];
}

/** The direction on the ball, in the orb's frame, the ray from `v` along its view turned `a` right and `b` up meets, or null where it misses or meets the ground first. */
function hit(v: View, a: number, b: number, site = SITE): number[] | null {
  const [f, r, u] = axes(v);
  const d = [0, 1, 2].map((k) => f![k]! + Math.tan(a) * r![k]! + Math.tan(b) * u![k]!), dl = Math.hypot(...d);
  const cx = site.x - v.ex, cy = site.y + site.centre - v.ey, cz = site.z - v.ez;
  const along = (d[0]! * cx + d[1]! * cy + d[2]! * cz) / dl, disc = along * along - (cx * cx + cy * cy + cz * cz - site.radius * site.radius);
  if (disc <= 0) return null;
  const t = along - Math.sqrt(disc), px = (d[0]! / dl) * t - cx, py = (d[1]! / dl) * t - cy, pz = (d[2]! / dl) * t - cz;
  if (py < -site.centre) return null;
  const yaw = (site.yaw * Math.PI) / 32768, cs = Math.cos(yaw), sn = Math.sin(yaw);
  return [(cs * px - sn * pz) / site.radius, py / site.radius, (sn * px + cs * pz) / site.radius];
}

/** The picture's (u, v) along a ray of `v`, or null where it misses the ball. */
function uvAt(f: Float32Array, v: View, a: number, b: number): number[] | null {
  const n = hit(v, a, b);
  if (!n || !orbScreenUv(f, n[0]!, n[1]!, n[2]!)) return null;
  return [screenUv[0]!, screenUv[1]!];
}

/** The angles up and down from the view's middle the ball's seen part spans, along the camera's up. */
function seenSpan(v: View): number[] {
  let low = Infinity, high = -Infinity;
  for (let b = -0.4; b <= 0.4; b += 0.0005) if (hit(v, 0, b)) [low, high] = [Math.min(low, b), Math.max(high, b)];
  return [low, high];
}

const colour = [0, 0, 0];
const linear = (c: readonly number[]): number[] => c.map((x) => srgbToLinear(x / 255));
const near = (a: readonly number[], b: readonly number[], by: number): boolean => a.every((x, k) => Math.abs(x - b[k]!) <= by);

const VIEWS: readonly [string, View][] = [["south", side(0)], ["east", side(Math.PI / 2)], ["north", side(Math.PI)], ["west", side(-Math.PI / 2)], ["above", above(0.7)], ["above, turned", above(2.9)]];
const SIDES = VIEWS.slice(0, 4);

/** The twin's colour, linear, where the picture is at (u, w) on the copy the lanes face. */
function seenAt(f: Float32Array, u: number, w: number): number[] {
  const s = SCREEN_AT, lon = f[s]! + u * f[s + 4]!, y = f[s + 5]! + w * f[s + 6]!, c = Math.sqrt(1 - y * y);
  orbScene(colour, f, ORB_SCREEN, c * Math.sin(lon), y, c * Math.cos(lon), 0, 1e-4);
  return [...colour];
}

test("facing wraps the ball with a copy's middle toward each viewer, upright", () => {
  setScreenPicture(PICTURE);
  for (const [name, v] of SIDES) {
    const f = frameFor(v), [low, high] = seenSpan(v), mid = (low! + high!) / 2, span = high! - low!;
    // The middle of what is seen is the copy's middle across; up the view is up the picture, right is right.
    const at = uvAt(f, v, 0, mid)!;
    expect(Math.abs(at[0]!), name).toBeLessThan(0.02);
    expect(uvAt(f, v, 0, mid + span * 0.2)![1]!, name).toBeGreaterThan(at[1]! + 0.1);
    expect(uvAt(f, v, span * 0.15, mid)![0]!, name).toBeGreaterThan(0.1);
    // It reaches the ball's outline on both sides and its top: the picture is on the ball, not a card in front of it.
    let edge = 0;
    while (hit(v, edge + 0.0005, mid)) edge += 0.0005;
    expect(uvAt(f, v, edge, mid)![0]!, name).toBeGreaterThan(0.8);
    expect(uvAt(f, v, -edge, mid)![0]!, name).toBeLessThan(-0.8);
    expect(uvAt(f, v, 0, high! - 0.0005)![1]!, name).toBeGreaterThan(0.85);
  }
  for (const [name, v] of VIEWS.slice(4)) {
    // From over the top the copy faces the side the camera's up leaves behind, so the picture stands up on the screen.
    const f = frameFor(v), down = uvAt(f, v, 0, -0.08)!, lower = uvAt(f, v, 0, -0.12)!;
    expect(Math.abs(down[0]!), name).toBeLessThan(0.02);
    expect(lower[1]!, name).toBeLessThan(down[1]!);
  }
  // The test frame reads as drawn: the top row's green at the top, red growing to the right, the arrow at the middle.
  const f = frameFor(side(0));
  expect(near(seenAt(f, 0.85, 0.8), linear(cellColour(3, 0)), 0.03)).toBe(true);
  expect(near(seenAt(f, 0.85, -0.8), linear(cellColour(3, 2)), 0.03)).toBe(true);
  expect(near(seenAt(f, -0.8, 0), linear(cellColour(0, 1)), 0.03)).toBe(true);
  expect(near(seenAt(f, 0.8, 0), linear(cellColour(3, 1)), 0.03)).toBe(true);
  expect(Math.min(...seenAt(f, 0, 0))).toBeGreaterThan(0.9);
  setScreenPicture(null);
});

test("fill covers every seen part of the ball; fit keeps the picture's shape", () => {
  for (const [name, v] of VIEWS) {
    const fill = frameFor(v, true, true);
    let covered = 0, all = 0;
    for (let a = -0.25; a <= 0.25; a += 0.004) for (let b = -0.25; b <= 0.25; b += 0.004) {
      const n = hit(v, a, b);
      if (!n) continue;
      all++;
      orbScreenUv(fill, n[0]!, n[1]!, n[2]!);
      if (Math.abs(screenUv[0]!) <= 1.001 && Math.abs(screenUv[1]!) <= 1.001) covered++;
    }
    expect(covered, name).toBe(all);
  }
  // Seen from in front, fit's copy is as wide against its height as the picture.
  const fit = frameFor(side(0), true, false), s = SCREEN_AT;
  expect(Math.sin(fit[s + 4]!) / fit[s + 6]!).toBeCloseTo(W / H, 4);
  expect(fit[s + 43]!).toBeGreaterThan(0.6);
  expect(fit[s + 43]!).toBeLessThan(1);
});

test("the picture runs from where the ground meets the ball to its top", () => {
  const f = frameFor(side(0.4), true, true), s = SCREEN_AT;
  expect(f[s + 5]! - f[s + 6]!).toBeCloseTo(groundLine(SITE), 5);
  expect(f[s + 5]! + f[s + 6]!).toBeCloseTo(1, 5);
  expect(groundLine(SITE)).toBeCloseTo(-34 / 78, 5);
  // A ball clear of the ground has the picture from pole to pole.
  const clear = frameFor(side(0.4), true, true, { ...SITE, centre: 90 });
  expect(clear[s + 5]! - clear[s + 6]!).toBeCloseTo(-1, 5);
});

test("copies round the ball follow the picture's shape", () => {
  const low = groundLine(SITE);
  expect([screenWrap(16 / 9, low, true).copies, screenWrap(4 / 3, low, true).copies, screenWrap(3, low, true).copies]).toEqual([2, 2, 2]);
  expect(screenWrap(9 / 16, low, true).copies).toBeGreaterThanOrEqual(6);
  expect(screenWrap(9 / 16, low, true).cover).toBeCloseTo(1, 5);
  // Fit narrows a tall picture or shortens a wide one, never past what it covers.
  for (const aspect of [9 / 16, 1, 4 / 3, 16 / 9, 3]) {
    const w = screenWrap(aspect, low, false);
    expect(w.halfWide).toBeLessThanOrEqual(Math.PI / w.copies + 1e-9);
    expect(w.halfHigh).toBeLessThanOrEqual((1 - low) / 2 + 1e-9);
    expect(Math.sin(w.halfWide) / w.halfHigh).toBeCloseTo(aspect, 4);
  }
});

test("facing turns smoothly from the side to over the top and never spins", () => {
  let last: number | null = null;
  for (let k = 0; k <= 90; k++) {
    const lift = (k / 90) * (Math.PI / 2 - 0.01), d = 450, yaw = 0.3;
    const ex = SITE.x - d * Math.cos(lift) * Math.sin(yaw), ez = SITE.z - d * Math.cos(lift) * Math.cos(yaw), ey = SITE.y + SITE.centre + d * Math.sin(lift);
    const facing = frameFor({ ex, ey, ez, yaw, pitch: -lift })[SCREEN_AT]!;
    if (last !== null) expect(Math.abs(Math.atan2(Math.sin(facing - last), Math.cos(facing - last)))).toBeLessThan(0.02);
    last = facing;
  }
});

test("fixed holds the copies to the ball, with no seam where longitude wraps", () => {
  setScreenPicture(PICTURE);
  const views = SIDES.map(([, v]) => frameFor(v, false, true, SITE, held(false, true, v.yaw, v.pitch, 0, flatTrack(40, 200, 120, 60))));
  for (const f of views) expect(f[SCREEN_AT]).toBe(0);
  const f = views[0]!, copies = f[SCREEN_AT + 1]!;
  const at = (lon: number, lat: number): number[] => {
    orbScene(colour, f, ORB_SCREEN, Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), 0, 1e-3);
    return [...colour];
  };
  for (const lat of [-0.3, 0, 0.2]) {
    for (const lon of [0, 0.4, 1.3, 2.2, -0.9]) for (let k = 1; k < copies; k++) expect(near(at(lon, lat), at(lon + (k * 2 * Math.PI) / copies, lat), 1e-4)).toBe(true);
    expect(near(at(-1e-4, lat), at(1e-4, lat), 0.02)).toBe(true);
    expect(near(at(Math.PI - 1e-4, lat), at(-Math.PI - 1e-4, lat), 1e-4)).toBe(true);
  }
  setScreenPicture(null);
});

test("a change to the video, from clip to clip, and back is the scenes' wipe", () => {
  const v = side(0), f = new Float32Array(FRAME_FLOATS), at = (s: number, screen: OrbScreen | null): void => writeOrb(f, [SITE], [], s, NIGHT, v.ex, v.ey, v.ez, null, 0, TICK_RATE, -1, 1, screen);
  at(600, null);
  const scene = f[ORB_AT + 8]!;
  at(601, held(true, false, v.yaw, v.pitch, 2));
  expect([f[ORB_AT + 8], f[ORB_AT + 9], f[ORB_AT + 10]]).toEqual([ORB_SCREEN, scene, 0]);
  at(601 + ORB_WIPE / 2, held(true, false, v.yaw, v.pitch, 2));
  expect([f[ORB_AT + 9], f[ORB_AT + 10], f[SCREEN_AT + 31]]).toEqual([scene, 0.5, 0]);
  at(601 + ORB_WIPE, held(true, false, v.yaw, v.pitch, 2));
  expect([f[ORB_AT + 8], f[ORB_AT + 9], f[ORB_AT + 10]]).toEqual([ORB_SCREEN, ORB_SCREEN, 1]);
  // The next clip comes in over a dark screen.
  at(620, held(true, false, v.yaw, v.pitch, 3));
  expect([f[ORB_AT + 9], f[ORB_AT + 10], f[SCREEN_AT + 31]]).toEqual([ORB_SCREEN, 0, 1]);
  // Back to the scenes, the picture leaves as the scene comes.
  at(640, held(true, false, v.yaw, v.pitch, -1));
  expect([f[ORB_AT + 8], f[ORB_AT + 9], f[ORB_AT + 10]]).toEqual([scene, ORB_SCREEN, 0]);
  at(640 + ORB_WIPE + 0.1, held(true, false, v.yaw, v.pitch, -1));
  expect(f[ORB_AT + 9]).not.toBe(ORB_SCREEN);
  at(700, null);
});

test("the program reads the picture once, at its level, and compiles on every tier", () => {
  for (const tier of TIERS) {
    const text = PROGRAMS.orb!(tier, "rgba", false, false), vertex = withDefines(text.vertex, text.defines), fragment = withDefines(text.fragment, text.defines);
    expect([...compileErrors(vertex), ...compileErrors(fragment), ...linkErrors(vertex, fragment)]).toEqual([]);
  }
  expect(ORB_FRAGMENT).toContain("uniform highp sampler2D uScreen;");
  expect(ORB_FRAGMENT).not.toMatch(/dFdx|dFdy|texture\(/);
  expect(TIERS.map((t) => t.orb.video)).toEqual([false, true, true, true]);
});

test("the clip's colour track lights the streets, as much as the picture covers", () => {
  const v = side(0), red = flatTrack(40, 230, 30, 20), blue = flatTrack(40, 20, 40, 230);
  const castOf = (track: Uint8Array, fill: boolean): number[] => {
    const f = frameFor(v, true, fill, SITE, held(true, fill, v.yaw, v.pitch, 0, track));
    writeOrb(f, [SITE], [], 600, NIGHT, v.ex, v.ey, v.ez, null, 0, TICK_RATE, -1, 1, held(true, fill, v.yaw, v.pitch, 0, track));
    new OrbCast().step(f, 1000);
    return [0, 1, 2].map((c) => f[ORB_COLOUR + c]! * f[FRAME.exposure]!);
  };
  const r = castOf(red, true), b = castOf(blue, true), fit = castOf(red, false);
  expect(r[0]!).toBeGreaterThan(5 * r[2]!);
  expect(b[2]!).toBeGreaterThan(5 * b[0]!);
  // Fill covers the ball; fit leaves a little of it to the edges' dimmer glow.
  expect(fit[0]!).toBeLessThan(r[0]!);
  expect(fit[0]!).toBeGreaterThan(0.6 * r[0]!);
  expect(screenWrap(16 / 9, groundLine(SITE), true).cover).toBeCloseTo(1, 5);
});

test("a clip plays only when the ball is seen large enough, on a tier that plays it", () => {
  const all: Watch = { option: true, tier: true, orb: true, inView: true, pixels: 200, visible: true, settled: true };
  expect(mayPlay(all)).toBe(true);
  for (const key of ["option", "tier", "orb", "inView", "visible", "settled"] as const) expect(mayPlay({ ...all, [key]: false })).toBe(false);
  expect([mayPlay({ ...all, pixels: MIN_PIXELS - 1 }), mayPlay({ ...all, pixels: MIN_PIXELS })]).toEqual([false, true]);
  // The ball is 48 pixels across some 2.3 km off on a 70 degree view 1080 pixels high.
  expect(orbPixels(78, 2300, 1.2217, 1080)).toBeGreaterThan(MIN_PIXELS);
  expect(orbPixels(78, 3000, 1.2217, 1080)).toBeLessThan(MIN_PIXELS);
});

test("drift under half a second is left, nudged to three seconds, then seeks", () => {
  expect([syncRate(0), syncRate(0.4), syncRate(-0.4)]).toEqual([1, 1, 1]);
  expect([syncRate(0.6), syncRate(-0.6), syncRate(2.9)]).toEqual([1.05, 0.95, 1.05]);
  expect([mustSeek(2.9), mustSeek(3.1), mustSeek(-4)]).toEqual([false, true, true]);
  expect(syncRate(4)).toBe(1);
});

test("a manifest's colour track is read from base64", () => {
  expect([...base64Bytes("AQID/w==")]).toEqual([1, 2, 3, 255]);
  expect([...base64Bytes(Buffer.from([9, 8, 7, 6, 5]).toString("base64"))]).toEqual([9, 8, 7, 6, 5]);
  const clips = readManifest({ clips: [{ id: "a", file: "/media/a.mp4", poster: "/media/a.jpg", width: 640, height: 360, seconds: 10, colours: "AQID" }, { id: "b" }] })!;
  expect([clips.length, clips[0]!.track.length, clips[1]]).toEqual([2, 3, null]);
  expect(readManifest({ nope: 1 })).toBeNull();
});

// ---- The player against a page made of numbers.

class FakeVideo implements VideoLike {
  src = "";
  preload = "none";
  currentTime = 0;
  playbackRate = 1;
  muted = true;
  paused = true;
  seeking = false;
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  error: unknown = null;
  plays = 0;
  play(): Promise<void> {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  load(): void {}
  removeAttribute(name: string): void {
    if (name === "src") this.src = "";
  }
  /** As though its stream had come: a frame of `w` by `h`. */
  ready(w = 640, h = 360): void {
    this.readyState = 4;
    this.videoWidth = w;
    this.videoHeight = h;
  }
}

function fakeHost(): VideoHost & { made: FakeVideo[]; fetched: string[]; shown: boolean } {
  const made: FakeVideo[] = [], fetched: string[] = [];
  const manifest = { clips: [0, 1, 2].map((i) => ({ id: `c${i}`, title: "", file: `/media/c${i}.mp4`, poster: `/media/c${i}.jpg`, width: 640, height: 360, seconds: 20, bytes: 1, audio: false, rights: "", starter: true, colours: "" })) };
  const host = {
    made,
    fetched,
    shown: true,
    video: () => (made.push(new FakeVideo()), made.at(-1)!),
    json: (path: string) => (fetched.push(path), Promise.resolve(manifest)),
    image: (path: string): Promise<Picture> => (fetched.push(path), Promise.resolve({ source: path, width: 320, height: 180 })),
    visible: () => host.shown,
    audible: () => false,
    sound: () => {},
  };
  return host;
}

/** A camera 300 m south of the ball looking at it, or away from it. */
function cam(facing: boolean) {
  return { x: SITE.x, y: SITE.y + 2, z: SITE.z - 300, yaw: facing ? 0 : Math.PI, pitch: 0, fovY: 1.2, boxVisible: () => facing };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test("the player plays the clip in view, shows its poster while it loads, and fetches nothing out of view", async () => {
  const host = fakeHost(), player = new ScreenPlayer(host);
  const state: ScreenState = { ...newScreenState(), manifest: "0123456789abcdef", show: SHOW_VIDEO, flags: SCREEN_FACING, clip: 0, start: 0, next: 1 };
  const step = (tick: number, facing = true, option = true, tier = true) => player.step({ state, tick, option, tierVideo: tier, sites: [SITE], cam: cam(facing), height: 1080, now: tick * 33, artIdle: true });
  expect(step(0)).toBeNull();
  await flush();
  expect(host.fetched).toEqual(["/media/video.0123456789abcdef.json"]);
  // Out of view: the poster is fetched, and no element at all.
  step(30, false);
  await flush();
  expect([host.made.length, host.fetched.at(-1)]).toEqual([0, "/media/c0.jpg"]);
  // In view: one element takes the clip and plays; until it has a frame the poster is what the texture takes.
  step(60);
  const p = { frame: new Float32Array(FRAME_FLOATS), tier: TIERS[1]!, screenSource: null as unknown, screenWidth: 0, screenHeight: 0, screenFresh: false, screenMips: false };
  const upload = (drawn = true) => player.upload(p as never, drawn, 0.001);
  upload();
  expect([host.made.length, host.made[0]!.src, host.made[0]!.paused, p.screenSource, p.screenFresh]).toEqual([1, "/media/c0.mp4", false, "/media/c0.jpg", true]);
  const video = host.made[0]!;
  video.ready();
  video.currentTime = 2;
  expect(step(60)?.shows).toBe(0);
  p.screenFresh = false;
  upload(false);
  expect(p.screenFresh).toBe(false);
  upload();
  expect([p.screenSource, p.screenWidth, p.screenFresh]).toEqual([video, 640, true]);
  // Nothing new to show: no upload.
  p.screenFresh = false;
  upload();
  expect(p.screenFresh).toBe(false);
  // Behind by a second: nudged; by three, it seeks.
  video.currentTime = 1;
  step(60);
  expect(video.playbackRate).toBe(1.05);
  video.currentTime = 0;
  step(100);
  expect([video.currentTime, video.playbackRate]).toEqual([100 / TICK_RATE, 1.05]);
  // Five seconds from its end the next is buffered in the second element, and no third is made.
  step((20 - 4) * TICK_RATE);
  expect([host.made.length, host.made[1]!.src, host.made[1]!.paused]).toEqual([2, "/media/c1.mp4", true]);
  state.clip = 1;
  state.next = 2;
  state.start = 20 * TICK_RATE;
  host.made[1]!.ready();
  step(20 * TICK_RATE + 3);
  expect([host.made[1]!.paused, video.paused, host.made.length]).toEqual([false, true, 2]);
  // Looking away pauses it; the page hidden too.
  step(20 * TICK_RATE + 30, false);
  expect(host.made.every((v) => v.paused)).toBe(true);
  host.shown = false;
  step(20 * TICK_RATE + 60);
  expect(host.made.every((v) => v.paused)).toBe(true);
  host.shown = true;
  // The option off: everything stops, and after a while lets its stream go.
  step(20 * TICK_RATE + 90, true, false);
  step(20 * TICK_RATE + 90 + 20 * TICK_RATE, true, false);
  expect(host.made.every((v) => v.paused && v.src === "")).toBe(true);
});

test("a tier that plays no video shows the poster; a clip that fails falls back to the scenes", async () => {
  const host = fakeHost(), player = new ScreenPlayer(host);
  const state: ScreenState = { ...newScreenState(), manifest: "00000000000000aa", show: SHOW_VIDEO, flags: SCREEN_FACING, clip: 2, start: 0, next: NO_CLIP };
  const p = { frame: new Float32Array(FRAME_FLOATS), tier: TIERS[0]!, screenSource: null as unknown, screenWidth: 0, screenHeight: 0, screenFresh: false, screenMips: false };
  const step = (tick: number, tier: boolean) => player.step({ state, tick, option: true, tierVideo: tier, sites: [SITE], cam: cam(true), height: 1080, now: tick * 33, artIdle: true });
  step(0, false);
  await flush();
  step(1, false);
  await flush();
  step(2, false);
  player.upload(p as never, true, 0.001);
  expect([host.made.length, p.screenSource]).toEqual([0, "/media/c2.jpg"]);
  expect(step(3, false)?.shows).toBe(2);
  // On a tier that plays, the element errs: the scenes come back.
  step(4, true);
  host.made[0]!.error = { code: 4 };
  step(5, true);
  expect(step(6, true)?.shows).toBe(-1);
  // Told to show the scenes, it shows them.
  state.show = SHOW_SCENES;
  expect(step(7, true)?.shows ?? -1).toBe(-1);
});

test("a clip waits for the map's art, then plays, or plays after WAIT_FOR_ART", async () => {
  for (const idleAt of [5_000, Infinity]) {
    const host = fakeHost(), player = new ScreenPlayer(host);
    const state: ScreenState = { ...newScreenState(), manifest: "0123456789abcdef", show: SHOW_VIDEO, flags: SCREEN_FACING, clip: 0, start: 0, next: NO_CLIP };
    const step = (ms: number) => player.step({ state, tick: (ms / 1000) * 30, option: true, tierVideo: true, sites: [SITE], cam: cam(true), height: 1080, now: ms, artIdle: ms >= idleAt });
    step(0);
    await flush();
    step(1000);
    await flush();
    expect(host.made.length).toBe(0);
    // A clip is first wanted at 1 s, once the manifest has come.
    const starts = Math.min(idleAt, 1000 + WAIT_FOR_ART);
    step(starts - 100);
    expect(host.made.length).toBe(0);
    step(starts);
    expect(host.made.length).toBe(1);
    // Once begun, art coming again does not stop it.
    step(starts + 100);
    expect(host.made.length).toBe(1);
  }
});
