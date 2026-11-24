// The claims grid (server/claims.ts): the enemy range and the structure cap, read from 16 m cells and proved against a scan.

import { expect, test } from "bun:test";
import { buildReason } from "../../client/core/build.ts";
import type { ClientSession } from "../../client/core/session.ts";
import { ENEMY_FOUNDATION, ENEMY_PILLAR } from "../../server/build.ts";
import { CAP_CELLS, CLAIM_CELL, Claims } from "../../server/claims.ts";
import { STRUCT_UNITS, chunkCount, type MapDims } from "../../shared/coords.ts";
import type { BitWriter } from "../../shared/net/codec.ts";
import { CMD_PLACE, CMD_SELECT, RESULT_LIMIT, RESULT_OK } from "../../shared/net/protocol.ts";
import { writeNew } from "../../shared/net/place.ts";
import { Rng } from "../../shared/rng.ts";
import { GONE_BLAST, GONE_FELL, StructureStore, type PlacedRows } from "../../shared/world/structures.ts";
import { STRUCT_DEMOLISH } from "../../shared/world/upkeep.ts";
import { PIECES, builder } from "../fixtures/build.ts";
import { scanNear } from "../fixtures/enemy-scan.ts";
import { join, start } from "../fixtures/slots.ts";
import { coreRegistry } from "../fixtures/world.ts";

const reg = coreRegistry();
const id = (name: string): number => reg.index.get(`core:${name}`)!;
const U = STRUCT_UNITS;
const KINDS = ["foundation_wood", "foundation_stone", "pillar_wood", "pillar_stone", "wall_wood", "ceiling_wood"].map(id);

interface Owned {
  ref: number;
  kind: number;
  x: number;
  z: number;
  owner: number;
}

/** Every piece with an owner, read from the chunks' slots. */
function owned(structs: StructureStore): Owned[] {
  const out: Owned[] = [];
  for (const chunk of structs.held) {
    const t = structs.chunks[chunk]!;
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && t.owner[s] !== 0) out.push({ ref: chunk * 65536 + s, kind: t.kind[s]!, x: t.x[s]!, z: t.z[s]!, owner: t.owner[s]! });
  }
  return out;
}

const cellOf = (v: number, cells: number): number => Math.min(cells - 1, Math.max(0, Math.floor(v / CLAIM_CELL)));

/** What the slots say the grid's counts should be, where they differ from what it says: per team, per team and chunk, and around `at`. */
function countsWrong(structs: StructureStore, claims: Claims, teams: number[], at: [number, number][]): string[] {
  const wrong: string[] = [];
  const all = owned(structs);
  const dims = structs.dims;
  for (const team of teams) {
    if (claims.total(team) !== all.filter((p) => p.owner === team).length) wrong.push(`total of team ${team}`);
    for (let chunk = 0; chunk < chunkCount(dims); chunk++) {
      if (claims.has(team, chunk) !== all.some((p) => p.owner === team && Math.floor(p.ref / 65536) === chunk)) wrong.push(`team ${team} in chunk ${chunk}`);
    }
  }
  for (const [x, z] of at) {
    const cx = cellOf(x, dims.chunksX * 4);
    const cz = cellOf(z, dims.chunksZ * 4);
    const n = all.filter((p) => (cellOf(p.x, dims.chunksX * 4) - cx) ** 2 + (cellOf(p.z, dims.chunksZ * 4) - cz) ** 2 <= CAP_CELLS * CAP_CELLS).length;
    if (claims.near(x, z) !== n) wrong.push(`near ${x}, ${z}: ${claims.near(x, z)} for ${n}`);
  }
  return wrong;
}

/** A few of the map's own pieces in every chunk, foundations and pillars among them, as placeMap takes them. */
function mapRows(dims: MapDims, rng: Rng): PlacedRows {
  const first = new Uint32Array(chunkCount(dims) + 1);
  const rows: number[][] = [];
  for (let c = 0; c < chunkCount(dims); c++) {
    first[c] = rows.length;
    for (let n = rng.int(5); n > 0; n--) rows.push([KINDS[rng.int(KINDS.length)]!, (c % dims.chunksX) * 64 + rng.int(64 * U) / U, rng.int(8), Math.floor(c / dims.chunksX) * 64 + rng.int(64 * U) / U, rng.int(4) * 16384]);
  }
  first[chunkCount(dims)] = rows.length;
  const col = (k: number): Float32Array => Float32Array.from(rows, (r) => r[k]!);
  return { first, kind: Uint16Array.from(rows, (r) => r[0]!), x: col(1), y: col(2), z: col(3), yaw: Uint16Array.from(rows, (r) => r[4]!), row: new Uint32Array(0) };
}

