// Break sets for review. `bun tools/breaks.ts` draws every sample component in every form, with what leaves drawn apart,
// into artifacts/breaks. `--only wall8` draws one; `--variant 2` picks which of the four cuts.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Chunk } from "../content/breaks/cut.ts";
import { VARIANTS, type Component, type Form } from "../content/breaks/forms.ts";
import type { Corner } from "../content/breaks/geometry.ts";
import { SAMPLES } from "../content/breaks/samples.ts";
import { drawSheet, type Drawn, type Row, type Tile } from "./breaks/sheet.ts";
import { encodePng } from "./snap/png.ts";

const middle = (chunks: readonly Chunk[]): Corner => {
  const all = chunks.flatMap((c) => c.corners);
  return [0, 1, 2].map((a) => all.reduce((s, p) => s + p[a]!, 0) / all.length) as unknown as Corner;
};

/** A form's tile: what stands, and what left drawn apart from it, out toward the eye and spread from the form's middle. */
function tile(c: Component, form: Form): Tile {
  const base = { finish: c.finish, skin: c.skin };
  const things: Drawn[] = [{ ...base, look: form.look }];
  const groups = form.fragments;
  if (groups.length > 0) {
    const all = middle(groups.flat());
    for (const group of groups) {
      const m = middle(group);
      const out = c.apart ?? [0, -0.4, 4];
      things.push({ ...base, look: { boxes: [], chunks: group }, shift: [(m[0] - all[0]) * 0.35 + out[0]!, (m[1] - all[1]) * 0.35 + out[1]!, (m[2] - all[2]) * 0.35 + out[2]!] });
    }
  }
  const parts = form.look.boxes.length + form.look.chunks.length;
  const count = groups.length > 0 ? `${groups.length} leave, ` : "";
  return { title: form.name, note: `${count}${parts} drawn, ${form.walked.boxes.length + form.walked.hulls.length} solid${form.bears ? "" : ", bears nothing"}`, things };
}

export function rowOf(c: Component, variant: number): Row {
  return { title: `${c.name}: ${c.family}, ${c.material}`, tiles: c.forms(variant).map((f) => tile(c, f)), ...(c.eye ? { eye: c.eye } : {}) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const only = value("--only"), variant = Number(value("--variant") ?? 0) % VARIANTS;
  const out = value("--out") ?? "artifacts/breaks";
  mkdirSync(out, { recursive: true });
  const shown = SAMPLES.filter((c) => !only || c.name === only);
  for (const c of shown) {
    const sheet = drawSheet([rowOf(c, variant)]);
    writeFileSync(join(out, `${c.name}-${variant}.png`), encodePng(sheet.width, sheet.height, sheet.rgba));
  }
  if (!only) {
    const all = drawSheet(shown.map((c) => rowOf(c, variant)));
    writeFileSync(join(out, `all-${variant}.png`), encodePng(all.width, all.height, all.rgba));
  }
  console.log(`${shown.length} components drawn to ${out}`);
}
