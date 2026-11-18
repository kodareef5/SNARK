// The facades' text on a GPU (client/core/render/facade.ts), a check of tools/probe-lit.ts: a wall of every kind of
// part, drawn by FACADE_GLSL with the varyings the flat program gives a static (its face's corners, its own frame and its
// place), from near and from across a street, on high (rooms and the far side) and on medium (a dark recess), and held
// to facadeSurface at points away from every edge. Each pass writes one of its outputs: the albedo, the room's light,
// the normal, and occlusion, roughness and the far side's share.

import { sample } from "../../client/core/render/cpu-texture.ts";
import { FACADE_GLSL, FACADE_TIERS, KIND, facadeKind, facadeOut, facadeSurface, type FacadeSample, type FacadeTier } from "../../client/core/render/facade.ts";
import { facadeMaps } from "../facade/build.ts";
import { spread } from "../probe-textured.ts";
import { RawShot, type LitCheck, type Readback } from "./shot.ts";

const [W, H] = [480, 270];
const EYE_Y = 1.7;
/** A face on the wall z = 0, looking +z: its class, its least corner's x and y, its width and height, and whether its corners are given right to left. */
const FACES: readonly (readonly [number, number, number, number, number, boolean?])[] = [
  [1, 0, 1, 1.4, 2], [1, 2, 0, 0.9, 2.2, true], [1, 3.5, 0.9, 1.4, 1.4], [1, 6, 0.5, 5, 2.4], [2, 12, 1, 16, 2.6], [3, -8, 0, 7.2, 2.9],
  [4, -8, 3, 7.2, 0.9], [5, -8, 4.2, 6.8, 0.25], [1, 29, 0, 1, 2.2], [0, 31, 0, 1.25, 2.9], [1, 0, 5, 1.4, 2], [1, 2, 5, 0.9, 2.2], [1, 6, 4.5, 5, 2.4],
];
/** Where the world is from the eye's origin, and each view: the eye and the point it looks at, in the wall's metres. */
const ORIGIN = [413.25, 0, 1207.5];
const VIEWS = [{ eye: [5, EYE_Y, 4], at: [5.5, 2.2, 0] }, { eye: [9, EYE_Y, 15], at: [8, 2.5, 0] }];
const PASSES = 4;
/** Levels of 255 the GPU may be from the twin: every point's 3 by 3 mean, and 99 points' pixels in 100. */
const TOLERANCE = { mean: 4, p99: 6 };
const NEAR = 3;
const SMOOTH = 6;

/** The view's matrix, from the eye's place (the eye at the origin of what is drawn), a 60 degree lens. */
function viewProj(eye: readonly number[], at: readonly number[]): { m: number[]; f: number[]; r: number[]; u: number[]; tan: number } {
  const f = [0, 1, 2].map((a) => at[a]! - eye[a]!), fl = Math.hypot(...f);
  for (let a = 0; a < 3; a++) f[a]! /= fl;
  const r = [-f[2]!, 0, f[0]!], rl = Math.hypot(...r);
  for (let a = 0; a < 3; a++) r[a]! /= rl;
  const u = [r[1]! * f[2]! - r[2]! * f[1]!, r[2]! * f[0]! - r[0]! * f[2]!, r[0]! * f[1]! - r[1]! * f[0]!];
  const tan = Math.tan(Math.PI / 6), near = 0.1, far = 500, aspect = W / H;
  const sx = 1 / (tan * aspect), sy = 1 / tan, a = (far + near) / (near - far), b = (2 * far * near) / (near - far);
  // Column-major: rows of the view are r, u, -f; then the projection.
  const view = [r[0]!, u[0]!, -f[0]!, 0, r[1]!, u[1]!, -f[1]!, 0, r[2]!, u[2]!, -f[2]!, 0, 0, 0, 0, 1];
  const proj = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, a, -1, 0, 0, b, 0];
  const m = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) m[c * 4 + row]! += proj[k * 4 + row]! * view[c * 4 + k]!;
  return { m, f, r, u, tan };
}

/** The faces as triangles: where each vertex is from the eye, its corner of its face, its own frame and its instance's place, its class. */
function triangles(eye: readonly number[]): Float32Array {
  const out: number[] = [];
  FACES.forEach(([cls, x, y, w, h, reversed], i) => {
    const origin = [x + w / 2, y + h / 2, -0.2 - i * 0.01];
    const corners = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    for (const [cu, cv] of corners) {
      const p = [x + cu! * w, y + cv! * h, 0];
      const face = [reversed ? 1 - cu! : cu!, cv!];
      out.push(p[0]! - eye[0]!, p[1]! - eye[1]!, p[2]! - eye[2]!, ...face, p[0]! - origin[0]!, p[1]! - origin[1]!, p[2]! - origin[2]!, Math.round((origin[0]! + ORIGIN[0]!) * 4), Math.round((origin[2]! + ORIGIN[2]!) * 4), cls);
    }
  });
  return Float32Array.from(out);
}

