// An orb's screen (client/core/render/orb.ts): its scenes' twins over the whole ball, the pucks, the change between
// scenes, the level, the frame's lanes and the pass that draws it (client/core/render/passes/orb.ts).
import { expect, test } from "bun:test";
import { tierOf, TIERS } from "../../client/core/assets/tiers.ts";
import { Camera } from "../../client/core/render/camera.ts";
import { ORB_FLAT, ORB_FRAGMENT, ORB_SHELL, PUCK, PUCK_FROM, orbFill, orbLevel, orbLight, orbPick, orbPuck, orbRaw, orbScene, puckRings, writeOrb, type Puck } from "../../client/core/render/orb.ts";
import "../../client/core/render/orb-late.ts";
import { DRAW_ORB, DRAW_TEXTURED, FRAME, FRAME_FLOATS, FramePacket, InstanceWriter, ORB_AT, ORB_LANES } from "../../client/core/render/packet.ts";
import type { Frame } from "../../client/core/render/pass.ts";
import { Orbs } from "../../client/core/render/passes/orb.ts";
import { PROGRAM, PROGRAMS, drawProgram, tierPrograms, withDefines } from "../../client/core/render/programs.ts";
import { Scene } from "../../client/core/render/scene.ts";
import { exposureFor, sunDirection, theSky } from "../../client/core/render/sky.ts";
import { EYE_SKY } from "../../client/core/render/tide-eye.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { parsePack, type Pack } from "../../shared/pack/pack.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import type { SupplyList } from "../../shared/sim/supply.ts";
import { Heightfield, TERRAIN_CELL } from "../../shared/world/heightfield.ts";
import { ORB_HOLD, ORB_SCENES, ORB_WIPE, orbShow, type OrbSite } from "../../shared/world/orb.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { CAST_PHASE, eyeKnot, type TideEyeSite } from "../../shared/world/tide-eye.ts";
import { grayboxMeshes } from "../../tools/pack/build.ts";
import { boxMesh, buildPack } from "../../tools/pack/write.ts";
import { Rasterizer } from "../../tools/snap/raster.ts";
import { compileErrors, linkErrors } from "../fixtures/glsl.ts";
import { corePack } from "../fixtures/pack.ts";
import { sceneRegistry } from "../fixtures/sceneworld.ts";

const RATE = 30;
const SITE: OrbSite = { name: "Sphere", x: 1000, y: 20, z: 1000, yaw: 9000, radius: 78, centre: 34 };
const BLUE: TideEyeSite = { name: "Sphere", x: 1000, y: 20, z: 1210, yaw: 0, color: "blue", radius: 28 };
const GAZE = ORB_AT + 12, SUN = ORB_AT + 16;

/** The frame's lanes with scene `which` held, at `seconds` and `hour`, seen from 400 m south of the ball. */
function lanes(which: number, seconds: number, hour: number, supply: SupplyList | null = null): Float32Array {
  const frame = new Float32Array(FRAME_FLOATS);
  frame[FRAME.exposure] = exposureFor(hour, theSky().lights);
  writeOrb(frame, [SITE], [BLUE], seconds, hour, SITE.x, SITE.y + 2, SITE.z - 400, supply, Math.round(seconds * RATE), RATE, which);
  return frame;
}

/** `count` directions spread evenly over the ball. */
function directions(count: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count, r = Math.sqrt(1 - y * y), a = i * 2.39996323;
    out.push([r * Math.cos(a), y, r * Math.sin(a)]);
  }
  return out;
}

/** Moments that take each scene through what it follows: the eye off, charging, at power and striking, by day, dusk and night. */
const MOMENTS: readonly (readonly [seconds: number, hour: number])[] = [[362, 12], [371.5, 23], [380, 23], [383.7, 6], [440, 18.2], [475.9, 0], [3.3, 9]];
const colour = [0, 0, 0];

