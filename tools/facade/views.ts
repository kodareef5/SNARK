// The facades in the software twin, before they are joined to the world's finishes: a street of four buildings made of
// the facade modules' boxes (content/ruins.ts), a flats block, a shop row, an office tower and a garage, cast ray by
// ray and lit as LIT lights a flat draw, with facade.ts on every part it knows. The sun's shadow is cast against the
// boxes. Views at 3, 15 and 60 m in sun and in shade, and a walk past, for judging the atlases and the rooms.
// bun tools/facade/views.ts <out folder> [--source <art>] [--tier high|medium|ultra] [--only <view>]

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FACADE_AT, RUIN_FACADES, RUIN_FINISHES, type FacadeModule } from "../../content/ruins.ts";
import { sample, type Texture } from "../../client/core/render/cpu-texture.ts";
import { FACADE_COLOURS, FACADE_TIERS, facadeKind, facadeOut, facadeSurface, type FacadeSample, type FacadeTier } from "../../client/core/render/facade.ts";
import { FRAME, FramePacket } from "../../client/core/render/packet.ts";
import { domeLight, skyFrame, theSky, trueSun } from "../../client/core/render/sky.ts";
import { lit, shown, skyFrom, skyLight, srgbToLinear } from "../../client/core/render/surface.ts";
import { defaultPalette } from "../../shared/pack/palette.ts";
import { encodePng } from "../snap/png.ts";
import { FACADE_SOURCE, facadeMaps } from "./build.ts";

/** A box of the street: least and most corner in the scene's metres, its palette colour, the module it is part of. */
interface Box { lo: number[]; hi: number[]; colour: number; module: number }
/** A module placed: its origin (its piece's, FACADE_AT from its bay's foot) and its boxes' bounds. */
interface Placed { origin: number[]; lo: number[]; hi: number[]; first: number; count: number }

const boxes: Box[] = [];
const modules: Placed[] = [];
/** Puts module `name` in its finish with its bay's middle at x and its storey's floor at y, on the wall line z = 0 facing +z. */
function put(name: FacadeModule, finish: keyof typeof RUIN_FINISHES, x: number, y: number): void {
  const at = FACADE_AT[name], shape = RUIN_FACADES[name], f = RUIN_FINISHES[finish];
  const origin = [x + at[0]!, y + at[1]!, at[2]!];
  const first = boxes.length;
  for (const b of shape.look!.boxes!) {
    boxes.push({ lo: [0, 1, 2].map((a) => origin[a]! + b.at[a]! - b.half[a]!), hi: [0, 1, 2].map((a) => origin[a]! + b.at[a]! + b.half[a]!), colour: b.color ?? f.color, module: modules.length });
  }
  const own = boxes.slice(first);
  modules.push({ origin, lo: [0, 1, 2].map((a) => Math.min(...own.map((b) => b.lo[a]!))), hi: [0, 1, 2].map((a) => Math.max(...own.map((b) => b.hi[a]!))), first, count: own.length });
}
/** A plain box, the building's body behind its front or a slab, as a module of one box. */
function mass(lo: number[], hi: number[], colour: number): void {
  boxes.push({ lo, hi, colour, module: modules.length });
  modules.push({ origin: [(lo[0]! + hi[0]!) / 2, lo[1]!, (lo[2]! + hi[2]!) / 2], lo, hi, first: boxes.length - 1, count: 1 });
}

