// What check-gpu.ts checks, where no browser's card can be had: every program of every tier compiled and linked by
// Mesa's software renderer (llvmpipe), and each job's layers drawn by it and set against their TypeScript twins, the
// materials' slots holding each recipe in turn. It is GLSL run in 32-bit floats by a real compiler, not a card: it
// says nothing of a card's time or of ANGLE. Needs Linux with Mesa's EGL and python3 (tools/texgen/softgl.py).
//
//   bun tools/texgen/check-soft.ts [--side 256] [--out folder]

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { tierOf } from "../../client/core/assets/tiers.ts";
import { PROGRAMS, withDefines } from "../../client/core/render/programs.ts";
import { TEXGEN_VERTEX, jobFragment, jobPixels, type Job } from "../../client/core/texgen/engine.ts";
import { materialJob } from "../../client/core/texgen/materials.ts";
import { weatherJobs } from "../../client/core/texgen/weather.ts";
import { MATERIAL_RECIPES } from "../../content/texgen/materials.ts";
import { encodePng } from "../snap/png.ts";

const { values } = parseArgs({ options: { side: { type: "string", default: "256" }, out: { type: "string" } } });
const side = Number(values.side), root = resolve(import.meta.dir, "../..");
const programs: { name: string; vertex: string; fragment: string }[] = [], seen = new Set<string>();
for (const tier of ["lowpoly", "medium", "high", "ultra"] as const) for (const format of ["bc", "astc", "rgba"] as const) for (const light of [false, true]) for (const [name, make] of Object.entries(PROGRAMS)) {
  const p = make(tierOf(tier), format, false, light), vertex = withDefines(p.vertex, p.defines), fragment = withDefines(p.fragment, p.defines);
  if (!seen.has(vertex + fragment)) programs.push({ name: `${tier} ${format}${light ? " light" : ""} ${name}`, vertex, fragment });
  seen.add(vertex + fragment);
}
const shaders = programs.length;
// Each job's layers, and the slots' two for every recipe by its version.
const layers: { name: string; job: Job; layer: number; version: number }[] = [];
weatherJobs().forEach((job, j) => {
  for (let l = 0; l < job.layers; l++) layers.push({ name: `job ${j} layer ${l}`, job, layer: l, version: 1 });
});
const slots = materialJob(1);
MATERIAL_RECIPES.forEach((r, k) => layers.push({ name: `${r.name} base`, job: slots, layer: 0, version: k + 1 }, { name: `${r.name} relief`, job: slots, layer: 1, version: k + 1 }));
const draws = layers.map(({ job, layer, version }) => {
  const fragment = jobFragment(job), rows = side / job.bands;
  if (!programs.some((p) => p.name === fragment)) programs.push({ name: fragment, vertex: TEXGEN_VERTEX, fragment });
  return { program: fragment, bands: Array.from({ length: job.bands }, (_, band) => {
    const u = new Float32Array((2 + job.rows) * 4);
    u.set([side, band * rows, rows, job.pad, job.taps[0], job.taps[1], 0, 0]);
    job.fill(layer, band, u, 8, version);
    return { first: band * rows, rows, uniforms: Array.from(u) };
  }) };
});
// Under var/, which is on disk: a machine's /tmp may be memory.
mkdirSync(join(root, "var"), { recursive: true });
const work = mkdtempSync(join(root, "var/check-soft-"));
let failed = 0;
try {
  writeFileSync(join(work, "in.json"), JSON.stringify({ side, programs, layers: draws }));
  const run = Bun.spawnSync(["python3", join(import.meta.dir, "softgl.py"), join(work, "in.json")], { stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`softgl.py: ${run.stderr.toString() || run.stdout.toString()}`);
  const done = JSON.parse(run.stdout.toString()) as { renderer: string; failed: string[]; layers: string[] };
  console.log(`${done.renderer}: ${programs.length - done.failed.length} of ${programs.length} programs compile and link (${shaders} of the tiers', ${programs.length - shaders} of the jobs')`);
  for (const f of done.failed) console.log(`FAILED ${f}`);
  failed = done.failed.length;
  layers.forEach(({ name, job, layer, version }, i) => {
    const card = Uint8Array.from(Buffer.from(done.layers[i]!, "base64")), twin = jobPixels(job, layer, side, job.taps, version);
    let most = 0, over = 0;
    for (let b = 0; b < card.length; b++) {
      const d = Math.abs(card[b]! - twin[b]!);
      most = Math.max(most, d);
      if (d > 2) over++;
    }
    console.log(`${name}: largest difference ${most}, ${((100 * over) / card.length).toFixed(3)}% of bytes over 2`);
    if (over / card.length > 0.001) failed++;
    if (values.out) {
      mkdirSync(values.out, { recursive: true });
      writeFileSync(join(values.out, `${name.replaceAll(" ", "-")}.png`), encodePng(side, side, card.map((v, b) => (b % 4 === 3 ? 255 : v))));
    }
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
