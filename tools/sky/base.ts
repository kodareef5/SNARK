// Draws the pictures the sky's mood keys are painted over: the proving ground seen from the top of its west rim, where
// all the land lies below the horizon, as a full panorama at each key's sun height, with two grey cubes beside the
// camera. It writes them and the points a key is read at to assets/source/core/sky/keys/base/.
// Run: bun tools/sky/base.ts [--out DIR] [--only NAME]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { DRAW_PLAIN, FRAME } from "../../client/core/render/packet.ts";
import { hourOfSun, skyFrame, sunDirection, sunHeight, theSky } from "../../client/core/render/sky.ts";
import { Found } from "../../shared/world/structures.ts";
import { provingView, type ProvingView } from "../snap.ts";
import { encodePng } from "../snap/png.ts";

/** The keys of the plan's A2: a name, the hour, and whether the moon lights it rather than the sun. */
export const KEYS = [
  { name: "dawn", hour: hourOfSun(2, false), moon: false },
  { name: "morning", hour: hourOfSun(15, false), moon: false },
  { name: "noon", hour: 12, moon: false },
  { name: "afternoon", hour: hourOfSun(35, true), moon: false },
  { name: "golden", hour: hourOfSun(8, true), moon: false },
  { name: "sunset", hour: hourOfSun(0, true), moon: false },
  { name: "dusk", hour: hourOfSun(-8, true), moon: false },
  { name: "night", hour: 0, moon: true },
] as const;

export const WIDTH = 2048;
export const HEIGHT = 1024;
/** The heading of the panorama's middle column, degrees clockwise from north (+Z). Chosen so no point falls on its seam. */
export const MIDDLE = 345;
/** The camera: 4 m over the highest ground near the rim's top, from which every piece of land is under the horizon. */
export const EYE = { x: 505, z: 370, over: 4 };
/** Pixels across the square read round each point. */
export const PATCH = 13;
const FACE = 1024;
const CUBE = 1; // half a side of core:block
const GREY = 15; // palette grey 128
/** Metres round the camera kept clear of nodes. */
const CLEAR = 60;

const rad = Math.PI / 180;

/** A direction from a heading (clockwise from north, +Z, toward east, -X) and an elevation, in degrees. */
export function direction(heading: number, elevation: number): [number, number, number] {
  const c = Math.cos(elevation * rad);
  return [-Math.sin(heading * rad) * c, Math.sin(elevation * rad), Math.cos(heading * rad) * c];
}

export function headingOf(x: number, y: number, z: number): { heading: number; elevation: number } {
  return { heading: ((Math.atan2(-x, z) / rad) % 360 + 360) % 360, elevation: Math.atan2(y, Math.hypot(x, z)) / rad };
}

/** The pixel of the panorama a heading and elevation fall on. */
export function pixelOf(heading: number, elevation: number): { x: number; y: number } {
  const u = 0.5 + (((heading - MIDDLE + 540) % 360) - 180) / 360;
  return { x: Math.min(WIDTH - 1, Math.floor(u * WIDTH)), y: Math.min(HEIGHT - 1, Math.floor(((90 - elevation) / 180) * HEIGHT)) };
}

interface Point {
  heading: number;
  elevation: number;
  x: number;
  y: number;
}

function point(heading: number, elevation: number): Point {
  heading = ((heading % 360) + 360) % 360;
  return { heading: +heading.toFixed(2), elevation: +elevation.toFixed(2), ...pixelOf(heading, elevation) };
}

/** Six square views, a quarter turn wide each, that together see every direction. */
const FACES = [
  { yaw: 0, pitch: 0 },
  { yaw: Math.PI / 2, pitch: 0 },
  { yaw: Math.PI, pitch: 0 },
  { yaw: -Math.PI / 2, pitch: 0 },
  { yaw: 0, pitch: Math.PI / 2 },
  { yaw: 0, pitch: -Math.PI / 2 },
];

/**
 * One key's panorama and its points. With `lit`, drawn as the lit tiers draw it, without fog: the land lit from the
 * frame block and the dome from the sky table.
 */