test("every scene is finite and in range over the ball at every footprint", () => {
  const ball = directions(300);
  for (let which = 0; which < ORB_SCENES.length; which++) {
    for (const [seconds, hour] of MOMENTS) {
      const f = lanes(which, seconds, hour), t = f[ORB_AT + 6]!;
      for (const fp of [0.0005, 0.006, 0.05, 0.6]) {
        for (const octaves of [2, 4]) {
          for (const [x, y, z] of ball) {
            orbScene(colour, f, which, x!, y!, z!, t, fp, octaves);
            for (const c of colour) expect(c >= 0 && c <= 3, `${ORB_SCENES[which]} at ${seconds} s, ${hour} h, footprint ${fp}: ${colour}`).toBe(true);
          }
        }
      }
    }
  }
});

test("no scene has a seam where longitude wraps, nor a pinch at either pole", () => {
  const other = [0, 0, 0], worst: Record<string, number> = {};
  for (let which = 0; which < ORB_SCENES.length; which++) {
    let most = 0;
    const apart = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, f: Float32Array): void => {
      orbScene(colour, f, which, ax, ay, az, f[ORB_AT + 6]!, 0.004);
      orbScene(other, f, which, bx, by, bz, f[ORB_AT + 6]!, 0.004);
      for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(colour[c]! - other[c]!));
    };
    for (const [seconds, hour] of MOMENTS) {
      const f = lanes(which, seconds, hour);
      // Either side of where longitude wraps, at every height, and of where it is 0.
      for (let k = 1; k < 60; k++) {
        const polar = (k * Math.PI) / 60, y = Math.cos(polar), r = Math.sin(polar);
        for (const lon of [Math.PI, 0, Math.PI / 2]) apart(r * Math.sin(lon - 1e-7), y, r * Math.cos(lon - 1e-7), r * Math.sin(lon + 1e-7), y, r * Math.cos(lon + 1e-7), f);
      }
      // Round each pole, a hair off it, against the pole itself.
      for (const pole of [1, -1]) for (let k = 0; k < 16; k++) apart(1e-6 * Math.cos(k), pole * Math.sqrt(1 - 1e-12), 1e-6 * Math.sin(k), 0, pole, 0, f);
    }
    worst[ORB_SCENES[which]!] = most;
  }
  for (const scene of ORB_SCENES) expect(worst[scene], scene).toBeLessThan(0.002);
});

test("a scene is quieter as the footprint grows", () => {
  const next = [0, 0, 0], last = [0, 0, 0], ball = directions(900);
  for (let which = 0; which < ORB_SCENES.length; which++) {
    // How rough the picture is over a step of the ball a third of a metre long, summed over the ball.
    const busy = (fp: number): number => {
      let sum = 0;
      for (const [seconds, hour] of MOMENTS) {
        const f = lanes(which, seconds, hour), t = f[ORB_AT + 6]!;
        for (const [x, y, z] of ball) {
          // A place against the middle of the places either side of it, which a smooth slope across it leaves at nothing.
          const l = Math.hypot(x! + 0.004, y!, z! - 0.002), m = Math.hypot(x! - 0.004, y!, z! + 0.002);
          orbScene(colour, f, which, x!, y!, z!, t, fp);
          orbScene(next, f, which, (x! + 0.004) / l, y! / l, (z! - 0.002) / l, t, fp);
          orbScene(last, f, which, (x! - 0.004) / m, y! / m, (z! + 0.002) / m, t, fp);
          for (let c = 0; c < 3; c++) sum += Math.abs(colour[c]! - 0.5 * (next[c]! + last[c]!));
        }
      }
      return sum;
    };
    const near = busy(0.001), mid = busy(0.03), far = busy(0.3);
    expect(mid, ORB_SCENES[which]).toBeLessThan(near);
    expect(far, ORB_SCENES[which]).toBeLessThan(0.6 * mid);
  }
});