const VERTEX = `#version 300 es
in vec3 aRel, aOwn;
in vec2 aFace, aPlace;
in float aClass;
uniform mat4 uViewProj;
out vec3 vRel, vOwn;
out vec2 vFace;
flat out vec2 vPlace;
flat out int vClass;
void main() {
  vRel = aRel;
  vOwn = aOwn;
  vFace = aFace;
  vPlace = aPlace;
  vClass = int(aClass + 0.5);
  gl_Position = uViewProj * vec4(aRel, 1.0);
}`;

const fragment = (rooms: boolean): string => `#version 300 es
${rooms ? "#define FACADE_ROOMS\n" : ""}precision highp float;
precision highp int;
in vec3 vRel, vOwn;
in vec2 vFace;
flat in vec2 vPlace;
flat in int vClass;
uniform float uPass, uEyeY;
out vec4 o;
${FACADE_GLSL.replaceAll("FACADE_NORMAL", "rg")}void main() {
  vec3 dx = dFdx(vRel), dy = dFdy(vRel);
  vec3 geometric = normalize(cross(dx, dy));
  vec3 albedo = vec3(0.5), orm = vec3(1.0), n = geometric, room;
  vec4 far;
  int k = facade(albedo, orm, n, room, far, vClass, vFace, dFdx(vFace), dFdy(vFace), vOwn, dFdx(vOwn), dFdy(vOwn), vPlace, vRel, dx, dy, geometric, vRel.y + uEyeY, vRel.y + uEyeY);
  vec3 c = uPass < 0.5 ? sqrt(albedo) : uPass < 1.5 ? sqrt(room) : uPass < 2.5 ? n * 0.5 + 0.5 : vec3(orm.r, orm.g, far.a);
  o = vec4(k == 0 ? vec3(1.0, 0.0, 1.0) : c, 1.0);
}`;

/** What the twin drew of a shot: each pixel's colour as the pass writes it, and the face under it (-1 none). */
interface Picture { key: string; color: Uint8Array; face: Int16Array }
const pictures: Picture[] = [];

/** The twin's picture of a view on a tier, every pass. */
function twin(view: (typeof VIEWS)[number], tier: FacadeTier, sampleAt: FacadeSample): { colors: Uint8Array[]; face: Int16Array } {
  const { f, r, u, tan } = viewProj(view.eye, view.at);
  const colors = Array.from({ length: PASSES }, () => new Uint8Array(W * H * 4));
  const face = new Int16Array(W * H).fill(-1);
  const o = facadeOut();
  // Where the ray through a pixel's middle meets the wall.
  const meet = (px: number, py: number): number[] | null => {
    const sx = ((px + 0.5) / W * 2 - 1) * tan * (W / H), sy = (1 - (py + 0.5) / H * 2) * tan;
    const d = [0, 1, 2].map((a) => f[a]! + r[a]! * sx + u[a]! * sy);
    if (d[2]! >= 0) return null;
    const t = -view.eye[2]! / d[2]!;
    return [0, 1, 2].map((a) => view.eye[a]! + d[a]! * t);
  };
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const p = meet(px, py);
    if (!p) continue;
    const i = FACES.findIndex(([, x, y, w, h]) => p[0]! >= x && p[0]! <= x + w && p[1]! >= y && p[1]! <= y + h);
    if (i < 0) continue;
    face[py * W + px] = i;
    const [cls, x, y, w, h] = FACES[i]!;
    const kind = facadeKind(cls, w, h, 0);
    const at = py * W + px;
    if (kind === KIND.none) {
      for (const c of colors) c.set([255, 0, 255, 255], at * 4);
      continue;
    }
    const a = meet(px + 1, py)!, b = meet(px, py + 1)!;
    const rel = [0, 1, 2].map((k) => p[k]! - view.eye[k]!), dist = Math.hypot(...rel);
    const footprint = Math.max(Math.hypot(a[0]! - p[0]!, a[1]! - p[1]!), Math.hypot(b[0]! - p[0]!, b[1]! - p[1]!));
    const origin = [x + w / 2, y + h / 2, -0.2 - i * 0.01];
    facadeSurface(o, kind, p[0]! - x, p[1]! - y, w, h, [0, 0, 1], rel.map((q) => -q / dist), [x - origin[0]!, y - origin[1]!, -origin[2]!], [1, 0, 0], Math.round((origin[0]! + ORIGIN[0]!) * 4), Math.round((origin[2]! + ORIGIN[2]!) * 4), p[1]!, p[1]!, footprint, dist, tier, sampleAt);
    const outs = [o.albedo.map(Math.sqrt), o.room.map(Math.sqrt), o.normal.map((q) => q * 0.5 + 0.5), [o.orm[0]!, o.orm[1]!, o.farShare]];
    outs.forEach((v, k) => colors[k]!.set([...[0, 1, 2].map((c) => Math.round(Math.min(1, Math.max(0, v[c]!)) * 255)), 255], at * 4));
  }
  return { colors, face };
}

