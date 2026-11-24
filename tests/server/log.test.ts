// The server's log (server/log.ts): a ring of its latest lines, and the console teed into it, still printing as before.

import { expect, mock, test } from "bun:test";
import { LINE_CHARS, ServerLog, teeConsole } from "../../server/log.ts";
import { LEVEL_DEBUG, LEVEL_ERROR, LEVEL_INFO, LEVEL_WARN } from "../../shared/debug.ts";

const METHODS = ["debug", "log", "info", "warn", "error"] as const;

/** Runs `fn` with each console method a spy, then puts the console back as it was. */
function spied(fn: (spies: Record<(typeof METHODS)[number], ReturnType<typeof mock>>) => void): void {
  const was = METHODS.map((m) => console[m]);
  const spies = Object.fromEntries(METHODS.map((m) => [m, mock(() => {})])) as Record<(typeof METHODS)[number], ReturnType<typeof mock>>;
  for (const m of METHODS) console[m] = spies[m];
  try {
    fn(spies);
  } finally {
    METHODS.forEach((m, i) => (console[m] = was[i]!));
  }
}

test("the log keeps its last lines, numbered from 1, with the tick and the time", () => {
  const log = new ServerLog(3);
  let tick = 0;
  log.tick = () => tick;
  expect([log.last, log.since(0)]).toEqual([0, []]);
  const before = Date.now();
  for (let n = 1; n <= 5; n++, tick += 10) log.add(LEVEL_INFO, `line ${n}`);
  expect(log.last).toBe(5);
  const kept = log.since(0);
  expect(kept.map((l) => [l.seq, l.tick, l.level, l.text])).toEqual([[3, 20, LEVEL_INFO, "line 3"], [4, 30, LEVEL_INFO, "line 4"], [5, 40, LEVEL_INFO, "line 5"]]);
  expect(kept.every((l) => l.at >= before && l.at <= Date.now())).toBe(true);
  log.add(LEVEL_WARN, "x".repeat(10_000));
  const long = log.since(5)[0]!.text;
  expect([long.length, long.endsWith("…")]).toEqual([LINE_CHARS, true]);
});

test("since gives only the lines after the number asked", () => {
  const log = new ServerLog();
  for (let n = 1; n <= 4; n++) log.add(LEVEL_INFO, `line ${n}`);
  expect(log.since(2).map((l) => l.seq)).toEqual([3, 4]);
  expect(log.since(4)).toEqual([]);
  expect(log.since(9)).toEqual([]);
  expect(log.since(-1).length).toBe(4);
  log.add(LEVEL_ERROR, "line 5");
  expect(log.since(4).map((l) => l.text)).toEqual(["line 5"]);
});

test("the tee keeps each console line at its level and still prints it", () => {
  spied((spies) => {
    const log = new ServerLog();
    const untee = teeConsole(log);
    try {
      console.debug("d %d", 1);
      console.log("l", { a: 1 });
      console.info("i");
      console.warn("w");
      console.error("e %s", "boom");
      expect(spies.debug.mock.calls).toEqual([["d %d", 1]]);
      expect(spies.log.mock.calls).toEqual([["l", { a: 1 }]]);
      expect([spies.info, spies.warn, spies.error].map((s) => s.mock.calls.length)).toEqual([1, 1, 1]);
      expect(log.since(0).map((l) => [l.level, l.text])).toEqual([[LEVEL_DEBUG, "d 1"], [LEVEL_INFO, "l { a: 1 }"], [LEVEL_INFO, "i"], [LEVEL_WARN, "w"], [LEVEL_ERROR, "e boom"]]);
      untee();
      console.log("after");
      expect([spies.log.mock.calls.length, log.last]).toEqual([2, 5]);
    } finally {
      untee();
    }
  });
});

test("teeing twice wraps once and points the console at the second log", () => {
  spied((spies) => {
    const first = new ServerLog(), second = new ServerLog();
    const unteeFirst = teeConsole(first);
    const wrapped = console.log;
    const unteeSecond = teeConsole(second);
    try {
      expect(console.log).toBe(wrapped);
      console.log("once");
      expect(spies.log.mock.calls).toEqual([["once"]]);
      expect([first.last, second.since(0).map((l) => l.text)]).toEqual([0, ["once"]]);
      // Stopping the first leaves the second fed.
      unteeFirst();
      console.log("twice");
      expect(second.last).toBe(2);
    } finally {
      unteeSecond();
    }
  });
});

test("a log that throws does not break the console", () => {
  class Full extends ServerLog {
    override add(): void {
      throw new Error("full");
    }
  }
  spied((spies) => {
    const untee = teeConsole(new Full());
    try {
      expect(() => console.log("still printed")).not.toThrow();
      expect(() => console.error(new Error("and this"))).not.toThrow();
      expect([spies.log.mock.calls, spies.error.mock.calls.length]).toEqual([[["still printed"]], 1]);
    } finally {
      untee();
    }
  });
});

test("a console method that throws keeps its line and throws as before", () => {
  spied(() => {
    console.warn = () => {
      throw new Error("stdout is gone");
    };
    const log = new ServerLog();
    const untee = teeConsole(log);
    try {
      expect(() => console.warn("lost?")).toThrow("stdout is gone");
      expect(log.since(0).map((l) => l.text)).toEqual(["lost?"]);
    } finally {
      untee();
    }
  });
});
