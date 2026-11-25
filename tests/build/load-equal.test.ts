// The fast ways a store is filled give what the plain ways give. A save's load sizes its tables from the chunks' heads, and
// is held to rows put one by one as the load used to; the pose, the cells and the direction sums are held to their former
// forms over random keys.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Claims } from "../../server/claims.ts";
import { WorldStore } from "../../server/persist/store.ts";
import { CHUNK_SIZE, STRUCT_UNITS, chunkCx, chunkCz } from "../../shared/coords.ts";
import { BitReader } from "../../shared/net/codec.ts";
import { Rng } from "../../shared/rng.ts";
import { LEVEL_UNITS, QUARTER_YAW } from "../../shared/world/lattice/basis.ts";
import { STOREY_LEVELS } from "../../shared/world/lattice/forms.ts";
import { Frame, poseOf, rotsOf, type LatticePose } from "../../shared/world/lattice/frames.ts";
import { CLS_EDGE, CLS_SQUARE, CLS_TRIANGLE, DIRS, LVL_MOST, M_MOST, SIDE, dirTurn, key0, key1, keyAnchor, keyCls, keyDir, keyFlip, keyLayer, keyLvl, keyRot, tupleStep, tupleWithin } from "../../shared/world/lattice/module.ts";
import { Cells, formCells } from "../../shared/world/lattice/occupancy.ts";
import { Found, PUT_FREE, StructureStore } from "../../shared/world/structures.ts";
import { Base, dodecagon, mixedHouse, ring, row, turnedRegistry, turnedWorld } from "../fixtures/turned.ts";