test("a change shows one scene or the other at each place, and ends complete", () => {
  const ball = directions(500), cast = 10 * ORB_HOLD + CAST_PHASE;
  const show = orbShow(cast + 1, { scene: 0, before: 0, wipe: 0 });
  expect(show.scene).not.toBe(show.before);
  const shares: number[] = [];
  for (const into of [0, 1, 2, 3, ORB_WIPE, ORB_WIPE + 60]) {
    const f = lanes(-1, cast + into, 22);
    let now = 0, nearNow = 0, nearAll = 0;
    for (const [x, y, z] of ball) {
      const which = orbPick(f, x!, y!, z!);
      expect([show.scene, show.before]).toContain(which);
      const facing = x! * f[ORB_AT + 20]! + y! * f[ORB_AT + 21]! + z! * f[ORB_AT + 22]! > 0.6;
      if (which === show.scene) now++;
      if (facing) nearAll++;
      if (facing && which === show.scene) nearNow++;
    }
    shares.push(now / ball.length);
    // What faces the eye changes first.
    if (into === 1) expect(nearNow / nearAll).toBeGreaterThan(now / ball.length);
  }
  expect(shares[0]).toBe(0);
  expect(shares.slice(4)).toEqual([1, 1]);
  for (let k = 1; k < shares.length; k++) expect(shares[k]!).toBeGreaterThanOrEqual(shares[k - 1]!);
  // The place a change starts from faces the blue eye, in the orb's own frame.
  const f = lanes(-1, cast + 1, 22), yaw = (SITE.yaw * Math.PI) / 32768;
  const ox = Math.cos(yaw) * f[ORB_AT + 20]! + Math.sin(yaw) * f[ORB_AT + 22]!, oz = -Math.sin(yaw) * f[ORB_AT + 20]! + Math.cos(yaw) * f[ORB_AT + 22]!;
  expect([f[ORB_AT + 21], oz]).toEqual([0, expect.closeTo(1, 6)]);
  expect(Math.abs(ox)).toBeLessThan(1e-6);
  // Mid change, a place shows the same light as the scene it was given, and no mix of the two.
  const light = [0, 0, 0], held = [0, 0, 0];
  const mid = lanes(-1, cast + 2, 22);
  for (const which of [show.scene, show.before]) {
    const alone = new Float32Array(mid);
    alone[ORB_AT + 8] = alone[ORB_AT + 9] = which;
    alone[ORB_AT + 6] = alone[ORB_AT + 7] = mid[ORB_AT + (which === show.scene ? 6 : 7)]!;
    alone[ORB_AT + 10] = 1;
    let same = 0, seen = 0;
    for (const [x, y, z] of ball) {
      // Away from the line of light the front draws.
      const across = 0.5 - 0.5 * (x! * mid[ORB_AT + 20]! + y! * mid[ORB_AT + 21]! + z! * mid[ORB_AT + 22]!);
      if (orbPick(mid, x!, y!, z!) !== which || Math.abs(across - (mid[ORB_AT + 10]! * 1.1 - 0.05)) < 0.2) continue;
      // In the orb's frame the place is turned back by its heading, and stands a radius from its centre.
      const wx = Math.cos(yaw) * x! + Math.sin(yaw) * z!, wz = -Math.sin(yaw) * x! + Math.cos(yaw) * z!;
      const px = mid[ORB_AT]! + wx * 78, py = mid[ORB_AT + 1]! + y! * 78, pz = mid[ORB_AT + 2]! + wz * 78;
      orbLight(mid, px, py, pz, 2, light, 4, false);
      orbLight(alone, px, py, pz, 2, held, 4, false);
      seen++;
      if (light.every((v, c) => Math.abs(v - held[c]!) < 1e-6)) same++;
    }
    expect(seen).toBeGreaterThan(30);
    expect(same).toBe(seen);
  }
});

