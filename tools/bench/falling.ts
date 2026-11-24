// A whole server tick while the bench's house falls, with no fight round it: 40 watchers and a database, and where the
// tick went. The collapse section of tools/bench.ts runs in a fight whose own ticks are many times the fall's, and once,
// cold; here the house falls three times in one process and the third is told. `bun tools/bench/falling.ts` runs it alone;
// `bun run bench` does not. BOXES=1 sets a full storage box and a fire on every top floor.

import { mkdirSync, rmSync } from "node:fs";
import { join as joinPath, resolve } from "node:path";
import { PART } from "../../server/admin/parts.ts";
import { FALL_MOST } from "../../server/build.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { flatGround } from "../../tests/fixtures/arena.ts";
import { Harness } from "../../tests/fixtures/net.ts";
import { join, start } from "../../tests/fixtures/slots.ts";

type Section = (title: string) => void;
type Row = (name: string, value: number, unit: string, budget?: number | null) => void;

const WATCHERS = 40;
const OWNER = 9000;
const median = (v: number[]): number => [...v].sort((a, b) => a - b)[v.length >> 1] ?? 0;
const most = (v: number[]): number => v.reduce((a, b) => Math.max(a, b), 0);
const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);

/** One tick: its time, its parts, the time inside each timed call, and the pieces it removed. */
interface Tick {
  ms: number;
  parts: number[];
  in: Record<string, number>;
  removed: number;
}

