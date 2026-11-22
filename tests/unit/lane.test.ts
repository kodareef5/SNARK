import { expect, test } from "bun:test";
import { LANE_RESERVE_MS, LANE_TARGET_MS, Lane } from "../../server/lane.ts";

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
  lane.enter();
  at.ms = 5;
  lane.leave();
  // 5 ms gone, all of it physics: 1 ms of the reserve still owed.
  expect(lane.room()).toBe(LANE_TARGET_MS - 5 - (LANE_RESERVE_MS - 5));
});

test("a long run of physics keeps its time for some ticks after", () => {
  const { lane, at } = clocked();
  lane.begin();
  lane.enter();
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

test("nested physics counts once", () => {
  const { lane, at } = clocked();
  lane.begin();
  lane.enter();
  at.ms = 2;
  lane.enter();
  at.ms = 3;
  lane.leave();
  lane.leave();
  expect(lane.physicsMs).toBe(3);
});
