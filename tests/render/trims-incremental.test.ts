// Trims kept between layings (client/core/render/trims.ts): a chunk brought up to date by the pieces that changed has the
// trims and the yields a whole laying gives, in the same order, over random edits to bases straight and turned, across
// chunk borders, with walls of every shape the forms plan.

import { expect, test } from "bun:test";
import { yields } from "../../client/core/render/piece-fit.ts";
import type { PieceLooks } from "../../client/core/render/piece-state.ts";
import { Trims } from "../../client/core/render/trims.ts";
import { cityMaterial } from "../../content/breaks/materials.ts";
import { PLANNED_FORMS, formBoxes } from "../../content/building/forms.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Def, ShapeBox } from "../../shared/content/defs.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import type { HullDef } from "../../shared/world/convex.ts";
import { formHalf, type FormDef } from "../../shared/world/lattice/forms.ts";
import type { Frame } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX, M_MOST, canon, canonical, dirTurn, key0, key1, tupleStep, tupleWithin } from "../../shared/world/lattice/module.ts";
import { StructureStore } from "../../shared/world/structures.ts";

const DIMS = { chunksX: 4, chunksZ: 4 };
const TEAM = 7;
const PLANNED = ["half_wall", "quarter_wall", "large_wall", "gateway", "double_doorway", "sloped_wall_left", "triangle_foundation", "triangle_ceiling", "quarter_foundation", "thin_pillar"] as const;
const TIERS = ["wood", "stone", "metal", "thatch"] as const;

let made: Registry | null = null;

/** A form's collider: boxes for a rectangle, and for any other outline one convex part through its thickness. */
function collider(form: FormDef): { boxes: ShapeBox[]; hulls: HullDef[] } {
  if (form.outline.length === 4) return { boxes: formBoxes(form), hulls: [] };
  const t = form.thick / 2;
  // A triangle's third corner is told along its second axis, 60 degrees round.
  if (form.cls === "triangle") return { boxes: [], hulls: [{ sixty: true, corners: [[0, -t, 0], [0, t, 0], [3, -t, 0], [3, t, 0], [0, -t, 3], [0, t, 3]] }] };
  return { boxes: [], hulls: [{ corners: form.outline.flatMap(([u, v]): [number, number, number][] => [[u - form.at[0], v - form.at[1], -t], [u - form.at[0], v - form.at[1], t]]) }] };
}

/** The core content with the planned forms as pieces of each tier, `test:<form>_<tier>`, and a wall and a ceiling of a material that is no tier's. */
function registry(): Registry {
  if (made) return made;
  const piece = (id: string, form: FormDef, material: string): Def[] => [
    { type: "shape", id: `test:shape_${id}`, role: "thing", ...collider(form), form },
    { type: "structure", class: "piece", id: `test:${id}`, mesh: "shape", shape: `test:shape_${id}`, half: formHalf(form), color: 5, hp: 100, material },
  ];
  const defs = PLANNED.flatMap((name) => TIERS.flatMap((tier) => piece(`${name}_${tier}`, PLANNED_FORMS[name], `core:mat_${tier}`)));
  defs.push(...piece("bare_wall", PLANNED_FORMS.half_wall, cityMaterial("concrete")), ...piece("bare_ceiling", PLANNED_FORMS.triangle_ceiling, cityMaterial("concrete")));
  const { registry, errors } = compileContent([...CORE_CONTENT, ...defs]);
  if (!registry) throw new Error(errors.join("\n"));
  return (made = registry);
}

/** Trims of a registry whose wood has every trim mesh, stone no narrow joint, metal no skirt, and thatch none. */
function trimsOf(reg: Registry): Trims {
  const meshes = ["core:joint_sq_wood", "core:joint_r15_wood", "core:joint_r21_wood", "core:skirt_wood", "core:joint_sq_stone", "core:joint_r21_stone", "core:skirt_stone", "core:joint_sq_metal", "core:joint_r15_metal", "core:joint_r21_metal"];
  const looks = { flag: new Uint32Array(meshes.length), yields: Uint8Array.from(reg.defs, (_, k) => (reg.forms.def[k] && yields(reg.forms.def[k]!) ? 1 : 0)) };
  return new Trims(reg, (id) => meshes.indexOf(id), looks as unknown as PieceLooks);
}

