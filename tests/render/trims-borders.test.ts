// Trims do not turn on where a chunk's sides fall (client/core/render/trims.ts): the same base laid well inside one
// chunk, across a side, and on the corner four chunks share has the same joints, skirts, eaves and ridges, and its
// pieces give way alike. A corner by a chunk's side is read from the base's cells and one inside from the chunk's own
// walls, so this holds the two readings to one rule.

import { expect, test } from "bun:test";
import { yields } from "../../client/core/render/piece-fit.ts";
import type { PieceLooks } from "../../client/core/render/piece-state.ts";
import { Trims } from "../../client/core/render/trims.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent, type Registry } from "../../shared/content/registry.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { rotsOf } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, CLS_VERTEX, canon, canonical, dirTurn, key0, key1, tupleStep } from "../../shared/world/lattice/module.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { fortKeys } from "../../tools/pieces/village.ts";

const DIMS = { chunksX: 4, chunksZ: 4 };
const TEAM = 7;
const MESHES = ["wood", "stone", "metal"].flatMap((tier) => ["joint_sq", "joint_r15", "joint_r21", "skirt", "eave", "ridge", "hip", "saddle"].map((name) => `core:${name}_${tier}`));
const WALLS = ["wall", "wall", "wall", "doorframe", "windowframe", "half_wall", "quarter_wall", "large_wall", "gateway", "double_doorway", "sloped_wall_left", "sloped_wall_right", "railing", "beam", "fence_foundation"];
const SQUARES = ["foundation", "foundation", "foundation", "ceiling", "ceiling", "trapdoor_frame", "roof", "roof", "roof_hip", "roof_valley"];
const TRIANGLES = ["triangle_foundation", "triangle_ceiling", "triangle_roof", "triangle_roof_low"];

let made: Registry | null = null;
function registry(): Registry {
  if (made) return made;
  const { registry, errors } = compileContent(CORE_CONTENT);
  if (!registry) throw new Error(errors.join("\n"));
  return (made = registry);
}

/** A piece to set down: its kind and its key. */
interface Set {
  kind: number;
  k0: number;
  k1: number;
}

const m = new Int32Array(12);

/** A base of `n` pieces set at random about its own corner: walls of every shape, slabs, roofs, triangles and pillars, of three tiers. */
function scatter(reg: Registry, rng: Rng, n: number): Set[] {
  const out: Set[] = [];
  for (let i = 0; i < n; i++) {
    const tier = ["wood", "wood", "stone", "metal"][rng.int(4)]!;
    const roll = rng.float();
    const [form, cls] = roll < 0.45 ? [WALLS[rng.int(WALLS.length)]!, CLS_EDGE] : roll < 0.8 ? [SQUARES[rng.int(SQUARES.length)]!, CLS_SQUARE] : roll < 0.92 ? [TRIANGLES[rng.int(TRIANGLES.length)]!, CLS_TRIANGLE] : [rng.float() < 0.5 ? "pillar" : "thin_pillar", CLS_VERTEX];
    const kind = reg.index.get(`core:${form}_${tier}`)!;
    m.fill(0);
    tupleStep(m, 0, 0, 2 * (rng.int(5) - 2), m, 0);
    tupleStep(m, 0, 3, 2 * (rng.int(5) - 2), m, 0);
    if (rng.float() < 0.15) tupleStep(m, 0, 1 + rng.int(2), 2, m, 0);
    const d = rng.float() < 0.8 ? 3 * rng.int(4) : rng.int(12);
    const slab = form.includes("foundation") ? 0 : 4 * (1 + rng.int(2));
    const lvl = cls === CLS_EDGE || cls === CLS_VERTEX ? (rng.float() < 0.85 ? 4 * rng.int(3) : rng.int(9)) : rng.float() < 0.9 ? slab : 1 + rng.int(8);
    canonical(cls, m, 0, dirTurn(d, 0), m, 4);
    out.push({ kind, k0: key0(cls, m[4]!, m[5]!, m[6]!), k1: key1(m[7]!, lvl, canon.dir, reg.forms.layer[kind]!, rng.int(rotsOf(reg.forms, kind)), 0) });
  }
  return out;
}

