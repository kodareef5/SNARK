// The survivor log's recorder and store without a server: what goes in reads back at the moments asked, the oldest
// segments go at the cap and the rest still reads, a restart and a crash carry on, and what an hour costs on disk.

import { afterAll, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TICK_RATE } from "../../shared/coords.ts";
import { Inventory } from "../../shared/sim/items.ts";
import { STATE_ALIVE, STATE_DEAD, aggregate, itemKey, stateOf } from "../../server/survivor-log/format.ts";
import { LogRecorder } from "../../server/survivor-log/recorder.ts";
import { LogStore, MAX_STEPS, type LogWorld } from "../../server/survivor-log/store.ts";

const IDS = ["", "core:survivor", "core:stone", "core:rifle", "core:helicopter", "core:metal_ingot", "core:round"];
const STONE = 2;
const RIFLE = 3;
const HELI = 4;
const METAL = 5;
const WORLD: LogWorld = { saveId: "save-a", mapId: "flat", world: 1, opAdmin: 2, opDeath: 3, causes: ["", "starved"] };
const W0 = Date.UTC(2026, 10, 18, 9, 0, 0);
const wallOf = (tick: number, from = W0, at = 0): number => from + Math.round(((tick - at) * 1000) / TICK_RATE);
const MB = 1 << 20;

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
function folder(): string {
  const root = mkdtempSync(join(tmpdir(), "snark-survivor-log-"));
  roots.push(root);
  return join(root, "world.db.survivor-log");
}

const held = (...pairs: number[]): Map<number, number> => {
  const m = new Map<number, number>();
  for (let i = 0; i < pairs.length; i += 2) m.set(pairs[i]!, pairs[i + 1]!);
  return m;
};

/** Runs ticks from `from` to `to`, flushing every five seconds as the host does, with `each` called every tick. */
function run(rec: LogRecorder, store: LogStore, from: number, to: number, each: (tick: number) => void, wall = (t: number) => wallOf(t)): void {
  for (let t = from; t <= to; t++) {
    each(t);
    if (t > from && t % 150 === 0) store.write(rec.flush(wall(t), t));
  }
}

test("positions, sessions and what was held read back at the moments asked", () => {
  const store = new LogStore(folder(), 64 * MB, WORLD);
  const rec = new LogRecorder(IDS, wallOf(0), 0);
  const ana = 101;
  const ben = 202;
  run(rec, store, 0, 900, (t) => {
    if (t === 0) rec.enter(ana, "ana", 7, "", held(itemKey(STONE, 0, false), 5), wallOf(t), t);
    if (t === 150) rec.enter(ben, "ben", 9, "Pteros", held(), wallOf(t), t);
    // Five changes within two seconds, as the host's debounce would fold them: only the state at the end is noted.
    if (t === 300) rec.held(ana, held(itemKey(STONE, 0, false), 9, itemKey(RIFLE, 3, false), 1), wallOf(t), t);
    if (t % 30 === 0) rec.sample(ana, t, t / 30, 2, -3, stateOf(STATE_ALIVE, -1));
    if (t % 30 === 15 && t > 150 && t < 600) rec.sample(ben, t, 100 + t / 3, 40, 5, stateOf(STATE_ALIVE, HELI));
    if (t === 600) rec.leave(ben, "left", wallOf(t), t);
  });
  const at = store.positions(wallOf(450), wallOf(450), 1000);
  const a = at.tracks.find((tr) => tr.pid === ana)!;
  const b = at.tracks.find((tr) => tr.pid === ben)!;
  expect([a.x[0], a.y[0], a.z[0], a.tick[0], a.name]).toEqual([15, 2, -3, 450, "ana"]);
  expect([b.x[0], b.y[0], at.seats[b.seat[0]!], b.tick[0]]).toEqual([245, 40, "core:helicopter", 435]);
  // A day asked at a second's step is thinned to the most steps one read answers.
  expect(store.positions(wallOf(0), wallOf(0) + 86_400_000, 1000).step).toBe(Math.ceil(86_400_000 / (MAX_STEPS - 1)));
  const track = store.track(ana, wallOf(0), wallOf(900), 1000).tracks[0]!;
  expect(track.x).toEqual(Array.from({ length: 31 }, (_, i) => i));
  expect(track.wall[10]).toBe(wallOf(300));
  expect(store.track(ben, wallOf(700), wallOf(900), 1000).tracks).toEqual([]);

  expect(store.heldAt(ana, wallOf(200))!.items).toEqual([{ item: "core:stone", quality: 0, blueprint: false, count: 5 }]);
  expect(store.heldAt(ana, wallOf(400))!.items).toEqual([
    { item: "core:rifle", quality: 3, blueprint: false, count: 1 },
    { item: "core:stone", quality: 0, blueprint: false, count: 9 },
  ]);
  const ch = store.changes(ana, wallOf(100), wallOf(500));
  expect([ch.gained, ch.lost, ch.entries.length, ch.entries[0]!.wall]).toEqual([
    [
      { item: "core:rifle", quality: 3, blueprint: false, count: 1 },
      { item: "core:stone", quality: 0, blueprint: false, count: 4 },
    ],
    [],
    1,
    wallOf(300),
  ]);
  const rifles = store.holders("core:rifle", wallOf(0), wallOf(900));
  expect(rifles.map((h) => [h.pid, h.name, h.quality, h.from, h.to, h.most])).toEqual([[ana, "ana", 3, wallOf(300), null, 1]]);
  expect(store.holders("core:rifle", wallOf(0), wallOf(200))).toEqual([]);
  expect(store.items(wallOf(0), wallOf(900)).map((i) => [i.item, i.survivors, i.most])).toEqual([["core:rifle", 1, 1], ["core:stone", 1, 9]]);

  const who = store.survivors(wallOf(0), wallOf(900));
  const sa = who.find((s) => s.pid === ana)!;
  const sb = who.find((s) => s.pid === ben)!;
  expect([sa.sessions.length, sa.sessions[0]!.to, sa.sessions[0]!.why]).toEqual([1, null, ""]);
  expect([sb.sessions[0]!.from, sb.sessions[0]!.to, sb.sessions[0]!.why, sb.sessions[0]!.tribe, sb.playMs]).toEqual([wallOf(150), wallOf(600), "left", "Pteros", wallOf(600) - wallOf(150)]);
  expect(store.survivors(wallOf(300), wallOf(400)).find((s) => s.pid === ben)!.playMs).toBe(wallOf(400) - wallOf(300));
  // Offline, a survivor holds what it held when it left.
  const off = store.heldAt(ben, wallOf(800))!;
  expect([off.online, off.wall, off.items]).toEqual([false, wallOf(600), []]);
  expect(store.heldAt(303, wallOf(800))).toBeNull();

  expect(store.wallAt(450)).toBe(wallOf(450));
  expect(store.tickAt(wallOf(451))).toBe(451);
  store.close();
});

