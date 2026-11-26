// People's shading on a GPU, a check of tools/probe-lit.ts. First the terms alone, drawn once each and held to their
// twins in surface.ts within a level of 255: a normal through bone rows stretched more along one axis than another
// (`normalUnder`), one light's wrap of skin's scattered light (`wrapped`), and how much of skin's own light a pixel keeps
// (`skinNear`). Then whole frames: the scene fixture's tube on medium at noon, drawn as skin (content/street-finishes.ts
// SKIN), as an eye (EYE) and as neither, one of each pair with its bones stretched as a look stretches a survivor's,
// held to the rasterizer at points on one body with no edge near, as the layers check holds them.

import { tierOf } from "../../client/core/assets/tiers.ts";
import { BONE_FLOATS, type FramePacket } from "../../client/core/render/packet.ts";
import { NORMAL_UNDER, SKIN_GLSL, SKIN_WRAP, normalUnder, skinNear } from "../../client/core/render/surface.ts";
import { EYE, SKIN } from "../../content/street-finishes.ts";
import { INSTANCE_BYTES } from "../../shared/pack/pack.ts";
import { sceneSet, sceneWorld } from "../../tests/fixtures/sceneworld.ts";
import { TUBE, TUBE_RIG } from "../../tests/fixtures/textured.ts";
import { spread } from "../probe-textured.ts";
import { PICK_ENTITY, Rasterizer } from "../snap/raster.ts";
import { RawShot, Shot, type LitCheck, type Readback } from "./shot.ts";

const num = (v: number): string => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const vec = (v: readonly number[]): string => `vec${v.length}(${v.map(num).join(",")})`;

// Bone rows: a turn, then a stretch of each of its columns, and a blend of two such.
const turn = (a: number, b: number): number[] => {
  const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
  return [ca * cb, -sa, ca * sb, 0.3, sa * cb, ca, sa * sb, -1.2, -sb, 0, cb, 2];
};
const stretched = (m: number[], s: readonly number[]): number[] => m.map((v, i) => ((i & 3) < 3 ? v * s[i & 3]! : v));
const ROWS = [
  turn(0, 0), stretched(turn(0.4, -0.7), [1.3, 0.8, 1.05]), stretched(turn(2.1, 0.3), [0.7, 1.25, 1.4]),
  stretched(turn(-1, 1.2), [1.6, 1, 0.75]).map((v, i) => v * 0.6 + stretched(turn(-0.6, 1.5), [1.1, 1.4, 0.9])[i]! * 0.4),
];
const NORMALS = [[0, 0, 1], [0.6, 0.8, 0], [-0.48, 0.6, 0.64], [0.267, -0.534, 0.802]];
const normals = ROWS.flatMap((m) => NORMALS.map((n) => ({ m, n })));
// Wraps: a light's way, its colour, a normal and a share of skin.
const wraps = [-0.9, -0.35, -0.1, 0, 0.12, 0.5, 0.97].flatMap((y) => [0, 0.4, 1].map((share) => ({ l: [Math.sqrt(1 - y * y), y, 0], colour: [0.9, 0.7, 0.5], share })));
// Pixel widths in metres on medium's threshold.
const nears = [0.001, 0.008, 0.0125, 0.015, 0.0175, 0.02, 0.023, 0.03];
const RAW = "skin-terms";

const [W, H] = [480, 270];
const NEAR = 3;
const SMOOTH = 3;
const TOLERANCE = { pixelP95: 4, meanWorst: 4 };
const LEAST = 200;
/** Each frame shot: the label its tube draws take, and which of its two tubes has its bones stretched. */
const FRAMES = [
  { key: "skin", label: SKIN },
  { key: "eye", label: EYE },
  { key: "stretch", label: 0 },
] as const;
const STRETCH = [1.45, 0.85, 0.7];

const made = new Map<string, { frame: number; color: Uint8ClampedArray; pickKind: Uint8Array; pickId: Float64Array; pickDraw: Int16Array }>();