test("pucks are evenly spaced, tile every ring whole, and are off past their fade", () => {
  const rings = puckRings(78), a: Puck = { ring: 0, count: 0, x: 0, y: 0, z: 0, off: 0 }, b = { ...a };
  expect(Math.abs((Math.PI * 78) / rings - PUCK)).toBeLessThan(0.001);
  let fewest = Infinity;
  for (let ring = 0; ring < rings; ring++) {
    const polar = ((ring + 0.5) * Math.PI) / rings, y = Math.cos(polar), r = Math.sin(polar);
    orbPuck(0, y, r, 78, a);
    expect(a.ring).toBe(ring);
    fewest = Math.min(fewest, a.count);
    // A ring's own length shared evenly: a puck's spacing is within a half puck's share of PUCK.
    const spacing = (2 * Math.PI * 78 * r) / a.count;
    expect(Math.abs(spacing - PUCK)).toBeLessThanOrEqual((0.5 * PUCK) / a.count + 1e-9);
    if (ring % 37 !== 0) continue;
    // Round the ring a place falls on each puck in turn, never farther from its centre than half a cell across.
    const centres = new Set<string>();
    for (let k = 0; k < a.count * 8; k++) {
      const lon = ((k + 0.37) / (a.count * 8)) * 2 * Math.PI - Math.PI;
      orbPuck(r * Math.sin(lon), y, r * Math.cos(lon), 78, b);
      expect(b.count).toBe(a.count);
      expect(b.off).toBeLessThan(0.75);
      expect(Math.hypot(b.x, b.y, b.z)).toBeCloseTo(1, 9);
      centres.add(`${Math.round(b.x * 1e7) + 0},${Math.round(b.z * 1e7) + 0}`);
    }
    expect(centres.size).toBe(a.count);
  }
  expect(fewest).toBeGreaterThanOrEqual(3);
  // Where one ring gives way to the next the count may change, and a place still falls on one puck or the other.
  for (let ring = 1; ring < rings; ring += 29) {
    const polar = (ring * Math.PI) / rings;
    for (let k = 0; k < 40; k++) {
      const lon = k * 0.161;
      orbPuck(Math.sin(polar - 1e-9) * Math.sin(lon), Math.cos(polar - 1e-9), Math.sin(polar - 1e-9) * Math.cos(lon), 78, a);
      orbPuck(Math.sin(polar + 1e-9) * Math.sin(lon), Math.cos(polar + 1e-9), Math.sin(polar + 1e-9) * Math.cos(lon), 78, b);
      expect([a.ring, b.ring]).toEqual([ring - 1, ring]);
      expect(Math.max(a.off, b.off)).toBeLessThan(0.75);
    }
  }
  // Every other ring is half a puck on from the one over it.
  orbPuck(0, Math.cos((300.5 * Math.PI) / rings), Math.sin((300.5 * Math.PI) / rings), 78, a);
  orbPuck(0, Math.cos((301.5 * Math.PI) / rings), Math.sin((301.5 * Math.PI) / rings), 78, b);
  const lonA = Math.atan2(a.x, a.z) * a.count / (2 * Math.PI), lonB = Math.atan2(b.x, b.z) * b.count / (2 * Math.PI);
  expect(Math.abs(Math.abs(lonA - lonB) - 0.5)).toBeLessThan(1e-6);

  // Past the fade the grid is not drawn: the picture with pucks is the picture without.
  const f = lanes(1, 400, 12), with_ = [0, 0, 0], without = [0, 0, 0];
  for (const [x, y, z] of directions(120)) {
    const px = f[ORB_AT]! + x! * 78, py = f[ORB_AT + 1]! + y! * 78, pz = f[ORB_AT + 2]! + z! * 78;
    orbLight(f, px, py, pz, PUCK / PUCK_FROM, with_, 4, true);
    orbLight(f, px, py, pz, PUCK / PUCK_FROM, without, 4, false);
    expect(with_).toEqual(without);
  }
  // Close up a puck is lit and the trellis between pucks is dark by night, and the two average to the plain picture.
  const night = lanes(4, 475.9, 0);
  let lit = 0, dark = 0, sum = 0, plain = 0;
  for (let k = 0; k < 4000; k++) {
    const lon = 0.3 + ((k * 0.6180339887) % 1) * 0.2, polar = 1.6 + ((k * 0.7548776662) % 1) * 0.05;
    const px = night[ORB_AT]! + Math.sin(polar) * Math.sin(lon) * 78, py = night[ORB_AT + 1]! + Math.cos(polar) * 78, pz = night[ORB_AT + 2]! + Math.sin(polar) * Math.cos(lon) * 78;
    orbLight(night, px, py, pz, 0.01, with_, 4, true);
    orbLight(night, px, py, pz, 0.01, without, 4, false);
    if (with_[2]! > 1.2 * without[2]!) lit++;
    if (with_[2]! < 0.02 * without[2]!) dark++;
    sum += with_[2]!;
    plain += without[2]!;
  }
  expect(lit).toBeGreaterThan(1500);
  expect(dark).toBeGreaterThan(500);
  expect(Math.abs(sum / plain - 1)).toBeLessThan(0.12);
});

