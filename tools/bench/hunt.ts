// Rows for creatures that hunt round what is built: a chase in the open among a herd, which should cost what it did before
// paths, a pack with a wall between it and its prey, and five hundred hunters at once. `bun tools/bench/hunt.ts` runs these alone.

import { PATH_TICK_CELLS } from "../../server/behavior.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { Rng } from "../../shared/rng.ts";
import { flatGround } from "../../tests/fixtures/arena.ts";
import { Harness } from "../../tests/fixtures/net.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

/** A survivor kept alive on open level ground, with a wall of `pieces` 3 m pieces 6 m south of her. */
function scene(pieces: number) {
  const h = new Harness({}, 1, 60, { dev: true });
  const ada = h.join("ada");
  h.run(500);
  h.say(ada, "enablecheats");
  const g = flatGround(h, 100, 60);
  h.host.survival.gods.add(h.client(ada)!.pid);
  const [cx, wz] = [g.x + 50.3, g.z + 30.6];
  const wall = h.reg.index.get("core:wall_wood")!;
  for (let i = 0; i < pieces; i++) h.world.structs.add(wall, cx - 1.5 * pieces + 1.5 + 3 * i, g.y + 1.5, wz, 0, 0, 10000);
  h.say(ada, `tp ${cx.toFixed(3)} ${(wz + 6).toFixed(3)}`, 200);
  return { h, ada, g, cx, wz, her: h.ent(ada) };
}

/** Runs `seconds`, timing each server tick and noting the path cells it spent. */
function measure(h: Harness, seconds: number, each?: () => void): { ticks: number[]; cells: number[] } {
  const ticks: number[] = [];
  const cells: number[] = [];
  const server = h.server;
  const tick = server.tick.bind(server);
  server.tick = () => {
    const t = performance.now();
    tick();
    ticks.push(performance.now() - t);
    cells.push(h.host.creatures.mind.spent);
  };
  h.run(seconds * 1000, each);
  server.tick = tick;
  return { ticks, cells };
}

/** The `q` quantile of `times`. */
const at = (times: number[], q: number): number => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};

export function benchHunt(section: Section, record: Row): void {
  section("Hunting: a chase in the open among a herd, a pack round a wall, and five hundred hunters at once");
  {
    // 1,000 grazers wander about her, and ten raptors come at her across open ground from 15 to 20 m.
    const { h, cx, wz, her } = scene(0);
    const ents = h.world.ents;
    const rng = new Rng(5);
    for (let n = 0; n < 1000; ) if (h.host.spawnCreature("core:grazer", cx + rng.range(-50, 50), wz + rng.range(-25, 30), 1 + rng.int(30)) >= 0) n++;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const e = h.host.spawnCreature("core:raptor", cx + Math.sin(a) * (15 + i * 0.5), wz + 6 + Math.cos(a) * (15 + i * 0.5), 1);
      h.host.creatures.provoke(e, ents.x[her]!, ents.z[her]!, her);
    }
    const searches = h.host.creatures.mind.searches;
    const r = measure(h, 10);
    record("ten raptors chasing in the open among 1,000 grazers: tick time, median", at(r.ticks, 0.5), "ms", 8);
    record("in the open: tick time, 99th percentile", at(r.ticks, 0.99), "ms", 16);
    record("in the open: path searches", h.host.creatures.mind.searches - searches, "");
  }
  {
    // Twelve raptors 6 to 10 m south of a 24 m wall, and she is 6 m north of it.
    const { h, cx, wz, her } = scene(8);
    const ents = h.world.ents;
    const mind = h.host.creatures.mind;
    const pack: number[] = [];
    for (let i = 0; i < 12; i++) pack.push(h.host.spawnCreature("core:raptor", cx - 5 + (i % 6) * 2, wz - 6 - Math.floor(i / 6) * 4, 1));
    for (const e of pack) h.host.creatures.provoke(e, ents.x[her]!, ents.z[her]!, her);
    const bitten = new Set<number>();
    let last = -1;
    let ran = 0;
    const r = measure(h, 10, () => {
      ran++;
      for (const e of pack) {
        const near = Math.hypot(ents.x[e]! - ents.x[her]!, ents.z[e]! - ents.z[her]!) < 3;
        if (near && !bitten.has(e)) {
          bitten.add(e);
          if (bitten.size === pack.length) last = ran / 60;
        }
      }
    });
    // Timed while they go round, the first four seconds. After that they stand and bite.
    const round = r.ticks.slice(0, 4 * TICK_RATE);
    record("a pack of 12 behind a 24 m wall: tick time, median", at(round, 0.5), "ms", 8);
    record("the pack: tick time, 99th percentile", at(round, 0.99), "ms", 16);
    record("the pack: path searches", mind.searches, "");
    record("the pack: path cells in the busiest tick", Math.max(0, ...r.cells), "", PATH_TICK_CELLS);
    record("the pack: raptors at her within ten seconds, of 12", bitten.size, "");
    record("the pack: seconds until the last was at her", last, "s");
  }
  {
    // Five hundred raptors 25 abreast and 20 deep south of a 36 m wall.
    const { h, cx, wz, her } = scene(12);
    const ents = h.world.ents;
    const mind = h.host.creatures.mind;
    const pack: number[] = [];
    for (let i = 0; i < 500; i++) pack.push(h.host.spawnCreature("core:raptor", cx - 14.4 + (i % 25) * 1.2, wz - 4 - Math.floor(i / 25), 1));
    for (const e of pack) h.host.creatures.provoke(e, ents.x[her]!, ents.z[her]!, her);
    const r = measure(h, 10);
    record("500 at a 36 m wall: tick time, median", at(r.ticks, 0.5), "ms", 8);
    record("500: tick time, 99th percentile", at(r.ticks, 0.99), "ms", 16);
    record("500: path searches a second", mind.searches / 10, "");
    record("500: path cells in the busiest tick", Math.max(0, ...r.cells), "", PATH_TICK_CELLS);
    record("500: round the wall after ten seconds, of 500", pack.filter((e) => ents.z[e]! > wz).length, "");
  }
}

if (import.meta.main) {
  benchHunt(
    (title) => console.log(`\n${title}`),
    (name, value, unit, budget = null) => console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`}`),
  );
}