test("aggregating counts stacks, rounds in weapons and fitted attachments, by item, quality and blueprint", () => {
  const inv = new Inventory(25, 10);
  inv.set(0, STONE, 30, 0, 0, 0);
  inv.set(1, STONE, 20, 0, 0, 0);
  inv.set(2, RIFLE, 1, 3, 100, 0);
  inv.setGear(2, 6, 4, METAL);
  inv.set(3, RIFLE, 1, 3, 0, 0, 1);
  inv.set(12, RIFLE, 1, 0, 50, 0);
  const m = aggregate(inv);
  expect([...m].sort((a, b) => a[0] - b[0])).toEqual([
    [itemKey(STONE, 0, false), 50],
    [itemKey(RIFLE, 0, false), 1],
    [itemKey(RIFLE, 3, false), 1],
    [itemKey(RIFLE, 3, true), 1],
    [itemKey(METAL, 0, false), 1],
    [itemKey(6, 0, false), 4],
  ]);
  // Wear is no change.
  inv.setDur(2, 99);
  expect(aggregate(inv)).toEqual(m);
});

test("at the cap the oldest segments go, the cap holds, and any moment left still reads, the first just after the cut", () => {
  const dir = folder();
  const cap = 1 * MB;
  const store = new LogStore(dir, cap, WORLD);
  const rec = new LogRecorder(IDS, wallOf(0), 0);
  const n = 20;
  // What each survivor held after each change, to compare with what the log gives back.
  const truth = new Map<number, { wall: number; stone: number }[]>();
  let most = 0;
  const end = 30 * 60 * TICK_RATE;
  for (let t = 0; t <= end; t++) {
    for (let i = 0; i < n; i++) {
      const pid = 1000 + i;
      if (t === 0) {
        rec.enter(pid, `s${i}`, i + 1, "", held(itemKey(STONE, 0, false), 1), wallOf(t), t);
        truth.set(pid, [{ wall: wallOf(t), stone: 1 }]);
      }
      if ((t + i) % 30 === 0) rec.sample(pid, t, Math.sin(t / 900 + i) * 300, 10, Math.cos(t / 700 + i) * 300, stateOf(STATE_ALIVE, -1));
      if ((t + i * 37) % 450 === 0 && t > 0) {
        const stone = 1 + ((Math.floor(t / 450) + i) % 40);
        rec.held(pid, held(itemKey(STONE, 0, false), stone, itemKey(METAL, 0, false), i + 1), wallOf(t), t);
        truth.get(pid)!.push({ wall: wallOf(t), stone });
      }
    }
    if (t > 0 && t % 150 === 0) {
      store.write(rec.flush(wallOf(t), t));
      const files = readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
      most = Math.max(most, files);
      expect(store.span().bytes).toBeLessThanOrEqual(cap);
    }
  }
  const span = store.span();
  // What is on disk, the write-ahead log and all, never passed the cap.
  expect(most).toBeLessThanOrEqual(cap);
  expect(span.from!).toBeGreaterThan(wallOf(0));
  expect(span.segments).toBeGreaterThan(4);
  expect(store.positions(wallOf(0), wallOf(0), 1000).tracks).toEqual([]);
  for (const at of [span.from! + 1, span.from! + 60_000, span.to! - 1]) {
    for (const pid of [1000, 1007, 1019]) {
      const want = truth.get(pid)!.filter((c) => c.wall <= at).at(-1)!.stone;
      const got = store.heldAt(pid, at)!;
      expect([got.online, got.items.find((h) => h.item === "core:stone")!.count]).toEqual([true, want]);
    }
    expect(store.positions(at, at, 1000).tracks.length).toBe(n);
  }
  // A session cut by the oldest segment going still reads as one, begun before what the log holds.
  const s = store.survivors(span.from!, span.to!).find((x) => x.pid === 1003)!;
  expect([s.sessions.length, s.sessions[0]!.began, s.sessions[0]!.to]).toEqual([1, wallOf(0), null]);
  // Lowered while running, the cap drops the oldest at once.
  store.setCap(cap / 4);
  expect(store.span().bytes).toBeLessThanOrEqual(cap / 4);
  expect(store.heldAt(1000, store.span().from! + 1)!.online).toBe(true);
  store.close();
});

