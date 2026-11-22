// Take all (client/core/ui/take-all.ts): the open box's stacks asked for a few at a time, and asked again when the
// server had no room for a command.

import { expect, test } from "bun:test";
import type { ClientSession } from "../../client/core/session.ts";
import { TAKE_PATIENCE, TAKE_WAIT, TAKE_WINDOW, TakeAll } from "../../client/core/ui/take-all.ts";
import { BitReader, BitWriter } from "../../shared/net/codec.ts";
import { RESULT_BUSY, RESULT_INVALID, RESULT_OK } from "../../shared/net/protocol.ts";
import { Inventory } from "../../shared/sim/items.ts";

/** A session with a bag and an open box, whose commands are kept to be answered by hand: [sequence, box slot, bag slot]. */
function session(inBox: number, bag = 40) {
  const own = new Inventory(bag);
  const other = new Inventory(60);
  for (let s = 0; s < inBox; s++) [other.item[s * 2], other.count[s * 2]] = [7, 1];
  const sent: [number, number, number][] = [];
  let seq = 0;
  const s = {
    inventory: own,
    open: { name: "box", inventory: other, takeOnly: true } as ClientSession["open"],
    tickClock: 100,
    active: true,
    command(_op: number, args?: (w: BitWriter) => void): number {
      if (!s.active) return 0;
      const w = new BitWriter(64);
      args?.(w);
      const r = new BitReader(w.bytes().slice());
      r.bits(1);
      const from = r.varint();
      r.bits(1);
      sent.push([++seq, from, r.varint()]);
      return seq;
    },
  };
  /** The server runs a move: the stack is in the bag and out of the box. */
  const done = (m: readonly [number, number, number]): void => {
    [own.item[m[2]], own.count[m[2]], other.item[m[1]], other.count[m[1]]] = [7, 1, 0, 0];
  };
  return { s, as: s as unknown as ClientSession, own, other, sent, done };
}

test("take all asks for a few stacks at a time, each to its own slot of the bag, and for more as the answers come", () => {
  const { s, as, own, other, sent, done } = session(20);
  const t = new TakeAll();
  t.begin(as);
  // Eight wait at once: half of what the server queues from a session.
  expect([TAKE_WINDOW, sent.length, t.busy, sent.map((m) => m[1]), sent.map((m) => m[2])]).toEqual([8, 8, true, [0, 2, 4, 6, 8, 10, 12, 14], [0, 1, 2, 3, 4, 5, 6, 7]]);
  t.update(as);
  expect(sent.length).toBe(8);
  // Four answered, as the server runs four a tick: four more are asked, to the next slots, though the bag has not yet shown the first.
  for (const m of sent.slice(0, 4)) t.result(m[0], RESULT_OK, s.tickClock);
  t.update(as);
  expect([sent.length, sent.slice(8).map((m) => m[2])]).toEqual([12, [8, 9, 10, 11]]);
  // To the end: every stack asked for once, each to a slot of its own, and it is done when the last is answered.
  for (let at = 4; at < sent.length; at++) {
    done(sent[at]!);
    t.result(sent[at]![0], RESULT_OK, s.tickClock);
    t.update(as);
  }
  expect([sent.length, new Set(sent.map((m) => m[1])).size, new Set(sent.map((m) => m[2])).size, t.busy, other.used()]).toEqual([20, 20, 20, false, 4]);
  expect(own.used()).toBe(16);
});

test("a move the server had no room for is asked again after a few ticks, and one it refuses is not", () => {
  const { s, as, sent } = session(3);
  const t = new TakeAll();
  t.begin(as);
  expect(sent.map((m) => m[1])).toEqual([0, 2, 4]);
  // The second was not run; the third was refused (somebody else's by now).
  t.result(1, RESULT_OK, s.tickClock);
  t.result(2, RESULT_BUSY, s.tickClock);
  t.result(3, RESULT_INVALID, s.tickClock);
  t.update(as);
  expect([sent.length, t.busy]).toEqual([3, true]);
  s.tickClock += TAKE_WAIT;
  t.update(as);
  // Asked again, to the slot it was given back; an answer to a command that is none of its own changes nothing.
  expect(sent.slice(3)).toEqual([[4, 2, 1]]);
  t.result(99, RESULT_BUSY, s.tickClock);
  t.result(4, RESULT_OK, s.tickClock);
  t.update(as);
  expect([sent.length, t.busy]).toEqual([4, false]);
});

