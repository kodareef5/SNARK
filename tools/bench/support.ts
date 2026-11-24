// Rows for support and stability by themselves (shared/world/support.ts): the house of the collapse section of
// tools/bench.ts asked and brought down with no server round it, a 30-storey tower, and one pass over a 20,000-piece
// base. `bun tools/bench/support.ts` runs these alone; `bun run bench` does not.

import { CORE_CONTENT } from "../../content/core.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { STRUCT_UNITS } from "../../shared/coords.ts";
import { Collapse } from "../../shared/world/collapse.ts";
import { poseAt, type Pose } from "../../shared/world/snap.ts";
import { Found, GONE_FELL, StructureStore } from "../../shared/world/structures.ts";
import { Support } from "../../shared/world/support.ts";
import { boxBase } from "./base.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 8, chunksZ: 8 };
/** server/build.ts's COLLAPSE_WORK. */
const WORK = 16000;
const U = STRUCT_UNITS;
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;

export function supportRows(section: Section, record: Row): void {
  const { registry: reg, errors } = compileContent(CORE_CONTENT);
  if (!reg) throw new Error(errors.join("\n"));
  const make = (): StructureStore => new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const piece = (name: string): number => reg.index.get(`core:${name}_stone`)!;
  const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const flat = (): number => 0;

  /** The house of tools/bench.ts: 12 by 12 foundations and `storeys` of walls and ceilings. Returns its foundations and top floors. */
  const house = (structs: StructureStore, storeys: number, n = 12): { ground: number[]; top: number[] } => {
    const add = (name: string, target: number, k: number): number => {
      if (!poseAt(structs, reg, target, piece(name), k, 0, pose)) throw new Error(`no place for a ${name}`);
      return structs.add(piece(name), pose.x / U, pose.y / U, pose.z / U, pose.yaw, 9000, 10000);
    };
    const ground: number[][] = [];
    for (let i = 0; i < n; i++) {
      ground.push([]);
      for (let j = 0; j < n; j++) ground[i]!.push(i === 0 && j === 0 ? structs.add(piece("foundation"), 200, 0.1875, 200, 0, 9000, 15000) : j === 0 ? add("foundation", ground[i - 1]![0]!, 1) : add("foundation", ground[i]![j - 1]!, 0));
    }
    let tiles = ground;
    for (let storey = 0; storey < storeys; storey++) {
      tiles = tiles.map((line, i) =>
        line.map((t, j) => {
          const north = add("wall", t, 0);
          add("wall", t, 1);
          if (j === 0) add("wall", t, 2);
          if (i === 0) add("wall", t, 3);
          return add("ceiling", north, 1);
        }),
      );
    }
    return { ground: ground.flat(), top: tiles.flat() };
  };

  section("Support: the 1,512-piece house of the collapse section, by itself");
  {
    const structs = make();
    const { ground, top } = house(structs, 3);
    record("pieces in the house", structs.count, "");
    const support = new Support(structs, reg, flat);
    const asks: number[] = [];
    for (let pass = 0; pass < 20; pass++) {
      const t0 = performance.now();
      let stood = 0;
      for (const ref of top) stood += support.standsRef(ref) ? 1 : 0;
      asks.push((performance.now() - t0) / top.length);
      if (stood !== top.length) throw new Error("a floor of the house does not stand");
    }
    record("ask whether a piece stands, median of 20 passes", median(asks), "ms", 0.1);
    if ("stability" in support) {
      const numbers: number[] = [];
      for (let pass = 0; pass < 20; pass++) {
        const t0 = performance.now();
        for (const ref of top) support.stability(ref);
        numbers.push((performance.now() - t0) / top.length);
      }
      record("its stability, median of 20 passes", median(numbers), "ms", 0.1);
      const out = new Uint32Array(256);
      const t0 = performance.now();
      const falls = support.wouldFall(ground[0]!, out);
      record("what falls with a corner foundation, found dry", performance.now() - t0, "ms");
      record("pieces that would fall with it", falls, "");
    }

    const collapse = new Collapse(structs, reg, flat);
    structs.onRemove = (ref, cause) => void (cause !== GONE_FELL && collapse.gone(ref));
    for (const ref of ground) structs.damage(ref, 1e9, 1);
    const steps: number[] = [];
    let units = 0;
    for (let tick = 2; collapse.busy && tick < 2000; tick++) {
      const t0 = performance.now();
      collapse.step(WORK, tick);
      steps.push(performance.now() - t0);
      units += collapse.spent;
    }
    const all = steps.reduce((a, b) => a + b, 0);
    record("pieces that fell", collapse.fallen, "");
    record("pieces left standing", structs.count, "", 0);
    record("steps until the last was down", steps.length, "", 60);
    record("collapse work in a step, median", median(steps), "ms", 1.5);
    record("collapse work in a step, worst", Math.max(...steps), "ms", 3);
    record("collapse work in all", all, "ms");
    record("a millisecond of it in work units", units / all, "units");
  }

  section("Support: a tower of 30 storeys on one foundation");
  {
    const structs = make();
    const { top } = house(structs, 30, 1);
    record("pieces in the tower", structs.count, "");
    const support = new Support(structs, reg, flat);
    const asks: number[] = [];
    for (let pass = 0; pass < 200; pass++) {
      const t0 = performance.now();
      if (!support.standsRef(top[0]!)) throw new Error("the top floor does not stand");
      asks.push(performance.now() - t0);
    }
    record("ask whether its top floor stands, median", median(asks), "ms", 0.1);
    record("work units of that question", support.work / 200, "units");
  }

  section("Stability: one pass over a base of 20,000 pieces, as a client's overlay asks");
  {
    const structs = make();
    for (const [kind, x, y, z, yaw] of boxBase(reg, "stone", 190, 0, 190, 40, 3, 20000)) structs.add(kind, x, y, z, yaw, 9000, 100);
    record("pieces in the base", structs.count, "");
    record("frames", structs.frames.count, "");
    const support = new Support(structs, reg, flat);
    if (!("stabilities" in support)) return;
    const rows = new Found(32768);
    let out = new Int8Array(32768);
    const passes: number[] = [];
    let n = 0;
    const fr = structs.frames.all().next().value!.gid;
    for (let pass = 0; pass < 20; pass++) {
      const t0 = performance.now();
      n = support.stabilities(fr, rows, out);
      passes.push(performance.now() - t0);
    }
    record("pieces the pass numbered", n, "");
    record("the pass, median of 20", median(passes), "ms", 5);
    record("the pass, first", passes[0]!, "ms");
    let standing = 0;
    for (let i = 0; i < n; i++) if (out[i]! >= 0) standing++;
    record("pieces it found standing", standing, "");
    out = new Int8Array(0);
  }
}

if (import.meta.main) {
  supportRows((title) => console.log(`\n${title}`), (name, value, unit, budget = null) => {
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 4 : 1).padStart(12)} ${unit}${verdict}`);
  });
}
