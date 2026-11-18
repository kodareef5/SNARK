// What the survivor log costs. On the tick thread: what its step adds to a tick with 50 and with 200 survivors moving and
// changing what they hold, the store on its worker thread as a running server has it. Then each read against a store of
// 200 survivors over the hours asked for, at the widest window each read takes. A read of places costs by its steps
// (store.ts MAX_STEPS) and the survivors in them, not by how much the folder holds, so hours of 200 stand for a full cap.
//
//   bun tools/bench/survivor-log.ts [hours]      4 hours of 200 survivors for the reads unless given

import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { CORE_CONTENT } from "../../content/core.ts";
import type { Client } from "../../server/game.ts";
import { createHost } from "../../server/host.ts";
import { STATE_ALIVE, itemKey, stateOf } from "../../server/survivor-log/format.ts";
import { LogRecorder } from "../../server/survivor-log/recorder.ts";
import { LogStore } from "../../server/survivor-log/store.ts";
import { compileContent } from "../../shared/content/registry.ts";
import { TICK_RATE } from "../../shared/coords.ts";
import { SESSION_ALIVE } from "../../shared/net/protocol.ts";

const reg = compileContent(CORE_CONTENT).registry!;
const STONE = reg.index.get("core:stone")!;
const METAL = reg.index.get("core:metal_ingot") ?? STONE;
const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
const load = (): string => `load ${loadavg()[0]!.toFixed(1)} on ${cpus().length} cores`;

/** Milliseconds the log's step took in each of two minutes of ticks, `n` survivors walking and each given something once a minute. */
function stepTimes(n: number): number[] {
  const dir = mkdtempSync(join(tmpdir(), "snark-survivor-log-bench-"));
  try {
    const host = createHost(reg, { dbPath: join(dir, "world.db"), survivorLog: { mode: "worker" }, game: { maxClients: n + 8 } });
    const ents = host.world.ents;
    const at = host.world.spawn;
    const bodies: number[] = [];
    for (let i = 0; i < n; i++) {
      const e = host.spawnCreature("core:survivor", at.x + (i % 20) * 3, at.z + Math.floor(i / 20) * 3, 1);
      if (e < 0) throw new Error("no room for a survivor's body");
      // What the log reads of a session: its survivor, its body and its state.
      host.survivorLog.enter({ pid: ents.pid[e]!, name: `s${i}`, state: SESSION_ALIVE, ent: e, closed: false, body: { x: 0, y: 0, z: 0 } } as unknown as Client);
      bodies.push(e);
    }
    const log = host.survivorLog;
    const step = log.step.bind(log);
    const times: number[] = [];
    log.step = (tick) => {
      const t = performance.now();
      step(tick);
      times.push(performance.now() - t);
    };
    for (let k = 0; k < 120 * TICK_RATE; k++) {
      bodies.forEach((e, i) => {
        ents.setPosition(e, ents.x[e]! + Math.sin(k / 40 + i) * 0.15, ents.y[e]!, ents.z[e]! + Math.cos(k / 50 + i) * 0.15);
        if ((k + i * 53) % (60 * TICK_RATE) === 0) host.items.mint(host.records.byPid.get(ents.pid[e]!)!, STONE, 1 + (i % 5), 0, 0, -1, "given");
      });
      host.game.tick();
    }
    host.shutdown();
    return times;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const n of [50, 200]) {
  const times = stepTimes(n).sort((a, b) => a - b);
  const mean = times.reduce((s, v) => s + v, 0) / times.length;
  console.log(`tick cost of the log, ${n} survivors: mean ${(mean * 1000).toFixed(1)} µs, median ${(pct(times, 0.5) * 1000).toFixed(1)} µs, 99th ${(pct(times, 0.99) * 1000).toFixed(1)} µs, worst ${(times.at(-1)! * 1000).toFixed(1)} µs (${load()})`);
}

// A store of 200 survivors, written as the recorder writes it, then each read at its widest.
const hours = Number(process.argv[2] ?? 4);
const dir = mkdtempSync(join(tmpdir(), "snark-survivor-log-bench-"));
try {
  const W0 = Date.UTC(2026, 10, 18);
  const wall = (t: number): number => W0 + Math.round((t * 1000) / TICK_RATE);
  const store = new LogStore(dir, 1024 << 20, { saveId: "bench", mapId: "bench", world: 1, opAdmin: 2, opDeath: 3, causes: [] });
  const rec = new LogRecorder(reg.ids, wall(0), 0);
  const n = 200;
  const end = hours * 3600 * TICK_RATE;
  const t0 = performance.now();
  for (let t = 0; t <= end; t++) {
    for (let i = 0; i < n; i++) {
      if (t === 0) rec.enter(1000 + i, `s${i}`, i + 1, "", new Map([[itemKey(STONE, 0, false), 1]]), wall(0), 0);
      if ((t + i) % TICK_RATE === 0) rec.sample(1000 + i, t, Math.sin(t / 900 + i) * 2000, 10, Math.cos(t / 700 + i) * 2000, stateOf(STATE_ALIVE, -1));
      if ((t + i * 61) % (60 * TICK_RATE) === 0 && t > 0) rec.held(1000 + i, new Map([[itemKey(STONE, 0, false), 1 + ((t / TICK_RATE + i) % 400)], [itemKey(METAL, 0, false), 1 + (i % 9)]]), wall(t), t);
    }
    if (t > 0 && t % 150 === 0) store.write(rec.flush(wall(t), t));
  }
  const bytes = readdirSync(dir).reduce((s, f) => s + statSync(join(dir, f)).size, 0);
  console.log(`store: ${hours} h of ${n} survivors, ${(bytes / (1 << 20)).toFixed(1)} MB in ${store.span().segments} segments, written in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const from = wall(0);
  const to = wall(end);
  const time = (name: string, read: () => unknown): void => {
    const runs: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t = performance.now();
      read();
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    console.log(`${name}: median ${pct(runs, 0.5).toFixed(1)} ms, worst ${runs.at(-1)!.toFixed(1)} ms (${load()})`);
  };
  time("span", () => store.span());
  time("survivors over the whole span", () => store.survivors(from, to));
  time("positions over the whole span at the most steps", () => store.positions(from, to, 1000));
  time("positions at one moment", () => store.positions(from + 1_000_000, from + 1_000_000, 1000));
  time("one track over the whole span at the most steps", () => store.track(1100, from, to, 1000));
  time("what one held at a moment", () => store.heldAt(1100, to - 1000));
  time("what one gained and lost over the whole span", () => store.changes(1100, from, to));
  time("who held an item over the whole span", () => store.holders("core:stone", from, to));
  time("every item held over the whole span", () => store.items(from, to));
  time("tick to wall and back", () => store.tickAt(store.wallAt(end / 2)!));
  store.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