/** One seeded world: five teams build, break, swap and change hands, and after every change the grid is asked what the scan is asked. */
function world(seed: number, mapped: boolean): { asked: number; near: number; placed: number; removed: number; wrong: string[] } {
  const rng = new Rng(seed);
  const dims = { chunksX: 8, chunksZ: 6 };
  const [sizeX, sizeZ] = [dims.chunksX * 64, dims.chunksZ * 64];
  const make = (): StructureStore => new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const identity = Uint16Array.from({ length: reg.halfX.length }, (_, k) => k);
  const rows = mapped ? mapRows(dims, rng) : null;
  const structs = make();
  // On half the worlds the grid is made before the map is set down, and on half after.
  const early = seed % 2 === 0 ? new Claims(structs, reg.role) : null;
  if (rows) structs.placeMap(rows, identity, reg.maxHp);
  const claims = early ?? new Claims(structs, reg.role);
  const TEAMS = [1, 2, 3, 4, 5];
  const homes = TEAMS.map(() => [rng.range(40, sizeX - 40), rng.range(40, sizeZ - 40)] as const);
  const refs: number[] = [];
  const out = { asked: 0, near: 0, placed: 0, removed: 0, wrong: [] as string[] };
  const live = (ref: number): boolean => (structs.chunks[Math.floor(ref / 65536)]?.kind[ref & 0xffff] ?? 0) !== 0;
  /** A ref still standing, or -1. */
  const pick = (): number => {
    for (let tries = 0; tries < 8 && refs.length > 0; tries++) {
      const i = rng.int(refs.length);
      if (live(refs[i]!)) return refs[i]!;
      refs[i] = refs[refs.length - 1]!;
      refs.pop();
    }
    return -1;
  };
  const rowOf = (ref: number): [number, number] => {
    const t = structs.chunks[Math.floor(ref / 65536)]!;
    return [t.x[ref & 0xffff]!, t.z[ref & 0xffff]!];
  };
  const edge = (): number => [-1 / U, 0, 1 / U][rng.int(3)]!;
  /** A point a reach away from a standing piece, to a lattice step either side, or anywhere if nothing stands. */
  const atReach = (exact: boolean): [number, number] => {
    const ref = pick();
    if (ref < 0) return [rng.range(0, sizeX), rng.range(0, sizeZ)];
    const [x, z] = rowOf(ref);
    const reach = rng.int(2) === 0 ? ENEMY_FOUNDATION : ENEMY_PILLAR;
    // Whole metres that make the reach exactly: along an axis, or as a 3-4-5 triangle.
    if (exact) {
      const [dx, dz] = [[reach, 0], [0, reach], [reach * 0.6, reach * 0.8], [reach * 0.8, reach * 0.6]][rng.int(4)]!;
      return [x + (rng.int(2) === 0 ? dx! : -dx!) + edge(), z + (rng.int(2) === 0 ? dz! : -dz!) + edge()];
    }
    const turn = rng.range(0, 2 * Math.PI);
    const far = reach + rng.range(-0.01, 0.01);
    return [x + Math.cos(turn) * far, z + Math.sin(turn) * far];
  };
  const ask = (x: number, z: number): void => {
    const team = rng.int(8);
    const said = claims.enemyNear(team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR);
    out.asked++;
    if (said) out.near++;
    if (said !== scanNear(structs, reg.role, team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR)) out.wrong.push(`team ${team} at ${x}, ${z}: the grid says ${said}`);
  };
  const OPS = 1500;
  for (let op = 0; op < OPS; op++) {
    const roll = rng.int(100);
    if (roll < 56 || refs.length < 20) {
      const team = rng.int(12) === 0 ? 0 : TEAMS[rng.int(TEAMS.length)]!;
      const home = homes[(team || 1) - 1]!;
      const how = rng.int(10);
      let [x, z] = [home[0] + rng.range(-28, 28), home[1] + rng.range(-28, 28)];
      // Anywhere; on the edge of a cell or a chunk; just off the map; a reach from another piece; and where another already stands.
      if (how === 0) [x, z] = [rng.range(0, sizeX), rng.range(0, sizeZ)];
      else if (how === 1) x = CLAIM_CELL * rng.int(dims.chunksX * 4 + 1) + edge();
      else if (how === 2) z = CLAIM_CELL * rng.int(dims.chunksZ * 4 + 1) + edge();
      else if (how === 3) [x, z] = [CLAIM_CELL * rng.int(dims.chunksX * 4 + 1) + edge(), CLAIM_CELL * rng.int(dims.chunksZ * 4 + 1) + edge()];
      else if (how === 4) [x, z] = rng.int(2) === 0 ? [rng.int(2) === 0 ? -rng.range(0, 3) : sizeX + rng.range(0, 3), z] : [x, rng.int(2) === 0 ? -rng.range(0, 3) : sizeZ + rng.range(0, 3)];
      else if (how === 5) [x, z] = atReach(true);
      const on = how === 6 ? pick() : -1;
      if (on >= 0) [x, z] = rowOf(on);
      const ref = structs.add(KINDS[rng.int(KINDS.length)]!, x, rng.int(30), z, rng.int(4) * 16384, team, 100);
      expect(ref).toBeGreaterThanOrEqual(0);
      refs.push(ref);
      out.placed++;
    } else if (roll < 76) {
      const ref = pick();
      if (ref >= 0 && structs.remove(ref, rng.int(3), op)) out.removed++;
    } else if (roll < 82) {
      // Several broken together, some of them left as a heap of another kind where they stood.
      const batch = new Uint32Array(12);
      let n = 0;
      for (let k = rng.int(12) + 1; k > 0; k--) {
        const ref = pick();
        if (ref >= 0) batch[n++] = ref;
      }
      const heaps = roll < 79;
      out.removed += heaps ? 0 : structs.removeMany(batch, n, GONE_FELL, 0, 0, 0, op);
      if (heaps) structs.breakMany(batch, n, GONE_BLAST, (ref, leaves) => void ([leaves.kind, leaves.hp] = [ref % 3 === 0 ? 0 : KINDS[ref % KINDS.length]!, 5]), 0, 0, 0, op, 8);
    } else if (roll < 90) {
      const ref = pick();
      if (ref >= 0) structs.swap(ref, KINDS[rng.int(KINDS.length)]!);
    } else if (roll < 94) {
      const ref = pick();
      if (ref >= 0 && structs.damage(ref, rng.int(2) === 0 ? 1 : 1e9, op) === 0) out.removed++;
    } else if (roll < 97) {
      // A tribe takes in a team's pieces, and now and then a team takes the map's.
      structs.reown(mapped && rng.int(6) === 0 ? 0 : TEAMS[rng.int(TEAMS.length)]!, TEAMS[rng.int(TEAMS.length)]!);
    } else if (mapped) {
      const chunk = rng.int(chunkCount(dims));
      structs.heal(chunk, Uint16Array.from({ length: structs.chunks[chunk]?.mapped ?? 0 }, (_, s) => s));
    }
    for (let k = 0; k < 4; k++) ask(rng.range(-4, sizeX + 4), rng.range(-4, sizeZ + 4));
    for (let k = 0; k < 3; k++) ask(...atReach(k === 0));
    ask(CLAIM_CELL * rng.int(dims.chunksX * 4 + 1) + edge(), CLAIM_CELL * rng.int(dims.chunksZ * 4 + 1) + edge());
    if (op % 250 === 249) out.wrong.push(...countsWrong(structs, claims, [0, ...TEAMS, 9], [[rng.range(0, sizeX), rng.range(0, sizeZ)], [0, 0], [sizeX, sizeZ], atReach(false)]));
  }
  // A grid made from the standing world, as after a load, and one told of a copy of it slot by slot, say what this one says.
  const copy = make();
  const told = new Claims(copy, reg.role);
  if (rows) copy.placeMap(rows, identity, reg.maxHp);
  for (const chunk of structs.held) {
    const t = structs.chunks[chunk]!;
    for (let s = 0; s < t.high; s++) {
      if (s < t.mapped) copy.putMapped(chunk, s, t.kind[s]!, t.owner[s]!, t.hp[s]!, t.mod[s]!);
      else if (t.kind[s] !== 0) copy.put(chunk, s, t.kind[s]!, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, t.owner[s]!, t.hp[s]!, t.mod[s]!);
    }
    copy.setVersion(chunk, t.version);
  }
  const before = { entries: claims.entries, spots: claims.spots };
  const fresh = new Claims(structs, reg.role);
  expect([{ entries: fresh.entries, spots: fresh.spots }, { entries: told.entries, spots: told.spots }]).toEqual([before, before]);
  for (let k = 0; k < 400; k++) {
    const [x, z] = k % 2 === 0 ? [rng.range(0, sizeX), rng.range(0, sizeZ)] : atReach(k % 4 === 1);
    const team = rng.int(8);
    const said = scanNear(structs, reg.role, team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR);
    for (const grid of [fresh, told]) if (grid.enemyNear(team, x, z, ENEMY_FOUNDATION, ENEMY_PILLAR) !== said || grid.near(x, z) !== claims.near(x, z) || grid.total(team) !== claims.total(team)) out.wrong.push(`a grid made afresh, at ${x}, ${z}`);
  }
  // With every owned piece gone the grid holds nothing, whatever of the map still stands.
  for (const p of owned(structs)) structs.remove(p.ref);
  expect([fresh.entries, fresh.spots, fresh.near(sizeX / 2, sizeZ / 2), fresh.enemyNear(0, homes[0]![0], homes[0]![1], ENEMY_FOUNDATION, ENEMY_PILLAR)]).toEqual([0, 0, 0, false]);
  return out;
}

