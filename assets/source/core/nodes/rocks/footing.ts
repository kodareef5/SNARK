// What the stones' footing does on the proving ground, and what one judged by what grows would do (D340, D350): of
// the slots where a stone would grow but for its footing, how many grow nothing under the kind's rule, how many a stone
// standing there really floats over, and how many a rule judged by each variant at its size would leave bare. A stone
// floats where the ground anywhere round its foot, out to its base's reach that way, falls further than its base is
// buried (mesh/<name>.json `footing`, from boxes.py). Not part of the build.
//   bun assets/source/core/nodes/rocks/footing.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CORE_CONTENT } from "../../../../../content/core.ts";
import type { Def, NodeDef } from "../../../../../shared/content/defs.ts";
import { compileContent } from "../../../../../shared/content/registry.ts";
import { PROVING_DIMS, buildProvingHeightfield, provingNodes } from "../../../../../shared/world/proving.ts";
import { SIZE_UNITS, nodeForms, type NodeSpot } from "../../../../../shared/world/nodes.ts";
import { chunkCount } from "../../../../../shared/coords.ts";

const STONES = ["core:rock", "core:metal_rock", "core:rubble"];
const hf = buildProvingHeightfield();
const reg = compileContent([...CORE_CONTENT]).registry!;
// The same content with no footing on the stones: what each slot would grow before its footing is judged.
const free = compileContent(CORE_CONTENT.map((d): Def => (d.type === "node" && STONES.includes(d.id) ? { ...d, footing: undefined } : d))).registry!;
const forms = nodeForms(free);
const [ruled, raw] = [provingNodes(hf, reg), provingNodes(hf, free)];

/** Each stone's footing at its modelled size: how far its base reaches, each of 16 ways round, and how deep it goes. */
const feet = new Map<string, { reach: number; rim: number[]; burial: number }>();
for (const id of STONES) {
  for (const v of (CORE_CONTENT.find((d) => d.id === id) as NodeDef).variants!) {
    const name = v.mesh.slice(5);
    feet.set(v.mesh, JSON.parse(readFileSync(join(import.meta.dir, "mesh", `${name}.json`), "utf8"))[name].footing);
  }
}

/** Whether the stone at `s` stands over air: the ground under any point of its foot's edge lower than its base goes. */
function floats(s: NodeSpot): boolean {
  const f = feet.get(forms.mesh[s.form]!)!;
  const k = forms.size[s.form]! / SIZE_UNITS;
  const yaw = (s.yaw / 65536) * Math.PI * 2;
  for (let i = 0; i < 16; i++) {
    // The rim is in Blender's axes: x, and y toward the game's -z. Turned as a node is turned.
    const a = (i / 16) * Math.PI * 2;
    const [lx, lz] = [Math.cos(a) * f.rim[i]! * k, -Math.sin(a) * f.rim[i]! * k];
    const [x, z] = [Math.cos(yaw) * lx + Math.sin(yaw) * lz + s.x, Math.cos(yaw) * lz - Math.sin(yaw) * lx + s.z];
    if (hf.heightAt(x, z) < s.y - f.burial * k) return true;
  }
  return false;
}

/**
 * The kind's rule as nodes.ts judges it, but with the variant's reach and burial at its size: the ground's samples at the
 * ring of cells its reach falls in, falling no more than the base's slope allows that far out.
 */
function fitsByRing(s: NodeSpot): boolean {
  const f = feet.get(forms.mesh[s.form]!)!;
  const k = forms.size[s.form]! / SIZE_UNITS;
  const ring = Math.ceil((f.reach * k) / hf.cell);
  const slant = Math.floor((ring * 181 + 128) / 256);
  const fall = Math.floor(((ring * hf.cell * f.burial) / f.reach) / hf.stepY);
  const i = Math.round(s.x / hf.cell);
  const j = Math.round(s.z / hf.cell);
  const h = (a: number, b: number): number => hf.heights[Math.min(hf.nz - 1, Math.max(0, b)) * hf.nx + Math.min(hf.nx - 1, Math.max(0, a))]!;
  const low = h(i, j) - fall;
  return [[ring, 0], [-ring, 0], [0, ring], [0, -ring], [slant, slant], [slant, -slant], [-slant, slant], [-slant, -slant]].every(([di, dj]) => h(i + di!, j + dj!) >= low);
}

/**
 * The variant's reach and burial at its size, judged where its foot is: the ground between the samples, at its reach
 * along the axes and the diagonals, no further down than its base is buried.
 */
function fitsAtReach(s: NodeSpot): boolean {
  const f = feet.get(forms.mesh[s.form]!)!;
  const k = forms.size[s.form]! / SIZE_UNITS;
  const r = f.reach * k;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (hf.heightAt(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r) < s.y - f.burial * k) return false;
  }
  return true;
}

const RULES = { "by variant and size, at the ring of cells past its reach": fitsByRing, "by variant and size, at its reach": fitsAtReach };
const count = { stones: 0, kindBare: 0, kindBareFloats: 0, grownFloats: 0 };
const by = Object.fromEntries(Object.keys(RULES).map((k) => [k, { bare: 0, bareFloats: 0, grownFloats: 0, moved: 0 }]));
const a: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
const b: NodeSpot = { kind: 0, form: 0, x: 0, y: 0, z: 0, yaw: 0 };
const ids = new Set(STONES.map((id) => free.index.get(id)!));
for (let chunk = 0; chunk < chunkCount(PROVING_DIMS); chunk++) {
  for (let i = 0; i < raw.perChunk; i++) {
    raw.at(chunk, i, a);
    if (!ids.has(a.kind)) continue;
    ruled.at(chunk, i, b);
    count.stones++;
    const fl = floats(a);
    const kindBare = b.kind === 0;
    if (kindBare) count.kindBare++;
    if (kindBare && fl) count.kindBareFloats++;
    if (!kindBare && fl) count.grownFloats++;
    for (const [name, rule] of Object.entries(RULES)) {
      const c = by[name]!;
      const bare = !rule(a);
      if (bare) c.bare++;
      if (bare && fl) c.bareFloats++;
      if (!bare && fl) c.grownFloats++;
      if (bare !== kindBare) c.moved++;
    }
  }
}
console.log(`proving ground: ${count.stones} slots a stone would grow in but for its footing`);
console.log(`the kind's rule (content now): ${count.kindBare} grow nothing, of which ${count.kindBareFloats} would float; ${count.grownFloats} grown stones float`);
for (const [name, c] of Object.entries(by)) console.log(`${name}: ${c.bare} would grow nothing, of which ${c.bareFloats} would float; ${c.grownFloats} grown stones would float; ${c.moved} slots differ from now`);
