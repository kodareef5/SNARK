// S_CHAT on the wire: a line's runs and their inks, and what the reader refuses.

import { expect, test } from "bun:test";
import { CHAT_RUNS_MOST, readChat, writeChat, type TextRun } from "../../shared/net/chat.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { MAX_SERVER_TEXT_BYTES, TEXT_LOCAL, TEXT_TRIBE } from "../../shared/net/protocol.ts";

const roundTrip = (channel: number, runs: TextRun[]) => {
  const w = new BitWriter(4096);
  writeChat(w, channel, runs);
  return readChat(new BitReader(w.bytes()));
};

/** A message laid out by hand: its count of runs, then each run's ink and text. */
const raw = (count: number, runs: { ink?: number; text: string }[]): Uint8Array => {
  const w = new BitWriter(8192);
  w.u8(TEXT_LOCAL);
  w.bits(count, 4);
  for (const r of runs) {
    w.bool(r.ink !== undefined);
    if (r.ink !== undefined) w.bits(r.ink, 24);
    w.string(r.text);
  }
  return w.bytes().slice();
};

test("a line's runs keep their text and inks across the wire, and a run with no ink stays without", () => {
  const runs = [{ text: "[Admin] ", ink: 0xff3030 }, { text: "ada", ink: 0x00a0ff }, { text: ": hello \u{1F996}" }];
  expect(roundTrip(TEXT_TRIBE, runs)).toEqual({ channel: TEXT_TRIBE, text: "[Admin] ada: hello \u{1F996}", runs });
});

test("an ink costs 25 bits and a run with none one bit beside its text", () => {
  const size = (runs: TextRun[]): number => {
    const w = new BitWriter(256);
    writeChat(w, TEXT_LOCAL, runs);
    return w.pos;
  };
  const plain = size([{ text: "ada" }, { text: ": hi" }]);
  expect(size([{ text: "ada", ink: 0x123456 }, { text: ": hi" }]) - plain).toBe(24);
  expect(plain).toBe(8 + 4 + 2 * (1 + 8) + 8 * "ada: hi".length);
});

test("a message with too many runs, none, or too many bytes is refused", () => {
  const read = (data: Uint8Array) => readChat(new BitReader(data));
  const nine = Array.from({ length: CHAT_RUNS_MOST + 1 }, (_, i) => ({ text: `r${i}` }));
  expect(read(raw(CHAT_RUNS_MOST, nine.slice(0, CHAT_RUNS_MOST)))?.runs.length).toBe(CHAT_RUNS_MOST);
  expect(read(raw(CHAT_RUNS_MOST + 1, nine))).toBeNull();
  expect(read(raw(0, []))).toBeNull();
  const half = "x".repeat(MAX_SERVER_TEXT_BYTES / 2);
  expect(read(raw(2, [{ text: half }, { text: half }]))?.text.length).toBe(MAX_SERVER_TEXT_BYTES);
  expect(read(raw(2, [{ text: half }, { text: half + "x" }]))).toBeNull();
  // Cut short in the middle of a run.
  const whole = raw(2, [{ text: "ada", ink: 0xffffff }, { text: ": hello" }]);
  expect(read(whole.subarray(0, whole.length - 3))).toBeNull();
});

test("the writer leaves out runs past the most and cuts text past the bytes, so what it sends is read", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ text: `${i} ${"y".repeat(150)}`, ink: i }));
  const line = roundTrip(TEXT_LOCAL, many)!;
  expect(line.runs.length).toBe(CHAT_RUNS_MOST);
  expect(line.text.length).toBe(MAX_SERVER_TEXT_BYTES);
  expect(line.runs.map((r) => r.ink)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});