/** A chunk's layout as plain numbers: each trim in order, every slot's yield, and the chunks it turns on. */
function laid(trims: Trims, structs: StructureStore, chunk: number): unknown {
  const t = structs.chunks[chunk];
  if (!t) return null;
  const out = trims.lay(structs, chunk, t, chunkCx(DIMS, chunk) * CHUNK_SIZE, chunkCz(DIMS, chunk) * CHUNK_SIZE);
  if (!out) return null;
  const rows: number[][] = [];
  for (let i = 0; i < out.count; i++) rows.push([out.mesh[i]!, out.owner[i]!, out.x[i]!, out.y[i]!, out.z[i]!, out.yaw[i]!, out.tw[i]!, out.cut[i]!]);
  return { rows, yields: Array.from(out.yields.subarray(0, t.high)), borders: out.borders };
}

const m = new Int32Array(12);

interface Fuzz {
  structs: StructureStore;
  reg: Registry;
  rng: Rng;
  bases: { x: number; z: number; yaw: number; f: Frame }[];
  refs: number[];
}

/** Sets one random piece down in a random base, or takes one up. */
function edit(z: Fuzz): void {
  const { structs, reg, rng } = z;
  if (z.refs.length > 0 && rng.float() < 0.42) {
    const at = rng.int(z.refs.length);
    structs.remove(z.refs[at]!);
    z.refs[at] = z.refs[z.refs.length - 1]!;
    z.refs.pop();
    return;
  }
  const b = z.bases[rng.int(z.bases.length)]!;
  // A base whose last piece went is made again, as a new one.
  if (!structs.frames.get(b.f.gid)) b.f = structs.frames.make(Math.round(b.x * STRUCT_UNITS), 0, Math.round(b.z * STRUCT_UNITS), b.yaw, TEAM);
  const tier = TIERS[rng.int(TIERS.length)]!;
  const roll = rng.float();
  const [id, cls] =
    roll < 0.3 ? [`core:${["wall", "wall", "doorframe", "windowframe"][rng.int(tier === "thatch" ? 3 : 4)]}_${tier}`, CLS_EDGE]
    : roll < 0.42 ? [`test:${["half_wall", "quarter_wall", "large_wall", "gateway", "double_doorway", "sloped_wall_left"][rng.int(6)]}_${tier}`, CLS_EDGE]
    : roll < 0.6 ? [`core:foundation_${tier}`, CLS_SQUARE]
    : roll < 0.76 ? [`core:ceiling_${tier}`, CLS_SQUARE]
    : roll < 0.84 ? [`test:${["triangle_foundation", "triangle_ceiling"][rng.int(2)]}_${tier}`, CLS_TRIANGLE]
    : roll < 0.88 ? [`test:quarter_foundation_${tier}`, CLS_SQUARE]
    : roll < 0.94 ? [rng.float() < 0.5 || tier === "thatch" ? `test:thin_pillar_${tier}` : `core:pillar_${tier}`, CLS_VERTEX]
    : roll < 0.98 ? ["test:bare_wall", CLS_EDGE]
    : ["test:bare_ceiling", CLS_TRIANGLE];
  const kind = reg.index.get(id as string)!;
  // A corner of the base's squares, now and then one step off them along a turned way.
  m.fill(0);
  tupleStep(m, 0, 0, 2 * (rng.int(5) - 2), m, 0);
  tupleStep(m, 0, 3, 2 * (rng.int(5) - 2), m, 0);
  if (rng.float() < 0.15) tupleStep(m, 0, 1 + rng.int(2), 2, m, 0);
  const d = rng.float() < 0.8 ? 3 * rng.int(4) : rng.int(12);
  const slabLevel = id.includes("foundation") ? (rng.float() < 0.85 ? 0 : 4) : 4 * (1 + rng.int(2));
  const lvl = cls === CLS_EDGE || cls === CLS_VERTEX ? (rng.float() < 0.8 ? 4 * rng.int(2) : rng.int(9)) : rng.float() < 0.9 ? slabLevel : 1 + rng.int(8);
  canonical(cls, m, 0, dirTurn(d, 0), m, 4);
  if (!tupleWithin(m, 4, M_MOST)) return;
  const ref = structs.place(kind, b.f.gid, key0(cls, m[4]!, m[5]!, m[6]!), key1(m[7]!, lvl, canon.dir, reg.forms.layer[kind]!, rng.int(reg.forms.turns[kind]!), 0), TEAM, 100);
  if (ref >= 0) z.refs.push(ref);
}

