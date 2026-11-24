// Rows for support and stability by themselves (shared/world/support.ts): the house of the collapse section of
// tools/bench.ts asked and brought down with no server round it, a 30-storey tower, and one pass over a 20,000-piece
// base. `bun tools/bench/support.ts` runs these alone; `bun run bench` does not. The collapse here runs once, cold:
// its steps are held to their budgets by the collapse section of tools/bench.ts. Last, a hut, the house and a base of
// 20,000 come down at the server's pace (server/build.ts), with how many of their pieces a client would have in the air.

import { FALL_GRAVITY, FRONT_MS_PER_METRE, MAX_WAIT_MS } from "../../client/core/rubble.ts";
import { CORE_CONTENT } from "../../content/core.ts";
import { COLLAPSE_WORK, WAVE_TICKS, fallMost } from "../../server/build.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { Collapse } from "../../shared/world/collapse.ts";
import { Found, GONE_FELL, StructureStore } from "../../shared/world/structures.ts";
import { Support } from "../../shared/world/support.ts";
import { boxBase, layBase } from "./base.ts";
import { join, start } from "../../tests/fixtures/slots.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const DIMS = { chunksX: 8, chunksZ: 8 };
const WORK = COLLAPSE_WORK;
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;

export function supportRows(section: Section, record: Row): void {
  const { registry: reg, errors } = compileContent(CORE_CONTENT);
  if (!reg) throw new Error(errors.join("\n"));
  const make = (): StructureStore => new StructureStore(DIMS, reg.halfX, reg.halfY, reg.halfZ, null, reg.parts);
  const piece = (name: string): number => reg.index.get(`core:${name}_stone`)!;
  const flat = (): number => 0;

  /** The house of tools/bench.ts: 12 by 12 foundations and `storeys` of walls and ceilings. Returns its foundations and top floors. */
  const house = (structs: StructureStore, storeys: number, n = 12): { ground: number[]; top: number[] } => {
    const add = (name: string, target: number, k: number): number => {
      const ref = join({ structs, reg }, target, piece(name), k, 0, 10000);
      if (ref < 0) throw new Error(`no place for a ${name}`);
      return ref;
    };
    const ground: number[][] = [];
    for (let i = 0; i < n; i++) {
      ground.push([]);
      for (let j = 0; j < n; j++) ground[i]!.push(i === 0 && j === 0 ? start({ structs, reg }, piece("foundation"), 200, 0.1875, 200, 0, 9000, 15000) : j === 0 ? add("foundation", ground[i - 1]![0]!, 1) : add("foundation", ground[i]![j - 1]!, 0));
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
    record("collapse work in a step, median", median(steps), "ms");
    record("collapse work in a step, worst", Math.max(...steps), "ms");
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
    layBase(structs, boxBase(reg, "stone", 190, 0, 190, 40, 3, 20000), 9000, 100);
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
    record("the pass, median of 20", median(passes), "ms");
    record("the pass, first", passes[0]!, "ms");
    let standing = 0;
    for (let i = 0; i < n; i++) if (out[i]! >= 0) standing++;
    record("pieces it found standing", standing, "");
    out = new Int8Array(0);
  }

  // Every foundation goes at once, and the rest falls as server/build.ts steps it: a removal every WAVE_TICKS, each of
  // at most fallMost pieces. A piece is in the air from its removal and its wait behind the front (client/core/rubble.ts)
  // until the ground has it.
  const down = (title: string, build: (structs: StructureStore) => number[], budget: number | null): void => {
    section(title);
    const structs = make();
    const ground = build(structs);
    record("pieces", structs.count, "");
    const collapse = new Collapse(structs, reg, flat);
    const t = structs.chunks[Math.floor(ground[0]! / 65536)]!;
    const [ox, oy, oz] = [t.x[ground[0]! & 0xffff]!, t.y[ground[0]! & 0xffff]!, t.z[ground[0]! & 0xffff]!];
    /** Each fallen piece: the tick it went, how far from where the collapse began, and the seconds its drop takes. */
    const fell: number[] = [];
    let tick = 1;
    structs.onRemove = (ref, cause) => {
      if (cause !== GONE_FELL) return void collapse.gone(ref);
      const c = structs.chunks[Math.floor(ref / 65536)]!, slot = ref & 0xffff;
      fell.push(tick, Math.sqrt((c.x[slot]! - ox) ** 2 + (c.y[slot]! - oy) ** 2 + (c.z[slot]! - oz) ** 2), Math.sqrt((2 * (c.y[slot]! + reg.halfY[c.kind[slot]!]!)) / FALL_GRAVITY));
    };
    for (const ref of ground) structs.damage(ref, 1e9, 1);
    const steps: number[] = [];
    const sizes: number[] = [];
    const chunks = new Map<number, number>();
    const versions = structs.chunks.map((c) => c?.version ?? 0);
    let [first, last, fellAt] = [-1, -1, -WAVE_TICKS];
    for (tick = 2; collapse.busy && tick < 100000; tick++) {
      if (tick - fellAt < WAVE_TICKS) continue;
      const t0 = performance.now();
      const n = collapse.step(WORK, tick, fallMost(collapse.made));
      steps.push(performance.now() - t0);
      if (n === 0) continue;
      sizes.push(n);
      fellAt = last = tick;
      if (first < 0) first = tick;
      structs.chunks.forEach((c, k) => {
        if (c && c.version !== versions[k]) chunks.set(k, (chunks.get(k) ?? 0) + 1);
        versions[k] = c?.version ?? 0;
      });
    }
    // In the air: from its removal's tick and its place behind that removal's front, for as long as its drop takes.
    const nearest = new Map<number, number>();
    for (let k = 0; k < fell.length; k += 3) nearest.set(fell[k]!, Math.min(nearest.get(fell[k]!) ?? Infinity, fell[k + 1]!));
    const starts: number[] = [];
    const ends: number[] = [];
    for (let k = 0; k < fell.length; k += 3) {
      const from = (fell[k]! / TICK_RATE) * 1000 + Math.min(MAX_WAIT_MS, (fell[k + 1]! - nearest.get(fell[k]!)!) * FRONT_MS_PER_METRE);
      starts.push(from);
      ends.push(from + fell[k + 2]! * 1000);
    }
    starts.sort((a, b) => a - b);
    ends.sort((a, b) => a - b);
    let most = 0;
    for (let k = 0, gone = 0; k < starts.length; k++) {
      while (ends[gone]! <= starts[k]!) gone++;
      most = Math.max(most, k + 1 - gone);
    }
    const seconds = (last - first + 1) / TICK_RATE;
    record("pieces that fell", collapse.fallen, "");
    record("pieces left standing", structs.count, "", 0);
    record("removals", sizes.length, "");
    record("ticks from the first piece to the last", last - first + 1, "", budget);
    record("most pieces in one removal", Math.max(...sizes), "", 256);
    record("pieces a second, first to last", collapse.fallen / seconds, "");
    record("most in the air at once for a client that shows them all", most, "");
    record("most removals of one chunk in a second", Math.max(...chunks.values()) / Math.max(1, seconds), "", TICK_RATE / WAVE_TICKS);
    record("collapse work in a step, worst", Math.max(...steps), "ms", 3);
  };
  down("Collapse at the server's pace: a hut of 128", (structs) => house(structs, 2, 4).ground, 15);
  down("Collapse at the server's pace: the house of 1,512", (structs) => house(structs, 3).ground, 45);
  down("Collapse at the server's pace: a base of 20,000", (structs) => layBase(structs, boxBase(reg, "stone", 190, 0, 190, 40, 3, 20000), 9000, 100).slice(0, 1600), 300);
}

if (import.meta.main) {
  supportRows((title) => console.log(`\n${title}`), (name, value, unit, budget = null) => {
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 4 : 1).padStart(12)} ${unit}${verdict}`);
  });
}