test("the grid answers the enemy range as a scan of every slot does, on seeded worlds", () => {
  const sum = { asked: 0, near: 0, placed: 0, removed: 0 };
  for (let seed = 1; seed <= 8; seed++) {
    const got = world(seed * 7919, seed > 4);
    expect(got.wrong.slice(0, 5)).toEqual([]);
    for (const k of ["asked", "near", "placed", "removed"] as const) sum[k] += got[k];
  }
  // Both answers are common, so neither is right by default.
  expect(sum.placed).toBeGreaterThan(6000);
  expect(sum.removed).toBeGreaterThan(2000);
  expect(sum.near).toBeGreaterThan(sum.asked * 0.2);
  expect(sum.near).toBeLessThan(sum.asked * 0.8);
});

test("the cap counts every team's pieces in the cells within 96 m, not the map's", () => {
  const dims = { chunksX: 6, chunksZ: 6 };
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const claims = new Claims(structs, reg.role);
  const [wall, foundation] = [id("wall_wood"), id("foundation_wood")];
  // The builder stands in cell (12, 12). A piece counts by the cell its middle is in.
  const at = (cx: number, cz: number): [number, number] => [cx * CLAIM_CELL + 8, cz * CLAIM_CELL + 8];
  const here = at(12, 12);
  const put = (cx: number, cz: number, team: number, kind = wall): number => structs.add(kind, at(cx, cz)[0], 1, at(cx, cz)[1], 0, team, 100);
  put(12, 12, 1);
  put(18, 12, 2, foundation);
  put(12, 6, 3);
  put(16, 16, 1);
  expect(claims.near(...here)).toBe(4);
  // Seven cells off, and five by four, are past it. So is anything nobody owns.
  put(19, 12, 1);
  put(17, 16, 2);
  put(12, 12, 0);
  expect(claims.near(...here)).toBe(4);
  expect(claims.near(here[0] + 7.9, here[1] - 7.9)).toBe(4);
  expect(claims.near(here[0] + 8, here[1])).toBe(5);
  // A change of owner moves no count, and a piece gone is counted no more.
  expect(structs.reown(1, 2)).toBe(3);
  expect([claims.near(...here), claims.total(1), claims.total(2)]).toEqual([4, 0, 5]);
  structs.remove(put(12, 13, 4));
  expect([claims.near(...here), claims.total(4)]).toEqual([4, 0]);
  // At the map's corner there are fewer cells to count, and no others are read.
  put(0, 0, 5);
  expect([claims.near(0, 0), claims.near(-5, -5), claims.near(6 * 64 + 5, 6 * 64 + 5)]).toEqual([1, 1, 0]);
});