export function fallingRows(section: Section, record: Row): void {
  const dir = resolve(`var/bench-falling-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const h = new Harness({ maxClients: 128 }, 1, 30, { dev: true, dbPath: joinPath(dir, "world.db"), commitEvery: 6 });
  const { reg, world } = h;
  const structs = world.structs;
  const build = h.host.build;
  const sessions = Array.from({ length: WATCHERS }, (_, i) => h.join(`w${i}`));
  h.run(600);
  const g = flatGround(h, 44, 44);
  sessions.forEach((s, i) => world.ents.setPosition(h.ent(s), g.x + 1 + (i % 20) * 2, g.y, g.z + 1 + Math.floor(i / 20) * 1.5));
  const piece = (name: string): number => reg.index.get(`core:${name}_stone`)!;
  const add = (name: string, target: number, k: number): number => {
    const ref = join(world, target, piece(name), k, 0, 10000);
    if (ref < 0) throw new Error(`no place for a ${name}`);
    return ref;
  };

  // Time spent inside a call, by name, since the tick began.
  const spent: Record<string, number> = {};
  const time = (of: object, name: string, as: string): void => {
    const o = of as Record<string, (...a: unknown[]) => unknown>;
    const f = o[name]!;
    o[name] = function (this: unknown, ...a: unknown[]) {
      const t = performance.now();
      try {
        return f.apply(this, a);
      } finally {
        spent[as] = (spent[as] ?? 0) + performance.now() - t;
      }
    };
  };
  time(build.collapse, "step", "collapse");
  time(structs, "removeMany", "remove");
  time(h.host.persistence!, "commit", "commit");
  const parts = h.server.parts as unknown as { ms: Float64Array; end(tick: number): void };
  const end = parts.end.bind(parts);
  let last: number[] = [];
  parts.end = (tick) => {
    last = Array.from(parts.ms);
    end(tick);
  };
  const log: Tick[] = [];
  const tick = h.server.tick.bind(h.server);
  h.server.tick = () => {
    for (const k in spent) spent[k] = 0;
    const had = structs.count;
    const t = performance.now();
    tick();
    log.push({ ms: performance.now() - t, parts: last, in: { ...spent }, removed: had - structs.count });
  };

  let pieces = 0, chunks = 0, fallen = 0, bytes = 0, idle: Tick[] = [], fall: Tick[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const ground: number[][] = [];
    const before = structs.count;
    for (let i = 0; i < 12; i++) {
      ground.push([]);
      for (let j = 0; j < 12; j++) ground[i]!.push(i === 0 && j === 0 ? start(world, piece("foundation"), g.x + 6, g.y + 0.1875, g.z + 7, 0, OWNER, 15000) : j === 0 ? add("foundation", ground[i - 1]![0]!, 1) : add("foundation", ground[i]![j - 1]!, 0));
    }
    let tiles = ground;
    for (let storey = 0; storey < 3; storey++) {
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
    if (process.env.BOXES === "1") {
      const [box, fire, wood] = [reg.index.get("core:storage_box")!, reg.index.get("core:campfire")!, reg.index.get("core:wood")!];
      for (const ref of tiles.flat()) {
        const t = structs.chunks[Math.floor(ref / 65536)]!, s = ref & 0xffff;
        const top = t.y[s]! + reg.halfY[t.kind[s]!]!;
        h.host.items.mint(h.host.fixtures.ensure(structs.add(box, t.x[s]! - 0.6, top + reg.halfY[box]!, t.z[s]!, 0, OWNER, 500)), wood, 50);
        structs.add(fire, t.x[s]! + 0.7, top + reg.halfY[fire]!, t.z[s]!, 0, OWNER, 500);
      }
    }
    pieces = structs.count - before;
    const held = structs.chunks.map((t, c) => (t && t.owner.subarray(0, t.high).includes(OWNER) ? c : -1)).filter((c) => c >= 0);
    chunks = held.length;
    for (let k = 0; k < 200 && !h.server.clients.every((c) => !c?.active || held.every((ch) => c.known[ch] === structs.chunks[ch]!.version)); k++) h.run(100);
    h.run(1000);
    log.length = 0;
    h.run(3000);
    idle = log.splice(0);
    const [sent, fell] = [h.server.stats.chunkBytes, build.fallen];
    for (const ref of ground.flat()) structs.damage(ref, 1e9, world.tick);
    while (build.collapse.busy && log.length < 3000) h.run(1000 / TICK_RATE);
    fall = log.splice(0);
    h.run(1500);
    fallen = build.fallen - fell;
    bytes = (h.server.stats.chunkBytes - sent) / WATCHERS;
  }

  section(`A falling tick by itself: the house of ${pieces}${process.env.BOXES === "1" ? ", boxes and fires and all" : ""}, ${WATCHERS} watching, saved every 6 ticks`);
  record("chunks the house lies in", chunks, "");
  record("pieces that fell", fallen, "");
  const at = fall.map((t, k) => (t.removed > 0 ? k : -1)).filter((k) => k >= 0);
  record("removals", at.length, "");
  record("ticks from the first piece to the last", at[at.length - 1]! - at[0]! + 1, "", 45);
  record("most pieces removed in a tick", most(fall.map((t) => t.removed)), "", FALL_MOST);
  const calm = median(idle.map((t) => t.ms));
  record("whole tick with nothing happening, median", calm, "ms");
  record("whole tick while it fell, median", median(fall.map((t) => t.ms)), "ms");
  record("whole tick while it fell, worst", most(fall.map((t) => t.ms)), "ms", 16);
  record("collapse work in a tick, worst", most(fall.map((t) => t.in.collapse ?? 0)), "ms", 3);
  // What the fall added in all, and where: each part's time over its median with nothing happening.
  const over = (get: (t: Tick) => number): number => sum(fall.map(get)) - median(idle.map(get)) * fall.length;
  const judging = over((t) => (t.in.collapse ?? 0) - (t.in.remove ?? 0));
  const removing = over((t) => t.in.remove ?? 0);
  const telling = over((t) => t.parts[PART.chunks]! + t.parts[PART.own]! + t.parts[PART.snapshot]!);
  const saving = over((t) => t.parts[PART.save]!);
  const whole = over((t) => t.ms);
  record("added to the ticks in all", whole, "ms");
  record("  of that, judging", judging, "ms");
  record("  removing: the store, cells, frames, claims, fixtures", removing, "ms");
  record("  telling the watchers", telling, "ms");
  record("  saving the chunks", saving, "ms");
  record("  the rest", whole - judging - removing - telling - saving, "ms");
  record("a piece removed, by itself", (removing / fallen) * 1000, "us");
  record("a piece fallen, in all", (whole / fallen) * 1000, "us");
  record("sent to each watcher for all of it", bytes, "bytes", pieces * 2);
  h.host.shutdown();
  rmSync(dir, { recursive: true, force: true });
}

if (import.meta.main) {
  console.log(`load ${(await Bun.file("/proc/loadavg").text().catch(() => "unknown")).trim()}`);
  fallingRows((title) => console.log(`\n${title}`), (name, value, unit, budget = null) => {
    const verdict = budget === null ? "" : value <= budget ? `  ok (budget ${budget})` : `  MISS (budget ${budget})`;
    console.log(`  ${name.padEnd(58)} ${value.toFixed(value < 10 ? 3 : 1).padStart(12)} ${unit}${verdict}`);
  });
  process.exit(0);
}