export function render(key: (typeof KEYS)[number], lit = false): { pixels: Uint8ClampedArray; points: Record<string, Point>; sun: Point; moon: Point } {
  const view: ProvingView = provingView(FACE, FACE);
  const { scene, cam, hf, structs, reg, raster } = view;
  scene.assets.tier = tierOf("lowpoly");
  scene.hour = key.hour;
  scene.viewHeight = FACE;
  const sun = [0, 0, 0];
  sunDirection(key.hour, sun);
  const light = key.moon ? sun.map((v) => -v) : sun;
  // Two grey cubes a few metres off, each turned to face the light: the camera sees the lit face of the one away from
  // the light and the shaded face of the one toward it.
  const block = reg.index.get("core:block")!;
  scene.colorOfKind[block] = GREY;
  const flat = Math.hypot(light[0]!, light[2]!);
  const [lx, lz] = [light[0]! / flat, light[2]! / flat];
  const turn = (x: number, z: number, a: number): [number, number] => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
  const groundY = hf.heightAt(EYE.x, EYE.z);
  const eye = { x: EYE.x, y: groundY + EYE.over, z: EYE.z };
  // No tree or rock near the camera stands in front of the sky.
  const found = new Found();
  const near = view.nodes.store.query(eye.x - CLEAR, eye.z - CLEAR, eye.x + CLEAR, eye.z + CLEAR, found);
  for (let i = 0; i < near; i++) view.nodes.store.remove(found.refs[i]!);
  const yaw = Math.round((Math.atan2(lx, lz) / (2 * Math.PI)) * 65536) & 0xffff;
  // A third, sunk to its top, is a card lying flat, square across the light from the camera.
  const cubes: Record<string, { x: number; y: number; z: number }> = {};
  for (const [name, reach, a, sunk] of [["lit", -4.5, 55 * rad, false], ["shaded", 4.5, 55 * rad, false], ["flat", 3.5, Math.PI / 2, true]] as const) {
    // Of the two places either side of the light's line, the one inland, where the ground is lower.
    const [ox, oz] = [turn(lx * reach, lz * reach, a), turn(lx * reach, lz * reach, -a)].sort((p, q) => p[0] - q[0])[0]!;
    const x = eye.x + ox;
    const z = eye.z + oz;
    let top = -Infinity;
    for (const dx of [-CUBE, CUBE]) for (const dz of [-CUBE, CUBE]) top = Math.max(top, hf.heightAt(x + dx, z + dz));
    const y = sunk ? top + 0.02 - CUBE : top + CUBE;
    // No cube may stand against the sky near the horizon.
    if (Math.atan2(y + CUBE - eye.y, Math.hypot(x - eye.x, z - eye.z) - CUBE * Math.SQRT2) > -4 * rad) throw new Error(`the ${name} cube of ${key.name} reaches the horizon`);
    structs.add(block, x, y, z, yaw, 0, 1000);
    cubes[name] = { x, y, z };
  }
  // The sea runs on past the map to the horizon.
  const water = scene.assets.table.find("core:water");
  for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) scene.things.push({ mesh: water, x: 256 + i * 1024, y: hf.seaLevel - 0.05, z: 256 + j * 1024, level: -1 });
  const blockMesh = scene.meshOfKind[block]!;

  cam.x = eye.x;
  cam.y = eye.y;
  cam.z = eye.z;
  cam.fovY = Math.PI / 2;
  cam.aspect = 1;
  const faces: Uint8ClampedArray[] = [];
  const matrices: Float32Array[] = [];
  for (const f of FACES) {
    cam.yaw = f.yaw;
    cam.pitch = f.pitch;
    const p = scene.build(cam, null);
    p.sun[0] = light[0]!;
    p.sun[1] = light[1]!;
    p.sun[2] = light[2]!;
    // The cards and the sea are drawn without the checker.
    for (let d = 0; d < p.drawCount; d++) if (p.drawMesh[d] === blockMesh || p.drawMesh[d] === water) p.drawFlags[d]! |= DRAW_PLAIN;
    if (lit) {
      // Low poly's meshes and palette, lit as a lit tier lights them.
      p.lit = true;
      skyFrame(key.hour, theSky(), p.frame);
      p.frame[FRAME.eyeHeight] = eye.y - hf.seaLevel;
      p.fogStart = p.fogEnd = 1e9;
    }
    raster.render(p);
    faces.push(raster.color.slice());
    matrices.push(p.viewProj.slice());
  }

  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  const acc = [0, 0, 0];
  for (let j = 0; j < HEIGHT; j++) {
    for (let i = 0; i < WIDTH; i++) {
      acc.fill(0);
      for (let s = 0; s < 4; s++) {
        const heading = MIDDLE + ((i + 0.25 + 0.5 * (s & 1)) / WIDTH - 0.5) * 360;
        const elevation = 90 - ((j + 0.25 + 0.5 * (s >> 1)) / HEIGHT) * 180;
        const [dx, dy, dz] = direction(heading, elevation);
        let best = 0;
        let most = -Infinity;
        for (let f = 0; f < 6; f++) {
          const m = matrices[f]!;
          const w = m[3]! * dx + m[7]! * dy + m[11]! * dz;
          if (w > most) {
            most = w;
            best = f;
          }
        }
        const m = matrices[best]!;
        const fx = ((m[0]! * dx + m[4]! * dy + m[8]! * dz) / most) * 0.5 + 0.5;
        const fy = 0.5 - ((m[1]! * dx + m[5]! * dy + m[9]! * dz) / most) * 0.5;
        bilinear(faces[best]!, fx * FACE - 0.5, fy * FACE - 0.5, acc);
      }
      const o = (j * WIDTH + i) * 4;
      pixels[o] = acc[0]! / 4;
      pixels[o + 1] = acc[1]! / 4;
      pixels[o + 2] = acc[2]! / 4;
      pixels[o + 3] = 255;
    }
  }

  const towards = headingOf(light[0]!, light[1]!, light[2]!);
  const facing = (c: { x: number; y: number; z: number }, nx: number, ny: number, nz: number): Point => {
    const h = headingOf(c.x + nx * CUBE - eye.x, c.y + ny * CUBE - eye.y, c.z + nz * CUBE - eye.z);
    return point(h.heading, h.elevation);
  };
  const points: Record<string, Point> = {
    zenith: point(MIDDLE, 87),
    high: point(towards.heading + 180, 30),
    toward: point(towards.heading + 15, 3),
    away: point(towards.heading + 180, 3),
    lit: facing(cubes.lit!, lx, 0, lz),
    shaded: facing(cubes.shaded!, -lx, 0, -lz),
    up: facing(cubes.flat!, 0, 1, 0),
  };
  const s = headingOf(sun[0]!, sun[1]!, sun[2]!);
  const mo = headingOf(-sun[0]!, -sun[1]!, -sun[2]!);
  return { pixels, points, sun: point(s.heading, s.elevation), moon: point(mo.heading, mo.elevation) };
}