test("a piece over the structure cap is refused with both numbers", () => {
  const made = builder(["ada"], 40, 40);
  const { h, sessions, at, act, count, structs } = made;
  const ada = sessions[0] as ClientSession;
  let code = -1;
  ada.onResult = (_seq, c) => void (code = c);
  // The placement's own answer carries both numbers, and the client words them.
  let said = "";
  ada.onPlaced = (p) => void (said = buildReason(h.reg, ada, p.code, p));
  let row = 0;
  /** Sets a foundation down on the next free place along a row. Returns the result code. */
  const found = (): number => {
    ada.command(CMD_SELECT, (w: BitWriter) => w.u8(PIECES.indexOf("foundation")));
    h.run(100);
    code = -1;
    ada.command(CMD_PLACE, (w: BitWriter) => writeNew(w, 0, Math.round((at.x - 8 + row * 4) * U), Math.round((at.z + 5) * U), 0));
    h.run(200);
    if (code === RESULT_OK) row++;
    return code;
  };
  // ARK's default of 10,500 is far off. Another tribe's wall counts with her two foundations.
  expect([found(), found()]).toEqual([RESULT_OK, RESULT_OK]);
  structs.add(id("wall_wood"), at.x, at.y + 20, at.z + 12, 0, 77, 100);
  expect(h.world.claims.near(at.x, at.z)).toBe(3);
  expect(h.say(ada, "setting TheMaxStructuresInRange 3")[0]).toContain("TheMaxStructuresInRange=3");
  const had = count(ada, "foundation");
  expect(found()).toBe(RESULT_LIMIT);
  expect(said).toBe("3 of 3 structures here");
  expect([count(ada, "foundation"), h.host.build.refused]).toEqual([had, 1]);
  // Room is made by a higher cap, by a piece taken down, or by no cap at all.
  h.say(ada, "setting TheMaxStructuresInRange 4");
  expect(found()).toBe(RESULT_OK);
  const third = h.host.build.last;
  expect(found()).toBe(RESULT_LIMIT);
  expect(said).toBe("4 of 4 structures here");
  expect(act(ada, third, STRUCT_DEMOLISH)).toBe(RESULT_OK);
  ada.onResult = (_seq, c) => void (code = c);
  expect([found(), found()]).toEqual([RESULT_OK, RESULT_LIMIT]);
  h.say(ada, "setting TheMaxStructuresInRange 0");
  expect(found()).toBe(RESULT_OK);
  expect(h.host.items.audit()).toEqual([]);
  h.host.shutdown();
});