// Flats, x -32 to -8: a ground floor, three storeys of balconies, a roofed top.
for (const x of [-28, -20, -12]) {
  put("zlobby", "rose", x, 0);
  for (const y of [4, 8, 12]) put("zbalc", "rose", x, y);
  put("zbalctop", "rose", x, 16);
}
mass([-32, 0, -14], [-8, 20.8, -0.4], 97);
// A door the lobby has not yet: a dark box a door's size, which the facade draws as one.
mass([-20.5, 0, 0.25], [-19.5, 2.2, 0.28], 83);
// Shops, x -8 to 24: shop fronts, one shuttered, two storeys of windows and a parapet.
for (const [i, x] of [-4, 4, 12, 20].entries()) {
  put(i === 2 ? "zshutter" : "zstore", "limestone", x, 0);
  put("zwin", "limestone", x, 4);
  put("zwintop", "limestone", x, 8);
}
mass([-8, 0, -14], [24, 12, -1.3], 101);
mass([-8, -0.2, -14], [24, 0, 0], 2);
// An office tower, x 24 to 48: five storeys of curtain wall and a crown.
for (const x of [28, 36, 44]) {
  for (const y of [0, 4, 8, 12, 16]) put("zcurt", "concrete", x, y);
  put("zcurttop", "concrete", x, 20);
}
mass([24, -0.4, -16], [48, 24, -0.25], 97);
// A garage, x 48 to 64: a way in and open decks with their slabs and the dark of the decks behind.
for (const x of [52, 60]) {
  put("zgate", "concrete", x, 0);
  for (const y of [4, 8]) put("zdeck", "concrete", x, y);
}
for (const y of [4, 8, 12]) mass([48, y - 0.4, -16], [64, y, 0], 100);
mass([48, 0, -16.5], [64, 12, -16], 97);
// The street: a pavement and the road.
mass([-60, -0.2, 0], [90, 0.12, 4], 2);
mass([-60, -0.3, 4], [90, 0, 60], 4);

const palette = defaultPalette();
const linear = (c: number): number[] => [0, 1, 2].map((k) => srgbToLinear(palette[c * 4 + k]! / 255));

/** The nearest box a ray from o along d meets within `far`: its index, distance and face (axis * 2 + 1 where it faces up its axis). */
const hit = { box: -1, t: 0, face: 0 };
function cast(o: Numbers, d: Numbers, far: number, any = false): boolean {
  hit.box = -1;
  hit.t = far;
  const inv = [1 / d[0]!, 1 / d[1]!, 1 / d[2]!];
  const span = (lo: number[], hi: number[]): [number, number, number] => {
    let t0 = -Infinity, t1 = Infinity, face = 0;
    for (let a = 0; a < 3; a++) {
      let n = (lo[a]! - o[a]!) * inv[a]!, f = (hi[a]! - o[a]!) * inv[a]!;
      const enter = inv[a]! < 0 ? a * 2 + 1 : a * 2;
      if (n > f) [n, f] = [f, n];
      if (n > t0) [t0, face] = [n, enter];
      if (f < t1) t1 = f;
    }
    return [t0, t1, face];
  };
  for (const m of modules) {
    const [m0, m1] = span(m.lo, m.hi);
    if (m0 > m1 || m1 < 1e-4 || m0 > hit.t) continue;
    for (let i = m.first; i < m.first + m.count; i++) {
      const [t0, t1, face] = span(boxes[i]!.lo, boxes[i]!.hi);
      if (t0 <= t1 && t0 > 1e-4 && t0 < hit.t) {
        [hit.box, hit.t, hit.face] = [i, t0, face];
        if (any) return true;
      }
    }
  }
  return hit.box >= 0;
}
type Numbers = ArrayLike<number>;