/** The base's trims and what each piece yields, laid whole with its corner at (x, z) and turned `yaw`: every number from the base's own corner. */
function laid(reg: Registry, sets: readonly Set[], x: number, z: number, yaw: number): { trims: string[]; yields: string[] } {
  const structs = new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const f = structs.frames.make(Math.round(x * STRUCT_UNITS), 0, Math.round(z * STRUCT_UNITS), yaw, TEAM);
  const keyOf = new Map<number, string>();
  for (const s of sets) {
    const ref = structs.place(s.kind, f.gid, s.k0, s.k1, TEAM, 100);
    if (ref >= 0) keyOf.set(ref, `${s.k0}:${s.k1}`);
  }
  const looks = { flag: new Uint32Array(MESHES.length), yields: Uint8Array.from(reg.defs, (_, k) => (reg.forms.def[k] && yields(reg.forms.def[k]!) ? 1 : 0)) };
  const trims = new Trims(reg, (id) => MESHES.indexOf(id), looks as unknown as PieceLooks);
  const out = { trims: [] as string[], yields: [] as string[] };
  const [ox, oz] = [f.ox / STRUCT_UNITS, f.oz / STRUCT_UNITS];
  for (const chunk of structs.held) {
    const t = structs.chunks[chunk]!;
    const got = trims.lay(structs, chunk, t, chunkCx(DIMS, chunk) * CHUNK_SIZE, chunkCz(DIMS, chunk) * CHUNK_SIZE);
    if (!got) continue;
    for (let k = 0; k < got.count; k++) out.trims.push([MESHES[got.mesh[k]!], (got.x[k]! - ox).toFixed(2), got.y[k]!.toFixed(2), (got.z[k]! - oz).toFixed(2), got.yaw[k], got.tw[k], got.cut[k], got.ends[k], keyOf.get(chunk * 65536 + got.owner[k]!)].join(" "));
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && got.yields[s] !== 0) out.yields.push(`${keyOf.get(chunk * 65536 + s)} ${got.yields[s]}`);
  }
  out.trims.sort();
  out.yields.sort();
  return out;
}

/** Where a base is laid again: across one side, across the other, and on the corner four chunks share, a little off each way. */
const OFFSETS: readonly (readonly [number, number])[] = [[64, 96], [96, 64.4], [64, 64], [63.2, 64.9], [66.5, 61], [58.5, 67]];

test("a base has the same trims and yields wherever the chunks' sides fall across it", () => {
  const reg = registry();
  let trims = 0, yielding = 0, hips = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const rng = new Rng(seed * 104729);
    const sets = scatter(reg, rng, 60 + rng.int(200));
    const yaw = seed % 3 === 0 ? 0 : rng.int(65536);
    const want = laid(reg, sets, 96, 96, yaw);
    trims += want.trims.length;
    yielding += want.yields.length;
    hips += want.trims.filter((t) => t.startsWith("core:hip") || t.startsWith("core:saddle")).length;
    for (const [x, z] of OFFSETS) expect(laid(reg, sets, x, z, yaw), `seed ${seed}, base at ${x}, ${z}`).toEqual(want);
  }
  expect(trims).toBeGreaterThan(3000);
  expect(yielding).toBeGreaterThan(1500);
  // Hips and saddles among them, from the triangle roofs that fall so.
  expect(hips).toBeGreaterThan(20);
});

test("the metal fort has the same trims and yields across a chunk's side as inside one", () => {
  const reg = registry();
  const sets = fortKeys("metal").flatMap(({ name, k0, k1 }): Set[] => {
    const kind = reg.index.get(`core:${name === "corner_pillar" ? "pillar" : name}_metal`);
    return kind === undefined ? [] : [{ kind, k0, k1 }];
  });
  for (const yaw of [0, 3095]) {
    const want = laid(reg, sets, 96, 96, yaw);
    expect(want.trims.length).toBeGreaterThan(100);
    // The gatehouse stands three sides south of the base's corner: the offsets put a chunk's side through it and through the keep.
    for (const [x, z] of [[64, 96], [96, 70], [61, 73], [64, 64], [58, 61.5]] as const) expect(laid(reg, sets, x, z, yaw), `base at ${x}, ${z}, yaw ${yaw}`).toEqual(want);
  }
});