/** A seeded world of bases of several tribes over many chunks, with things, pieces set down by pose and nobody's scenery. */
function tribesWorld(seed: number): { structs: StructureStore; claims: Claims } {
  const dims: MapDims = { chunksX: 6, chunksZ: 6 };
  const structs = new StructureStore(dims, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const claims = new Claims(structs, reg.role);
  const rng = new Rng(seed);
  const w = { structs, reg };
  const [box, wall] = [id("storage_box"), id("wall_wood")];
  for (let b = 0; b < 40; b++) {
    const team = 1 + rng.int(6);
    const first = start(w, id("foundation_wood"), 20 + rng.int(340), 0.1875, 20 + rng.int(340), rng.int(65536), team, 100);
    const built = [first];
    for (let n = rng.int(12); n > 0; n--) {
      const kind = KINDS[rng.int(KINDS.length)]!;
      const ref = join(w, built[rng.int(built.length)]!, kind, rng.int(4), 0, 100);
      if (ref >= 0) built.push(ref);
    }
  }
  // Things and loose pieces are in no base, and nobody's are in no tribe.
  for (let n = 0; n < 60; n++) structs.add(rng.int(2) === 0 ? box : wall, 10 + rng.int(360), 1 + rng.int(3), 10 + rng.int(360), rng.int(65536), rng.int(8), 100);
  return { structs, claims };
}

test("a tribe's pieces change owner the same whether every chunk is read or only those it built in", () => {
  /** Everything a change of owner writes: each chunk's version, owners, the versions its slots changed at and its log of changes; each base's team; each team's count. */
  const state = (o: { structs: StructureStore; claims: Claims }): unknown[] => [
    o.structs.held.map((c) => {
      const t = o.structs.chunks[c]!;
      return [c, t.version, [...t.owner.subarray(0, t.high)], [...t.mod.subarray(0, t.high)], t.recentCount, t.recentSlot ? [...t.recentSlot.subarray(0, Math.min(t.recentCount, 256))] : [], t.differs];
    }),
    [...o.structs.frames.all()].map((f) => [f.gid, f.team]),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((team) => o.claims.total(team)),
  ];
  let passed = 0, moved = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const [all, some] = [tribesWorld(seed), tribesWorld(seed)];
    expect(state(some)).toEqual(state(all));
    // Tribes join tribes, one that has nothing joins, one joins a tribe that was not there, and nobody's pieces are given.
    for (const [from, to] of [[3, 5], [1, 5], [5, 2], [9, 4], [6, 9], [7, 7], [0, 8], [4, 1]] as const) {
      const whole = all.structs.reown(from, to);
      const part = some.structs.reown(from, to, (chunk) => {
        const has = some.claims.has(from, chunk);
        if (!has) passed++;
        return has;
      });
      expect([seed, from, to, part]).toEqual([seed, from, to, whole]);
      expect(state(some)).toEqual(state(all));
      moved += whole;
    }
  }
  // Pieces did change hands, and chunks the tribe had not built in were passed over unread.
  expect(moved).toBeGreaterThan(500);
  expect(passed).toBeGreaterThan(100);
});