test("a restart carries on in a segment of its own, and both clocks read across the time the server was down", () => {
  const dir = folder();
  let store = new LogStore(dir, 64 * MB, WORLD);
  let rec = new LogRecorder(IDS, wallOf(0), 0);
  run(rec, store, 0, 600, (t) => {
    if (t === 0) rec.enter(1, "ana", 1, "", held(itemKey(STONE, 0, false), 3), wallOf(t), t);
    if (t % 30 === 0) rec.sample(1, t, t / 30, 0, 0, stateOf(STATE_ALIVE, -1));
    if (t === 600) rec.leave(1, "stopped", wallOf(t), t);
  });
  store.write(rec.flush(wallOf(600), 600));
  store.close();
  // An hour later the world goes on from the tick it was saved at.
  const back = wallOf(600) + 3_600_000;
  const later = (t: number) => wallOf(t, back, 600);
  store = new LogStore(dir, 64 * MB, WORLD);
  rec = new LogRecorder(IDS, later(600), 600);
  run(rec, store, 600, 1200, (t) => {
    if (t === 600) rec.enter(1, "ana", 1, "", held(itemKey(STONE, 0, false), 3), later(t), t);
    if (t % 30 === 0) rec.sample(1, t, 100 + t / 30, 0, 0, stateOf(STATE_ALIVE, -1));
  }, later);
  const span = store.span();
  expect([span.segments, span.from, span.fromTick, span.toTick]).toEqual([2, wallOf(0), 0, 1200]);
  const ana = store.survivors(wallOf(0), later(1200))[0]!;
  expect(ana.sessions.map((s) => [s.from, s.to, s.why])).toEqual([[wallOf(0), wallOf(600), "stopped"], [back, null, ""]]);
  expect(ana.playMs).toBe(wallOf(600) - wallOf(0) + later(1200) - back);
  // The world stood still while the server was down.
  expect(store.tickAt(wallOf(600) + 1_800_000)).toBe(600);
  expect(store.wallAt(900)).toBe(later(900));
  expect(store.wallAt(300)).toBe(wallOf(300));
  expect(store.positions(wallOf(600) + 1_800_000, wallOf(600) + 1_800_000, 1000).tracks).toEqual([]);
  expect(store.track(1, back, later(1200), 5000).tracks[0]!.x[0]).toBe(120);
  store.close();
});

