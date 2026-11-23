import { expect, test } from "bun:test";
import { LANE_RESERVE_MS, LANE_ROW, LANE_ROWS, LANE_TARGET_MS, Lane } from "../../server/lane.ts";
import { Harness } from "../fixtures/net.ts";

/** A lane on a clock the test moves. */
function clocked(): { lane: Lane; at: { ms: number } } {
  const at = { ms: 0 };
  return { lane: new Lane(() => at.ms), at };
}

test("a quiet tick leaves the target less the reserve to the work that can wait", () => {
  const { lane, at } = clocked();
  lane.begin();
  expect(lane.room()).toBe(LANE_TARGET_MS - LANE_RESERVE_MS);
  at.ms = 4;
  expect(lane.room()).toBe(LANE_TARGET_MS - LANE_RESERVE_MS - 4);
  expect(lane.may()).toBe(true);
});

test("physics already spent this tick is not counted twice", () => {
  const { lane, at } = clocked();
  lane.begin();
  lane.enter(LANE_ROW.players);
  at.ms = 5;
  lane.leave();
  // 5 ms gone, all of it physics: 1 ms of the reserve still owed.
  expect(lane.room()).toBe(LANE_TARGET_MS - 5 - (LANE_RESERVE_MS - 5));
});

test("a long run of physics keeps its time for some ticks after", () => {
  const { lane, at } = clocked();
  lane.begin();
  lane.enter(LANE_ROW.creatures);
  at.ms = 14;
  lane.leave();
  at.ms = 15;
  lane.begin();
  // The last tick's 14 ms is owed again before anything that can wait.
  expect(lane.room()).toBe(LANE_TARGET_MS - 14);
  expect(lane.worst).toBe(14);
  // It falls back over seconds, not at once.
  for (let i = 0; i < 30; i++) lane.begin();
  expect(lane.peak).toBeGreaterThan(7);
  expect(lane.peak).toBeLessThan(14);
});

test("work that can wait gives way once the tick is full, counted once a tick", () => {
  const { lane, at } = clocked();
  lane.begin();
  at.ms = LANE_TARGET_MS - LANE_RESERVE_MS;
  expect(lane.may()).toBe(false);
  expect(lane.may()).toBe(false);
  expect(lane.yielded).toBe(1);
  lane.begin();
  expect(lane.may()).toBe(true);
});

test("nested physics counts once, to the outer row", () => {
  const { lane, at } = clocked();
  lane.begin();
  lane.enter(LANE_ROW.loose);
  at.ms = 2;
  lane.enter(LANE_ROW.falls);
  at.ms = 3;
  lane.leave();
  lane.leave();
  expect(lane.physicsMs).toBe(3);
  expect(lane.rowMs[LANE_ROW.loose]).toBe(3);
  expect(lane.rowMs[LANE_ROW.falls]).toBe(0);
});

test("each row keeps its last tick, its most lately and its most since the start", () => {
  const { lane, at } = clocked();
  lane.begin();
  lane.enter(LANE_ROW.falls);
  at.ms = 4;
  lane.leave();
  lane.enter(LANE_ROW.contacts);
  at.ms = 5;
  lane.leave();
  lane.enter(LANE_ROW.falls);
  at.ms = 7;
  lane.leave();
  expect(lane.physicsMs).toBe(7);
  lane.begin();
  expect([lane.rowLast[LANE_ROW.falls], lane.rowLast[LANE_ROW.contacts], lane.rowLast[LANE_ROW.players]]).toEqual([6, 1, 0]);
  // A quiet second after: the last is nothing, the most lately falls back as the lane's does, the worst stays.
  for (let i = 0; i < 30; i++) lane.begin();
  expect(lane.rowLast[LANE_ROW.falls]).toBe(0);
  expect(lane.rowPeak[LANE_ROW.falls]).toBeGreaterThan(3);
  expect(lane.rowPeak[LANE_ROW.falls]).toBeLessThan(6);
  expect(lane.rowPeak[LANE_ROW.falls]! / 6).toBeCloseTo(lane.peak / 7, 9);
  expect(lane.rowWorst[LANE_ROW.falls]).toBe(6);
  const report = lane.report();
  expect(report.rows).toEqual([...LANE_ROWS]);
  expect(report.worst[LANE_ROW.falls]).toBe(6);
  expect(report.worst[LANE_ROW.contacts]).toBe(1);
});

test("a host's tick keeps each physics system's time in its own row", () => {
  const h = new Harness();
  try {
    const a = h.join("ada");
    h.run(500);
    // A clock that moves a millisecond each read: every row entered in a tick is given time.
    let ms = 0;
    h.server.lane.setClock(() => ++ms);
    h.server.tick();
    const lane = h.server.lane;
    for (const row of ["players", "creatures", "loose", "contacts", "corpses", "falls", "react"] as const) expect(lane.rowMs[LANE_ROW[row]]).toBeGreaterThan(0);
    let sum = 0;
    for (const v of lane.rowMs) sum += v;
    expect(sum).toBe(lane.physicsMs);
    expect(h.ent(a)).toBeGreaterThanOrEqual(0);
  } finally {
    h.host.shutdown();
  }
});
