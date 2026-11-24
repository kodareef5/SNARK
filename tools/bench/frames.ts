// Rows for frames, keys and occupancy in the structure store, at the sizing target of 500,000 pieces in 250 bases: what
// they hold, what keying adds to setting a piece down by key, by pose through the adoption shim and by loaded rows, and
// what a lookup and taking a piece up cost. `bun tools/bench/frames.ts` runs these alone; `bun run bench` does not.

import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Rng } from "../../shared/rng.ts";
import type { LatticeKey } from "../../shared/world/lattice/frames.ts";
import { cellAt } from "../../shared/world/lattice/occupancy.ts";
import { keyLvl } from "../../shared/world/lattice/module.ts";
import { StructureStore } from "../../shared/world/structures.ts";
import { BASE_TIERS, boxBase, type Piece } from "./base.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 128, chunksZ: 128 };
const BASES = 250;
const EACH = 2000;
const ASKS = 1000000;

export function framesRows(section: Section, record: Row): void {
  section("Frames, keys and occupancy: 500,000 pieces in 250 bases");
  const { registry: reg, errors } = compileContent(CORE_CONTENT);
  if (!reg) throw new Error(errors.join("\n"));
  const rng = new Rng(2026);
  const bases: Piece[][] = [];
  for (let b = 0; b < BASES; b++) bases.push(boxBase(reg, BASE_TIERS[b % 3]!, Math.round(rng.range(400, 7790) / 3) * 3 - 21, 0, Math.round(rng.range(400, 7790) / 3) * 3 - 21, 14, 3, EACH));
  const { forms: _none, ...unformed } = reg.parts;
  const make = (keyed: boolean): StructureStore => new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, keyed ? reg.parts : unformed);
  const byPose = (structs: StructureStore): number => {
    const t0 = performance.now();
    bases.forEach((base, b) => {
      for (const [kind, x, y, z, yaw] of base) structs.add(kind, x, y, z, yaw, b + 1, 100);
    });
    return performance.now() - t0;
  };
  const best = (run: () => number): number => Math.min(run(), run(), run());
  byPose(make(true));
  const bare = best(() => byPose(make(false)));
  let structs = make(true);
  const shim = best(() => byPose((structs = make(true))));
  let free = 0;
  for (const c of structs.held) {
    const t = structs.chunks[c]!;
    for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0 && (!t.fr || t.fr[s] === 0)) free++;
  }
  record("pieces placed", structs.count, "");
  record("pieces the shim left with a free pose", free, "");
  record("frames", structs.frames.count, "");
  record("to set them down by pose in a store with no forms", bare, "ms");
  record("to set them down by pose, each keyed by the shim", shim, "ms");

  // The same pieces by their keys, each base's frame made first with its origin.
  const keys: { kind: number; base: number; k0: number; k1: number }[] = [];
  const origins: [number, number, number, number][] = [];
  const key: LatticeKey = { fr: 0, k0: 0, k1: 0 };
  const gids = new Map<number, number>();
  for (const c of structs.held) {
    const t = structs.chunks[c]!;
    for (let s = 0; s < t.high; s++) {
      if (!structs.keyAt(c * 65536 + s, key)) continue;
      const f = structs.frames.get(key.fr)!;
      if (!gids.has(key.fr)) {
        gids.set(key.fr, origins.length);
        origins.push([f.ox, f.oy, f.oz, f.yaw]);
      }
      keys.push({ kind: t.kind[s]!, base: gids.get(key.fr)!, k0: key.k0, k1: key.k1 });
    }
  }
  let keyed = make(true);
  const byKey = (): number => {
    keyed = make(true);
    const made = origins.map((o, b) => keyed.frames.make(o[0], o[1], o[2], o[3], b + 1).gid);
    const t0 = performance.now();
    for (const k of keys) keyed.place(k.kind, made[k.base]!, k.k0, k.k1, k.base + 1, 100);
    return performance.now() - t0;
  };
  const placed = best(byKey);
  if (keyed.count !== keys.length) throw new Error(`placed ${keyed.count} of ${keys.length} by key`);
  record("to set them down by key", placed, "ms");

  // As a save loads them: rows put chunk by chunk in slot order, keyed by the shim as they come.
  const load = (to: StructureStore): number => {
    const t0 = performance.now();
    for (const c of structs.held) {
      const t = structs.chunks[c]!;
      for (let s = 0; s < t.high; s++) to.put(c, s, t.kind[s]!, t.x[s]!, t.y[s]!, t.z[s]!, t.yaw[s]!, t.owner[s]!, t.hp[s]!, t.mod[s]!);
      to.setVersion(c, t.version);
    }
    return performance.now() - t0;
  };
  const loadedBare = best(() => load(make(false)));
  let loaded = make(true);
  const loadedKeyed = best(() => load((loaded = make(true))));
  record("to put them as loaded rows in a store with no forms", loadedBare, "ms");
  record("to put them as loaded rows, each keyed by the shim", loadedKeyed, "ms");
  record("loaded rows the shim left with a free pose", loaded.count - loaded.occupied.size, "");

  let columns = 0;
  for (const c of structs.held) if (structs.chunks[c]!.fr) columns += structs.chunks[c]!.cap * 13;
  record("key columns, at 13 bytes a row of a chunk's room", columns / 1048576, "MB");
  record("occupancy table", structs.occupied.bytes / 1048576, "MB");
  record("occupancy entries", structs.occupied.size, "");
  record("bytes a keyed piece, columns and table", (columns + structs.occupied.bytes) / structs.occupied.size, "B");

  // Who is in a cell some piece has, who covers a wall's edge two levels up, and a cell nothing is in.
  const asked = Array.from({ length: 4096 }, () => keys[rng.int(keys.length)]!);
  const gidOf = [...gids.keys()];
  let hits = 0;
  let t0 = performance.now();
  for (let i = 0; i < ASKS; i++) {
    const k = asked[i & 4095]!;
    if (structs.refAt(gidOf[k.base]!, k.k0, k.k1) >= 0) hits++;
  }
  record("who is in a cell", ((performance.now() - t0) / ASKS) * 1e6, "ns");
  t0 = performance.now();
  for (let i = 0; i < ASKS; i++) {
    const k = asked[i & 4095]!;
    if (structs.covering(gidOf[k.base]!, k.k0, cellAt(k.k1, keyLvl(k.k1) + 2, 2)) >= 0) hits++;
  }
  record("who covers an edge two levels up, of walls four levels high", ((performance.now() - t0) / ASKS) * 1e6, "ns");
  t0 = performance.now();
  for (let i = 0; i < ASKS; i++) {
    const k = asked[i & 4095]!;
    if (structs.refAt(gidOf[k.base]!, k.k0, cellAt(k.k1, 200, 5)) >= 0) hits++;
  }
  record("a cell nothing is in", ((performance.now() - t0) / ASKS) * 1e6, "ns");
  if (hits < ASKS) throw new Error("the lookups found too little");

  // Taking every piece up again, in a store with no forms and in the keyed one.
  const clear = (of: StructureStore): number => {
    const refs: number[] = [];
    for (const c of of.held) {
      const t = of.chunks[c]!;
      for (let s = 0; s < t.high; s++) if (t.kind[s] !== 0) refs.push(c * 65536 + s);
    }
    const t1 = performance.now();
    for (const ref of refs) of.remove(ref);
    return performance.now() - t1;
  };
  const plain = make(false);
  byPose(plain);
  record("to take them all up from a store with no forms", clear(plain), "ms");
  record("to take them all up, keyed", clear(structs), "ms");
  if (structs.frames.count !== 0 || structs.occupied.size !== 0) throw new Error("frames or cells were left");
}

if (import.meta.main) {
  framesRows(
    (title) => console.log(`\n${title}`),
    (name, value, unit) => console.log(`  ${name.padEnd(72)} ${value.toFixed(value < 10 ? 5 : 1).padStart(12)} ${unit}`),
  );
}
