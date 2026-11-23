// The debug bar's one log (client/core/debug/log.ts): repeats fold, the oldest line goes past the most kept, a read
// filters by source and level a page at a time, and errors are counted since the bar last looked.

import { expect, test } from "bun:test";
import { ALL_SOURCES, LOG_CHARS, LOG_MOST, LogRing, SOURCE_GAME, SOURCE_PAGE, SOURCE_SERVER, type LogLine } from "../../client/core/debug/log.ts";
import { LEVEL_DEBUG, LEVEL_ERROR, LEVEL_INFO, LEVEL_WARN } from "../../shared/debug.ts";

const texts = (lines: readonly LogLine[]): string[] => lines.map((l) => l.text);

test("a line equal to the one before it folds into it and raises its count", () => {
  const log = new LogRing();
  for (let i = 0; i < 3; i++) log.add(1000 + i, SOURCE_PAGE, LEVEL_ERROR, "the card was lost");
  log.add(1010, SOURCE_SERVER, LEVEL_INFO, "saved");
  log.add(1020, SOURCE_PAGE, LEVEL_ERROR, "the card was lost");
  // The same words at another level, or from another source, are another line.
  log.add(1030, SOURCE_PAGE, LEVEL_WARN, "the card was lost");
  log.add(1040, SOURCE_GAME, LEVEL_WARN, "the card was lost");
  const out: LogLine[] = [];
  expect(log.read(out, ALL_SOURCES, LEVEL_DEBUG, 10)).toBe(5);
  expect(out.map((l) => [l.text, l.count, l.at])).toEqual([["the card was lost", 3, 1000], ["saved", 1, 1010], ["the card was lost", 1, 1020], ["the card was lost", 1, 1030], ["the card was lost", 1, 1040]]);
});

test("past the most kept the oldest line goes, and repeats still fold", () => {
  const log = new LogRing();
  for (let i = 0; i < LOG_MOST + 150; i++) log.add(i, SOURCE_GAME, LEVEL_INFO, `line ${i}`, i * 2);
  expect(log.length).toBe(LOG_MOST);
  expect(log.line(0).text).toBe("line 150");
  expect(log.line(LOG_MOST - 1).text).toBe(`line ${LOG_MOST + 149}`);
  log.add(9e9, SOURCE_GAME, LEVEL_INFO, `line ${LOG_MOST + 149}`);
  expect([log.length, log.line(LOG_MOST - 1).count, log.line(LOG_MOST - 1).tick]).toEqual([LOG_MOST, 2, (LOG_MOST + 149) * 2]);
  // A small ring wraps the same way.
  const small = new LogRing(3);
  for (const t of ["a", "b", "c", "d", "d", "e"]) small.add(0, SOURCE_PAGE, LEVEL_INFO, t);
  const out: LogLine[] = [];
  small.read(out, ALL_SOURCES, LEVEL_DEBUG, 10);
  expect(out.map((l) => `${l.text}${l.count}`)).toEqual(["c1", "d2", "e1"]);
  // A line too long is cut.
  small.add(0, SOURCE_SERVER, LEVEL_INFO, "x".repeat(LOG_CHARS * 2));
  expect(small.line(2).text.length).toBe(LOG_CHARS);
});

test("a read keeps the asked sources at the least level or worse, newest last", () => {
  const log = new LogRing();
  const lines: [number, number, string][] = [
    [SOURCE_PAGE, LEVEL_DEBUG, "page debug"], [SOURCE_SERVER, LEVEL_ERROR, "server error 1"], [SOURCE_GAME, LEVEL_WARN, "game warn"],
    [SOURCE_PAGE, LEVEL_WARN, "page warn"], [SOURCE_SERVER, LEVEL_INFO, "server info"], [SOURCE_PAGE, LEVEL_ERROR, "page error"],
    [SOURCE_SERVER, LEVEL_ERROR, "server error 2"], [SOURCE_SERVER, LEVEL_WARN, "server warn"],
  ];
  lines.forEach(([source, level, text], i) => log.add(i, source, level, text, source === SOURCE_SERVER ? 100 + i : -1));
  const out: LogLine[] = [{ at: 0, source: 0, level: 0, text: "left from before", count: 1, tick: -1 }];
  const pageAndServer = (1 << SOURCE_PAGE) | (1 << SOURCE_SERVER);
  expect(log.read(out, pageAndServer, LEVEL_WARN, 10)).toBe(5);
  expect(texts(out)).toEqual(["server error 1", "page warn", "page error", "server error 2", "server warn"]);
  expect(out.map((l) => l.tick)).toEqual([101, -1, -1, 106, 107]);
  // A page of two, then the two before them.
  expect(log.read(out, pageAndServer, LEVEL_WARN, 2)).toBe(5);
  expect(texts(out)).toEqual(["server error 2", "server warn"]);
  log.read(out, pageAndServer, LEVEL_WARN, 2, 2);
  expect(texts(out)).toEqual(["page warn", "page error"]);
  log.read(out, pageAndServer, LEVEL_WARN, 2, 4);
  expect(texts(out)).toEqual(["server error 1"]);
  expect(log.read(out, 1 << SOURCE_GAME, LEVEL_ERROR, 10)).toBe(0);
  expect(out).toEqual([]);
  log.read(out, ALL_SOURCES, LEVEL_DEBUG, 100);
  expect(texts(out)).toEqual(lines.map((l) => l[2]));
});

test("errors and warnings are counted by source since the mark, repeats too", () => {
  const log = new LogRing(4);
  log.add(0, SOURCE_PAGE, LEVEL_ERROR, "a");
  log.add(1, SOURCE_SERVER, LEVEL_WARN, "b");
  expect([log.since(ALL_SOURCES, LEVEL_ERROR), log.since(ALL_SOURCES, LEVEL_WARN)]).toEqual([1, 1]);
  log.mark();
  expect([log.since(ALL_SOURCES, LEVEL_ERROR), log.since(ALL_SOURCES, LEVEL_WARN)]).toEqual([0, 0]);
  log.add(2, SOURCE_PAGE, LEVEL_ERROR, "c");
  log.add(3, SOURCE_PAGE, LEVEL_ERROR, "c");
  log.add(4, SOURCE_SERVER, LEVEL_ERROR, "d");
  log.add(5, SOURCE_GAME, LEVEL_WARN, "e");
  // Lines pushed out of the ring were still given since the mark.
  for (let i = 0; i < 6; i++) log.add(6 + i, SOURCE_GAME, LEVEL_INFO, `f${i}`);
  expect(log.since(ALL_SOURCES, LEVEL_ERROR)).toBe(3);
  expect([log.since(1 << SOURCE_PAGE, LEVEL_ERROR), log.since(1 << SOURCE_SERVER, LEVEL_ERROR), log.since(1 << SOURCE_GAME, LEVEL_ERROR)]).toEqual([2, 1, 0]);
  expect([log.since(1 << SOURCE_GAME, LEVEL_WARN), log.since(1 << SOURCE_SERVER, LEVEL_WARN)]).toEqual([1, 0]);
  expect(log.since(ALL_SOURCES, LEVEL_INFO)).toBe(6);
  // A level the server sends out of range counts as the nearest.
  log.add(20, SOURCE_SERVER, 9, "g");
  expect(log.since(1 << SOURCE_SERVER, LEVEL_ERROR)).toBe(2);
});