function bilinear(img: Uint8ClampedArray, x: number, y: number, out: number[]): void {
  const x0 = Math.max(0, Math.min(FACE - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(FACE - 1, Math.floor(y)));
  const x1 = Math.min(FACE - 1, x0 + 1);
  const y1 = Math.min(FACE - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  for (let c = 0; c < 3; c++) {
    const a = img[(y0 * FACE + x0) * 4 + c]!, b = img[(y0 * FACE + x1) * 4 + c]!;
    const d = img[(y1 * FACE + x0) * 4 + c]!, e = img[(y1 * FACE + x1) * 4 + c]!;
    out[c]! += (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf("--" + name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = resolve(arg("out") ?? "assets/source/core/sky/keys/base");
  mkdirSync(out, { recursive: true });
  const only = arg("only");
  const keys = [];
  for (const key of KEYS) {
    if (only && key.name !== only) continue;
    const t0 = performance.now();
    const r = render(key);
    writeFileSync(join(out, `${key.name}.png`), encodePng(WIDTH, HEIGHT, r.pixels));
    keys.push({ name: key.name, file: `${key.name}.png`, hour: +key.hour.toFixed(4), sunHeight: +sunHeight(key.hour).toFixed(2), lightBy: key.moon ? "moon" : "sun", sun: r.sun, moon: r.moon, points: r.points });
    console.log(`${key.name.padEnd(10)} hour ${key.hour.toFixed(3)} sun ${sunHeight(key.hour).toFixed(2)} deg  ${(performance.now() - t0).toFixed(0)} ms`);
  }
  if (!only) {
    const points = {
      about: "The proving ground from 4 m over the top of its west rim, at each of the eight mood keys' hours, drawn by the software rasterizer on low poly with today's flat sky. Paint each key over its picture, keeping the horizon, the land's shapes and where the sun is. A key is read at the points below: the mean of the square of `patch` pixels centred on each.",
      projection: `Equirectangular, ${WIDTH} by ${HEIGHT}. A column's heading in degrees clockwise from north is ${MIDDLE} + (x + 0.5 - ${WIDTH / 2}) * 360 / ${WIDTH}; north is +Z and east is -X in the world. A row's elevation is 90 - (y + 0.5) * 180 / ${HEIGHT}.`,
      eye: { x: EYE.x, z: EYE.z, overGround: EYE.over },
      patch: PATCH,
      pointsAre: {
        zenith: "the sky straight up (87 degrees, any heading)",
        high: "the sky 30 degrees up, opposite the light's heading",
        toward: "the sky 3 degrees up, 15 degrees round from the light's heading, clear of the disc",
        away: "the sky 3 degrees up, opposite the light's heading",
        lit: "the upright face of a grey 128 cube turned to the light's heading, lit by it at the light's height",
        shaded: "the upright face of a second grey 128 cube turned away from the light's heading, in its own shade",
        up: "a third grey 128 cube sunk to its top, a card lying flat and facing straight up",
      },
      lightIs: "the sun, except in the night key, where it is the moon opposite the sun",
      keys,
    };
    writeFileSync(join(out, "points.json"), JSON.stringify(points, null, 2) + "\n");
  }
}
