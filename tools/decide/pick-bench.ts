// What nav.pick and nav.reach cost a tick with many movers on objectives: the decider's row and Courses' row (where a
// pick's ways are priced), median and 99th percentile, under today's code and under the rule.
//
//   bun tools/decide/pick-bench.ts [--movers 500] [--seconds 60] [--seed 1]
//
// Movers are raptors, parasaurs and dodos among walled pens and U's on the lab's flat ground, each given an objective of
// three choices within 40 m, and a new one each time it runs out. Pin the process to one core to compare runs.

import { TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import type { Objective } from "../../shared/world/course.ts";
import { flatMap } from "../../tests/fixtures/map.ts";
import { lab } from "./world.ts";

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
}

const pct = (v: number[], q: number): number => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * q))] ?? NaN;

function bench(policy: string, movers: number, seconds: number, seed: number, near: boolean): string {
  const w = lab(flatMap(4), seed), rng = new Rng(seed), reg = w.world.reg, wall = reg.index.get("core:wall_stone")!;
  // A U every 40 m, open to a side drawn from the seed.
  for (let cx = 30; cx < 230; cx += 40) for (let cz = 30; cz < 230; cz += 40) {
    const turn = rng.int(4), put = (u: number, v: number, along: boolean) => {
      const [a, b] = [[u, v], [v, -u], [-u, -v], [-v, u]][turn]!;
      const q = (turn % 2 === 0) === along ? 1 : 0;
      for (let y = 0; y < 2; y++) w.world.structs.add(wall, cx + a!, w.world.hf.heightAt(cx + a!, cz + b!) + 1.5 + 3 * y, cz + b!, q * 16384, 0, 10000);
    };
    for (let u = -7.5; u <= 7.5; u += 3) put(u, -6, false);
    for (let v = -4.5; v <= 7.5; v += 3) {
      put(-9, v, true);
      put(9, v, true);
    }
  }
  w.host.decide.set(policy);
  // Every mover with a player close by, or every one in the background.
  if (near) w.host.creatures.mind.close?.fill(1);
  const kinds = ["core:raptor", "core:parasaur", "core:dodo"], courses = w.host.courses, ents = w.world.ents;
  const objective = (e: number): Objective => ({
    choices: Array.from({ length: 3 }, () => {
      const a = rng.float() * 2 * Math.PI, d = rng.range(8, 40);
      const x = Math.max(8, Math.min(248, ents.x[e]! + Math.sin(a) * d)), z = Math.max(8, Math.min(248, ents.z[e]! + Math.cos(a) * d));
      return { place: { x, z, radius: 1.5, kind: 0, priority: 1 + rng.int(3), pull: 0 }, detour: false };
    }),
  });
  const all: number[] = [];
  for (let n = 0; n < movers * 3 && all.length < movers; n++) {
    const e = w.host.spawnCreature(kinds[n % 3]!, rng.range(10, 246), rng.range(10, 246), 1);
    if (e >= 0) all.push(e);
  }
  const again = (e: number): void => void courses.aim(e, objective(e), { ended: () => again(e) });
  for (const e of all) again(e);
  const d = w.host.decide, step = d.step.bind(d), cstep = courses.step.bind(courses);
  const decideUs: number[] = [], coursesUs: number[] = [];
  let measure = false;
  d.step = (tick) => {
    const from = performance.now();
    step(tick);
    if (measure) decideUs.push((performance.now() - from) * 1000);
  };
  courses.step = (tick) => {
    const from = performance.now();
    cstep(tick);
    if (measure) coursesUs.push((performance.now() - from) * 1000);
  };
  for (let t = 0; t < 20 * TICK_RATE; t++) w.tick();
  const before = d.report().points.map((p) => ({ ...p.counts }));
  measure = true;
  for (let t = 0; t < seconds * TICK_RATE; t++) w.tick();
  const counts = d.report().points.map((p, i) => ({ name: p.name, answered: p.counts.answered - before[i]!.answered, cut: p.counts.cut - before[i]!.cut }));
  const ticks = seconds * TICK_RATE, f = (v: number) => v.toFixed(1);
  const of = (name: string) => counts.find((c) => c.name === name)!;
  const line = `${policy || "today"}, ${near ? "a player near each" : "all in the background"}: ${all.length} movers; decider row median ${f(pct(decideUs, 0.5))} µs, 99th ${f(pct(decideUs, 0.99))}; courses row median ${f(pct(coursesUs, 0.5))} µs, 99th ${f(pct(coursesUs, 0.99))}, most ${f(Math.max(...coursesUs))}; nav.pick ${f(of("nav.pick").answered / ticks)} a tick (cut ${of("nav.pick").cut}), nav.reach ${f(of("nav.reach").answered / ticks)} a tick; legs given up ${courses.gaveUp}, objectives done ${courses.finished}`;
  w.host.shutdown();
  return line;
}

if (import.meta.main) {
  const movers = arg("--movers", 500), seconds = arg("--seconds", 60), seed = arg("--seed", 1);
  for (const near of [false, true]) for (const policy of ["", "nav.pick=rule,nav.reach=rule"]) console.log(bench(policy, movers, seconds, seed, near));
}