const dir = mkdtempSync(join(tmpdir(), "snark-loadequal-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const Q = 16384;
const U = STRUCT_UNITS;

/** Every column and count of each chunk's table, the frames with their counts, chunks and boxes. */
function tables(s: StructureStore) {
  const chunks = s.held.map((c) => {
    const t = s.chunks[c]!;
    const cols = [t.kind, t.x, t.y, t.z, t.yaw, t.owner, t.hp, t.mod, t.fr, t.k0, t.k1, t.tw].map((a) => (a ? [...a] : null));
    return [c, t.version, t.shape, t.placed, t.high, t.live, t.cap, t.mapped, t.differs, t.changed, t.recentCount, t.recentFloor, cols];
  });
  const frames = [...s.frames.all()].map((f) => [f.gid, f.ox, f.oy, f.oz, f.yaw, f.team, f.live, f.roots, [...f.chunks], [...f.rows], f.minX, f.maxX, f.minZ, f.maxZ, f.loose]);
  return { chunks, frames, count: s.count, next: s.frames.next };
}

/** For each keyed row, each cell it takes and who covers it and the levels over it, and what is free there. */
function cells(s: StructureStore): unknown[] {
  const out: unknown[] = [s.occupied.size, [...s.occupied.deep], s.occupied.triangles];
  const list = new Cells();
  for (const c of s.held) {
    const t = s.chunks[c]!;
    for (let slot = t.mapped; slot < t.high; slot++) {
      if (t.kind[slot] === 0 || !t.fr || t.fr[slot] === 0) continue;
      formCells(s.forms!, t.kind[slot]!, t.k0![slot]!, t.k1![slot]!, list);
      for (let i = 0; i < list.n; i++) {
        const [k0, k1] = [list.k0[i]!, list.k1[i]!];
        const at = s.refAt(t.fr[slot]!, k0, k1);
        const over = [0, 1, 2, 3, 4, 5, 6].map((up) => s.covering(t.fr![slot]!, k0, k1 + up * 1024));
        const free = [1, 2, 4, 8].map((reach) => s.occupied.free(t.fr![slot]!, k0, k1 + 4 * 1024, reach));
        out.push([c * 65536 + slot, at, over, free]);
      }
    }
  }
  return out;
}

/** What the 4 m grid lists over each chunk, in its order. */
function grid(s: StructureStore): number[][] {
  const found = new Found();
  return s.held.map((c) => {
    const [x, z] = [chunkCx(s.dims, c) * CHUNK_SIZE, chunkCz(s.dims, c) * CHUNK_SIZE];
    return [c, ...found.refs.subarray(0, s.query(x, z, x + CHUNK_SIZE, z + CHUNK_SIZE, found))];
  });
}

/** The claims' answers over the map, for these teams. */
function claimed(s: StructureStore, claims: Claims, teams: number[]): unknown[] {
  const out: unknown[] = [claims.entries, claims.spots, teams.map((team) => claims.total(team)), s.held.map((c) => teams.map((team) => claims.has(team, c)))];
  for (let x = 0; x < s.dims.chunksX * CHUNK_SIZE; x += 7) {
    for (let z = 0; z < s.dims.chunksZ * CHUNK_SIZE; z += 7) out.push([claims.near(x, z), teams.map((team) => claims.enemyNear(team, x, z, 50, 10))]);
  }
  return out;
}

test("a save's load equals its rows put one by one, bases at odd yaws", () => {
  const w = turnedWorld(6);
  const { structs, reg } = w;
  const claims = new Claims(structs, reg.role);
  // Bases at odd turns, of every turn class of piece, two across chunk borders, and two teams.
  const bases: Base[] = [];
  const at = (x: number, z: number, yaw: number): Base => {
    const b = new Base(w, x, z, yaw);
    bases.push(b);
    return b;
  };
  mixedHouse(at(64, 64, 4097), 1);
  mixedHouse(at(130, 40, 12345 + Q), 2);
  dodecagon(at(200, 190, 777 + 2 * Q), 1);
  ring(at(40, 200, 3 * Q + 5000), 2);
  row(at(120, 128, 9001), 1, 9);
  const theirs = at(250, 60, Q + 3);
  row(theirs, 2, 7);
  // That one is another team's, as a replicated change of owner gives it.
  const refs = new Found();
  for (let i = 0, n = structs.rowsOf(theirs.f.gid, refs); i < n; i++) {
    const [c, s] = [Math.floor(refs.refs[i]! / 65536), refs.refs[i]! & 0xffff];
    const t = structs.chunks[c]!;
    structs.put(c, s, t.kind[s]!, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, 9, t.hp[s]!, t.version);
  }
  expect(theirs.f.team).toBe(9);
  // A free row of each owner, and a hole or two in the slots.
  const crate = w.kind("core:crate");
  structs.add(crate, 70.25, 1, 66.5, 4242, 7, 3);
  structs.add(crate, 133, 1, 41, 99, 0, reg.maxHp[crate]!);
  const holes = [structs.held[0]!, structs.held[2]!].map((c) => c * 65536 + 1);
  for (const ref of holes) structs.remove(ref);
  // Some harm, kept exactly.
  for (const c of structs.held) {
    const t = structs.chunks[c]!;
    for (let s = 0; s < t.high; s += 5) if (t.kind[s] !== 0) structs.damage(c * 65536 + s, 0.37);
  }
  expect(structs.frames.count).toBeGreaterThanOrEqual(6);
  expect([...structs.held].some((c) => structs.chunks[c]!.tw?.some((tw) => tw !== 0))).toBe(true);

  const db = join(dir, "equal.db");
  const store = new WorldStore(db, reg);
  store.transaction(() => {
    for (const c of structs.held) store.saveChunk(c, structs);
    store.setMeta("tick", 1);
  });
  store.close();

  const fresh = (): [StructureStore, Claims] => {
    const s = new StructureStore(w.dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
    return [s, new Claims(s, reg.role)];
  };
  // The save's own load.
  const [fast, fastClaims] = fresh();
  const loader = new WorldStore(db, reg);
  loader.loadChunks(fast);
  loader.close();
  // One by one, as the load was before: each frame by its gid, then each chunk's rows in slot order, by key or by pose.
  const [plain, plainClaims] = fresh();
  for (const f of [...structs.frames.all()].sort((a, b) => a.gid - b.gid)) plain.frames.make(f.ox, f.oy, f.oz, f.yaw, f.team, f.gid);
  plain.frames.next = structs.frames.next;
  for (const c of [...structs.held].sort((a, b) => a - b)) {
    const t = structs.chunks[c]!;
    for (let s = t.mapped; s < t.high; s++) {
      const kind = t.kind[s]!;
      if (kind === 0) continue;
      const fr = t.fr?.[s] ?? 0;
      if (fr === 0) {
        plain.put(c, s, kind, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, t.owner[s]!, t.hp[s]!, t.version, PUT_FREE);
        continue;
      }
      const pose = plain.keyedPose(c, kind, fr, t.k0![s]!, t.k1![s]!)!;
      plain.put(c, s, kind, pose.x / U, pose.y / U, pose.z / U, pose.yaw, t.owner[s]!, t.hp[s]!, t.version, fr, t.k0![s]!, t.k1![s]!);
    }
    plain.setVersion(c, t.version);
  }

  const teams = [0, 7, 9];
  expect(tables(fast)).toEqual(tables(plain));
  expect(cells(fast)).toEqual(cells(plain));
  expect(grid(fast)).toEqual(grid(plain));
  expect(claimed(fast, fastClaims, teams)).toEqual(claimed(plain, plainClaims, teams));
  // And both hold what was built, piece by piece by key: its rows, frames, cells and claims.
  const rowsOf = (s: StructureStore) => tables(s).chunks.map(([c, , , , high, live, , , , , , , cols]) => [c, high, live, (cols as (number[] | null)[]).filter((_, i) => i !== 7).map((a) => a?.slice(0, high as number) ?? null)]);
  expect(rowsOf(fast)).toEqual(rowsOf(structs));
  const framesOf = (s: StructureStore) => tables(s).frames.map(([gid, ox, oy, oz, yaw, team, live, roots, chunks]) => [gid, ox, oy, oz, yaw, team, live, roots, [...(chunks as number[])].sort((a, b) => a - b)]);
  expect(framesOf(fast)).toEqual(framesOf(structs));
  expect(cells(fast)).toEqual(cells(structs));
  expect(claimed(fast, fastClaims, teams)).toEqual(claimed(structs, claims, teams));
});

// The forms these replaced, kept here as they were.
const oldTurn = (d: number, k: number): number => (((d + k) % 12) + 12) % 12;
const m = new Int32Array(8);
const v = new Int32Array(4);

function oldPoseOf(f: Frame, k0: number, k1: number, kind: number, out: LatticePose): void {
  const forms = turnedRegistry().forms;
  const cls = keyCls(k0);
  const side = forms.size[kind]!;
  const dir = keyDir(k1);
  const own = oldTurn(dir, (-keyRot(k1) * 12) / rotsOf(forms, kind));
  const small = cls === CLS_SQUARE && side !== SIDE;
  let slot = dir;
  keyAnchor(k0, k1, m, 0);
  if (cls === CLS_TRIANGLE) {
    const corner = oldTurn(own, -dir) / 4;
    if (corner !== 0) tupleStep(m, 0, oldTurn(dir, corner === 1 ? 0 : 2), side, m, 0);
    slot = own;
  } else if (cls === CLS_EDGE) tupleStep(m, 0, dir, SIDE / 2, m, 0);
  else if (cls === CLS_SQUARE && !small) {
    tupleStep(m, 0, dir, SIDE / 2, m, 0);
    tupleStep(m, 0, oldTurn(dir, 3), SIDE / 2, m, 0);
  }
  let i = forms.atI[kind]!;
  let j = forms.atJ[kind]!;
  if (keyFlip(k1) === 1) {
    let wide = 1;
    for (const c of forms.def[kind]!.cells ?? []) wide = Math.max(wide, c[0] + 1);
    if (((oldTurn(slot, -own) / 3) & 1) === 1) j = (small ? 1 : 0) - j;
    else i = (cls === CLS_EDGE ? (wide - 1) * SIDE : cls === CLS_TRIANGLE ? side : small ? 1 : 0) - i;
  }
  const b = f.basis;
  v[0] = f.ox + m[0]! * b[0]! + m[1]! * b[2]! + m[2]! * b[4]! + m[3]! * b[6]!;
  v[1] = f.oz + m[0]! * b[1]! + m[1]! * b[3]! + m[2]! * b[5]! + m[3]! * b[7]!;
  const quarters = Math.floor(slot / 3);
  let x = b[(slot - quarters * 3) * 2]!;
  let z = b[(slot - quarters * 3) * 2 + 1]!;
  for (let k = 0; k < quarters; k++) [x, z] = [-z, x];
  v[2] = x;
  v[3] = z;
  out.x = v[0]! + i * v[2]! - j * v[3]!;
  out.z = v[1]! + i * v[3]! + j * v[2]!;
  out.y = f.oy + keyLvl(k1) * LEVEL_UNITS + forms.atY[kind]!;
  out.yaw = (f.yaw - Math.floor(own / 3) * QUARTER_YAW) & (4 * Q - 1);
  out.tw = own % 3;
}

function oldFormCells(kind: number, k0: number, k1: number, out: Cells): boolean {
  const forms = turnedRegistry().forms;
  const span = forms.reach[kind]!;
  const listed = forms.def[kind]!.cells;
  const lvl = keyLvl(k1);
  const d = keyDir(k1);
  out.n = 0;
  if (lvl + span - 1 > LVL_MOST) return false;
  keyAnchor(k0, k1, m, 0);
  for (let c = 0, count = listed ? listed.length : Math.ceil(span / STOREY_LEVELS); c < count; c++) {
    const along = listed ? listed[c]![0] : 0;
    const up = listed ? listed[c]![1] : c * STOREY_LEVELS;
    tupleStep(m, 0, d, along * SIDE, m, 4);
    if (!tupleWithin(m, 4, M_MOST)) return false;
    const n = out.n++;
    out.k0[n] = key0(keyCls(k0), m[4]!, m[5]!, m[6]!);
    out.k1[n] = key1(m[7]!, lvl + up, d, keyLayer(k1), 0, 0);
    out.reach[n] = Math.min(STOREY_LEVELS, span - up);
  }
  return true;
}

test("poseOf and formCells match their former forms for any key", () => {
  const { forms } = turnedRegistry();
  const kinds = [...forms.cls.keys()].filter((k) => forms.cls[k]! >= 0);
  const rng = new Rng(9090);
  const [a, b] = [{ x: 0, y: 0, z: 0, yaw: 0, tw: 0 }, { x: 0, y: 0, z: 0, yaw: 0, tw: 0 }];
  const [p, q] = [new Cells(), new Cells()];
  const wrong: string[] = [];
  for (let n = 0; n < 200000; n++) {
    const kind = kinds[rng.int(kinds.length)]!;
    const f = new Frame(1, rng.int(8_000_000) - 1_000_000, rng.int(200_000), rng.int(8_000_000) - 1_000_000, rng.int(4 * Q), 1);
    // The class is the form's, as a fitted key has it, or any; the direction any of sixteen; turn, flip and place any.
    const cls = rng.int(4) === 0 ? rng.int(4) : forms.cls[kind]!;
    const k0 = key0(cls, rng.int(1023) - 511, rng.int(1023) - 511, rng.int(1023) - 511);
    const k1 = key1(rng.int(1023) - 511, rng.int(511) - 255, rng.int(16), rng.int(8), rng.int(4), rng.int(2));
    poseOf(f, k0, k1, forms, kind, a);
    oldPoseOf(f, k0, k1, kind, b);
    if (!Object.is(a.x, b.x) || !Object.is(a.y, b.y) || !Object.is(a.z, b.z) || !Object.is(a.yaw, b.yaw) || !Object.is(a.tw, b.tw)) wrong.push(`pose of ${kind} ${k0} ${k1}`);
    const [ok, was] = [formCells(forms, kind, k0, k1, p), oldFormCells(kind, k0, k1, q)];
    if (ok !== was || p.n !== q.n || [...p.k0.subarray(0, p.n)].join() !== [...q.k0.subarray(0, q.n)].join() || [...p.k1.subarray(0, p.n)].join() !== [...q.k1.subarray(0, q.n)].join() || [...p.reach.subarray(0, p.n)].join() !== [...q.reach.subarray(0, q.n)].join()) wrong.push(`cells of ${kind} ${k0} ${k1}`);
    if (wrong.length > 5) break;
  }
  expect(wrong).toEqual([]);
  const turns: string[] = [];
  for (let d = -40; d <= 40; d++) for (let k = -40; k <= 40; k++) for (const e of [0, 0.5, -0.5]) if (!Object.is(dirTurn(d + e, k), oldTurn(d + e, k)) || !Object.is(dirTurn(d, -0), oldTurn(d, -0))) turns.push(`${d + e} ${k}`);
  expect(turns).toEqual([]);
  // DIRS is the table both read: a direction past the twelve is read as no step, as the Int32Array scratch stored it.
  expect(DIRS.length).toBe(48);
});

test("a bit read alone reads as bits(1) does, past the end too", () => {
  const rng = new Rng(77);
  const bytes = Uint8Array.from({ length: 64 }, () => rng.int(256));
  const [one, run] = [new BitReader(bytes), new BitReader(bytes)];
  const got: unknown[][] = [[], []];
  for (let i = 0; i < 64 * 8 + 5; i++) {
    got[0]!.push(one.bool(), one.pos, one.overflow);
    got[1]!.push(run.bits(1) === 1, run.pos, run.overflow);
    if (i % 7 === 3) {
      got[0]!.push(one.bits(5));
      got[1]!.push(run.bits(5));
    }
  }
  expect(got[0]).toEqual(got[1]);
});