test("the level is lower by night than at noon before exposure, and finite", () => {
  const lights = theSky().lights, noon = exposureFor(12, lights), night = exposureFor(0, lights);
  expect(night).toBeGreaterThan(1000 * noon);
  for (const e of [noon, night, exposureFor(18, lights)]) expect(Number.isFinite(orbRaw(e)) && orbRaw(e) > 0).toBe(true);
  expect(orbRaw(night)).toBeLessThan(orbRaw(noon) / 1000);
  // As light after exposure it rises into the night, where the grade's gain is a third of noon's.
  expect(orbLevel(night)).toBeGreaterThan(orbLevel(noon));
  expect(orbLevel(exposureFor(18, lights))).toBeGreaterThanOrEqual(orbLevel(noon));
  // Low poly has no exposure.
  expect([orbLevel(0), orbRaw(0)]).toEqual([ORB_FLAT, ORB_FLAT]);
});

test("the lanes hold the nearest orb, its scene and the Watcher's look for every eye", () => {
  const far: OrbSite = { ...SITE, name: "Far", x: 5000 };
  const frame = new Float32Array(FRAME_FLOATS), again = new Float32Array(FRAME_FLOATS);
  const seconds = 7 * ORB_HOLD + CAST_PHASE + 100, tick = seconds * RATE;
  writeOrb(frame, [far, SITE], [BLUE], seconds, 22, 900, 30, 700, null, tick, RATE);
  const show = orbShow(seconds, { scene: 0, before: 0, wipe: 0 });
  expect([...frame.subarray(ORB_AT, ORB_AT + 4)]).toEqual([100, 24, 300, 78]);
  expect([frame[ORB_AT + 8], frame[ORB_AT + 9], frame[ORB_AT + 10]]).toEqual([show.scene, show.before, 1]);
  expect(frame[ORB_AT + 6]).toBeGreaterThanOrEqual(100);
  expect(frame[ORB_AT + 6]).toBeLessThan(2000);
  // Another eye somewhere else is told the same, but for where the ball is from it.
  writeOrb(again, [far, SITE], [BLUE], seconds, 22, 1300, 80, 1400, null, tick, RATE);
  expect([...again.subarray(ORB_AT + 4, ORB_AT + ORB_LANES * 4)]).toEqual([...frame.subarray(ORB_AT + 4, ORB_AT + ORB_LANES * 4)]);
  // No orb, nothing.
  writeOrb(frame, [], [BLUE], seconds, 22, 0, 0, 0, null, tick, RATE);
  expect(frame.subarray(ORB_AT, ORB_AT + ORB_LANES * 4).every((v) => v === 0)).toBe(true);

  /** Where the Watcher looks in the world, from the lanes: turned back out of the orb's frame. */
  const gaze = (f: Float32Array): number[] => {
    const yaw = (SITE.yaw * Math.PI) / 32768, c = Math.cos(yaw), s = Math.sin(yaw);
    return [c * f[GAZE]! + s * f[GAZE + 2]!, f[GAZE + 1]!, -s * f[GAZE]! + c * f[GAZE + 2]!];
  };
  const toward = (f: Float32Array, x: number, y: number, z: number): number => {
    const g = gaze(f), l = Math.hypot(x, y, z);
    return (g[0]! * x + g[1]! * y + g[2]! * z) / l;
  };
  const sun = [0, 0, 0];
  // By day the sun, by night the moon opposite it, with the blue eye dark (its cycle's first seconds).
  sunDirection(10, sun);
  expect(toward(lanes(0, 362, 10), sun[0]!, sun[1]!, sun[2]!)).toBeGreaterThan(0.9999);
  sunDirection(23, sun);
  expect(toward(lanes(0, 362, 23), -sun[0]!, -sun[1]!, -sun[2]!)).toBeGreaterThan(0.9999);
  // The blue eye's figure while it stands at power.
  const knot = eyeKnot(BLUE);
  expect(toward(lanes(0, 380, 23), knot.x - SITE.x, EYE_SKY - SITE.y - SITE.centre, knot.z - SITE.z)).toBeGreaterThan(0.9999);
  // A drop in flight before either.
  const tick380 = 380 * RATE;
  const row = { id: 1, tier: 0, cls: 0, ringed: false, landed: false, opened: false, announce: 0, sender: 0, eye: 0, look: 0, called: tick380 - 600, release: tick380 - 300, land: tick380 + 300, brake: 90, end: tick380 + 9000, left: 0, ox: BLUE.x, oy: 2790, oz: BLUE.z, x: SITE.x - 900, y: SITE.y, z: SITE.z - 200 };
  const falling = lanes(0, 380, 23, { tiers: [], classes: [], rows: [row] });
  expect(gaze(falling)[0]).toBeLessThan(-0.3);
  expect(toward(falling, knot.x - SITE.x, EYE_SKY - SITE.y - SITE.centre, knot.z - SITE.z)).toBeLessThan(0.99);
  for (const f of [falling, lanes(0, 380, 23), lanes(0, 362, 6)]) expect(Math.hypot(...gaze(f))).toBeCloseTo(1, 5);
  // The sun's way is the hour's, and the tide is full as the cast leaves and empty five seconds on.
  sunDirection(10, sun);
  const day = lanes(4, 362, 10), yaw = (SITE.yaw * Math.PI) / 32768;
  expect(day[SUN + 1]).toBeCloseTo(sun[1]!, 6);
  expect(Math.cos(yaw) * day[SUN]! + Math.sin(yaw) * day[SUN + 2]!).toBeCloseTo(sun[0]!, 6);
  expect([orbFill(CAST_PHASE), orbFill(CAST_PHASE + 5)]).toEqual([1, 0]);
  expect(orbFill(CAST_PHASE - 0.01)).toBeGreaterThan(0.99);
  expect(orbFill(80)).toBeGreaterThan(orbFill(50));
});