export const facadeCheck: LitCheck = {
  name: "facades (facade.ts)",
  shots: () => [],

  raws(): RawShot[] {
    const shots: RawShot[] = [];
    for (const name of ["high", "medium"]) {
      const tier = FACADE_TIERS[name]!;
      const { levels, textures } = facadeMaps(tier);
      const sampleAt: FacadeSample = (t, u, v, lod, out) => sample(textures[t]!, u, v, lod - (textures[t]!.pictures.length - 1), out);
      const maps = levels.map((l, k) => ({ name: ["uFacadeBase", "uFacadeNormal", "uFacadeOrm", "uFacadeRooms"][k]!, size: Math.max(k < 3 ? tier.elements : tier.rooms, 64), channels: (k === 1 ? 2 : 4) as 2 | 4, srgb: k === 0 || k === 3, levels: l }));
      VIEWS.forEach((view, v) => {
        const drawn = twin(view, tier, sampleAt);
        const data = triangles(view.eye);
        for (let pass = 0; pass < PASSES; pass++) {
          const key = `facade-${name}-${v}-${pass}`;
          shots.push(new RawShot(key, W, H, VERTEX, fragment(tier.reflect), [["aRel", 3], ["aFace", 2], ["aOwn", 3], ["aPlace", 2], ["aClass", 1]], data, { uViewProj: viewProj(view.eye, view.at).m, uPass: [pass], uEyeY: [EYE_Y] }, maps));
          pictures.push({ key, color: drawn.colors[pass]!, face: drawn.face });
        }
      });
    }
    return shots;
  },

  judge(back: Readback): { ok: boolean; lines: string[] } {
    const lines = [`every kind of part on high and medium, near and across a street, against facadeSurface at points with one face and no edge of its output within ${NEAR} pixels: 3 by 3 means within ${TOLERANCE.mean}, pixels within ${TOLERANCE.p99} at 99 in 100`];
    let ok = true;
    for (const pic of pictures) {
      const gpu = back.pixels(pic.key, 0);
      if (!gpu) {
        lines.push(`${pic.key}: NO PICTURE`);
        ok = false;
        continue;
      }
      const pixel: number[] = [], mean: number[] = [];
      for (let y = NEAR + 1; y < H - NEAR - 1; y += 2) for (let x = NEAR + 1; x < W - NEAR - 1; x += 2) {
        const i = y * W + x;
        if (pic.face[i]! < 0) continue;
        let flat = true;
        for (let dy = -NEAR; dy <= NEAR && flat; dy++) for (let dx = -NEAR; dx <= NEAR && flat; dx++) {
          const j = i + dy * W + dx;
          if (pic.face[j] !== pic.face[i]) flat = false;
          for (let c = 0; c < 3 && flat; c++) if (Math.abs(pic.color[j * 4 + c]! - pic.color[(j + 1) * 4 + c]!) > SMOOTH || Math.abs(pic.color[j * 4 + c]! - pic.color[(j + W) * 4 + c]!) > SMOOTH) flat = false;
        }
        if (!flat) continue;
        let most = 0, mostMean = 0;
        for (let c = 0; c < 3; c++) {
          most = Math.max(most, Math.abs(gpu[i * 4 + c]! - pic.color[i * 4 + c]!));
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += gpu[(i + dy * W + dx) * 4 + c]! - pic.color[(i + dy * W + dx) * 4 + c]!;
          mostMean = Math.max(mostMean, Math.abs(sum / 9));
        }
        pixel.push(most);
        mean.push(mostMean);
      }
      const [p, m] = [spread(pixel), spread(mean)];
      const good = p.points >= 300 && m.worst <= TOLERANCE.mean && p.p99 <= TOLERANCE.p99;
      ok &&= good;
      lines.push(`${pic.key}: ${p.points} points: pixels mean ${p.mean.toFixed(2)}, 99 in 100 within ${p.p99}, worst ${p.worst}; means worst ${m.worst.toFixed(2)}  ${good ? "ok" : "FAIL"}`);
    }
    return { ok, lines };
  },
};