test("it stops when the bag is full, when the box shuts or is another, and when nothing can be sent", () => {
  // Room for two: two are asked, and with those answered there is no more she can carry.
  const full = session(5, 2);
  const t = new TakeAll();
  t.begin(full.as);
  expect([full.sent.length, t.busy]).toEqual([2, true]);
  for (const m of full.sent) (full.done(m), t.result(m[0], RESULT_OK, 100));
  t.update(full.as);
  expect([full.sent.length, t.busy, full.other.used()]).toEqual([2, false, 3]);
  // A slot given back by a refusal is used for the next stack.
  const back = session(3, 1);
  t.begin(back.as);
  t.result(back.sent[0]![0], RESULT_INVALID, 100);
  t.update(back.as);
  expect(back.sent.map((m) => [m[1], m[2]])).toEqual([[0, 0], [2, 0]]);
  t.stop();
  // The box shuts under it, or another is opened in its place: nothing of the first is asked of the second.
  const shut = session(12);
  t.begin(shut.as);
  shut.s.open = null;
  t.update(shut.as);
  expect([shut.sent.length, t.busy]).toEqual([8, false]);
  const swap = session(12);
  t.begin(swap.as);
  swap.s.open = { ...swap.s.open! };
  for (const m of swap.sent) t.result(m[0], RESULT_OK, 100);
  t.update(swap.as);
  expect([swap.sent.length, t.busy]).toEqual([8, false]);
  // A session that is not in the world sends nothing.
  const out = session(4);
  out.s.active = false;
  t.begin(out.as);
  expect([out.sent.length, t.busy]).toEqual([0, false]);
  // Pressed again while it runs, it takes up what has come since and asks for nothing twice.
  const again = session(10);
  t.begin(again.as);
  [again.other.item[41], again.other.count[41]] = [7, 1];
  t.begin(again.as);
  for (let at = 0; at < again.sent.length; at++) (again.done(again.sent[at]!), t.result(again.sent[at]![0], RESULT_OK, 100), t.update(again.as));
  expect([again.sent.length, new Set(again.sent.map((m) => m[1])).size, again.sent.at(-1)![1], t.busy]).toEqual([11, 11, 41, false]);
});

test("a press after one that is done takes again: what the first took holds no slot of the bag against the second", () => {
  // A bag of one slot: the box's one stack is taken.
  const { s, as, own, other, sent, done } = session(1, 1);
  const t = new TakeAll();
  t.begin(as);
  done(sent[0]!);
  t.result(sent[0]![0], RESULT_OK, s.tickClock);
  t.update(as);
  expect([sent.length, t.busy, own.used(), other.used()]).toEqual([1, false, 1, 0]);
  // She drops what she took, something more is put in the box that is still open, and she presses again.
  [own.item[0], own.count[0], other.item[5], other.count[5]] = [0, 0, 7, 1];
  t.begin(as);
  expect([sent.length, sent.at(-1)!.slice(1), t.busy]).toEqual([2, [5, 0], true]);
  done(sent[1]!);
  t.result(sent[1]![0], RESULT_OK, s.tickClock);
  expect([t.busy, own.used(), other.used()]).toEqual([false, 1, 0]);
  // The same while the first is still at work: a slot whose move is not yet answered stays spoken for, and one whose
  // stack has arrived and been dropped again is free.
  const two = session(3, 2);
  t.begin(two.as);
  expect(two.sent.map((m) => m[2])).toEqual([0, 1]);
  two.done(two.sent[0]!);
  t.result(two.sent[0]![0], RESULT_OK, 100);
  t.update(two.as);
  expect(two.sent.length).toBe(2);
  [two.own.item[0], two.own.count[0]] = [0, 0];
  t.begin(two.as);
  expect(two.sent.map((m) => [m[1], m[2]])).toEqual([[0, 0], [2, 1], [4, 0]]);
  // An answer that never comes does not hold the rest back for ever: after a few seconds the move is let go.
  const lost = session(10, 20);
  t.begin(lost.as);
  expect(lost.sent.length).toBe(TAKE_WINDOW);
  lost.s.tickClock += TAKE_PATIENCE + 1;
  t.update(lost.as);
  expect([lost.sent.length > TAKE_WINDOW, t.busy]).toEqual([true, true]);
});