/** A frame for the pass alone: a real packet, camera and instance writer, and the assets and the packet's writer as far as the pass asks them. */
function stage(meshes: readonly string[]) {
  const packet = new FramePacket();
  packet.tier = tierOf("high");
  const cam = new Camera();
  cam.far = 12000;
  const draws: { mesh: number; level: number; flags: number; passes: number }[] = [], wanted: string[] = [];
  const assets = {
    table: { find: (id: string) => meshes.indexOf(id), error: meshes.map(() => [0, 0.5, 4]), radius: Float32Array.from(meshes, () => 60) },
    choose: (errors: readonly number[], distance: number) => (distance > 2000 ? errors.length - 1 : distance > 300 ? 1 : 0),
    want: (mesh: number) => void wanted.push(`flat ${meshes[mesh]}`),
    wantTextured: (mesh: number) => void wanted.push(`textured ${meshes[mesh]}`),
  };
  const put = { doubled: 0, draw: (mesh: number, level: number, _b: number, _f: number, _n: number, _x: number, _y: number, _z: number, flags: number, passes: number) => void draws.push({ mesh, level, flags, passes }) };
  const f = { cam, packet, assets, put, transient: new InstanceWriter(packet.transient), world: { orbs: [SITE] as readonly OrbSite[] } };
  const pass = new Orbs(assets as never);
  /** The frame's draws with the camera `metres` south of the ball, looking at it. */
  const from = (metres: number, yaw = 0): typeof draws => {
    cam.x = SITE.x;
    cam.y = SITE.y + 2;
    cam.z = SITE.z - metres;
    cam.yaw = yaw;
    cam.update();
    packet.beginFrame();
    draws.length = wanted.length = 0;
    pass.draw(f as unknown as Frame);
    return draws;
  };
  return { from, wanted, packet, f };
}