interface View { name: string; eye: number[]; at: number[]; hour: number; shade: boolean }
/** Draws a view into an RGBA picture w by h with a 70 degree lens. `shade` turns the street so its front faces away from the sun. */
function draw(view: View, w: number, h: number, tier: FacadeTier, tex: Texture[]): Uint8Array {
  const p = new FramePacket();
  skyFrame(view.hour, theSky(), p.frame);
  p.frame[FRAME.eyeHeight] = view.eye[1]!;
  const sunWorld = [p.frame[FRAME.sun]!, p.frame[FRAME.sun + 1]!, p.frame[FRAME.sun + 2]!];
  const trueAt = new Float64Array(3);
  trueSun(p.frame, trueAt);
  // The street's +z is turned toward the sun's way round, or away from it: world = turn * scene.
  const az = Math.atan2(sunWorld[0]!, sunWorld[2]!) + (view.shade ? Math.PI : 0) + 0.35;
  const c = Math.cos(az), s = Math.sin(az);
  const toWorld = (v: Numbers): number[] => [c * v[0]! + s * v[2]!, v[1]!, -s * v[0]! + c * v[2]!];
  const toScene = (v: Numbers): number[] => [c * v[0]! - s * v[2]!, v[1]!, s * v[0]! + c * v[2]!];
  const sun = toScene(sunWorld);
  const look = (dir: Numbers, out: Float64Array | Float32Array | number[]): void => domeLight(theSky().table, trueAt, dir, out);
  const sample3: FacadeSample = (t, u, v, lod, out) => {
    const tt = tex[t]!;
    sample(tt, u, v, lod - (tt.pictures.length - 1), out);
  };
  const forward = [0, 1, 2].map((a) => view.at[a]! - view.eye[a]!), fl = Math.hypot(...forward);
  const f = forward.map((q) => q / fl), side = [-f[2]!, 0, f[0]!].map((q) => q / Math.hypot(f[0]!, f[2]!)), up = [side[1]! * f[2]! - side[2]! * f[1]!, side[2]! * f[0]! - side[0]! * f[2]!, side[0]! * f[1]! - side[1]! * f[0]!];
  const tan = Math.tan((70 * Math.PI) / 360), pixel = (2 * tan) / h;
  const out = new Uint8Array(w * h * 4), o = facadeOut();
  const light = new Float64Array(3), rgb = new Float64Array(3), mirror = new Float64Array(3), sky = new Float64Array(3), sky2 = new Float64Array(3);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const sx = ((px + 0.5) / w * 2 - 1) * tan * (w / h), sy = (1 - (py + 0.5) / h * 2) * tan;
      const dir = [0, 1, 2].map((a) => f[a]! + side[a]! * sx + up[a]! * sy), dl = Math.hypot(...dir);
      const d = dir.map((q) => q / dl);
      const wd = toWorld(d);
      if (!cast(view.eye, d, 4000)) {
        skyFrom(light, p.frame, wd, look);
        shown(rgb, light, 4000, p);
      } else {
        const b = boxes[hit.box]!, t = hit.t;
        const point = [0, 1, 2].map((a) => view.eye[a]! + d[a]! * t);
        const axis = hit.face >> 1, n = [0, 0, 0];
        n[axis] = hit.face & 1 ? 1 : -1;
        const nw = toWorld(n), v = wd.map((q) => -q);
        const shade = sun[1]! > 0 && !cast(point.map((q, a) => q + n[a]! * 1e-3), sun, 500, true) ? 1 : 0;
        const albedo = linear(b.colour), orm = [1, 1, 0];
        let normal = nw, sharp = false;
        o.room.fill(0);
        o.farShare = 0;
        const fw = b.hi[0]! - b.lo[0]!, fh = b.hi[1]! - b.lo[1]!;
        // A part's face to the street, or a jamb's across the bay.
        const across = axis === 0 ? b.hi[2]! - b.lo[2]! : fw;
        const kind = axis !== 1 ? facadeKind(FACADE_COLOURS[b.colour] ?? 0, across, fh, 0) : 0;
        if (kind > 0) {
          const m = modules[b.module]!;
          // The face's left foot and its right, as a reader facing it sees them, and where the point is across it.
          const right = axis === 2 ? [n[2]!, 0, 0] : [0, 0, -n[0]!];
          const left = [0, 1, 2].map((a) => (a === axis ? (n[a]! > 0 ? b.hi[a]! : b.lo[a]!) : right[a]! < 0 ? b.hi[a]! : b.lo[a]!));
          const corner = left.map((q, a) => q - m.origin[a]!);
          const ax = (point[0]! - left[0]!) * right[0]! + (point[2]! - left[2]!) * right[2]!;
          const footprint = (t * pixel) / Math.max(Math.abs(d[axis]!), 0.05);
          o.albedo.set(albedo);
          o.orm.set(orm);
          o.normal.set(nw);
          facadeSurface(o, kind, ax, point[1]! - b.lo[1]!, across, fh, nw, v, corner, toWorld(right), Math.round(m.origin[0]! * 4), Math.round(m.origin[2]! * 4), point[1]!, point[1]!, footprint, t, tier, sample3);
          albedo.splice(0, 3, ...o.albedo);
          orm.splice(0, 3, ...o.orm);
          normal = [...o.normal];
          sharp = o.sharp;
        }
        const twice = 2 * (normal[0]! * v[0]! + normal[1]! * v[1]! + normal[2]! * v[2]!);
        const r = normal.map((q, a) => twice * q - v[a]!);
        if (sharp) {
          skyFrom(mirror, p.frame, r, look);
          skyLight(sky2, p.frame, nw.map((q) => -q));
          for (let k = 0; k < 3; k++) mirror[k] = mirror[k]! * (1 - o.farShare) + o.far[k]! * sky2[k]! * o.farShare;
        } else if (orm[1]! < 1) skyLight(mirror, p.frame, r);
        else mirror.fill(0);
        lit(light, albedo, orm, normal, v, p.frame, mirror, shade);
        skyLight(sky, p.frame, nw);
        for (let k = 0; k < 3; k++) light[k]! += o.room[k]! * sky[k]!;
        shown(rgb, light, t, p);
      }
      for (let k = 0; k < 3; k++) out[(py * w + px) * 4 + k] = Math.round(Math.min(1, Math.max(0, rgb[k]!)) * 255);
      out[(py * w + px) * 4 + 3] = 255;
    }
  }
  return out;
}