/** Stretches every bone of the tube whose entity is `id` along its own axes, as a look does (characters.ts writeBones). */
function stretch(p: FramePacket, id: number): void {
  for (let inst = 0; inst < p.transientCount; inst++) {
    if (p.transientIds[inst] !== id) continue;
    const first = new DataView(p.transient.buffer, p.transient.byteOffset).getUint16(inst * INSTANCE_BYTES + 12, true);
    for (let b = 0; b < TUBE_RIG.names!.length; b++) {
      const o = (first + b) * BONE_FLOATS;
      for (let i = 0; i < BONE_FLOATS; i++) if ((i & 3) < 3) p.bones[o + i]! *= STRETCH[i & 3]!;
    }
  }
}

function frames(key: string, label: number): Shot {
  const set = sceneSet(64);
  const w = sceneWorld({}, tierOf("medium"), set);
  w.scene.viewHeight = H;
  w.scene.plainSky = true;
  w.cam.aspect = W / H;
  // Near enough that skin keeps nearly all of its own light, and a little further, where it keeps part.
  const near = w.place(TUBE, 31.6, 21.9, { colors: [8, 7, 14, 6], yaw: Math.PI / 2 + 0.5 });
  w.place(TUBE, 32.6, 23.6, { colors: [8, 7, 14, 6], yaw: Math.PI / 2 - 0.4 });
  const raster = new Rasterizer(W, H, w.pack, w.hf, w.manifest);
  const shot = new Shot(`skin-${key}`, W, H, w.hf, set.files[0]!.bytes);
  shot.manifest = set.manifest;
  for (let f = 0; f < 40; f++) {
    const p = w.frame(100, false);
    for (let d = 0; d < p.drawCount; d++) if (w.manifest.meshes[p.drawMesh[d]!]?.id === TUBE) p.drawStreetMaterial[d] = label;
    stretch(p, w.remote.id[near]!);
    raster.render(p);
    shot.add(p, f === 39);
    if (f === 39) made.set(key, { frame: f, color: raster.color.slice(), pickKind: raster.pickKind.slice(), pickId: raster.pickId.slice(), pickDraw: raster.pickDraw.slice() });
  }
  return shot;
}

/** The worst and 95th of 100 differences at points on one body with no edge near, and how many points. */
function judged(gpu: Uint8Array, m: NonNullable<ReturnType<typeof made.get>>): { points: number; p95: number; worst: number; mean: number } {
  const { color, pickKind, pickId, pickDraw } = m;
  const one = (i: number): boolean => {
    if (pickKind[i] !== PICK_ENTITY) return false;
    for (let dy = -NEAR; dy <= NEAR; dy++) {
      for (let dx = -NEAR; dx <= NEAR; dx++) {
        const j = i + dy * W + dx;
        if (pickId[j] !== pickId[i] || pickDraw[j] !== pickDraw[i]) return false;
        for (let c = 0; c < 3; c++) if (Math.abs(color[j * 4 + c]! - color[(j + 1) * 4 + c]!) > SMOOTH || Math.abs(color[j * 4 + c]! - color[(j + W) * 4 + c]!) > SMOOTH) return false;
      }
    }
    return true;
  };
  const pixel: number[] = [];
  const mean: number[] = [];
  for (let y = NEAR + 2; y < H - NEAR - 2; y++) {
    for (let x = NEAR + 2; x < W - NEAR - 2; x++) {
      const i = y * W + x;
      if (!one(i)) continue;
      let most = 0, mostMean = 0;
      for (let c = 0; c < 3; c++) {
        most = Math.max(most, Math.abs(gpu[i * 4 + c]! - color[i * 4 + c]!));
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += gpu[(i + dy * W + dx) * 4 + c]! - color[(i + dy * W + dx) * 4 + c]!;
        mostMean = Math.max(mostMean, Math.abs(sum / 25));
      }
      pixel.push(most);
      mean.push(mostMean);
    }
  }
  const [p, mm] = [spread(pixel), spread(mean)];
  return { points: p.points, p95: p.p95, worst: p.worst, mean: mm.worst };
}