test("the pass draws shell and plinth at any distance and skips missing meshes", () => {
  const whole = stage(["core:orb/plinth", "core:orb/shell"]);
  for (const metres of [150, 900, 8000]) {
    const draws = whole.from(metres);
    expect(draws.length).toBeLessThanOrEqual(5);
    expect(draws.map((d) => [d.mesh, (d.flags & DRAW_ORB) !== 0])).toEqual([[1, true], [0, false]]);
    expect(draws.every((d) => d.passes !== 0)).toBe(true);
    expect(whole.wanted).toEqual(["flat core:orb/shell", "textured core:orb/plinth"]);
  }
  // Coarser levels with distance, and nothing where the ball is behind the eye.
  expect([whole.from(150)[0]!.level, whole.from(900)[0]!.level, whole.from(8000)[0]!.level]).toEqual([0, 1, 2]);
  expect(whole.from(900, Math.PI)).toEqual([]);
  // A marked draw is the orb program's, whatever its mesh's materials.
  const p = whole.packet;
  for (const more of [0, DRAW_TEXTURED]) {
    p.drawFlags[0] = whole.from(150)[0]!.flags | more;
    expect(drawProgram(p, 0, undefined)).toBe(PROGRAM.orb);
  }
  // With two orbs the nearer is the screen, as the frame's lanes hold it, and the other is plain.
  Object.assign(whole.f.world, { orbs: [{ ...SITE, z: SITE.z + 1500 }, SITE] });
  expect(whole.from(400).map((d) => (d.flags & DRAW_ORB) !== 0)).toEqual([false, false, true, false]);
  // Art that has not come: the shell alone, the plinth alone, neither.
  expect(stage(["core:orb/shell"]).from(300).map((d) => d.mesh)).toEqual([0]);
  expect(stage(["core:orb/plinth"]).from(300).map((d) => (d.flags & DRAW_ORB) !== 0)).toEqual([false]);
  expect(stage([]).from(300)).toEqual([]);
});

let made: Pack | null = null;
/** The core's grey boxes with a box each for the shell and the plinth, until the art has them. */
const pack = (): Pack => (made ??= parsePack(buildPack([...grayboxMeshes(CORE_CONTENT), { id: "core:orb/shell", lods: [boxMesh([44, 44, 44], 12)] }, { id: "core:orb/plinth", lods: [boxMesh([50, 3, 50], 5)] }], defaultPalette())));

/** A flat map with the ball on it, drawn on `tier` from 300 m south. */
function world(tier: string, thePack: Pack, orbs: readonly OrbSite[] | null = [{ ...SITE, y: 0 }]) {
  const reg = sceneRegistry(), dims = { chunksX: 32, chunksZ: 32 };
  const hf = new Heightfield(dims, TERRAIN_CELL, -64, 1 / 64);
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const scene = new Scene({ dims, hf, structs, ...(orbs ? { orbs } : {}), tideEyes: [{ ...BLUE, y: 0 }] }, reg, thePack);
  scene.assets.tier = tierOf(tier);
  scene.plainSky = true;
  const cam = new Camera();
  cam.x = SITE.x;
  cam.y = 2;
  cam.z = SITE.z - 300;
  cam.pitch = 0.12;
  cam.aspect = 160 / 90;
  scene.viewHeight = 90;
  return { scene, cam, hf };
}