test("a chunk laid by its changed pieces has a whole laying's trims and yields", () => {
  const reg = registry();
  let layings = 0, trimsSeen = 0, edits = 0, yielding = 0, wholes = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    const kept = trimsOf(reg), whole = trimsOf(reg);
    whole.incremental = false;
    // Counts the layings the kept one could not bring up to date and laid whole.
    const inner = kept as unknown as { whole: () => void };
    const laysWhole = inner.whole;
    inner.whole = function (this: unknown): void {
      wholes++;
      laysWhole.call(this);
    };
    const rng = new Rng(seed * 7919);
    // One base inside a chunk, a second turned in the same chunk, one whose corners lie on the lines where four chunks meet, and a turned one across a border.
    const bases = [[40, 40, 0], [28, 44, 9000], [61, 61, 0], [62.2, 100, 5000], [100, 62.9, 60000]].map(([x, z, yaw]) => ({ x: x!, z: z!, yaw: yaw!, f: structs.frames.make(Math.round(x! * STRUCT_UNITS), 0, Math.round(z! * STRUCT_UNITS), yaw!, TEAM) }));
    const z: Fuzz = { structs, reg, rng, bases, refs: [] };
    for (let i = 0; i < 300; i++) edit(z);
    for (let round = 0; round < 500; round++) {
      // Mostly a piece or a few; now and then enough that the chunk is laid whole, or every piece of one base.
      const roll = rng.float();
      if (roll < 0.03) {
        const gid = bases[rng.int(bases.length)]!.f.gid;
        for (let i = z.refs.length - 1; i >= 0; i--) {
          if (structs.frameAt(z.refs[i]!) !== gid) continue;
          structs.remove(z.refs[i]!);
          z.refs[i] = z.refs[z.refs.length - 1]!;
          z.refs.pop();
          edits++;
        }
      } else for (let n = roll < 0.06 ? 150 : 1 + rng.int(4); n > 0; n--, edits++) edit(z);
      // A chunk is not laid every time, so its changes and those round it gather.
      for (const chunk of structs.held) {
        if (rng.float() < 0.3) continue;
        const want = laid(whole, structs, chunk), got = laid(kept, structs, chunk);
        expect(got, `seed ${seed}, round ${round}, chunk ${chunk}`).toEqual(want);
        layings++;
        const rows = (want as { rows: number[][]; yields: number[] } | null);
        trimsSeen += rows?.rows.length ?? 0;
        yielding += rows?.yields.filter((v) => v !== 0).length ?? 0;
      }
    }
  }
  expect(edits).toBeGreaterThan(20000);
  expect(layings).toBeGreaterThan(8000);
  // Most layings took in changes; the rest met a base's first or last wall, a wall of no tier, or too many pieces at once.
  expect(wholes).toBeLessThan(layings / 4);
  expect(trimsSeen).toBeGreaterThan(200000);
  expect(yielding).toBeGreaterThan(50000);
});