export const skinCheck: LitCheck = {
  name: "people's shading",

  shots: () => FRAMES.map(({ key, label }) => frames(key, label)),

  raws() {
    const at = (k: number, start: number): string => `k == ${k + start}`;
    const fragment = `#version 300 es
precision highp float;
precision highp int;
vec2 keyShade(float shade) { return vec2(shade, 1.0); }
const vec4 fSun = vec4(0.0), fSunColor = vec4(0.0), fMoon = vec4(0.0), fMoonColor = vec4(0.0);
${NORMAL_UNDER}${SKIN_GLSL}out vec4 color;
void main() {
  int k = int(gl_FragCoord.x);
  vec3 c = vec3(0.0);
  ${normals.map(({ m, n }, i) => `if (${at(i, 0)}) c = 0.5 + 0.5 * normalize(normalUnder(mat3x4(${vec(m.slice(0, 4))}, ${vec(m.slice(4, 8))}, ${vec(m.slice(8, 12))}), ${vec(n)}));`).join("\n  ")}
  ${wraps.map(({ l, colour, share }, i) => `if (${at(i, normals.length)}) c = 0.5 + wrapped(${vec(l)}, ${vec(colour)}, vec3(0.0, 1.0, 0.0), ${num(share)} * ${vec([...SKIN_WRAP])});`).join("\n  ")}
  ${nears.map((pixel, i) => `if (${at(i, normals.length + wraps.length)}) c = vec3(skinNear(${num(pixel)}, ${num(tierOf("medium").threshold)}));`).join("\n  ")}
  color = vec4(c, 1.0);
}`;
    const vertex = `#version 300 es
in vec2 point;
void main() { gl_Position = vec4(point, 0.0, 1.0); }`;
    return [new RawShot(RAW, normals.length + wraps.length + nears.length, 1, vertex, fragment, [["point", 2]], Float32Array.of(-1, -1, 3, -1, -1, 3), {}, [])];
  },

  judge(back: Readback) {
    const lines: string[] = [];
    let ok = true;
    const raw = back.pixels(RAW, 0);
    if (!raw) return { ok: false, lines: ["NO PICTURE of the terms"] };
    let peak = 0;
    const check = (k: number, want: readonly number[]): void => {
      for (let c = 0; c < 3; c++) peak = Math.max(peak, Math.abs(raw[k * 4 + c]! - Math.round(255 * Math.min(1, Math.max(0, want[c]!)))));
    };
    const out = [0, 0, 0];
    normals.forEach(({ m, n }, k) => {
      normalUnder(out, m, n[0]!, n[1]!, n[2]!);
      const l = Math.hypot(out[0]!, out[1]!, out[2]!);
      check(k, out.map((v) => 0.5 + (0.5 * v) / l));
    });
    wraps.forEach(({ l, colour, share }, k) => {
      const nl = l[1]!;
      check(normals.length + k, [0, 1, 2].map((c) => {
        const w = share * SKIN_WRAP[c]!;
        return 0.5 + colour[c]! * (Math.min(Math.max((nl + w) / (1 + w), 0), 1) - Math.max(nl, 0));
      }));
    });
    nears.forEach((pixel, k) => check(normals.length + wraps.length + k, [0, 1, 2].map(() => skinNear(pixel, tierOf("medium").threshold))));
    ok &&= peak <= 1;
    lines.push(`${normals.length} normals through stretched bone rows, ${wraps.length} wraps of skin's light, ${nears.length} fades: maximum channel difference ${peak}/255 (limit 1)  ${peak <= 1 ? "ok" : "FAIL"}`);
    for (const { key } of FRAMES) {
      const m = made.get(key)!;
      const gpu = back.pixels(`skin-${key}`, m.frame);
      if (!gpu) {
        ok = false;
        lines.push(`${key}: NO PICTURE`);
        continue;
      }
      const j = judged(gpu, m);
      // A term that changed nothing would pass unseen: so many pixels must differ from the tubes drawn as neither.
      const plain = made.get("stretch")!.color;
      let changed = 0;
      for (let i = 0; key !== "stretch" && i < W * H; i++) if ([0, 1, 2].some((c) => Math.abs(m.color[i * 4 + c]! - plain[i * 4 + c]!) >= 3)) changed++;
      const good = j.points >= LEAST && j.p95 <= TOLERANCE.pixelP95 && j.mean <= TOLERANCE.meanWorst && (key === "stretch" || changed >= LEAST);
      ok &&= good;
      lines.push(`tubes drawn as ${key}, one stretched, against the rasterizer: ${j.points} points; pixels 95 in 100 within ${j.p95}, worst ${j.worst}; 5 by 5 means worst ${j.mean.toFixed(2)}${key === "stretch" ? "" : `; ${changed} pixels changed by the term`}  ${good ? "ok" : "FAIL"}`);
    }
    return { ok, lines };
  },
};