test("a scene writes the orb's lanes and draws its screen, on low poly too", () => {
  for (const tier of ["lowpoly", "medium"]) {
    const { scene, cam, hf } = world(tier, pack());
    scene.eyeSeconds = 5 * ORB_HOLD + CAST_PHASE + 30;
    scene.hour = 12;
    const p = scene.build(cam, null);
    expect([...p.frame.subarray(ORB_AT, ORB_AT + 4)]).toEqual([0, 32, 300, 78]);
    expect(p.frame[ORB_AT + 8]).toBe(orbShow(scene.eyeSeconds, { scene: 0, before: 0, wipe: 0 }).scene);
    expect(p.frame[ORB_AT + 11]).toBeGreaterThan(0);
    const marked = [...Array(p.drawCount).keys()].filter((d) => (p.drawFlags[d]! & DRAW_ORB) !== 0);
    // One draw, or one in each depth range where the ball stands across the split; with the plinth's, within the gate.
    expect(marked.length === 1 || marked.length === 2).toBe(true);
    for (const d of marked) expect(drawProgram(p, d, undefined)).toBe(PROGRAM.orb);
    expect([...Array(p.drawCount).keys()].filter((d) => ["core:orb/shell", "core:orb/plinth"].includes(scene.assets.manifest.meshes[p.drawMesh[d]!]!.id)).length).toBeLessThanOrEqual(5);
    expect(tierPrograms(p.tier)).toContain(PROGRAM.orb);
    // The pixel on the shell at the middle of the view is the twin's light there, shown.
    const raster = new Rasterizer(160, 90, pack(), hf);
    raster.render(p);
    const at = (45 * 160 + 80) * 4, shown = [...raster.color.subarray(at, at + 3)];
    expect(Math.max(...shown)).toBeGreaterThan(20);
    // Held on another scene the same pixel shows another picture, and dark with the level at nothing.
    scene.orbOnly = (p.frame[ORB_AT + 8]! + 2) % ORB_SCENES.length;
    raster.render(scene.build(cam, null));
    expect([...raster.color.subarray(at, at + 3)]).not.toEqual(shown);
    scene.orbGain = 0;
    raster.render(scene.build(cam, null));
    expect(Math.max(...raster.color.subarray(at, at + 3))).toBeLessThan(40);
  }
  // A map with no orb, and a pack whose art has not come: nothing is drawn and nothing fails.
  const none = world("medium", pack(), null);
  const bare = none.scene.build(none.cam, null);
  expect(bare.frame.subarray(ORB_AT, ORB_AT + ORB_LANES * 4).every((v) => v === 0)).toBe(true);
  const artless = world("medium", corePack());
  const q = artless.scene.build(artless.cam, null);
  expect(q.frame[ORB_AT + 3]).toBe(78);
  expect([...Array(q.drawCount).keys()].filter((d) => (q.drawFlags[d]! & DRAW_ORB) !== 0)).toEqual([]);
});

test("the program's texts compile on every tier, with the tier's octaves and pucks", () => {
  for (const tier of TIERS) {
    for (const light of [false, true]) {
      const text = PROGRAMS.orb!(tier, "rgba", false, light);
      expect(text.fragment).toBe(ORB_FRAGMENT);
      expect(text.defines).toContain(`#define ORB_OCTAVES ${tier.orb.octaves}\n`);
      expect(text.defines.includes("ORB_PUCKS")).toBe(tier.orb.pucks);
      const vertex = withDefines(text.vertex, text.defines), fragment = withDefines(text.fragment, text.defines);
      expect([...compileErrors(vertex), ...compileErrors(fragment), ...linkErrors(vertex, fragment)]).toEqual([]);
    }
  }
  // Low poly reads the fewest octaves, and no tier more than four.
  expect(TIERS.map((t) => t.orb.octaves)).toEqual([...TIERS.map((t) => t.orb.octaves)].sort((a, b) => a - b));
  expect(Math.max(...TIERS.map((t) => t.orb.octaves))).toBeLessThanOrEqual(4);
  // It reads no texture, and its shell's size is the art's.
  expect(ORB_FRAGMENT).not.toMatch(/sampler|texture\(/);
  expect(ORB_SHELL).toBe(78);
});
