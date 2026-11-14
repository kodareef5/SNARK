// Rows for the pure part of sun shadows: fitting each tier's cascades, and testing every mesh near the camera against
// them for its cascades and levels, under a sun 10 degrees up, which stretches the cascades furthest. The meshes are
// made up: 50 kinds in each of 30 chunks round the camera, the worst the lighting design costs, and then all 81 chunks
// of the near store built up to 30 m. The scene's own rows come when casters are collected.
// `bun tools/bench/shadow.ts` runs these alone.

import { Camera } from "../../client/core/render/camera.ts";
import { Cascades, reach, type ShadowSetup } from "../../client/core/render/shadow.ts";
import { Rng } from "../../shared/rng.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const SETUPS: readonly (readonly [string, ShadowSetup])[] = [
  ["medium", { cascades: 2, size: 2048, distance: 64, everyOther: false }],
  ["high", { cascades: 3, size: 2048, distance: 128, everyOther: false }],
  ["ultra", { cascades: 4, size: 2048, distance: 192, everyOther: false }],
  ["medium on a phone", { cascades: 2, size: 1024, distance: 48, everyOther: true }],
];
const CHUNK = 64;
const KINDS = 50;
const ERRORS = [0, 0.004, 0.012, 0.05, 0.2];
const SUN = (10 * Math.PI) / 180;

function median(xs: number[]): number {
  xs.sort((a, b) => a - b);
  return xs[xs.length >> 1]!;
}

/** Each mesh of the chunks from (x0, z0) to (x1, z1) round the camera: its chunk's camera-relative box and its own radius. */
function store(x0: number, z0: number, x1: number, z1: number): { boxes: Float64Array; radius: Float64Array } {
  const rng = new Rng(1);
  const n = (x1 - x0 + 1) * (z1 - z0 + 1) * KINDS;
  const boxes = new Float64Array(n * 6);
  const radius = new Float64Array(n);
  let r = 0;
  for (let cz = z0; cz <= z1; cz++) {
    for (let cx = x0; cx <= x1; cx++) {
      const top = rng.range(4, 30);
      for (let m = 0; m < KINDS; m++, r++) {
        boxes.set([cx * CHUNK - 32, -2, cz * CHUNK - 32, cx * CHUNK + 32, top, cz * CHUNK + 32], r * 6);
        radius[r] = rng.range(0.2, 4);
      }
    }
  }
  return { boxes, radius };
}

/** Tests every mesh of a store: the entries it makes, the draws each cascade then takes, and the median time. */
function casters(c: Cascades, s: { boxes: Float64Array; radius: Float64Array }, stretch: number): { entries: number; draws: number[]; ms: number } {
  const out = new Uint8Array(8);
  const draws = new Array<number>(c.count).fill(0);
  let entries = 0;
  const times: number[] = [];
  for (let k = 0; k < 30; k++) {
    const t = performance.now();
    entries = 0;
    for (let r = 0; r < s.radius.length; r++) {
      const b = r * 6;
      const mask = c.mask(s.boxes[b]!, s.boxes[b + 1]!, s.boxes[b + 2]!, s.boxes[b + 3]!, s.boxes[b + 4]!, s.boxes[b + 5]!, s.radius[r]!, stretch);
      if (mask === 0) continue;
      const n = c.entries(mask, ERRORS, 0b11111, out);
      entries += n;
      if (k === 0) for (let e = 0; e < n; e++) for (let i = 0; i < c.count; i++) if ((out[e * 2 + 1]! & (1 << i)) !== 0) draws[i]!++;
    }
    times.push(performance.now() - t);
  }
  return { entries, draws, ms: median(times) };
}

export function benchShadow(section: Section, record: Row): void {
  section("Shadows (headless): cascades fitted, and 50 kinds in each of 30 chunks tested for their cascades and levels, sun 10 degrees up");
  const worst = store(-2, -2, 2, 3);
  const full = store(-4, -4, 4, 4);
  const cam = new Camera();
  const [sx, sy, sz] = [Math.cos(SUN) * 0.6, Math.sin(SUN), Math.cos(SUN) * 0.8];
  const stretch = reach(30, sy);
  for (const [name, setup] of SETUPS) {
    const c = new Cascades();
    cam.x = 8000.3;
    cam.y = 41.7;
    cam.z = 7900.6;
    const fits: number[] = [];
    for (let k = 0; k < 40; k++) {
      const t = performance.now();
      for (let f = 0; f < 1000; f++) {
        cam.x += 0.02;
        cam.yaw += 0.003;
        c.fit(cam, sx, sy, sz, setup, f);
      }
      fits.push(performance.now() - t);
    }
    record(`${name}: fit the cascades, a frame, median`, median(fits), "µs", 5);
    cam.yaw = 0.4;
    cam.pitch = -0.1;
    c.fit(cam, sx, sy, sz, setup, 0);
    const w = casters(c, worst, stretch);
    record(`${name}: caster entries`, w.entries, "", 4096);
    w.draws.forEach((d, i) => record(`${name}: draws in cascade ${i}`, d, ""));
    record(`${name}: test and level every mesh, median`, w.ms, "ms", 0.3);
    const f = casters(c, full, stretch);
    record(`${name}: caster entries with all 81 chunks of the near store built up`, f.entries, "");
  }
}

if (import.meta.main) {
  benchShadow(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 3 : 1).padStart(10)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