const VIEWS: View[] = [
  { name: "flats-3m", eye: [-17, 5.7, 3], at: [-21, 5.6, 0], hour: 13, shade: false },
  { name: "flats-3m-shade", eye: [-17, 5.7, 3], at: [-21, 5.6, 0], hour: 13, shade: true },
  { name: "shops-3m", eye: [6, 1.7, 3], at: [1, 1.6, 0], hour: 13, shade: false },
  { name: "office-3m", eye: [33, 1.7, 3], at: [37, 3.2, 0], hour: 13, shade: false },
  { name: "street-15m", eye: [6, 1.7, 15], at: [4, 5, 0], hour: 13, shade: false },
  { name: "street-15m-shade", eye: [6, 1.7, 15], at: [4, 5, 0], hour: 13, shade: true },
  { name: "street-60m", eye: [10, 1.7, 60], at: [12, 8, 0], hour: 13, shade: false },
  { name: "street-60m-shade", eye: [10, 1.7, 60], at: [12, 8, 0], hour: 13, shade: true },
  { name: "flats-street", eye: [-20, 1.7, 8], at: [-20, 6, 0], hour: 13, shade: false },
  { name: "lobby-3m", eye: [-18, 1.7, 3], at: [-20, 1.5, 0], hour: 13, shade: false },
  { name: "office-5m", eye: [36, 1.7, 5], at: [36, 2.3, 0], hour: 13, shade: false },
  { name: "office-5m-shade", eye: [36, 1.7, 5], at: [36, 2.3, 0], hour: 13, shade: true },
  ...[0, 1, 2].map((k): View => ({ name: `walk-${k}`, eye: [-2 + k * 1.5, 1.7, 4], at: [-3 + k * 1.5, 1.6, 0], hour: 13, shade: false })),
];

if (import.meta.main) {
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const folder = resolve(args[0] ?? "var/facade/views"), tierName = opt("--tier") ?? "high", only = opt("--only");
  const tier = FACADE_TIERS[tierName];
  if (!tier) throw new Error(`no facade on ${tierName}`);
  const tex = facadeMaps(tier, opt("--source") ? resolve(opt("--source")!) : FACADE_SOURCE).textures;
  mkdirSync(folder, { recursive: true });
  const [w, h] = [Number(opt("--width") ?? 960), Number(opt("--height") ?? 540)];
  for (const view of VIEWS) {
    if (only && !view.name.startsWith(only)) continue;
    writeFileSync(join(folder, `${view.name}-${tierName}.png`), encodePng(w, h, draw(view, w, h, tier, tex)));
    console.log(view.name);
  }
}