test("a crash loses only what was not yet written, its sessions read as lost, and a run from an earlier tick owns the ticks again", () => {
  const dir = folder();
  const store = new LogStore(dir, 64 * MB, WORLD);
  const rec = new LogRecorder(IDS, wallOf(0), 0);
  run(rec, store, 0, 900, (t) => {
    if (t === 0) rec.enter(1, "ana", 1, "", held(itemKey(RIFLE, 0, false), 1), wallOf(t), t);
    if (t % 30 === 0) rec.sample(1, t, t / 30, 0, 0, stateOf(t > 800 ? STATE_DEAD : STATE_ALIVE, -1));
  });
  // The files as the process left them when it died: the segment still open, its write-ahead log beside it.
  const crashed = folder();
  mkdirSync(crashed, { recursive: true });
  for (const f of readdirSync(dir)) copyFileSync(join(dir, f), join(crashed, f));
  store.close();
  expect(readdirSync(crashed).some((f) => f.endsWith("-wal"))).toBe(true);
  // The save had committed tick 800 when it died, so the world starts again there, ten minutes later.
  const back = wallOf(900) + 600_000;
  const later = (t: number) => wallOf(t, back, 800);
  const again = new LogStore(crashed, 64 * MB, WORLD);
  expect(readdirSync(crashed).some((f) => f.endsWith("-wal"))).toBe(false);
  const rec2 = new LogRecorder(IDS, later(800), 800);
  run(rec2, again, 800, 1200, (t) => {
    if (t % 30 === 0 && t === 810) rec2.enter(1, "ana", 1, "", held(), later(t), t);
  }, later);
  const s = again.survivors(wallOf(0), later(1200))[0]!;
  expect(s.sessions[0]!.why).toBe("lost");
  expect(s.sessions[0]!.to).toBe(wallOf(900));
  // Tick 850 happened in both runs; the save's journal is the second run's, so the log answers with it.
  expect(again.wallAt(850)).toBe(later(850));
  expect(again.wallAt(700)).toBe(wallOf(700));
  expect(again.heldAt(1, wallOf(850))!.items.map((h) => h.item)).toEqual(["core:rifle"]);
  expect(again.track(1, wallOf(810), wallOf(900), 1000).tracks[0]!.state.at(-1)).toBe(STATE_DEAD);
  again.close();
});

test("a log beside another world's save is not mixed into this one's", () => {
  const dir = folder();
  const store = new LogStore(dir, 64 * MB, WORLD);
  const rec = new LogRecorder(IDS, wallOf(0), 0);
  run(rec, store, 0, 300, () => {});
  store.close();
  const said: string[] = [];
  const other = new LogStore(dir, 64 * MB, { ...WORLD, saveId: "save-b" }, (l) => said.push(l));
  expect([other.span().segments, said.length, readdirSync(dir).length]).toEqual([0, 1, 0]);
  other.close();
});

test("an hour of survivors on disk, per survivor, at the default cadence", () => {
  const dir = folder();
  const store = new LogStore(dir, 1024 * MB, WORLD);
  const rec = new LogRecorder(IDS, wallOf(0), 0);
  const n = 50;
  const hour = 3600 * TICK_RATE;
  const x = new Float64Array(n);
  const z = new Float64Array(n);
  const stone = new Float64Array(n).fill(1);
  let seed = 7;
  const rand = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let t = 0; t <= hour; t++) {
    for (let i = 0; i < n; i++) {
      if (t === 0) rec.enter(100 + i, `s${i}`, i + 1, "", held(itemKey(STONE, 0, false), 1, itemKey(RIFLE, 2, false), 1), wallOf(0), 0);
      // Walking at up to 5 m/s, a third of them standing at any time.
      if ((t + i) % 30 === 0) {
        if (i % 3 !== t % 3) {
          x[i]! += (rand() - 0.5) * 10;
          z[i]! += (rand() - 0.5) * 10;
        }
        rec.sample(100 + i, t, x[i]!, 4, z[i]!, stateOf(STATE_ALIVE, -1));
      }
      // About one change of what is held a minute, each a few stacks.
      if ((t + i * 61) % (60 * TICK_RATE) === 0 && t > 0) {
        stone[i] = stone[i]! + 1 + Math.floor(rand() * 20);
        rec.held(100 + i, held(itemKey(STONE, 0, false), stone[i]!, itemKey(RIFLE, 2, false), 1, itemKey(METAL, 0, false), Math.floor(rand() * 50) + 1), wallOf(t), t);
      }
    }
    if (t > 0 && t % 150 === 0) store.write(rec.flush(wallOf(t), t));
  }
  store.close();
  const bytes = readdirSync(dir).reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
  const perHour = bytes / n;
  const lasts = (survivors: number) => (1024 * MB) / (perHour * survivors);
  console.log(`survivor log: ${Math.round(perHour)} bytes per survivor-hour; 1 GB lasts ${Math.round(lasts(10) / 24)} days for 10, ${Math.round(lasts(50) / 24)} for 50, ${Math.round(lasts(200))} hours for 200`);
  // Hours is the floor and days the aim, for 200 survivors.
  expect(lasts(200)).toBeGreaterThan(48);
  expect(existsSync(dir)).toBe(true);
});