test("a lone root is told by its base's one row as by its links: a base of one piece has nothing joined to it", () => {
  const { h, structs } = builder(["ada"], 60);
  const rng = new Rng(9);
  const g = h.world.spawn;
  const here = { structs, reg };
  const refs: number[] = [];
  // Bases of one piece and of several, a pillar in the air, pieces taken away so that a base's last ones no longer touch.
  for (let b = 0; b < 60; b++) {
    const kind = rng.int(3) === 0 ? id("pillar_wood") : id("foundation_wood");
    const [x, z] = [g.x + 40 + (b % 10) * 9, g.z + 30 + Math.floor(b / 10) * 9];
    const y = h.world.hf.heightAt(x, z) + (kind === id("pillar_wood") ? 1.375 + rng.int(2) * 3 : 0.1875);
    const first = start(here, kind, x, y, z, rng.int(65536), 50 + (b % 3), 100);
    expect(first).toBeGreaterThanOrEqual(0);
    const built = [first];
    for (let n = rng.int(3) === 0 ? 0 : rng.int(5); n > 0; n--) {
      const ref = join(here, built[rng.int(built.length)]!, KINDS[rng.int(KINDS.length)]!, rng.int(4), 0, 100);
      if (ref >= 0) built.push(ref);
    }
    if (built.length > 2 && rng.int(2) === 0) structs.remove(built.splice(1 + rng.int(built.length - 1), 1)[0]!);
    refs.push(...built);
  }
  refs.push(structs.add(id("foundation_wood"), g.x + 30, 1, g.z + 20, 0, 50, 100), structs.add(id("storage_box"), g.x + 34, 1, g.z + 20, 0, 50, 100));
  const support = h.host.build.support;
  /** The rule as it was: a root with no link to anything. */
  const byLinks = (ref: number): boolean => {
    support.forget();
    const node = support.node(ref);
    return node !== null && node.root && (node.role === 0 || node.role === 3) && node.links.length === 0;
  };
  const lone = h.host.build.decay.lone!;
  const answers = refs.map((ref) => lone(ref));
  expect(answers).toEqual(refs.map(byLinks));
  expect([answers.filter(Boolean).length > 10, answers.filter((a) => !a).length > 20]).toEqual([true, true]);
});
